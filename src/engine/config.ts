// LUNA Engine — Config Loader
// Lee configuración del engine desde env vars via kernel config helpers.

import { getEnv } from '../kernel/config.js'
import type { EngineConfig, LLMProvider } from './types.js'

function env(key: string, fallback: string): string {
  return getEnv(key) ?? fallback
}

function envInt(key: string, fallback: number): number {
  const v = getEnv(key)
  return v ? parseInt(v, 10) : fallback
}

function envFloat(key: string, fallback: number): number {
  const v = getEnv(key)
  return v ? parseFloat(v) : fallback
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
function envMessages(prefix: string, max: number, fallback: string[]): string[] {
  const msgs: string[] = []
  for (let i = 1; i <= max; i++) {
    const v = getEnv(`${prefix}_${i}`)
    if (v) msgs.push(v)
  }
  return msgs.length > 0 ? msgs : fallback
}

function envProvider(key: string, fallback: LLMProvider): LLMProvider {
  const v = getEnv(key) as LLMProvider | undefined
  return v ?? fallback
}

/**
 * Load engine configuration from env vars.
 */
export function loadEngineConfig(): EngineConfig {
  return {
    // LLM models
    classifyModel: env('LLM_CLASSIFY_MODEL', 'claude-haiku-4-5-20251001'),
    classifyProvider: envProvider('LLM_CLASSIFY_PROVIDER', 'anthropic'),
    respondModel: env('LLM_RESPOND_MODEL', 'claude-sonnet-4-5-20250929'),
    respondProvider: envProvider('LLM_RESPOND_PROVIDER', 'anthropic'),
    complexModel: env('LLM_COMPLEX_MODEL', 'claude-opus-4-5-20251101'),
    complexProvider: envProvider('LLM_COMPLEX_PROVIDER', 'anthropic'),
    toolsModel: env('LLM_TOOLS_MODEL', 'claude-haiku-4-5-20251001'),
    toolsProvider: envProvider('LLM_TOOLS_PROVIDER', 'anthropic'),
    proactiveModel: env('LLM_PROACTIVE_MODEL', 'claude-sonnet-4-5-20250929'),
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
    maxOutputTokens: envInt('LLM_MAX_OUTPUT_TOKENS', 2048),
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

    // Subagent defaults
    subagentMaxIterations: envInt('SUBAGENT_MAX_ITERATIONS', 5),
    subagentTimeoutMs: envInt('SUBAGENT_TIMEOUT_MS', 20000),
    subagentMaxTokenBudget: envInt('SUBAGENT_MAX_TOKEN_BUDGET', 15000),

    // Replanning
    maxReplanAttempts: Math.min(envInt('PIPELINE_MAX_REPLAN_ATTEMPTS', 2), 5),

    // API keys
    anthropicApiKey: env('ANTHROPIC_API_KEY', ''),
    googleApiKey: env('GOOGLE_AI_API_KEY', ''),

    // Knowledge
    knowledgeDir: env('KNOWLEDGE_DIR', 'instance/knowledge'),

    // Session
    sessionReopenWindowMs: envInt('SESSION_REOPEN_WINDOW_MS', 86400000), // 24h

    // Attachments
    attachmentEnabled: envBool('ATTACHMENT_ENABLED', true),
    attachmentSmallDocTokens: envInt('ATTACHMENT_SMALL_DOC_TOKENS', 8000),
    attachmentMediumDocTokens: envInt('ATTACHMENT_MEDIUM_DOC_TOKENS', 32000),
    attachmentSummaryMaxTokens: envInt('ATTACHMENT_SUMMARY_MAX_TOKENS', 2000),
    attachmentCacheTtlMs: envInt('ATTACHMENT_CACHE_TTL_MS', 3600000), // 1h
    attachmentUrlFetchTimeoutMs: envInt('ATTACHMENT_URL_FETCH_TIMEOUT_MS', 10000),
    attachmentUrlMaxSizeMb: envInt('ATTACHMENT_URL_MAX_SIZE_MB', 5),
    attachmentUrlEnabled: envBool('ATTACHMENT_URL_ENABLED', true),

    // Avisos de proceso: now fully per-channel via channel-config:{name} services
    // (legacy WA/email aviso fields removed — each channel defines its own in configSchema)

    // Test mode: only admins receive responses
    testMode: envBool('ENGINE_TEST_MODE', false),

    // Concurrency
    maxConcurrentPipelines: envInt('ENGINE_MAX_CONCURRENT_PIPELINES', 50),
    maxQueueSize: envInt('ENGINE_MAX_QUEUE_SIZE', 200),
    maxConcurrentSteps: envInt('ENGINE_MAX_CONCURRENT_STEPS', 5),
    backpressureMessage: env('ENGINE_BACKPRESSURE_MESSAGE', 'Estamos atendiendo muchos clientes en este momento. Te responderemos pronto.'),

    // Phase 4 retries per provider
    composeRetriesPerProvider: envInt('ENGINE_COMPOSE_RETRIES_PER_PROVIDER', 1),
  }
}
