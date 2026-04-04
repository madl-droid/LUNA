// LUNA Engine — Config Loader
// Lee configuración del engine desde env vars via kernel config helpers.

import { getEnv } from '../kernel/config.js'
import type { Registry } from '../kernel/registry.js'
import type { EngineConfig, LLMProvider } from './types.js'
import { SUBAGENT_HARD_LIMITS } from './subagent/types.js'

interface EngineModuleConfig {
  ENGINE_TEST_MODE: boolean
  ENGINE_MAX_CONCURRENT_PIPELINES: number
  ENGINE_MAX_QUEUE_SIZE: number
  ENGINE_MAX_CONCURRENT_STEPS: number
  ENGINE_BACKPRESSURE_MESSAGE: string
  ENGINE_COMPOSE_RETRIES_PER_PROVIDER: number
  ATTACHMENT_ENABLED: boolean
  ATTACHMENT_SMALL_DOC_TOKENS: number
  ATTACHMENT_MEDIUM_DOC_TOKENS: number
  ATTACHMENT_SUMMARY_MAX_TOKENS: number
  ATTACHMENT_CACHE_TTL_MS: number
  ATTACHMENT_URL_ENABLED: boolean
  ATTACHMENT_URL_FETCH_TIMEOUT_MS: number
  ATTACHMENT_URL_MAX_SIZE_MB: number
  ENGINE_AGENTIC_MAX_TURNS: number
  ENGINE_EFFORT_ROUTING: boolean
  AGENTIC_LOOP_WARN_THRESHOLD: number
  AGENTIC_LOOP_BLOCK_THRESHOLD: number
  AGENTIC_LOOP_CIRCUIT_THRESHOLD: number
  LLM_CRITICIZER_MODE: string
  LLM_LOW_EFFORT_MODEL: string
  LLM_LOW_EFFORT_PROVIDER: string
  LLM_MEDIUM_EFFORT_MODEL: string
  LLM_MEDIUM_EFFORT_PROVIDER: string
  LLM_HIGH_EFFORT_MODEL: string
  LLM_HIGH_EFFORT_PROVIDER: string
}

function env(key: string, fallback: string): string {
  return getEnv(key) ?? fallback
}

function envInt(key: string, fallback: number): number {
  const v = getEnv(key)
  if (!v) return fallback
  const parsed = parseInt(v, 10)
  return Number.isNaN(parsed) ? fallback : parsed
}

function envFloat(key: string, fallback: number): number {
  const v = getEnv(key)
  if (!v) return fallback
  const parsed = parseFloat(v)
  return Number.isNaN(parsed) ? fallback : parsed
}

function envBool(key: string, fallback: boolean): boolean {
  const v = getEnv(key)
  if (!v) return fallback
  return v === 'true'
}

/**
 * Read up to `max` numbered env vars (KEY_1, KEY_2, KEY_3).
 * Returns array of non-empty messages, or fallback if none found.
 */

function envProvider(key: string, fallback: LLMProvider): LLMProvider {
  const v = getEnv(key) as LLMProvider | undefined
  return v ?? fallback
}

/**
 * Load engine configuration from registry for module-owned fields and env for legacy globals.
 */
