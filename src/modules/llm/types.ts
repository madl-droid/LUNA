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
  | 'tts'
  | 'image_gen'
  | 'web_search'
  | 'compress'
  | 'ack'
  | 'criticize'
  | 'document_read'
  | 'batch'
  | 'custom'

// ═══════════════════════════════════════════
// API key groups (for advanced key management)
// ═══════════════════════════════════════════

/**
 * API key capability groups for advanced key management.
 * In advanced mode, each group can have its own API key.
 * If a group key is not set, falls back to the provider's main key.
 */
export type GeminiKeyGroup = 'engine' | 'multimedia' | 'voice' | 'knowledge'
export type AnthropicKeyGroup = 'engine' | 'cortex' | 'memory'
export type ApiKeyGroup = GeminiKeyGroup | AnthropicKeyGroup

/**
 * Maps LLM tasks to their API key capability group.
 * Used by the gateway to select the correct API key in advanced mode.
 * The provider is already known from route resolution — only the group matters here.
 */
export const TASK_TO_KEY_GROUP: Record<string, ApiKeyGroup | undefined> = {
  // Gemini groups
  respond: 'engine',
  web_search: 'engine',
  criticize: 'engine',
  vision: 'multimedia',
  stt: 'multimedia',
  tts: 'voice',
  embeddings: 'knowledge',

  // Anthropic groups
  classify: 'engine',
  tools: 'engine',
  complex: 'engine',
  proactive: 'engine',
  compress: 'memory',
  batch: 'memory',
  document_read: 'engine',

  // Cortex tasks (resolved via aliases to 'complex', but need own key group)
  'trace-evaluate': 'cortex',
  'trace-compose': 'cortex',
  'trace-analyze': 'cortex',
  'trace-synthesize': 'cortex',
  'cortex-analyze': 'cortex',
  'cortex-pulse': 'cortex',
}

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
  /** Downgrade target — same provider, lesser model (used before cross-API fallback) */
  downgrade?: RouteTarget
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

/** Config for the escalating circuit breaker (per model-target) */
export interface EscalatingCBConfig {
  /** Failures within window to trip (default: 2) */
  failureThreshold: number
  /** Time window to count failures — ms (default: 1_800_000 = 30 min) */
  windowMs: number
  /** Max requests to allow in half-open state (default: 1) */
  halfOpenMax: number
  /** Escalating recovery durations — ms (default: [3_600_000, 10_800_000, 21_600_000]) */
  recoverySteps: number[]
}

export interface CircuitBreakerSnapshot {
  provider: LLMProviderName
  state: CircuitState
  failures: number
  lastFailureAt: number | null
  openedAt: number | null
  successesSinceHalfOpen: number
}

export interface EscalatingCBSnapshot {
  targetKey: string
  state: CircuitState
  failures: number
  lastFailureAt: number | null
  openedAt: number | null
  escalationLevel: number
  currentRecoveryMs: number
}

// ═══════════════════════════════════════════
// Request / Response (rich)
// ═══════════════════════════════════════════

export interface ContentPart {
  type: 'text' | 'image_url' | 'audio' | 'video'
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
  /** Force JSON output (Anthropic: prefill trick, Google: responseMimeType) */
  jsonMode?: boolean
  /** JSON schema for structured output (Google: responseSchema) */
  jsonSchema?: Record<string, unknown>
  /** Override API key env var */
  apiKeyEnv?: string
  /** Trace/correlation ID for logging */
  traceId?: string
  /** Timeout override (ms) */
  timeoutMs?: number
  /** Skip circuit breaker check (emergency) */
  bypassCircuitBreaker?: boolean
  /** Extended thinking (Anthropic: thinking param, Google: thinkingConfig) */
  thinking?: {
    type: 'enabled' | 'adaptive'
    budgetTokens?: number
  }
  /** Enable Google Search grounding (Google only, ignored by Anthropic) */
  googleSearchGrounding?: boolean
  /** Enable citations / source attribution (Anthropic only, ignored by Google) */
  citations?: boolean
  /** Enable server-side code execution (Anthropic: code_execution tool, Google: codeExecution tool) */
  codeExecution?: boolean
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
  /** Prompt cache: tokens read from cache (Anthropic/Google) */
  cacheReadTokens?: number
  /** Prompt cache: tokens written to cache (Anthropic) */
  cacheCreationTokens?: number
  /** Extended thinking: tokens used for thinking (not billed as output) */
  thinkingTokens?: number
  /** Which fallback level was used */
  fallbackLevel?: 'primary' | 'downgrade' | 'cross-api'
  /** Why fallback was triggered */
  fallbackReason?: string
  /** Google Search grounding metadata */
  groundingMetadata?: {
    searchQueries?: string[]
    sources?: Array<{ uri: string; title: string }>
  }
  /** Citations from knowledge sources (Anthropic) */
  citations?: Array<{
    citedText: string
    sourceTitle?: string
    sourceUrl?: string
  }>
  /** Code execution results */
  codeResults?: Array<{
    code: string
    output: string
    error?: string
  }>
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
  /** Submit a batch of requests for async processing (50% discount) */
  submitBatch?(requests: LLMBatchRequest[], apiKey: string): Promise<string>
  /** Check the status of a submitted batch */
  getBatchStatus?(batchId: string, apiKey: string): Promise<LLMBatchInfo>
  /** Retrieve results of a completed batch */
  getBatchResults?(batchId: string, apiKey: string): Promise<LLMBatchResult[]>
}

