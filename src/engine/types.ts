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

export interface QuickAction {
  type: 'stop' | 'escalate' | 'affirm' | 'deny'
  matched: string
}

export interface ContextBundle {
  // Original message
  message: IncomingMessage
  traceId: string

  // User resolution (first thing resolved)
  userType: UserType
  userPermissions: UserPermissions
  contactId: string | null

  // Contact & session
  contact: ContactInfo | null
  session: SessionInfo
  isNewContact: boolean

  // Quick action detected (may skip LLM)
  quickAction: QuickAction | null

  // Campaign
  campaign: CampaignInfo | null

  // RAG
  knowledgeMatches: KnowledgeMatch[]

  // History
  history: HistoryMessage[]

  // Sheets cache (from Redis)
  sheetsData: Record<string, unknown> | null

  // Normalized text
  normalizedText: string
  messageType: MessageContent['type']

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
  skippedByQuickAction?: boolean
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
  | 'commitment_check'
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
  traceId: string
  runAt: Date
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

  // Rate limits
  waRateLimitHour: number
  waRateLimitDay: number

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

  // API keys
  anthropicApiKey: string
  openaiApiKey: string
  googleApiKey: string

  // Knowledge
  knowledgeDir: string

  // Session
  sessionReopenWindowMs: number
}
