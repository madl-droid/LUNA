// LUNA Engine — Types
// Todos los tipos del pipeline de procesamiento de mensajes.

import type { ChannelName, IncomingMessage, MessageContent } from '../channels/types.js'

// ═══════════════════════════════════════════
// User resolution (S02 interface)
// ═══════════════════════════════════════════

export type UserType = 'admin' | 'coworker' | 'lead' | 'custom1' | 'custom2'

export interface UserResolution {
  userType: UserType
  contactId: string | null
  displayName: string | null
}

export interface UserPermissions {
  tools: string[]
  skills: string[]
  subagents: boolean
  canReceiveProactive: boolean
}

// ═══════════════════════════════════════════
// Tool framework (S03 interface)
// ═══════════════════════════════════════════

export interface ToolResult {
  success: boolean
  data?: unknown
  error?: string
}

export interface ToolCatalogEntry {
  name: string
  description: string
  category: string
}

export interface ToolDefinition {
  name: string
  description: string
  parameters: Record<string, unknown>
}

// ═══════════════════════════════════════════
// Context Bundle — output of Phase 1
// ═══════════════════════════════════════════

export interface ContactInfo {
  id: string
  channelContactId: string
  channel: ChannelName
  displayName: string | null
  contactType: string | null
  qualificationStatus: string | null
  qualificationScore: number | null
  qualificationData: Record<string, unknown> | null
  createdAt: Date
}

export interface SessionInfo {
  id: string
  contactId: string
  agentId: string
  channel: ChannelName
  startedAt: Date
  lastActivityAt: Date
  messageCount: number
  compressedSummary: string | null
  isNew: boolean
}

export interface CampaignInfo {
  id: string
  name: string
  keyword: string | null
  utm: Record<string, string> | null
}

export interface KnowledgeMatch {
  content: string
  source: string
  score: number
}

export interface HistoryMessage {
  role: 'user' | 'assistant'
  content: string
  timestamp: Date
}

export interface AttachmentMetadata {
  index: number
  type: 'document' | 'image' | 'audio' | 'spreadsheet' | 'presentation' | 'text' | 'unknown'
  name: string | null
  size: number | null
  mime: string | null
}

export interface KnowledgeInjection {
  coreDocuments: Array<{ title: string; description: string }>
  categories: Array<{ id: string; title: string; description: string }>
  apiConnectors: Array<{ title: string; description: string }>
}

export interface ContextBundle {
  // Original message
  message: IncomingMessage
  traceId: string

  // User resolution (first thing resolved)
  userType: UserType
  userPermissions: UserPermissions
  contactId: string | null

  // Agent (resolved from config or DB)
  agentId: string

  // Contact & session
  contact: ContactInfo | null
  session: SessionInfo
  isNewContact: boolean

  // Campaign
  campaign: CampaignInfo | null

  // RAG — legacy fallback matches
  knowledgeMatches: KnowledgeMatch[]

  // Knowledge v2 — structured injection for evaluator
  knowledgeInjection: KnowledgeInjection | null

  // History
  history: HistoryMessage[]

  // Memory v3 — from memory:manager service
  contactMemory: import('../modules/memory/types.js').ContactMemory | null
  pendingCommitments: import('../modules/memory/types.js').Commitment[]
  relevantSummaries: import('../modules/memory/types.js').HybridSearchResult[]
  leadStatus: string | null

  // Sheets cache (from Redis)
  sheetsData: Record<string, unknown> | null

  // Normalized text
  normalizedText: string
  messageType: MessageContent['type']

  // Response format preference (text, audio, or auto)
  responseFormat: 'text' | 'audio' | 'auto'

  // Attachment metadata (lightweight, no processing)
  attachmentMeta: AttachmentMetadata[]

  // Attachment context (processed — populated by Phase 3, not Phase 1)
  attachmentContext: import('./attachments/types.js').AttachmentContext | null

  // Injection flag from basic regex check
  possibleInjection: boolean
}

// ═══════════════════════════════════════════
// Phase 2 — Evaluator output
// ═══════════════════════════════════════════

export type ExecutionPlanType =
  | 'respond_only'
  | 'api_call'
  | 'workflow'
  | 'subagent'
  | 'memory_lookup'
  | 'web_search'
  | 'process_attachment'

export interface ExecutionStep {
  type: ExecutionPlanType
  tool?: string
  params?: Record<string, unknown>
  description?: string
  dependsOn?: number[]  // indices of steps this depends on
}