// ═══════════════════════════════════════════
// Module config (from configSchema)
// ═══════════════════════════════════════════

export interface LLMModuleConfig {
  // Provider API keys
  ANTHROPIC_API_KEY: string
  GOOGLE_AI_API_KEY: string

  // Gemini group keys (fallback to GOOGLE_AI_API_KEY if empty)
  LLM_GOOGLE_ENGINE_API_KEY: string
  LLM_GOOGLE_MULTIMEDIA_API_KEY: string
  LLM_GOOGLE_VOICE_API_KEY: string
  LLM_GOOGLE_KNOWLEDGE_API_KEY: string

  // Anthropic group keys (fallback to ANTHROPIC_API_KEY if empty)
  LLM_ANTHROPIC_ENGINE_API_KEY: string
  LLM_ANTHROPIC_CORTEX_API_KEY: string
  LLM_ANTHROPIC_MEMORY_API_KEY: string

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

  // Criticizer mode
  LLM_CRITICIZER_MODE: string

  // Task routing — all fields follow pattern LLM_{TASK}_{PROVIDER|MODEL}
  // Primary, downgrade, and fallback for each task are read dynamically
  // by the TaskRouter via config[`LLM_${TASK}_PROVIDER`] etc.
  // Typed as index signature — individual fields defined in configSchema.
  [key: `LLM_${string}_PROVIDER` | `LLM_${string}_MODEL`]: string

  // Fallback chain order
  LLM_FALLBACK_CHAIN: string

  // Model scanner
  MODEL_SCAN_INTERVAL_MS: number
}

// ═══════════════════════════════════════════
// Cost table (configurable)
// ═══════════════════════════════════════════

export const DEFAULT_COST_TABLE: Record<string, { inputPer1M: number; outputPer1M: number }> = {
  // Anthropic — Claude 4.5 (USD per 1M tokens)
  'claude-haiku-4-5-20251001': { inputPer1M: 0.80, outputPer1M: 4.00 },
  'claude-sonnet-4-5-20250929': { inputPer1M: 3.00, outputPer1M: 15.00 },
  'claude-opus-4-5-20251101': { inputPer1M: 15.00, outputPer1M: 75.00 },
  // Anthropic — Claude 4.6
  'claude-sonnet-4-6-20260214': { inputPer1M: 3.00, outputPer1M: 15.00 },
  'claude-opus-4-6-20260210': { inputPer1M: 5.00, outputPer1M: 25.00 },
  // Google — Gemini 2.5
  'gemini-2.5-flash': { inputPer1M: 0.15, outputPer1M: 0.60 },
  'gemini-2.5-flash-lite': { inputPer1M: 0.075, outputPer1M: 0.30 },
  'gemini-2.5-pro': { inputPer1M: 1.25, outputPer1M: 10.00 },
  // Google — Gemini 3
  'gemini-3-flash': { inputPer1M: 0.15, outputPer1M: 0.60 },
  'gemini-3-pro': { inputPer1M: 1.25, outputPer1M: 10.00 },
  'gemini-3.1-pro': { inputPer1M: 1.25, outputPer1M: 10.00 },
  // Google — TTS (Preview — pricing TBD)
  'gemini-2.5-pro-preview-tts': { inputPer1M: 0, outputPer1M: 0 },
  'gemini-2.5-flash-preview-tts': { inputPer1M: 0, outputPer1M: 0 },
}

// ═══════════════════════════════════════════
// TTS (Text-to-Speech)
// ═══════════════════════════════════════════

export interface TTSRequest {
  /** Text to synthesize */
  text: string
  /** Voice name (e.g. 'Kore', 'Aoede', or a Wavenet voice name) */
  voice: string
  /** Language code (default: 'es-US') */
  languageCode?: string
  /** Audio encoding (default: 'MP3') */
  audioEncoding?: 'MP3' | 'LINEAR16' | 'OGG_OPUS'
}

export interface TTSResponse {
  /** Base64-encoded audio content */
  audioBase64: string
  /** MIME type of the audio */
  mimeType: string
  /** Voice used */
  voice: string
}

// ═══════════════════════════════════════════
// Model scanner types
// ═══════════════════════════════════════════

export interface ScannedModel {
  id: string
  displayName: string
  provider: 'anthropic' | 'google'
  family: string
  createdAt: string
}

export interface ScanResult {
  anthropic: ScannedModel[]
  google: ScannedModel[]
  lastScanAt: string
  replacements: ModelReplacement[]
  errors?: Array<{ provider: string; message: string }>
}

export interface ModelReplacement {
  configKey: string
  oldModel: string
  newModel: string
  reason: string
}

// ═══════════════════════════════════════════
// Batch / async processing
// ═══════════════════════════════════════════

export type LLMBatchStatus = 'processing' | 'ended' | 'expired' | 'canceling' | 'canceled'

export interface LLMBatchRequest {
  /** Unique ID for this batch item (for correlating results) */
  customId: string
  /** The LLM request to execute */
  request: LLMRequest
}

export interface LLMBatchResult {
  customId: string
  response?: LLMResponse
  error?: string
}

export interface LLMBatchInfo {
  batchId: string
  provider: LLMProviderName
  status: LLMBatchStatus
  totalRequests: number
  completedRequests: number
  failedRequests: number
  createdAt: string
  endedAt?: string
}
