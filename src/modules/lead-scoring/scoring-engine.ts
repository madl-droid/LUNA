// LUNA — Module: lead-scoring — Scoring Engine (v3)
// Single-framework. Priority-based weights. EnumScoring configurable.
// LLM extracts, code decides. No multi-framework routing.

import pino from 'pino'
import type {
  QualifyingConfig,
  QualifyingCriterion,
  QualificationStatus,
  ScoreResult,
  CriterionScore,
  FrameworkStage,
  StageScoreSummary,
} from './types.js'

const logger = pino({ name: 'lead-scoring:engine' })

// ═══════════════════════════════════════════
// Priority → weight mapping
// ═══════════════════════════════════════════

const PRIORITY_WEIGHT: Record<string, number> = { high: 3, medium: 2, low: 1 }

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
 * Calculate the qualification score for a contact based on their data.
 * Returns score 0-100 and suggested status transition.
 */
export function calculateScore(
  qualificationData: Record<string, unknown>,
  config: QualifyingConfig,
): ScoreResult {
  const { criteria, thresholds } = config

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

  // Compute total weight from priorities
  const totalWeight = criteria.reduce((sum, c) => sum + (PRIORITY_WEIGHT[c.priority] ?? 2), 0)
  const weightMultiplier = totalWeight > 0 ? 100 / totalWeight : 1

  const criteriaScores: CriterionScore[] = []
  const missingRequired: string[] = []
  let totalScore = 0

  for (const criterion of criteria) {
    const value = qualificationData[criterion.key]
    const filled = isFilled(value)
    const normalizedWeight = (PRIORITY_WEIGHT[criterion.priority] ?? 2) * weightMultiplier
    const basePoints = filled ? calculateCriterionPoints(value, criterion, normalizedWeight) : 0

    // Apply temporal decay: older data contributes less to the score
    const extractedAt = (qualificationData['_extracted_at'] as Record<string, string> | undefined)?.[criterion.key]
    const decayMultiplier = filled ? calculateDecay(extractedAt, config.dataFreshnessWindowDays ?? 90) : 0
    const points = basePoints * decayMultiplier

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
  const stageScores = calculateStageScores(criteriaScores, config.stages ?? [])

  // Check for disqualification in data
  const disqualifyKey = qualificationData['_disqualified'] as string | undefined
  if (disqualifyKey) {
    const reason = config.disqualifyReasons.find(r => r.key === disqualifyKey)
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
  config: QualifyingConfig,
): FrameworkStage | null {
  const stages = config.stages
  if (!stages || stages.length === 0) return null

  const sortedStages = [...stages].sort((a, b) => a.order - b.order)

  for (const stage of sortedStages) {
    const stageCriteria = config.criteria.filter(c => c.stage === stage.key)
    const hasUnfilled = stageCriteria.some(c => !isFilled(qualificationData[c.key]))
    if (hasUnfilled) return stage
  }

  return null
}

/**
 * Calculate a temporal decay multiplier for a qualification data point.
 * Returns 1.0 for fresh data, 0.3 floor for data older than windowDays.
 * Linear decay between 1.0 and 0.3 over the window.
 */
function calculateDecay(extractedAtISO: string | undefined, windowDays: number): number {
  if (!extractedAtISO || windowDays <= 0) return 1 // no timestamp or no decay = full score

  const extractedAt = new Date(extractedAtISO)
  if (isNaN(extractedAt.getTime())) return 1 // invalid date = no decay

  const now = new Date()
  const ageMs = now.getTime() - extractedAt.getTime()
  const ageDays = ageMs / (1000 * 60 * 60 * 24)

  if (ageDays <= 0) return 1
  if (ageDays >= windowDays) return 0.3 // floor: very old data still contributes 30%

  // Linear decay from 1.0 → 0.3 over windowDays
  return 1 - (0.7 * ageDays / windowDays)
}

/**
 * Calculate points for a single criterion based on value and type.
 * Enum values: 'indexed' (default) gives partial/full based on position,
 * 'presence' gives full points if any valid option is set.
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
      return maxPoints

    case 'enum': {
      if (!criterion.options || criterion.options.length === 0) return 0
      const strVal = String(value)
      const idx = criterion.options.indexOf(strVal)

      // Presence mode: full points if valid option, 0 if unknown
      if (criterion.enumScoring === 'presence') {
        return idx !== -1 ? maxPoints : 0
      }

      // Indexed mode (default): higher index = better score; 0 if unknown
      if (idx === -1) return 0
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
export function isFilled(value: unknown): boolean {
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
 * Tracks extraction timestamps in _extracted_at.
 */
export function mergeQualificationData(
  existing: Record<string, unknown>,
  extracted: Record<string, unknown>,
  confidence: Record<string, number>,
  minConfidence = 0.4,
): Record<string, unknown> {
  const merged = { ...existing }
  const now = new Date().toISOString()
  const adoptedKeys = new Set<string>()

  for (const [key, newValue] of Object.entries(extracted)) {
    if (key.startsWith('_')) {
      // Special keys like _disqualified always overwrite
      merged[key] = newValue
      continue
    }

    const existingValue = existing[key]
    const newConfidence = confidence[key] ?? 0.5
    const existingConfidence = (existing['_confidence'] as Record<string, number> | undefined)?.[key] ?? 0
    const hasExisting = isFilled(existingValue)

    // Skip low-confidence extractions when there's already a value
    if (newConfidence < minConfidence && hasExisting) {
      logger.debug({ key, newConfidence, minConfidence }, 'Skipping low-confidence extraction — existing value preserved')
      continue
    }

    // Overwrite if: no existing value, or new confidence is higher
    if (!hasExisting || newConfidence > existingConfidence) {
      merged[key] = newValue
      adoptedKeys.add(key)
      // Track extraction timestamp
      const extractedAt = (merged['_extracted_at'] as Record<string, string>) ?? {}
      extractedAt[key] = now
      merged['_extracted_at'] = extractedAt
    }
  }

  // Update confidence tracking — only for keys that were actually adopted
  const existingConf = (existing['_confidence'] as Record<string, number>) ?? {}
  const acceptedConf: Record<string, number> = {}
  for (const [key, conf] of Object.entries(confidence)) {
    if (key.startsWith('_') || adoptedKeys.has(key)) {
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
  const scoreResult = calculateScore(qualificationData, config)

  const lines: string[] = []

  lines.push(`Framework: ${config.preset?.toUpperCase() ?? 'CUSTOM'}`)
  lines.push(`Objective: ${config.objective}`)
  lines.push(`Score: ${scoreResult.totalScore}/100`)
  lines.push(`Status: ${scoreResult.suggestedStatus}`)
  lines.push(`Progress: ${scoreResult.filledCount}/${scoreResult.totalCount} criteria filled`)

  // Stage progress
  if (scoreResult.stageScores.length > 0) {
    lines.push(`Stages:`)
    for (const ss of scoreResult.stageScores) {
      const stage = config.stages.find(s => s.key === ss.stageKey)
      const stageName = stage ? stage.name[lang] : ss.stageKey
      lines.push(`  - ${stageName}: ${ss.filledCount}/${ss.totalCount} (${ss.percentage}%)`)
    }
  }

  // What's missing (required)
  if (scoreResult.missingRequired.length > 0) {
    const missingNames = scoreResult.missingRequired.map(k => {
      const c = config.criteria.find(cr => cr.key === k)
      return c ? c.name[lang] : k
    })
    lines.push(`Missing required: ${missingNames.join(', ')}`)
  }

  // What we know (filled criteria)
  const known = scoreResult.criteriaScores.filter(c => c.filled)
  if (known.length > 0) {
    lines.push(`Known:`)
    for (const k of known) {
      const c = config.criteria.find(cr => cr.key === k.key)
      const name = c ? c.name[lang] : k.key
      lines.push(`  - ${name}: ${JSON.stringify(k.value)}`)
    }
  }

  // What we still need (unfilled, not neverAskDirectly)
  const needed = scoreResult.criteriaScores.filter(c => !c.filled)
  const askable = needed.filter(n => {
    const criterion = config.criteria.find(cr => cr.key === n.key)
    return criterion && !criterion.neverAskDirectly
  })
  if (askable.length > 0) {
    lines.push(`Still needed (can ask):`)
    for (const n of askable.slice(0, 5)) {
      const c = config.criteria.find(cr => cr.key === n.key)
      const name = c ? c.name[lang] : n.key
      lines.push(`  - ${name}`)
    }
  }

  // Never ask directly (unfilled)
  const neverAsk = needed.filter(n => {
    const criterion = config.criteria.find(cr => cr.key === n.key)
    return criterion?.neverAskDirectly
  })
  if (neverAsk.length > 0) {
    lines.push(`Never ask directly (infer only):`)
    for (const n of neverAsk) {
      const c = config.criteria.find(cr => cr.key === n.key)
      const name = c ? c.name[lang] : n.key
      lines.push(`  - ${name}`)
    }
  }

  // Essential questions for directo flow
  if (config.essentialQuestions.length > 0) {
    const eqNames = config.essentialQuestions.map(k => {
      const c = config.criteria.find(cr => cr.key === k)
      return c ? c.name[lang] : k
    })
    lines.push(`Essential questions (for direct conversion): ${eqNames.join(', ')}`)
  }

  return lines.join('\n')
}