export interface EvaluatorOutput {
  intent: string
  emotion: string
  injectionRisk: boolean
  onScope: boolean
  executionPlan: ExecutionStep[]
  toolsNeeded: string[]
  needsAcknowledgment: boolean
  searchQuery?: string      // v2: query for search_knowledge tool
  searchHint?: string       // v2: category title hint for boosting
  rawResponse?: string
}

// ═══════════════════════════════════════════
// Phase 3 — Execution results
// ═══════════════════════════════════════════

export interface StepResult {
  stepIndex: number
  type: ExecutionPlanType
  success: boolean
  data?: unknown
  error?: string
  durationMs: number
}

export interface ExecutionOutput {
  results: StepResult[]
  allSucceeded: boolean
  partialData: Record<string, unknown>
}

// ═══════════════════════════════════════════
// Phase 4 — Compositor output
// ═══════════════════════════════════════════

export interface CompositorOutput {
  responseText: string
  formattedParts: string[]
  audioBuffer?: Buffer
  audioDurationSeconds?: number
  outputFormat: 'text' | 'audio'
  rawResponse?: string
}

// ═══════════════════════════════════════════
// Phase 5 — Validation & delivery
// ═══════════════════════════════════════════

export interface ValidationResult {
  passed: boolean
  issues: string[]
  sanitizedText: string
}

export interface DeliveryResult {
  sent: boolean
  channelMessageId?: string
  error?: string
}

// ═══════════════════════════════════════════
// Pipeline result (full trace)
// ═══════════════════════════════════════════

export interface PipelineResult {
  traceId: string
  success: boolean
  phase1DurationMs: number
  phase2DurationMs: number
  phase3DurationMs: number
  phase4DurationMs: number
  phase5DurationMs: number
  totalDurationMs: number
  evaluatorOutput?: EvaluatorOutput
  executionOutput?: ExecutionOutput
  responseText?: string
  deliveryResult?: DeliveryResult
  error?: string
  skipped?: 'test_mode' | 'backpressure'
  replanAttempts: number
  subagentIterationsUsed: number
}

// ═══════════════════════════════════════════
// Replanning context (passed to phase2 on retry)
// ═══════════════════════════════════════════

export interface ReplanContext {
  attempt: number
  previousPlan: ExecutionStep[]
  failedSteps: StepResult[]
  partialData: Record<string, unknown>
}

// ═══════════════════════════════════════════
// Subagent types
// ═══════════════════════════════════════════

export interface SubagentConfig {
  maxIterations: number
  timeoutMs: number
  maxTokenBudget: number
  allowedTools: string[]
}

export interface SubagentResult {
  success: boolean
  data?: unknown
  iterations: number
  tokensUsed: number
  timedOut: boolean
  hitTokenLimit: boolean
  error?: string
}

// ═══════════════════════════════════════════
// Proactive flow types
// ═══════════════════════════════════════════

export type ProactiveTriggerType =
  | 'follow_up'
  | 'reminder'
  | 'commitment'
  | 'reactivation'
  | 'cache_refresh'
  | 'nightly_batch'

export interface ProactiveJob {
  name: string
  triggerType: ProactiveTriggerType
  cron?: string
  intervalMs?: number
  handler: (ctx: ProactiveJobContext) => Promise<void>
}

export interface ProactiveJobContext {
  db: import('pg').Pool
  redis: import('ioredis').Redis
  registry: import('../kernel/registry.js').Registry
  proactiveConfig: ProactiveConfig
  engineConfig: EngineConfig
  traceId: string
  runAt: Date
}

// ═══════════════════════════════════════════
// Proactive config (from instance/proactive.json)
// ═══════════════════════════════════════════

export interface ProactiveConfig {
  enabled: boolean
  business_hours: {
    start: number
    end: number
    timezone: string
    days: number[]
  }
  follow_up: {
    enabled: boolean
    scan_interval_minutes: number
    inactivity_hours: number
    max_attempts: number
    cross_channel: boolean
  }
  reminders: {
    enabled: boolean
    scan_interval_minutes: number
    hours_before_event: number
    notify_salesperson: boolean
  }
  commitments: {
    enabled: boolean
    scan_interval_minutes: number
    max_attempts: number
    generic_auto_cancel_hours: number
    commitment_types: CommitmentTypeConfig[]
  }
  reactivation: {
    enabled: boolean
    cron: string
    days_inactive: number
    max_attempts: number
    max_per_run: number
  }
  guards: {
    max_proactive_per_day_per_contact: number
    cooldown_minutes: number
    conversation_guard_hours: number
  }
}

