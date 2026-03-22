// LUNA — Module: lead-scoring — Types
// Interfaces del sistema de calificación de leads.

// ═══════════════════════════════════════════
// Qualifying config — instance/qualifying.json
// ═══════════════════════════════════════════

export interface QualifyingCriterion {
  key: string                              // unique id: 'budget', 'authority', 'zone', etc.
  name: { es: string; en: string }         // display name
  type: 'text' | 'boolean' | 'enum'       // data type
  options?: string[]                       // only for 'enum' type
  weight: number                           // 0-100 contribution to score
  required: boolean                        // must be filled to qualify
  neverAskDirectly: boolean                // agent should never ask this directly
}

export interface DisqualifyReason {
  key: string                              // unique id: 'no_budget', 'spam', etc.
  name: { es: string; en: string }         // display name
  targetStatus: QualificationStatus        // status to transition to
}

export interface QualifyingThresholds {
  cold: number                             // score <= cold → cold
  qualifying: number                       // cold < score < qualified → qualifying
  qualified: number                        // score >= qualified → qualified
}

export type QualifiedAction = 'scheduled' | 'transferred_to_sales' | 'sold' | 'purchase_complete'

export interface QualifyingConfig {
  criteria: QualifyingCriterion[]
  thresholds: QualifyingThresholds
  qualifiedActions: QualifiedAction[]
  defaultQualifiedAction: QualifiedAction
  disqualifyReasons: DisqualifyReason[]
  maxCustomCriteria: number
  recalculateOnConfigChange: boolean
  /** Minimum confidence (0-1) to accept an LLM extraction. Default: 0.3 */
  minConfidence: number
}

// ═══════════════════════════════════════════
// Qualification status (state machine)
// ═══════════════════════════════════════════

export type QualificationStatus =
  | 'new'
  | 'qualifying'
  | 'qualified'
  | 'scheduled'
  | 'attended'
  | 'converted'
  | 'out_of_zone'
  | 'not_interested'
  | 'cold'
  | 'blocked'

// ═══════════════════════════════════════════
// Scoring result
// ═══════════════════════════════════════════

export interface CriterionScore {
  key: string
  filled: boolean
  value: unknown
  points: number         // weighted points earned
  maxPoints: number      // max possible for this criterion
}

export interface ScoreResult {
  totalScore: number     // 0-100
  criteriaScores: CriterionScore[]
  filledCount: number
  totalCount: number
  missingRequired: string[]
  suggestedStatus: QualificationStatus
  disqualified: boolean
  disqualifyReason?: string
}

// ═══════════════════════════════════════════
// Extraction output (from extract_qualification tool)
// ═══════════════════════════════════════════

export interface ExtractionResult {
  extracted: Record<string, unknown>       // key → value pairs from conversation
  confidence: Record<string, number>       // key → 0-1 confidence
  disqualifyDetected?: string              // disqualify reason key if detected
}

// ═══════════════════════════════════════════
// Lead view (for console UI)
// ═══════════════════════════════════════════

export interface LeadSummary {
  contactId: string
  displayName: string | null
  channelContactId: string
  channel: string
  contactType: string
  qualificationStatus: QualificationStatus
  qualificationScore: number
  qualificationData: Record<string, unknown>
  createdAt: string
  updatedAt: string
  lastActivityAt: string | null
  messageCount: number
}

export interface LeadDetail extends LeadSummary {
  channels: Array<{ channel: string; channelContactId: string; isPrimary: boolean }>
  recentMessages: Array<{
    id: string
    senderType: string
    content: { type: string; text?: string }
    createdAt: string
  }>
}

// ═══════════════════════════════════════════
// Module config (env vars via configSchema)
// ═══════════════════════════════════════════

export interface LeadScoringConfig {
  LEAD_SCORING_CONFIG_PATH: string
}
