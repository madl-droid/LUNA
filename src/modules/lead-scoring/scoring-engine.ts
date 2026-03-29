// LUNA — Module: lead-scoring — Scoring Engine
// Motor de scoring por código. El LLM extrae, el código decide.
// Supports multi-framework with client_type routing and directo flow.

import pino from 'pino'
import type {
  QualifyingConfig,
  FrameworkConfig,
  QualifyingCriterion,
  QualificationStatus,
  ScoreResult,
  CriterionScore,
  FrameworkStage,
  StageScoreSummary,
  ClientType,
} from './types.js'
import { CLIENT_TYPE_FRAMEWORK } from './types.js'

const logger = pino({ name: 'lead-scoring:engine' })

// ═══════════════════════════════════════════
// Valid transitions in the state machine
// ═══════════════════════════════════════════

const VALID_TRANSITIONS: Record<string, QualificationStatus[]> = {
  new:            ['qualifying', 'directo', 'out_of_zone', 'not_interested', 'cold', 'blocked'],
  qualifying:     ['qualified', 'directo', 'out_of_zone', 'not_interested', 'cold', 'blocked'],
  qualified:      ['scheduled', 'blocked'],
  scheduled:      ['attended', 'cold', 'blocked'],
  attended:       ['converted', 'blocked'],
  converted:      ['blocked'],
  directo:        ['converted', 'blocked'],    // directo leads go straight to objective
  out_of_zone:    ['qualifying', 'blocked'],   // can re-enter if zone changes
  not_interested: ['qualifying', 'blocked'],   // can re-enter if interest changes
  cold:           ['qualifying', 'blocked'],   // can be reactivated
  blocked:        [],                          // terminal
}

/**
 * Resolve which framework to use for a contact based on their client_type.
 * If only one framework is active, always use that one.
 * If multiple, route by client_type. Falls back to first active framework.
 */
export function resolveFramework(
  config: QualifyingConfig,
  qualificationData: Record<string, unknown>,
): FrameworkConfig | null {
  const active = config.frameworks.filter(f => f.enabled)
  if (active.length === 0) return null
  if (active.length === 1) return active[0]!

  // Multi-framework: route by client_type
  const clientType = qualificationData['_client_type'] as ClientType | undefined
  if (clientType) {
    const fwType = CLIENT_TYPE_FRAMEWORK[clientType]
    const match = active.find(f => f.type === fwType)
    if (match) return match
  }

  // No client_type yet — return null to signal "detect client type first"
  return null
}

/**
 * Calculate the qualification score for a contact based on their data.
 * Returns score 0-100 and suggested status transition.
 */
export function calculateScore(
  qualificationData: Record<string, unknown>,
  config: QualifyingConfig,
  frameworkOverride?: FrameworkConfig,
): ScoreResult {
  const fw = frameworkOverride ?? resolveFramework(config, qualificationData)

  if (!fw) {
    // No framework resolved (multi-framework, client_type unknown)
    return {
      totalScore: 0,
      criteriaScores: [],
      stageScores: [],
      filledCount: 0,
      totalCount: 0,
      missingRequired: [],
      suggestedStatus: 'qualifying',
      disqualified: false,
    }
  }

  const { criteria } = fw
  const { thresholds } = config

  if (criteria.length === 0) {
    return {
      totalScore: 0,
      criteriaScores: [],
      stageScores: [],
      filledCount: 0,
      totalCount: 0,
      missingRequired: [],
      suggestedStatus: 'new',
      disqualified: false,
    }
  }

  // Normalize weights to sum to 100
  const totalWeight = criteria.reduce((sum, c) => sum + c.weight, 0)
  const weightMultiplier = totalWeight > 0 ? 100 / totalWeight : 1

  const criteriaScores: CriterionScore[] = []
  const missingRequired: string[] = []
  let totalScore = 0

  for (const criterion of criteria) {
    const value = qualificationData[criterion.key]
    const filled = isFilled(value, criterion)
    const normalizedWeight = criterion.weight * weightMultiplier
    const points = filled ? calculateCriterionPoints(value, criterion, normalizedWeight) : 0

    criteriaScores.push({
      key: criterion.key,
      filled,
      value,
      points: Math.round(points * 100) / 100,
      maxPoints: Math.round(normalizedWeight * 100) / 100,
      stage: criterion.stage,
    })

    totalScore += points

    if (criterion.required && !filled) {
      missingRequired.push(criterion.key)
    }
  }

  totalScore = Math.round(Math.min(100, Math.max(0, totalScore)))

  // Calculate stage scores
  const stageScores = calculateStageScores(criteriaScores, fw.stages ?? [])

  // Check for disqualification in data
  const disqualifyKey = qualificationData['_disqualified'] as string | undefined
  if (disqualifyKey) {
    const reason = fw.disqualifyReasons.find(r => r.key === disqualifyKey)
    return {
      totalScore,
      criteriaScores,
      stageScores,
      filledCount: criteriaScores.filter(c => c.filled).length,
      totalCount: criteria.length,
      missingRequired,
      suggestedStatus: reason?.targetStatus ?? 'not_interested',
      disqualified: true,
      disqualifyReason: disqualifyKey,
    }
  }

  // Determine suggested status based on score and thresholds
  let suggestedStatus: QualificationStatus
  if (totalScore >= thresholds.qualified && missingRequired.length === 0) {
    suggestedStatus = 'qualified'
  } else if (totalScore <= thresholds.cold) {
    suggestedStatus = 'cold'
  } else {
    suggestedStatus = 'qualifying'
  }

  return {
    totalScore,
    criteriaScores,
    stageScores,
    filledCount: criteriaScores.filter(c => c.filled).length,
    totalCount: criteria.length,
    missingRequired,
    suggestedStatus,
    disqualified: false,
  }
}