export interface CommitmentTypeConfig {
  type: string
  max_due_hours: number
  requires_tool: string | null
  auto_cancel_hours: number
}

// ═══════════════════════════════════════════
// Proactive context — simplified Phase 1 output
// ═══════════════════════════════════════════

export interface ProactiveContextBundle extends ContextBundle {
  isProactive: true
  proactiveTrigger: ProactiveTrigger
}

export interface ProactiveTrigger {
  type: ProactiveTriggerType
  triggerId?: string
  reason: string
  commitmentData?: import('../modules/memory/types.js').Commitment
  isOverdue?: boolean
}

// ═══════════════════════════════════════════
// Proactive candidate — found by scanner
// ═══════════════════════════════════════════

export interface ProactiveCandidate {
  contactId: string
  channelContactId: string
  channel: import('../channels/types.js').ChannelName
  displayName: string | null
  triggerType: ProactiveTriggerType
  triggerId?: string
  reason: string
  commitmentData?: import('../modules/memory/types.js').Commitment
  isOverdue?: boolean
}

// ═══════════════════════════════════════════
// Outreach log entry
// ═══════════════════════════════════════════

export interface OutreachLogEntry {
  contactId: string
  triggerType: ProactiveTriggerType
  triggerId?: string
  channel: string
  actionTaken: 'sent' | 'no_action' | 'blocked' | 'error'
  guardBlocked?: string
  messageId?: string
  metadata?: Record<string, unknown>
}

// ═══════════════════════════════════════════
// LLM client types (direct SDK calls)
// ═══════════════════════════════════════════

export type LLMProvider = 'anthropic' | 'google' | 'openai'

export interface LLMCallOptions {
  task: string
  provider?: LLMProvider
  model?: string
  system?: string
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
  maxTokens?: number
  temperature?: number
  jsonMode?: boolean
  tools?: LLMToolDef[]
}

export interface LLMToolDef {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export interface LLMCallResult {
  text: string
  provider: LLMProvider
  model: string
  inputTokens: number
  outputTokens: number
  toolCalls?: Array<{ name: string; input: Record<string, unknown> }>
}

// ═══════════════════════════════════════════
// Engine config (read from env / instance)
// ═══════════════════════════════════════════

export interface EngineConfig {
  // LLM models
  classifyModel: string
  classifyProvider: LLMProvider
  respondModel: string
  respondProvider: LLMProvider
  complexModel: string
  complexProvider: LLMProvider
  toolsModel: string
  toolsProvider: LLMProvider
  proactiveModel: string
  proactiveProvider: LLMProvider

  // Fallbacks
  fallbackClassifyModel: string
  fallbackClassifyProvider: LLMProvider
  fallbackRespondModel: string
  fallbackRespondProvider: LLMProvider
  fallbackComplexModel: string
  fallbackComplexProvider: LLMProvider

  // LLM limits
  maxInputTokens: number
  maxOutputTokens: number
  temperatureClassify: number
  temperatureRespond: number
  temperatureComplex: number
  requestTimeoutMs: number

  // Pipeline
  maxToolCallsPerTurn: number
  maxConversationTurns: number
  sessionTtlMs: number

  // User type cache
  userTypeCacheTtlSeconds: number

  // Proactive
  followupEnabled: boolean
  followupDelayMinutes: number
  followupMaxAttempts: number
  followupColdAfterAttempts: number
  batchEnabled: boolean
  batchCron: string
  batchTimezone: string

  // Subagent defaults
  subagentMaxIterations: number
  subagentTimeoutMs: number
  subagentMaxTokenBudget: number

  // Replanning
  maxReplanAttempts: number

  // API keys
  anthropicApiKey: string
  openaiApiKey: string
  googleApiKey: string

  // Knowledge
  knowledgeDir: string

  // Session
  sessionReopenWindowMs: number

  // Attachments
  attachmentEnabled: boolean
  attachmentSmallDocTokens: number
  attachmentMediumDocTokens: number
  attachmentSummaryMaxTokens: number
  attachmentCacheTtlMs: number
  attachmentUrlFetchTimeoutMs: number
  attachmentUrlMaxSizeMb: number
  attachmentUrlEnabled: boolean

  // Avisos: now fully per-channel via channel-config:{name} services

  // Test mode: only admins receive responses
  testMode: boolean

  // Concurrency
  maxConcurrentPipelines: number
  maxQueueSize: number
  maxConcurrentSteps: number
  backpressureMessage: string

  // Phase 4 retries per provider
  composeRetriesPerProvider: number
}
