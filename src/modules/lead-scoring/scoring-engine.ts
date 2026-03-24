// LUNA — Module: lead-scoring — Scoring Engine
// Motor de scoring por código. El LLM extrae, el código decide.

import pino from 'pino'
import type {
  QualifyingConfig,
  QualifyingCriterion,
  QualificationStatus,
  ScoreResult,
  CriterionScore,
} from './types.js'

const logger = pino({ name: 'lead-scoring:engine' })

// ═══════════════════════════════════════════
// Valid transitions in the state machine
// ═══════════════════════════════════════════

const VALID_TRANSITIONS: Record<string, QualificationStatus[]> = {
  new:            ['qualifying', 'out_of_zone', 'not_interested', 'cold', 'blocked'],
  qualifying:     ['qualified', 'out_of_zone', 'not_interested', 'cold', 'blocked'],
  qualified:      ['scheduled', 'blocked'],
  scheduled:      ['attended', 'cold', 'blocked'],
  attended:       ['converted', 'blocked'],
  converted:      ['blocked'],
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
    })

    totalScore += points

    if (criterion.required && !filled) {
      missingRequired.push(criterion.key)
    }
  }

  totalScore = Math.round(Math.min(100, Math.max(0, totalScore)))

  // Check for disqualification in data
  const disqualifyKey = qualificationData['_disqualified'] as string | undefined
  if (disqualifyKey) {
    const reason = config.disqualifyReasons.find(r => r.key === disqualifyKey)
    return {
      totalScore,
      criteriaScores,
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
    filledCount: criteriaScores.filter(c => c.filled).length,
    totalCount: criteria.length,
    missingRequired,
    suggestedStatus,
    disqualified: false,
  }
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
      // Special keys like _disqualified always overwrite
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
