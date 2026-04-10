// LUNA — Module: lead-scoring — Types
// Single-framework v3. Preset-based config, priority weights, enumScoring.

// ═══════════════════════════════════════════
// Framework types
// ═══════════════════════════════════════════

/** Objective — what the agent should do when lead qualifies */
export type FrameworkObjective = 'schedule' | 'sell' | 'escalate' | 'attend_only'

/** A stage groups related criteria within a framework */
export interface FrameworkStage {
  key: string                              // unique id: 'challenges', 'authority', etc.
  name: { es: string; en: string }         // display name
  description: { es: string; en: string }  // what the agent should explore in this stage
  order: number                            // sequence in the framework
}

// ═══════════════════════════════════════════
// Qualifying config — instance/qualifying.json
// ═══════════════════════════════════════════

export interface QualifyingCriterion {
  key: string                              // auto-generated from name.en (snake_case)
  name: { es: string; en: string }         // display name (user edits this, key auto-derives)
  type: 'text' | 'boolean' | 'enum'       // data type
  options?: string[]                       // only for 'enum' type
  priority: 'high' | 'medium' | 'low'     // replaces weight — computed in runtime
  required: boolean                        // must be filled to qualify
  neverAskDirectly: boolean                // agent should never ask this directly
  stage?: string                           // framework stage this criterion belongs to
  enumScoring?: 'indexed' | 'presence'    // default 'indexed' — 'presence' for non-scale enums
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

export interface QualifyingConfig {
  /** Preset base used (for display/reset). Null if fully custom */
  preset: string | null                    // 'champ' | 'spin' | 'champ_gov' | null
  /** Objective when the lead qualifies */
  objective: FrameworkObjective            // 'schedule' | 'sell' | 'escalate' | 'attend_only'
  /** Stages of the framework */
  stages: FrameworkStage[]
  /** Qualifying criteria (max 10) */
  criteria: QualifyingCriterion[]
  /** Disqualification reasons */
  disqualifyReasons: DisqualifyReason[]
  /** Essential questions for direct flow (max 2 keys) */
  essentialQuestions: string[]
  /** Global thresholds */
  thresholds: QualifyingThresholds
  /** Minimum confidence (0-1) to accept an extraction. Default: 0.4 */
  minConfidence: number
  /** Data freshness window in days. Default: 90 */
  dataFreshnessWindowDays: number
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
  | 'directo'            // skipped qualification, went straight to objective
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
  stage?: string         // framework stage this criterion belongs to
}

export interface StageScoreSummary {
  stageKey: string
  totalPoints: number
  maxPoints: number
  filledCount: number
  totalCount: number
  percentage: number     // 0-100
}

export interface ScoreResult {
  totalScore: number     // 0-100
  criteriaScores: CriterionScore[]
  stageScores: StageScoreSummary[]
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
  latestCampaignId: string | null
  latestCampaignName: string | null
  latestCampaignVisibleId: number | null
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

// ═══════════════════════════════════════════
// Helper: generate key from name
// ═══════════════════════════════════════════

/** Generate a snake_case key from an English name string */
export function generateKeyFromName(nameEn: string): string {
  return nameEn
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, '_')
    .replace(/^_+|_+$/g, '')
    .substring(0, 50)
}
