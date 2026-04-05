// LUNA Engine — Config Loader
// Lee configuración del engine desde env vars via kernel config helpers.

import { getEnv } from '../kernel/config.js'
import type { Registry } from '../kernel/registry.js'
import type { EngineConfig } from './types.js'
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
  MEMORY_SESSION_REOPEN_WINDOW_HOURS: number
  SESSION_REOPEN_WINDOW_MS: number
  ENGINE_PIPELINE_TIMEOUT_MS: number
  ENGINE_CHECKPOINT_ENABLED: boolean
  ENGINE_CHECKPOINT_RESUME_WINDOW_MS: number
  ENGINE_CHECKPOINT_CLEANUP_DAYS: number
  ENGINE_AGENTIC_MAX_TURNS: number
  ENGINE_EFFORT_ROUTING: boolean
  LLM_CRITICIZER_MODE: string
  ENGINE_CRITICIZER_MAX_RETRIES: number
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

function envBool(key: string, fallback: boolean): boolean {
  const v = getEnv(key)
  if (!v) return fallback
  return v === 'true'
}

/**
 * Load engine configuration from registry for module-owned fields and env for legacy globals.
 */
export function loadEngineConfig(registry: Registry): EngineConfig {
  const moduleConfig = registry.getConfig<EngineModuleConfig>('engine')
  return {
    // LLM limits (model/provider selection handled by task router in LLM module)
    maxInputTokens: envInt('LLM_MAX_INPUT_TOKENS', 4096),
    maxOutputTokens: envInt('LLM_MAX_OUTPUT_TOKENS', 7000),
    requestTimeoutMs: envInt('LLM_REQUEST_TIMEOUT_MS', 30000),

    // Pipeline
    maxToolCallsPerTurn: envInt('PIPELINE_MAX_TOOL_CALLS_PER_TURN', 5),
    sessionTtlMs: envInt('PIPELINE_SESSION_TTL_MS', 1800000),

    // User type cache
    userTypeCacheTtlSeconds: envInt('USER_TYPE_CACHE_TTL_SECONDS', 43200), // 12h

    // Proactive
    batchEnabled: envBool('BATCH_ENABLED', true),
    batchCron: env('BATCH_CRON', '0 2 * * *'),
    batchTimezone: env('BATCH_TIMEZONE', 'America/Mexico_City'),

    // Subagent v2 — hard limits (not configurable from console, safety only)
    // User-configurable token budget lives in subagent_types table
    subagentTimeoutMs: SUBAGENT_HARD_LIMITS.HARD_TIMEOUT_MS,
    subagentMaxTokenBudget: SUBAGENT_HARD_LIMITS.HARD_MAX_TOKEN_BUDGET,

    // API keys
    anthropicApiKey: env('ANTHROPIC_API_KEY', ''),
    googleApiKey: env('GOOGLE_AI_API_KEY', ''),

    // Knowledge
    knowledgeDir: env('KNOWLEDGE_DIR', 'instance/knowledge'),

    // Session reopen window: prefer hours, fall back to explicit ms
    sessionReopenWindowMs: moduleConfig.MEMORY_SESSION_REOPEN_WINDOW_HOURS > 0
      ? moduleConfig.MEMORY_SESSION_REOPEN_WINDOW_HOURS * 60 * 60 * 1000
      : moduleConfig.SESSION_REOPEN_WINDOW_MS,

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
    pipelineTimeoutMs: moduleConfig.ENGINE_PIPELINE_TIMEOUT_MS,

    // Criticizer (quality gate): disabled | complex_only | always
    criticizerMode: moduleConfig.LLM_CRITICIZER_MODE as 'disabled' | 'complex_only' | 'always',
    criticizerMaxRetries: moduleConfig.ENGINE_CRITICIZER_MAX_RETRIES,

    // Checkpoints (resumable pipelines)
    checkpointEnabled: moduleConfig.ENGINE_CHECKPOINT_ENABLED,
    checkpointResumeWindowMs: moduleConfig.ENGINE_CHECKPOINT_RESUME_WINDOW_MS,
    checkpointCleanupDays: moduleConfig.ENGINE_CHECKPOINT_CLEANUP_DAYS,

    // --- Agentic engine config (v2.0) ---
    agenticMaxTurns:         moduleConfig.ENGINE_AGENTIC_MAX_TURNS,
    effortRoutingEnabled:    moduleConfig.ENGINE_EFFORT_ROUTING,
  }
}