export function loadEngineConfig(registry: Registry): EngineConfig {
  const moduleConfig = registry.getConfig<EngineModuleConfig>('engine')
  return {
    // LLM models
    classifyModel: env('LLM_CLASSIFY_MODEL', 'claude-sonnet-4-6'),
    classifyProvider: envProvider('LLM_CLASSIFY_PROVIDER', 'anthropic'),
    respondModel: env('LLM_RESPOND_MODEL', 'claude-sonnet-4-6'),
    respondProvider: envProvider('LLM_RESPOND_PROVIDER', 'anthropic'),
    complexModel: env('LLM_COMPLEX_MODEL', 'claude-opus-4-6'),
    complexProvider: envProvider('LLM_COMPLEX_PROVIDER', 'anthropic'),
    toolsModel: env('LLM_TOOLS_MODEL', 'claude-haiku-4-5-20251001'),
    toolsProvider: envProvider('LLM_TOOLS_PROVIDER', 'anthropic'),
    proactiveModel: env('LLM_PROACTIVE_MODEL', 'claude-sonnet-4-6'),
    proactiveProvider: envProvider('LLM_PROACTIVE_PROVIDER', 'anthropic'),

    // Fallbacks
    fallbackClassifyModel: env('LLM_FALLBACK_CLASSIFY_MODEL', 'gemini-2.5-flash'),
    fallbackClassifyProvider: envProvider('LLM_FALLBACK_CLASSIFY_PROVIDER', 'google'),
    fallbackRespondModel: env('LLM_FALLBACK_RESPOND_MODEL', 'gemini-2.5-flash'),
    fallbackRespondProvider: envProvider('LLM_FALLBACK_RESPOND_PROVIDER', 'google'),
    fallbackComplexModel: env('LLM_FALLBACK_COMPLEX_MODEL', 'gemini-2.5-pro'),
    fallbackComplexProvider: envProvider('LLM_FALLBACK_COMPLEX_PROVIDER', 'google'),

    // LLM limits
    maxInputTokens: envInt('LLM_MAX_INPUT_TOKENS', 4096),
    maxOutputTokens: envInt('LLM_MAX_OUTPUT_TOKENS', 7000),
    temperatureClassify: envFloat('LLM_TEMPERATURE_CLASSIFY', 0.1),
    temperatureRespond: envFloat('LLM_TEMPERATURE_RESPOND', 0.7),
    temperatureComplex: envFloat('LLM_TEMPERATURE_COMPLEX', 0.5),
    requestTimeoutMs: envInt('LLM_REQUEST_TIMEOUT_MS', 30000),

    // Pipeline
    maxToolCallsPerTurn: envInt('PIPELINE_MAX_TOOL_CALLS_PER_TURN', 5),
    maxConversationTurns: envInt('PIPELINE_MAX_CONVERSATION_TURNS', 50),
    sessionTtlMs: envInt('PIPELINE_SESSION_TTL_MS', 1800000),

    // User type cache
    userTypeCacheTtlSeconds: envInt('USER_TYPE_CACHE_TTL_SECONDS', 43200), // 12h

    // Proactive
    followupEnabled: envBool('FOLLOWUP_ENABLED', true),
    followupDelayMinutes: envInt('FOLLOWUP_DELAY_MINUTES', 30),
    followupMaxAttempts: envInt('FOLLOWUP_MAX_ATTEMPTS', 3),
    followupColdAfterAttempts: envInt('FOLLOWUP_COLD_AFTER_ATTEMPTS', 3),
    batchEnabled: envBool('BATCH_ENABLED', true),
    batchCron: env('BATCH_CRON', '0 2 * * *'),
    batchTimezone: env('BATCH_TIMEZONE', 'America/Mexico_City'),

    // Subagent v2 — hard limits (not configurable from console, safety only)
    // User-configurable token budget lives in subagent_types table
    subagentMaxIterations: SUBAGENT_HARD_LIMITS.HARD_MAX_ITERATIONS,
    subagentTimeoutMs: SUBAGENT_HARD_LIMITS.HARD_TIMEOUT_MS,
    subagentMaxTokenBudget: SUBAGENT_HARD_LIMITS.HARD_MAX_TOKEN_BUDGET,

    // Replanning
    maxReplanAttempts: Math.min(envInt('PIPELINE_MAX_REPLAN_ATTEMPTS', 2), 5),

    // API keys
    anthropicApiKey: env('ANTHROPIC_API_KEY', ''),
    googleApiKey: env('GOOGLE_AI_API_KEY', ''),

    // Knowledge
    knowledgeDir: env('KNOWLEDGE_DIR', 'instance/knowledge'),

    // Session — MEMORY_SESSION_REOPEN_WINDOW_HOURS (hours, set from console) takes precedence over SESSION_REOPEN_WINDOW_MS (ms, legacy)
    sessionReopenWindowMs: envInt('MEMORY_SESSION_REOPEN_WINDOW_HOURS', 0) > 0
      ? envInt('MEMORY_SESSION_REOPEN_WINDOW_HOURS', 1) * 60 * 60 * 1000
      : envInt('SESSION_REOPEN_WINDOW_MS', 3600000), // default 1h

    // Attachments
    attachmentEnabled: moduleConfig.ATTACHMENT_ENABLED,
    attachmentSmallDocTokens: moduleConfig.ATTACHMENT_SMALL_DOC_TOKENS,
    attachmentMediumDocTokens: moduleConfig.ATTACHMENT_MEDIUM_DOC_TOKENS,
    attachmentSummaryMaxTokens: moduleConfig.ATTACHMENT_SUMMARY_MAX_TOKENS,
    attachmentCacheTtlMs: moduleConfig.ATTACHMENT_CACHE_TTL_MS,
    attachmentUrlFetchTimeoutMs: moduleConfig.ATTACHMENT_URL_FETCH_TIMEOUT_MS,
    attachmentUrlMaxSizeMb: moduleConfig.ATTACHMENT_URL_MAX_SIZE_MB,
    attachmentUrlEnabled: moduleConfig.ATTACHMENT_URL_ENABLED,

    // Avisos de proceso: now fully per-channel via channel-config:{name} services
    // (legacy WA/email aviso fields removed — each channel defines its own in configSchema)

    // Test mode: only admins receive responses
    testMode: moduleConfig.ENGINE_TEST_MODE,

    // Concurrency
    maxConcurrentPipelines: moduleConfig.ENGINE_MAX_CONCURRENT_PIPELINES,
    maxQueueSize: moduleConfig.ENGINE_MAX_QUEUE_SIZE,
    maxConcurrentSteps: moduleConfig.ENGINE_MAX_CONCURRENT_STEPS,
    backpressureMessage: moduleConfig.ENGINE_BACKPRESSURE_MESSAGE,

    // Phase 4 retries per provider
    composeRetriesPerProvider: moduleConfig.ENGINE_COMPOSE_RETRIES_PER_PROVIDER,

    // FIX: E-1 — Pipeline global timeout (2 minutes default)
    pipelineTimeoutMs: envInt('ENGINE_PIPELINE_TIMEOUT_MS', 120000),

    // Criticizer (quality gate): disabled | complex_only | always
    criticizerMode: moduleConfig.LLM_CRITICIZER_MODE as 'disabled' | 'complex_only' | 'always',

    // Checkpoints (resumable pipelines)
    checkpointEnabled: envBool('ENGINE_CHECKPOINT_ENABLED', true),
    checkpointResumeWindowMs: envInt('ENGINE_CHECKPOINT_RESUME_WINDOW_MS', 300000), // 5 min
    checkpointCleanupDays: envInt('ENGINE_CHECKPOINT_CLEANUP_DAYS', 7),

    // --- Agentic engine config (v2.0) ---
    agenticMaxTurns:         moduleConfig.ENGINE_AGENTIC_MAX_TURNS,
    effortRoutingEnabled:    moduleConfig.ENGINE_EFFORT_ROUTING,
    lowEffortModel:          moduleConfig.LLM_LOW_EFFORT_MODEL,
    lowEffortProvider:       moduleConfig.LLM_LOW_EFFORT_PROVIDER as LLMProvider,
    mediumEffortModel:       moduleConfig.LLM_MEDIUM_EFFORT_MODEL,
    mediumEffortProvider:    moduleConfig.LLM_MEDIUM_EFFORT_PROVIDER as LLMProvider,
    highEffortModel:         moduleConfig.LLM_HIGH_EFFORT_MODEL,
    highEffortProvider:      moduleConfig.LLM_HIGH_EFFORT_PROVIDER as LLMProvider,


    // Loop detection thresholds (graduated: warn → block → circuit break)
    loopWarnThreshold:    moduleConfig.AGENTIC_LOOP_WARN_THRESHOLD,
    loopBlockThreshold:   moduleConfig.AGENTIC_LOOP_BLOCK_THRESHOLD,
    loopCircuitThreshold: moduleConfig.AGENTIC_LOOP_CIRCUIT_THRESHOLD,
  }
}