/**
 * Calculate aggregate scores per framework stage.
 */
function calculateStageScores(
  criteriaScores: CriterionScore[],
  stages: FrameworkStage[],
): StageScoreSummary[] {
  if (stages.length === 0) return []

  return stages
    .sort((a, b) => a.order - b.order)
    .map(stage => {
      const stageCriteria = criteriaScores.filter(c => c.stage === stage.key)
      const totalPoints = stageCriteria.reduce((sum, c) => sum + c.points, 0)
      const maxPoints = stageCriteria.reduce((sum, c) => sum + c.maxPoints, 0)
      const filledCount = stageCriteria.filter(c => c.filled).length
      return {
        stageKey: stage.key,
        totalPoints: Math.round(totalPoints * 100) / 100,
        maxPoints: Math.round(maxPoints * 100) / 100,
        filledCount,
        totalCount: stageCriteria.length,
        percentage: maxPoints > 0 ? Math.round((totalPoints / maxPoints) * 100) : 0,
      }
    })
}

/**
 * Determine which stage the agent should focus on extracting data from.
 * Returns the first stage that has unfilled criteria.
 */
export function getCurrentStage(
  qualificationData: Record<string, unknown>,
  fw: FrameworkConfig,
): FrameworkStage | null {
  if (!fw.stages || fw.stages.length === 0) return null

  const sortedStages = [...fw.stages].sort((a, b) => a.order - b.order)

  for (const stage of sortedStages) {
    const stageCriteria = fw.criteria.filter(c => c.stage === stage.key)
    const hasUnfilled = stageCriteria.some(c => {
      const value = qualificationData[c.key]
      return !isFilled(value, c)
    })
    if (hasUnfilled) return stage
  }

  // All stages complete
  return null
}

/**
 * Calculate points for a single criterion based on value and type.
 * Enum values get full or partial points depending on the option chosen.
 */
function calculateCriterionPoints(
  value: unknown,
  criterion: QualifyingCriterion,
  maxPoints: number,
): number {
  switch (criterion.type) {
    case 'boolean':
      return value === true ? maxPoints : 0

    case 'text':
      // Text: filled = full points (presence-based)
      return maxPoints

    case 'enum': {
      if (!criterion.options || criterion.options.length === 0) return 0
      const strVal = String(value)
      const idx = criterion.options.indexOf(strVal)
      if (idx === -1) return maxPoints * 0.5 // unknown option gets half
      // Higher index = better (e.g. low=0, medium=1, high=2)
      const ratio = (idx + 1) / criterion.options.length
      return maxPoints * ratio
    }

    default:
      return 0
  }
}

/**
 * Check if a criterion value counts as "filled"
 */
function isFilled(value: unknown, _criterion: QualifyingCriterion): boolean {
  if (value === undefined || value === null) return false
  if (typeof value === 'string' && value.trim() === '') return false
  return true
}

/**
 * Determine if a status transition is valid, and apply it.
 * Returns the new status if transition is valid, null if not.
 */
export function resolveTransition(
  currentStatus: QualificationStatus,
  suggestedStatus: QualificationStatus,
): QualificationStatus | null {
  if (currentStatus === suggestedStatus) return null // no change

  const allowed = VALID_TRANSITIONS[currentStatus]
  if (!allowed || !allowed.includes(suggestedStatus)) {
    logger.debug(
      { from: currentStatus, to: suggestedStatus },
      'Transition not allowed',
    )
    return null
  }

  return suggestedStatus
}

/**
 * Merge new extracted data into existing qualification data.
 * Only overwrites if new value has higher confidence or existing is empty.
 * Extractions below minConfidence are discarded (unless no existing value).
 */
