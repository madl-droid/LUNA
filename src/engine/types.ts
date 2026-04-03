// LUNA Engine — Types
// Todos los tipos del pipeline de procesamiento de mensajes.

import type { ChannelName, IncomingMessage, MessageContent } from '../channels/types.js'

// --- Agentic types (v2.0) ---
export type {
  AgenticResult,
  AgenticConfig,
  EffortLevel,
  ToolCallLog,
} from './agentic/types.js'

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
  /** Knowledge category IDs this user type can access. Empty = all. */
  knowledgeCategories: string[]
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
  visibleId: number | null
  name: string
  keyword: string | null
  utm: Record<string, string> | null
  promptContext: string | null
  matchScore: number | null
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
  type: 'document' | 'image' | 'audio' | 'video' | 'spreadsheet' | 'presentation' | 'text' | 'unknown'
  name: string | null
  size: number | null
  mime: string | null
}

export interface KnowledgeInjectionItem {
  id: string
  title: string
  description: string
  categoryId: string | null
  categoryTitle?: string
  shareable?: boolean
  sourceUrl?: string
  liveQueryEnabled?: boolean
  sourceId?: string
  sourceType?: string
}

export interface KnowledgeInjection {
  coreDocuments: Array<{ title: string; description: string }>
  categories: Array<{ id: string; title: string; description: string }>
  apiConnectors: Array<{ title: string; description: string }>
  /** Active knowledge items grouped for evaluator catalog (v3) */
  items?: KnowledgeInjectionItem[]
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

  // Knowledge v2 — structured injection for evaluator (filtered by user's allowed categories)
  knowledgeInjection: KnowledgeInjection | null

  // Freshdesk KB — article metadata matches from cached index (Phase 1 fuse.js)
  freshdeskMatches: import('../tools/freshdesk/types.js').FreshdeskMatch[]

  // LLM assignment rules for auto-classifying contacts into lists
  assignmentRules: Array<{ listType: string; listName: string; prompt: string }> | null

  // History
  history: HistoryMessage[]

  // Buffer summary — running compressed summary of older turns in this session (Phase 3)
  // Loaded from Redis; null if session is new or hasn't been compressed yet.
  // PG messages are never touched by inline compression.
  bufferSummary: string | null

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

