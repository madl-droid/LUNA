// LUNA — Configuracion centralizada
// REGLA: Todo parametro configurable del sistema se define y exporta desde este archivo.
// Ningun otro modulo debe leer process.env directamente.
//
// Dos fuentes:
// 1. .env (via Varlock) → secretos (API keys, DB passwords)
// 2. instance/config.json → configuración operativa editable desde UI

// Runtime: dotenv carga .env → process.env
// Varlock queda instalado para CLI (varlock scan) y .env.schema como doc AI-safe
import dotenv from 'dotenv'
dotenv.config()

import * as fs from 'node:fs'
import * as path from 'node:path'
import { z } from 'zod'

// --- Helpers ---
const boolStr = z.string().transform(v => v === 'true').pipe(z.boolean())
const intStr = z.string().transform(Number).pipe(z.number().int())
const floatStr = z.string().transform(Number).pipe(z.number())

// --- Instance config schema (instance/config.json, editable desde UI) ---
export const instanceConfigSchema = z.object({
  whatsapp: z.object({
    phoneNumber: z.string().default(''),
    enabled: z.boolean().default(true),
    baileys: z.object({
      printQRInTerminal: z.boolean().default(true),
      syncFullHistory: z.boolean().default(false),
      allowedEvents: z.array(z.string()).default(['messages.upsert', 'connection.update', 'creds.update']),
    }).default({}),
  }).default({}),
  llm: z.object({
    primaryProvider: z.string().default('anthropic'),
    fallbackProvider: z.string().default('gemini'),
    models: z.object({
      classify: z.object({
        provider: z.string().default('anthropic'),
        model: z.string().default('claude-haiku-4-5-20251001'),
        maxInputTokens: z.number().default(2048),
        maxOutputTokens: z.number().default(512),
      }).default({}),
      respond: z.object({
        provider: z.string().default('anthropic'),
        model: z.string().default('claude-sonnet-4-5-20250929'),
        maxInputTokens: z.number().default(8192),
        maxOutputTokens: z.number().default(2048),
      }).default({}),
      complex: z.object({
        provider: z.string().default('anthropic'),
        model: z.string().default('claude-opus-4-5-20251101'),
        maxInputTokens: z.number().default(16384),
        maxOutputTokens: z.number().default(4096),
      }).default({}),
      compress: z.object({
        provider: z.string().default('anthropic'),
        model: z.string().default('claude-haiku-4-5-20251001'),
        maxInputTokens: z.number().default(8192),
        maxOutputTokens: z.number().default(2048),
      }).default({}),
      fallback: z.object({
        provider: z.string().default('anthropic'),
        model: z.string().default('claude-haiku-4-5-20251001'),
        maxInputTokens: z.number().default(8192),
        maxOutputTokens: z.number().default(2048),
      }).default({}),
    }).default({}),
    availableModels: z.object({
      anthropic: z.array(z.string()).default([
        'claude-haiku-4-5-20251001',
        'claude-sonnet-4-5-20250929',
        'claude-sonnet-4-6',
        'claude-opus-4-5-20251101',
        'claude-opus-4-6',
        'claude-sonnet-4-20250514',
        'claude-opus-4-20250514',
      ]),
      gemini: z.array(z.string()).default([
        'gemini-2.5-flash',
        'gemini-2.5-pro',
        'gemini-2.0-flash',
        'gemini-1.5-pro',
        'gemini-1.5-flash',
      ]),
    }).default({}),
  }).default({}),
  memory: z.object({
    bufferMessageCount: z.number().default(50),
    sessionInactivityTimeoutMinutes: z.number().default(30),
    sessionMaxTTLHours: z.number().default(24),
    compressionThreshold: z.number().default(30),
    compressionKeepRecent: z.number().default(10),
  }).default({}),
  channels: z.object({
    enabledChannels: z.array(z.string()).default(['whatsapp']),
  }).default({}),
})

export type InstanceConfig = z.infer<typeof instanceConfigSchema>

// --- Load instance config from JSON file ---
const INSTANCE_CONFIG_PATH = path.resolve('instance/config.json')