export function mergeQualificationData(
  existing: Record<string, unknown>,
  extracted: Record<string, unknown>,
  confidence: Record<string, number>,
  minConfidence = 0.3,
): Record<string, unknown> {
  const merged = { ...existing }

  for (const [key, newValue] of Object.entries(extracted)) {
    if (key.startsWith('_')) {
      // Special keys like _disqualified, _client_type always overwrite
      merged[key] = newValue
      continue
    }

    const existingValue = existing[key]
    const newConfidence = confidence[key] ?? 0.5
    const existingConfidence = (existing['_confidence'] as Record<string, number> | undefined)?.[key] ?? 0
    const hasExisting = isFilled(existingValue, { key, type: 'text', name: { es: '', en: '' }, weight: 0, required: false, neverAskDirectly: false })

    // Skip low-confidence extractions when there's already a value
    if (newConfidence < minConfidence && hasExisting) {
      logger.debug({ key, newConfidence, minConfidence }, 'Skipping low-confidence extraction — existing value preserved')
      continue
    }

    // Overwrite if: no existing value, or new confidence is higher
    if (!hasExisting) {
      merged[key] = newValue
    } else if (newConfidence > existingConfidence) {
      merged[key] = newValue
    }
  }

  // Update confidence tracking (only for values that passed the threshold)
  const existingConf = (existing['_confidence'] as Record<string, number>) ?? {}
  const acceptedConf: Record<string, number> = {}
  for (const [key, conf] of Object.entries(confidence)) {
    if (key.startsWith('_') || merged[key] === extracted[key]) {
      acceptedConf[key] = conf
    }
  }
  merged['_confidence'] = { ...existingConf, ...acceptedConf }

  return merged
}

/**
 * Build a summary of qualification state for injection into evaluator/compositor prompts.
 */
export function buildQualificationSummary(
  qualificationData: Record<string, unknown>,
  config: QualifyingConfig,
  lang: 'es' | 'en' = 'en',
): string {
  const fw = resolveFramework(config, qualificationData)
  const clientType = qualificationData['_client_type'] as ClientType | undefined
  const active = config.frameworks.filter(f => f.enabled)

  const lines: string[] = []

  // Client type
  if (clientType) {
    lines.push(`Client type: ${clientType.toUpperCase()}`)
  } else if (active.length > 1) {
    lines.push(`Client type: UNKNOWN (needs detection — ask if they are a person, company, or government entity)`)
  }

  if (!fw) {
    lines.push(`Framework: pending client type detection`)
    lines.push(`Active frameworks: ${active.map(f => `${f.type} (${lang === 'es' ? 'objetivo' : 'objective'}: ${f.objective})`).join(', ')}`)
    return lines.join('\n')
  }

  const scoreResult = calculateScore(qualificationData, config, fw)

  lines.push(`Framework: ${fw.type.toUpperCase()}`)
  lines.push(`Objective: ${fw.objective}`)
  lines.push(`Score: ${scoreResult.totalScore}/100`)
  lines.push(`Status: ${scoreResult.suggestedStatus}`)
  lines.push(`Progress: ${scoreResult.filledCount}/${scoreResult.totalCount} criteria filled`)

  // Stage progress
  if (scoreResult.stageScores.length > 0) {
    lines.push(`Stages:`)
    for (const ss of scoreResult.stageScores) {
      const stage = fw.stages.find(s => s.key === ss.stageKey)
      const stageName = stage ? stage.name[lang] : ss.stageKey
      lines.push(`  - ${stageName}: ${ss.filledCount}/${ss.totalCount} (${ss.percentage}%)`)
    }
  }

  // What's missing
  if (scoreResult.missingRequired.length > 0) {
    const missingNames = scoreResult.missingRequired.map(k => {
      const c = fw.criteria.find(cr => cr.key === k)
      return c ? c.name[lang] : k
    })
    lines.push(`Missing required: ${missingNames.join(', ')}`)
  }

  // What we know (filled criteria)
  const known = scoreResult.criteriaScores.filter(c => c.filled)
  if (known.length > 0) {
    lines.push(`Known:`)
    for (const k of known) {
      const c = fw.criteria.find(cr => cr.key === k.key)
      const name = c ? c.name[lang] : k.key
      lines.push(`  - ${name}: ${JSON.stringify(k.value)}`)
    }
  }

  // What we still need (unfilled, not neverAskDirectly)
  const needed = scoreResult.criteriaScores.filter(c => !c.filled)
  const askable = needed.filter(n => {
    const criterion = fw.criteria.find(cr => cr.key === n.key)
    return criterion && !criterion.neverAskDirectly
  })
  if (askable.length > 0) {
    lines.push(`Still needed (can ask):`)
    for (const n of askable.slice(0, 5)) {
      const c = fw.criteria.find(cr => cr.key === n.key)
      const name = c ? c.name[lang] : n.key
      lines.push(`  - ${name}`)
    }
  }

  // Never ask directly (unfilled)
  const neverAsk = needed.filter(n => {
    const criterion = fw.criteria.find(cr => cr.key === n.key)
    return criterion?.neverAskDirectly
  })
  if (neverAsk.length > 0) {
    lines.push(`Never ask directly (infer only):`)
    for (const n of neverAsk) {
      const c = fw.criteria.find(cr => cr.key === n.key)
      const name = c ? c.name[lang] : n.key
      lines.push(`  - ${name}`)
    }
  }

  // Essential questions for directo flow
  if (fw.essentialQuestions.length > 0) {
    const eqNames = fw.essentialQuestions.map(k => {
      const c = fw.criteria.find(cr => cr.key === k)
      return c ? c.name[lang] : k
    })
    lines.push(`Essential questions (for direct conversion): ${eqNames.join(', ')}`)
  }

  return lines.join('\n')
}