  // HITL — pending ticket context (from hitl:context service)
  hitlPendingContext: string | null
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
  | 'code_execution'

export interface ExecutionStep {
  type: ExecutionPlanType
  tool?: string
  params?: Record<string, unknown>
  description?: string
  dependsOn?: number[]  // indices of steps this depends on
  /** Phase 2 hint: activate extended thinking for this step's LLM calls */
  useThinking?: boolean
  /** Phase 2 hint: activate code execution sandbox for this step */
  useCoding?: boolean
  /** Subagent slug from catalog (for type='subagent') */
  subagentSlug?: string
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
  /** Sub-intent for granular classification (e.g. objection_price, objection_timing) */
  subIntent?: string
  /** Objection type when intent=objection (price, timing, competitor, need, authority, generic) */
  objectionType?: string
  /** Bryan Tracy step suggestion (1=listen, 2=pause, 3=clarify, 4=empathize, 5=respond, 6=confirm) */
  objectionStep?: number
  rawResponse?: string
}

// ═══════════════════════════════════════════
// Phase 3 — Execution results
// ═══════════════════════════════════════════

export interface StepResult {
  stepIndex: number
  type: ExecutionPlanType
  /** Tool name (if applicable) — used for checkpoint step validation */
  tool?: string
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
  /** Multiple audio chunks for sequential voice notes (used when response > 900 chars) */
  audioChunks?: Array<{ audioBuffer: Buffer; durationSeconds: number }>
  outputFormat: 'text' | 'audio'
  rawResponse?: string
  /** True when TTS was attempted but failed (triggers natural fallback message) */
  ttsFailed?: boolean
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
  skipped?: 'test_mode' | 'backpressure' | `unregistered:${string}`
  replanAttempts: number
  subagentIterationsUsed: number
  // --- Agentic fields (v2.0) ---
  agenticResult?: import('./agentic/types.js').AgenticResult
  effortLevel?: import('./agentic/types.js').EffortLevel
}

// ═══════════════════════════════════════════
// Agentic pipeline options (v2.0)
// ═══════════════════════════════════════════

export interface AgenticPipelineOptions {
  forceEffort?: import('./agentic/types.js').EffortLevel
  isProactive?: boolean
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
  | 'orphan_recovery'

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
    /** Ordered list of channels to try when cross_channel is true */
    channel_fallback_order: import('../channels/types.js').ChannelName[]
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
  smart_cooldown?: {
    enabled: boolean
    after_sent_minutes: number
    after_no_action_minutes: number
    after_error_minutes: number
    max_backoff_hours: number
  }
  orphan_recovery?: {
    enabled: boolean
    interval_minutes: number
    lookback_minutes: number
    max_per_run: number
  }
  conversation_guard?: {
    enabled: boolean
    cache_ttl_hours: number
    skip_for_commitments: boolean
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

export type LLMProvider = 'anthropic' | 'google'

export interface LLMCallOptions {
  task: string
  provider?: LLMProvider
  model?: string
  system?: string
  messages: Array<{ role: 'user' | 'assistant'; content: string | import('../kernel/types.js').LLMContentPart[] }>
  maxTokens?: number
  temperature?: number
  jsonMode?: boolean
  /** JSON schema for structured output (Google: responseSchema) */
  jsonSchema?: Record<string, unknown>
  tools?: LLMToolDef[]
  /** Extended thinking (Anthropic: adaptive thinking, Google: thinkingConfig) */
  thinking?: { type: 'enabled' | 'adaptive'; budgetTokens?: number }
  /** Enable Google Search grounding (Google only) */
  googleSearchGrounding?: boolean
  /** Enable citations / source attribution (Anthropic only) */
  citations?: boolean
  /** Enable server-side code execution (both providers) */
  codeExecution?: boolean
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
  /** Prompt cache tokens read (cost savings) */
  cacheReadTokens?: number
  /** Which fallback level was used */
  fallbackLevel?: 'primary' | 'downgrade' | 'cross-api'
  /** Google Search grounding metadata */
  groundingMetadata?: {
    searchQueries?: string[]
    sources?: Array<{ uri: string; title: string }>
  }
  /** Code execution results */
  codeResults?: Array<{ code: string; output: string; error?: string }>
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

  // FIX: E-1 — Pipeline global timeout
  pipelineTimeoutMs: number

  // FIX: E-30 — Agent slug (no hardcoding 'luna')
  agentSlug: string

  // Criticizer (quality gate): 'disabled' | 'complex_only' | 'always'
  criticizerMode: 'disabled' | 'complex_only' | 'always'

  // Checkpoints (resumable pipelines)
  checkpointEnabled: boolean
  /** Max age (ms) of incomplete checkpoints eligible for resume on startup */
  checkpointResumeWindowMs: number
  /** Days after which completed/failed checkpoints are purged */
  checkpointCleanupDays: number

  // --- Agentic engine config (v2.0) ---
  /** Max tool-calling turns before forcing a text response */
  agenticMaxTurns: number
  /** Enable effort routing: classify complexity to route to cheaper/capable model */
  effortRoutingEnabled: boolean
  /** Enable tool call deduplication within a single pipeline run */
  toolDedupEnabled: boolean
  /** Enable graduated loop detection (warn → block → circuit break) */
  loopDetectionEnabled: boolean
  /** Feed tool errors back to LLM as context instead of crashing the loop */
  errorAsContextEnabled: boolean
  /** Recover partial text if loop times out or hits turn limit */
  partialRecoveryEnabled: boolean
  /** Model for low-effort messages (greetings, acks) */
  lowEffortModel: string
  lowEffortProvider: LLMProvider
  /** Model for medium-effort messages (questions, single tool) */
  mediumEffortModel: string
  mediumEffortProvider: LLMProvider
  /** Model for high-effort messages (objections, multi-step) */
  highEffortModel: string
  highEffortProvider: LLMProvider
  /** Loop detector: number of identical calls before warning the LLM */
  loopWarnThreshold: number
  /** Loop detector: number of identical calls before blocking the tool */
  loopBlockThreshold: number
  /** Loop detector: number of identical calls before forcing text response (circuit break) */
  loopCircuitThreshold: number
  /** Execution queue: max reactive (incoming message) pipelines in parallel */
  executionQueueReactiveConcurrency: number
  /** Execution queue: max proactive (follow-up/reminder) pipelines in parallel */
  executionQueueProactiveConcurrency: number
  /** Execution queue: max background (nightly/cache) pipelines in parallel */
  executionQueueBackgroundConcurrency: number
}