function loadInstanceConfig(): InstanceConfig {
  try {
    if (fs.existsSync(INSTANCE_CONFIG_PATH)) {
      const raw = fs.readFileSync(INSTANCE_CONFIG_PATH, 'utf-8')
      return instanceConfigSchema.parse(JSON.parse(raw))
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[config] Failed to load instance/config.json, using defaults:', err)
  }
  return instanceConfigSchema.parse({})
}

// Mutable reference so admin UI can hot-reload
let _instanceConfig = loadInstanceConfig()

export function reloadInstanceConfig(): void {
  _instanceConfig = loadInstanceConfig()
}

// --- Env config schema (secrets from .env) ---
const envConfigSchema = z.object({
  // Node
  nodeEnv: z.enum(['development', 'production', 'staging', 'test']).default('development'),
  port: intStr.default('3000'),
  logLevel: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  // Database
  db: z.object({
    host: z.string().default('localhost'),
    port: intStr.default('5432'),
    name: z.string().default('luna'),
    user: z.string().default('luna'),
    password: z.string().default('luna_dev'),
    maxConnections: intStr.default('20'),
    idleTimeoutMs: intStr.default('30000'),
    connectionTimeoutMs: intStr.default('5000'),
  }),

  // Redis
  redis: z.object({
    host: z.string().default('localhost'),
    port: intStr.default('6379'),
    password: z.string().default(''),
    db: intStr.default('0'),
    maxRetries: intStr.default('3'),
  }),

  // BullMQ
  bullmq: z.object({
    defaultAttempts: intStr.default('3'),
    backoffDelayMs: intStr.default('5000'),
  }),

  // API Keys
  apiKeys: z.object({
    anthropic: z.string().default(''),
    openai: z.string().default(''),
    googleAi: z.string().default(''),
  }),

  // Google OAuth2
  google: z.object({
    clientId: z.string().default(''),
    clientSecret: z.string().default(''),
    redirectUri: z.string().default('http://localhost:3000/oauth2callback'),
    refreshToken: z.string().default(''),
    sheetId: z.string().default(''),
    sheetSyncEnabled: boolStr.default('true'),
  }),

  // WhatsApp
  whatsapp: z.object({
    enabled: boolStr.default('true'),
    authDir: z.string().default('instance/wa-auth'),
    reconnectIntervalMs: intStr.default('5000'),
    maxReconnectAttempts: intStr.default('10'),
  }),

  // Email
  email: z.object({
    enabled: boolStr.default('true'),
    from: z.string().default(''),
    imapHost: z.string().default('imap.gmail.com'),
    imapPort: intStr.default('993'),
    smtpHost: z.string().default('smtp.gmail.com'),
    smtpPort: intStr.default('465'),
    pollIntervalMs: intStr.default('60000'),
  }),

  // LLM
  llm: z.object({
    classify: z.object({
      model: z.string().default('claude-haiku-4-5-20251001'),
      provider: z.string().default('anthropic'),
    }),
    respond: z.object({
      model: z.string().default('claude-sonnet-4-5-20250929'),
      provider: z.string().default('anthropic'),
    }),
    complex: z.object({
      model: z.string().default('claude-opus-4-5-20251101'),
      provider: z.string().default('anthropic'),
    }),
    tools: z.object({
      model: z.string().default('claude-haiku-4-5-20251001'),
      provider: z.string().default('anthropic'),
    }),
    compress: z.object({
      model: z.string().default('claude-haiku-4-5-20251001'),
      provider: z.string().default('anthropic'),
    }),
    proactive: z.object({
      model: z.string().default('claude-sonnet-4-5-20250929'),
      provider: z.string().default('anthropic'),
    }),
    fallback: z.object({
      classifyModel: z.string().default('gemini-2.5-flash'),
      classifyProvider: z.string().default('google'),
      respondModel: z.string().default('gemini-2.5-flash'),
      respondProvider: z.string().default('google'),
      complexModel: z.string().default('gemini-2.5-pro'),
      complexProvider: z.string().default('google'),
    }),
    maxInputTokens: intStr.default('4096'),
    maxOutputTokens: intStr.default('2048'),
    temperatureClassify: floatStr.default('0.1'),
    temperatureRespond: floatStr.default('0.7'),
    temperatureComplex: floatStr.default('0.5'),
    requestTimeoutMs: intStr.default('30000'),
    circuitBreaker: z.object({
      failures: intStr.default('5'),
      windowMs: intStr.default('600000'),
      cooldownMs: intStr.default('300000'),
    }),
  }),

  // Pipeline
  pipeline: z.object({
    maxToolCallsPerTurn: intStr.default('5'),
    maxConversationTurns: intStr.default('50'),
    sessionTtlMs: intStr.default('1800000'),
  }),

  // Follow-up
  followup: z.object({
    enabled: boolStr.default('true'),
    delayMinutes: intStr.default('30'),
    maxAttempts: intStr.default('3'),
    coldAfterAttempts: intStr.default('3'),
  }),

  // Lead qualification
  qualifying: z.object({
    criteriaFile: z.string().default('instance/qualifying.json'),
    scoringEnabled: boolStr.default('true'),
  }),

  // Batch
  batch: z.object({
    enabled: boolStr.default('true'),
    cron: z.string().default('0 2 * * *'),
    timezone: z.string().default('America/Mexico_City'),
  }),

  // Media
  media: z.object({
    storageDir: z.string().default('instance/knowledge/media'),
    maxFileSizeMb: intStr.default('16'),
  }),

  // Health check
  healthCheck: z.object({
    enabled: boolStr.default('true'),
    port: intStr.default('3001'),
  }),

  // Oficina (panel de control)
  oficina: z.object({
    enabled: boolStr.default('true'),
  }),

  // Active modules
  modules: z.object({
    whatsapp: boolStr.default('true'),
    email: boolStr.default('true'),
    googleSheets: boolStr.default('true'),
    googleCalendar: boolStr.default('true'),
    batch: boolStr.default('true'),
    followup: boolStr.default('true'),
    webSearch: boolStr.default('false'),
  }),
})

// --- Mapeo env vars → schema ---
function loadFromEnv() {
  const env = process.env
  return envConfigSchema.parse({
    nodeEnv: env.NODE_ENV,
    port: env.PORT,
    logLevel: env.LOG_LEVEL,

    db: {
      host: env.DB_HOST,
      port: env.DB_PORT,
      name: env.DB_NAME,
      user: env.DB_USER,
      password: env.DB_PASSWORD,
      maxConnections: env.DB_MAX_CONNECTIONS,
      idleTimeoutMs: env.DB_IDLE_TIMEOUT_MS,
      connectionTimeoutMs: env.DB_CONNECTION_TIMEOUT_MS,
    },

    redis: {
      host: env.REDIS_HOST,
      port: env.REDIS_PORT,
      password: env.REDIS_PASSWORD,
      db: env.REDIS_DB,
      maxRetries: env.REDIS_MAX_RETRIES,
    },

    bullmq: {
      defaultAttempts: env.BULLMQ_DEFAULT_ATTEMPTS,
      backoffDelayMs: env.BULLMQ_BACKOFF_DELAY_MS,
    },

    apiKeys: {
      anthropic: env.ANTHROPIC_API_KEY,
      openai: env.OPENAI_API_KEY,
      googleAi: env.GOOGLE_AI_API_KEY,
    },

    google: {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      redirectUri: env.GOOGLE_REDIRECT_URI,
      refreshToken: env.GOOGLE_REFRESH_TOKEN,
      sheetId: env.GOOGLE_SHEET_ID,
      sheetSyncEnabled: env.GOOGLE_SHEET_SYNC_ENABLED,
    },

    whatsapp: {
      enabled: env.WHATSAPP_ENABLED,
      authDir: env.WHATSAPP_AUTH_DIR,
      reconnectIntervalMs: env.WHATSAPP_RECONNECT_INTERVAL_MS,
      maxReconnectAttempts: env.WHATSAPP_MAX_RECONNECT_ATTEMPTS,
    },

    email: {
      enabled: env.EMAIL_ENABLED,
      from: env.EMAIL_FROM,
      imapHost: env.EMAIL_IMAP_HOST,
      imapPort: env.EMAIL_IMAP_PORT,
      smtpHost: env.EMAIL_SMTP_HOST,
      smtpPort: env.EMAIL_SMTP_PORT,
      pollIntervalMs: env.EMAIL_POLL_INTERVAL_MS,
    },

    llm: {
      classify: {
        model: env.LLM_CLASSIFY_MODEL,
        provider: env.LLM_CLASSIFY_PROVIDER,
      },
      respond: {
        model: env.LLM_RESPOND_MODEL,
        provider: env.LLM_RESPOND_PROVIDER,
      },
      complex: {
        model: env.LLM_COMPLEX_MODEL,
        provider: env.LLM_COMPLEX_PROVIDER,
      },
      tools: {
        model: env.LLM_TOOLS_MODEL,
        provider: env.LLM_TOOLS_PROVIDER,
      },
      compress: {
        model: env.LLM_COMPRESS_MODEL,
        provider: env.LLM_COMPRESS_PROVIDER,
      },
      proactive: {
        model: env.LLM_PROACTIVE_MODEL,
        provider: env.LLM_PROACTIVE_PROVIDER,
      },
      fallback: {
        classifyModel: env.LLM_FALLBACK_CLASSIFY_MODEL,
        classifyProvider: env.LLM_FALLBACK_CLASSIFY_PROVIDER,
        respondModel: env.LLM_FALLBACK_RESPOND_MODEL,
        respondProvider: env.LLM_FALLBACK_RESPOND_PROVIDER,
        complexModel: env.LLM_FALLBACK_COMPLEX_MODEL,
        complexProvider: env.LLM_FALLBACK_COMPLEX_PROVIDER,
      },
      maxInputTokens: env.LLM_MAX_INPUT_TOKENS,
      maxOutputTokens: env.LLM_MAX_OUTPUT_TOKENS,
      temperatureClassify: env.LLM_TEMPERATURE_CLASSIFY,
      temperatureRespond: env.LLM_TEMPERATURE_RESPOND,
      temperatureComplex: env.LLM_TEMPERATURE_COMPLEX,
      requestTimeoutMs: env.LLM_REQUEST_TIMEOUT_MS,
      circuitBreaker: {
        failures: env.LLM_CIRCUIT_BREAKER_FAILURES,
        windowMs: env.LLM_CIRCUIT_BREAKER_WINDOW_MS,
        cooldownMs: env.LLM_CIRCUIT_BREAKER_COOLDOWN_MS,
      },
    },

    pipeline: {
      maxToolCallsPerTurn: env.PIPELINE_MAX_TOOL_CALLS_PER_TURN,
      maxConversationTurns: env.PIPELINE_MAX_CONVERSATION_TURNS,
      sessionTtlMs: env.PIPELINE_SESSION_TTL_MS,
    },

    followup: {
      enabled: env.FOLLOWUP_ENABLED,
      delayMinutes: env.FOLLOWUP_DELAY_MINUTES,
      maxAttempts: env.FOLLOWUP_MAX_ATTEMPTS,
      coldAfterAttempts: env.FOLLOWUP_COLD_AFTER_ATTEMPTS,
    },

    qualifying: {
      criteriaFile: env.QUALIFYING_CRITERIA_FILE,
      scoringEnabled: env.LEAD_SCORING_ENABLED,
    },

    batch: {
      enabled: env.BATCH_ENABLED,
      cron: env.BATCH_CRON,
      timezone: env.BATCH_TIMEZONE,
    },

    media: {
      storageDir: env.MEDIA_STORAGE_DIR,
      maxFileSizeMb: env.MEDIA_MAX_FILE_SIZE_MB,
    },

    healthCheck: {
      enabled: env.HEALTH_CHECK_ENABLED,
      port: env.HEALTH_CHECK_PORT,
    },

    oficina: {
      enabled: env.OFICINA_ENABLED,
    },

    modules: {
      whatsapp: env.MODULE_WHATSAPP,
      email: env.MODULE_EMAIL,
      googleSheets: env.MODULE_GOOGLE_SHEETS,
      googleCalendar: env.MODULE_GOOGLE_CALENDAR,
      batch: env.MODULE_BATCH,
      followup: env.MODULE_FOLLOWUP,
      webSearch: env.MODULE_WEB_SEARCH,
    },
  })
}

// --- Export singleton (hot-reloadable) ---
let _envConfig = loadFromEnv()

/** Recarga .env desde disco y actualiza el config en memoria. */
export function reloadEnvConfig(): void {
  // Re-read .env file into process.env
  dotenv.config({ override: true })
  _envConfig = loadFromEnv()
}

// Combined config: env config + instance config accessible via .instanceConfig
// Uses a Proxy so property reads always reflect the latest _envConfig after hot-reload.
type EnvConfig = ReturnType<typeof loadFromEnv>
type CombinedConfig = EnvConfig & { readonly instanceConfig: InstanceConfig }

export const config: CombinedConfig = new Proxy({} as CombinedConfig, {
  get(_target, prop) {
    if (prop === 'instanceConfig') return _instanceConfig
    if (typeof prop === 'symbol') return undefined
    return (_envConfig as Record<string, unknown>)[prop]
  },
  ownKeys() {
    return [...Object.keys(_envConfig), 'instanceConfig']
  },
  getOwnPropertyDescriptor(_target, prop) {
    if (typeof prop === 'symbol') return undefined
    if (prop === 'instanceConfig' || prop in _envConfig) {
      return { configurable: true, enumerable: true, writable: false, value: (config as Record<string, unknown>)[prop] }
    }
    return undefined
  },
})

export type Config = CombinedConfig
