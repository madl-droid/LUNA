// LUNA — Module: lead-scoring — Types
// Interfaces del sistema de calificación de leads.
// Multi-framework, objectives, client_type detection, directo flow.

// ═══════════════════════════════════════════
// Framework types
// ═══════════════════════════════════════════

/** Available qualification frameworks (no custom — only presets) */
export type FrameworkType = 'champ' | 'spin' | 'champ_gov'

/** Client type — detected from first interaction, routes to framework */
export type ClientType = 'b2b' | 'b2c' | 'b2g'

/** Mapping from client type to framework */
export const CLIENT_TYPE_FRAMEWORK: Record<ClientType, FrameworkType> = {
  b2b: 'champ',
  b2c: 'spin',
  b2g: 'champ_gov',
}

/** Objective — what the agent should do when lead qualifies */
export type FrameworkObjective = 'schedule' | 'sell' | 'escalate' | 'attend_only'

/** A stage groups related criteria within a framework */
export interface FrameworkStage {
  key: string                              // unique id: 'challenges', 'authority', etc.
  name: { es: string; en: string }         // display name
  description: { es: string; en: string }  // what the agent should explore in this stage
  order: number                            // sequence in the framework
}

/** A complete framework preset */
export interface FrameworkPreset {
  type: FrameworkType
  clientType: ClientType
  name: { es: string; en: string }
  description: { es: string; en: string }
  stages: FrameworkStage[]
  criteria: QualifyingCriterion[]
  disqualifyReasons: DisqualifyReason[]
  /** Max 2 essential questions — asked before converting a lead directly */
  essentialQuestions: string[]
}

// ═══════════════════════════════════════════
// Qualifying config — instance/qualifying.json
// ═══════════════════════════════════════════

export interface QualifyingCriterion {
  key: string                              // auto-generated from name.en (snake_case)
  name: { es: string; en: string }         // display name (user edits this, key auto-derives)
  type: 'text' | 'boolean' | 'enum'       // data type
  options?: string[]                       // only for 'enum' type
  weight: number                           // 0-100 contribution to score
  required: boolean                        // must be filled to qualify
  neverAskDirectly: boolean                // agent should never ask this directly
  stage?: string                           // framework stage this criterion belongs to
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

/** Config per active framework */
export interface FrameworkConfig {
  type: FrameworkType
  enabled: boolean
  objective: FrameworkObjective
  stages: FrameworkStage[]
  criteria: QualifyingCriterion[]
  disqualifyReasons: DisqualifyReason[]
  /** Max 2 essential questions keys — asked before converting a lead directly (directo flow) */
  essentialQuestions: string[]
}

export interface QualifyingConfig {
  /** Active frameworks — one or more can be active simultaneously */
  frameworks: FrameworkConfig[]
  /** Global thresholds (apply to all frameworks) */
  thresholds: QualifyingThresholds
  /** Always true — system always recalculates on config change */
  recalculateOnConfigChange: boolean
  /** Minimum confidence (0-1) to accept an LLM extraction. Default: 0.3 */
  minConfidence: number
}

// ═══════════════════════════════════════════
// Stats with channel breakdown
// ═══════════════════════════════════════════

export interface MetricChannelBreakdown {
  channel: string
  count: number
}

export interface StatusMetric {
  status: string
  total: number
  channels: MetricChannelBreakdown[]
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
  clientTypeDetected?: ClientType          // detected client type (b2b, b2c, b2g)
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
