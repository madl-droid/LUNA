// LUNA — LLM Module Types
// Tipos completos para el gateway LLM unificado.

// ═══════════════════════════════════════════
// Provider types
// ═══════════════════════════════════════════

export type LLMProviderName = 'anthropic' | 'google'

export interface ProviderConfig {
  name: LLMProviderName
  enabled: boolean
  apiKeys: ApiKeyConfig[]
  /** Max requests per minute (0 = unlimited) */
  rpmLimit: number
  /** Max tokens per minute (0 = unlimited) */
  tpmLimit: number
  /** Request timeout in ms */
  timeoutMs: number
}

export interface ApiKeyConfig {
  /** Env var name that holds the key */
  envVar: string
  /** Which capabilities this key is authorized for (empty = all) */
  capabilities: LLMCapability[]
  /** Resolved key value (never logged, never exposed) */
  key: string
}

// ═══════════════════════════════════════════
// Capabilities & tasks
// ═══════════════════════════════════════════

export type LLMCapability =
  | 'text'
  | 'tools'
  | 'vision'
  | 'image_gen'
  | 'stt'
  | 'tts'
  | 'code'
  | 'web_search'
  | 'embeddings'

export type LLMTask =
  | 'classify'
  | 'respond'
  | 'complex'
  | 'tools'
  | 'proactive'
  | 'vision'
  | 'stt'
  | 'image_gen'
  | 'web_search'
  | 'compress'
  | 'ack'
  | 'custom'

// ═══════════════════════════════════════════
// Task routing
// ═══════════════════════════════════════════

export interface TaskRoute {
  task: LLMTask
  primary: RouteTarget
  fallbacks: RouteTarget[]
}

export interface RouteTarget {
  provider: LLMProviderName
  model: string
  /** Override API key env var for this specific route */
  apiKeyEnv?: string
  /** Temperature override */
  temperature?: number
  /** Max output tokens override */
  maxTokens?: number
}

// ═══════════════════════════════════════════
// Circuit breaker
// ═══════════════════════════════════════════

export type CircuitState = 'closed' | 'open' | 'half-open'

export interface CircuitBreakerConfig {
  /** Failures within window to trip the breaker */
  failureThreshold: number
  /** Time window to count failures (ms) */
  windowMs: number
  /** Time to stay open before trying half-open (ms) */
  recoveryMs: number
  /** Max requests to allow in half-open state */
  halfOpenMax: number
}

export interface CircuitBreakerSnapshot {
  provider: LLMProviderName
  state: CircuitState
  failures: number
  lastFailureAt: number | null
  openedAt: number | null
  successesSinceHalfOpen: number
}

// ═══════════════════════════════════════════
// Request / Response (rich)
// ═══════════════════════════════════════════

export interface ContentPart {
  type: 'text' | 'image_url' | 'audio'
  text?: string
  /** Base64 data or URL */
  data?: string
  mimeType?: string
}

export interface LLMMessage {
  role: 'user' | 'assistant' | 'system'
  content: string | ContentPart[]
}

export interface LLMToolDef {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export interface LLMRequest {
  /** Task type for routing */
  task: LLMTask
  /** Override provider (bypasses router) */
  provider?: LLMProviderName
  /** Override model (bypasses router) */
  model?: string
  /** System prompt */
  system?: string
  /** Conversation messages */
  messages: LLMMessage[]
  /** Max output tokens */
  maxTokens?: number
  /** Temperature (0-2) */
  temperature?: number
  /** Tools for function calling */
  tools?: LLMToolDef[]
  /** Force JSON output */
  jsonMode?: boolean
  /** Override API key env var */
  apiKeyEnv?: string
  /** Trace/correlation ID for logging */
  traceId?: string
  /** Timeout override (ms) */
  timeoutMs?: number
  /** Skip circuit breaker check (emergency) */
  bypassCircuitBreaker?: boolean
}

export interface LLMToolCall {
  name: string
  input: Record<string, unknown>
}

export interface LLMResponse {
  text: string
  provider: LLMProviderName
  model: string
  inputTokens: number
  outputTokens: number
  toolCalls?: LLMToolCall[]
  durationMs: number
  fromFallback: boolean
  /** Which attempt succeeded (0 = first try) */
  attempt: number
}

// ═══════════════════════════════════════════
// Usage tracking
// ═══════════════════════════════════════════

export interface UsageRecord {
  timestamp: Date
  provider: LLMProviderName
  model: string
  task: LLMTask
  inputTokens: number
  outputTokens: number
  durationMs: number
  success: boolean
  error?: string
  traceId?: string
  estimatedCostUsd: number
}

export interface UsageSummary {
  period: string
  totalCalls: number
  totalInputTokens: number
  totalOutputTokens: number
  totalErrors: number
  estimatedCostUsd: number
  byProvider: Record<string, {
    calls: number
    inputTokens: number
    outputTokens: number
    errors: number
    costUsd: number
  }>
  byTask: Record<string, {
    calls: number
    inputTokens: number
    outputTokens: number
    costUsd: number
  }>
}

// ═══════════════════════════════════════════
// Provider status (for console)
// ═══════════════════════════════════════════

export interface ProviderStatus {
  name: LLMProviderName
  enabled: boolean
  circuitState: CircuitState
  available: boolean
  modelsCount: number
  recentErrors: number
  avgLatencyMs: number
  lastUsedAt: string | null
}

// ═══════════════════════════════════════════
// Model info
// ═══════════════════════════════════════════

export interface ModelInfo {
  id: string
  provider: LLMProviderName
  displayName: string
  family: string
  capabilities: LLMCapability[]
  /** Cost per 1M input tokens (USD) */
  inputCostPer1M: number
  /** Cost per 1M output tokens (USD) */
  outputCostPer1M: number
}

// ═══════════════════════════════════════════
// Provider adapter interface
// ═══════════════════════════════════════════

export interface ProviderAdapter {
  readonly name: LLMProviderName
  init(apiKey: string): void
  isInitialized(): boolean
  chat(request: LLMRequest, apiKey: string, timeoutMs: number): Promise<LLMResponse>
  listModels?(apiKey: string): Promise<ModelInfo[]>
}

// ═══════════════════════════════════════════
// Module config (from configSchema)
// ═══════════════════════════════════════════

export interface LLMModuleConfig {
  // Provider API keys
  ANTHROPIC_API_KEY: string
  GOOGLE_AI_API_KEY: string

  // Per-capability API key overrides
  LLM_VISION_API_KEY: string
  LLM_STT_API_KEY: string
  LLM_IMAGE_GEN_API_KEY: string

  // Circuit breaker
  LLM_CB_FAILURE_THRESHOLD: number
  LLM_CB_WINDOW_MS: number
  LLM_CB_RECOVERY_MS: number
  LLM_CB_HALF_OPEN_MAX: number

  // Retry
  LLM_RETRY_MAX: number
  LLM_RETRY_BACKOFF_MS: number

  // Timeouts per provider
  LLM_TIMEOUT_ANTHROPIC_MS: number
  LLM_TIMEOUT_GOOGLE_MS: number

  // Rate limits
  LLM_RPM_ANTHROPIC: number
  LLM_RPM_GOOGLE: number
  LLM_TPM_ANTHROPIC: number
  LLM_TPM_GOOGLE: number

  // Usage tracking
  LLM_USAGE_ENABLED: string
  LLM_USAGE_RETENTION_DAYS: number

  // Cost budget
  LLM_DAILY_BUDGET_USD: number
  LLM_MONTHLY_BUDGET_USD: number

  // Task routing (JSON strings parsed at init)
  LLM_ROUTE_CLASSIFY: string
  LLM_ROUTE_RESPOND: string
  LLM_ROUTE_COMPLEX: string
  LLM_ROUTE_TOOLS: string
  LLM_ROUTE_PROACTIVE: string

  // Fallback chain order
  LLM_FALLBACK_CHAIN: string
}

// ═══════════════════════════════════════════
// Cost table (configurable)
// ═══════════════════════════════════════════

export const DEFAULT_COST_TABLE: Record<string, { inputPer1M: number; outputPer1M: number }> = {
  // Anthropic (USD per 1M tokens)
  'claude-haiku-4-5-20251001': { inputPer1M: 0.80, outputPer1M: 4.00 },
  'claude-sonnet-4-5-20250929': { inputPer1M: 3.00, outputPer1M: 15.00 },
  'claude-opus-4-5-20251101': { inputPer1M: 15.00, outputPer1M: 75.00 },
  // Google
  'gemini-2.5-flash': { inputPer1M: 0.15, outputPer1M: 0.60 },
  'gemini-2.5-pro': { inputPer1M: 1.25, outputPer1M: 10.00 },
}
