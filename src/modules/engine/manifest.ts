// LUNA — Module: engine
// Wrapper que inicializa el pipeline de procesamiento de mensajes.
// Expone configSchema para engine params (editable desde console).

import { z } from 'zod'
import type { ModuleManifest } from '../../kernel/types.js'
import type { Registry } from '../../kernel/registry.js'
import { boolEnv, numEnvMin } from '../../kernel/config-helpers.js'
import { initEngine, stopEngine, getEngineStats } from '../../engine/index.js'
import { runAttachmentMigration } from '../../engine/attachments/migration.js'
import { registerQueryAttachmentTool } from '../../engine/attachments/tools/query-attachment.js'
import { registerWebExploreTool } from '../../engine/attachments/tools/web-explore.js'
import type { AttachmentEngineConfig } from '../../engine/attachments/types.js'
import { SYSTEM_HARD_LIMITS } from '../../engine/attachments/types.js'
import { jsonResponse } from '../../kernel/http-helpers.js'

/** Config type for engine module params */
interface EngineModuleConfig {
  // Test mode
  ENGINE_TEST_MODE: boolean
  // Concurrency
  ENGINE_MAX_CONCURRENT_PIPELINES: number
  ENGINE_MAX_QUEUE_SIZE: number
  ENGINE_MAX_CONCURRENT_STEPS: number
  ENGINE_BACKPRESSURE_MESSAGE: string
  // Phase 4
  ENGINE_COMPOSE_RETRIES_PER_PROVIDER: number
  // Attachments
  ATTACHMENT_ENABLED: boolean
  ATTACHMENT_SMALL_DOC_TOKENS: number
  ATTACHMENT_MEDIUM_DOC_TOKENS: number
  ATTACHMENT_SUMMARY_MAX_TOKENS: number
  ATTACHMENT_CACHE_TTL_MS: number
  ATTACHMENT_URL_ENABLED: boolean
  ATTACHMENT_URL_FETCH_TIMEOUT_MS: number
  ATTACHMENT_URL_MAX_SIZE_MB: number
}

const manifest: ModuleManifest = {
  name: 'engine',
  version: '2.0.0',
  description: {
    es: 'Motor de procesamiento de mensajes (pipeline de 5 fases con concurrencia)',
    en: 'Message processing engine (5-phase pipeline with concurrency)',
  },
  type: 'core-module',
  removable: false,
  activateByDefault: true,
  depends: ['memory', 'llm'],

  configSchema: z.object({
    // Test mode
    ENGINE_TEST_MODE: boolEnv(false),
    // Concurrency
    ENGINE_MAX_CONCURRENT_PIPELINES: numEnvMin(1, 50),
    ENGINE_MAX_QUEUE_SIZE: numEnvMin(0, 200),
    ENGINE_MAX_CONCURRENT_STEPS: numEnvMin(1, 5),
    ENGINE_BACKPRESSURE_MESSAGE: z.string().default('Estamos atendiendo muchos clientes en este momento. Te responderemos pronto.'),
    // Phase 4
    ENGINE_COMPOSE_RETRIES_PER_PROVIDER: numEnvMin(0, 1),
    // Attachments
    ATTACHMENT_ENABLED: boolEnv(true),
    ATTACHMENT_SMALL_DOC_TOKENS: numEnvMin(1000, 8000),
    ATTACHMENT_MEDIUM_DOC_TOKENS: numEnvMin(1000, 32000),
    ATTACHMENT_SUMMARY_MAX_TOKENS: numEnvMin(100, 2000),
    ATTACHMENT_CACHE_TTL_MS: numEnvMin(60000, 3600000),
    ATTACHMENT_URL_ENABLED: boolEnv(true),
    ATTACHMENT_URL_FETCH_TIMEOUT_MS: numEnvMin(1000, 10000),
    ATTACHMENT_URL_MAX_SIZE_MB: numEnvMin(1, 5),
  }),

  console: {
    title: { es: 'Engine', en: 'Engine' },
    info: {
      es: `Pipeline de procesamiento de mensajes. Concurrencia, modo de pruebas, adjuntos. Limites del sistema: max ${SYSTEM_HARD_LIMITS.maxFileSizeMb} MB por archivo, max ${SYSTEM_HARD_LIMITS.maxAttachmentsPerMessage} adjuntos por mensaje.`,
      en: `Message processing pipeline. Concurrency, test mode, attachments. System limits: max ${SYSTEM_HARD_LIMITS.maxFileSizeMb} MB per file, max ${SYSTEM_HARD_LIMITS.maxAttachmentsPerMessage} attachments per message.`,
    },
    order: 5,
    group: 'system',
    icon: '&#9881;',
    fields: [
      // ── Test Mode ──
      { key: '_div_test', type: 'divider', label: { es: 'Modo de pruebas', en: 'Test mode' } },
      {
        key: 'ENGINE_TEST_MODE',
        type: 'boolean',
        label: { es: 'Modo de pruebas', en: 'Test mode' },
        description: {
          es: 'Cuando esta activo, solo los admins reciben respuesta. Los demas contactos se ignoran silenciosamente.',
          en: 'When active, only admins receive responses. Other contacts are silently ignored.',
        },
        icon: '&#128274;',
      },

      // ── Concurrency ──
      { key: '_div_concurrency', type: 'divider', label: { es: 'Concurrencia', en: 'Concurrency' } },
      {
        key: 'ENGINE_MAX_CONCURRENT_PIPELINES',
        type: 'number',
        label: { es: 'Pipelines simultaneos (max)', en: 'Max concurrent pipelines' },
        description: {
          es: 'Cuantos mensajes se procesan en paralelo. Los excedentes esperan en cola.',
          en: 'How many messages are processed in parallel. Excess messages wait in queue.',
        },
        min: 1,
        max: 500,
        width: 'half',
      },
      {
        key: 'ENGINE_MAX_QUEUE_SIZE',
        type: 'number',
        label: { es: 'Tamano de cola (max)', en: 'Max queue size' },
        description: {
          es: 'Cuantos mensajes pueden esperar en cola. Si se llena, se envia mensaje de backpressure.',
          en: 'How many messages can wait in queue. When full, backpressure message is sent.',
        },
        min: 0,
        max: 2000,
        width: 'half',
      },
      {
        key: 'ENGINE_MAX_CONCURRENT_STEPS',
        type: 'number',
        label: { es: 'Steps simultaneos (Phase 3)', en: 'Max concurrent steps (Phase 3)' },
        description: {
          es: 'Cuantos pasos de ejecucion corren en paralelo dentro de un pipeline.',
          en: 'How many execution steps run in parallel within a single pipeline.',
        },
        min: 1,
        max: 20,
        width: 'half',
      },
      {
        key: 'ENGINE_BACKPRESSURE_MESSAGE',
        type: 'textarea',
        label: { es: 'Mensaje de backpressure', en: 'Backpressure message' },
        description: {
          es: 'Mensaje que se envia cuando la cola esta llena y no se puede procesar el mensaje.',
          en: 'Message sent when the queue is full and the message cannot be processed.',
        },
      },

      // ── Phase 4 ──
      { key: '_div_phase4', type: 'divider', label: { es: 'Composicion (Phase 4)', en: 'Composition (Phase 4)' } },
      {
        key: 'ENGINE_COMPOSE_RETRIES_PER_PROVIDER',
        type: 'number',
        label: { es: 'Reintentos por proveedor LLM', en: 'Retries per LLM provider' },
        description: {
          es: 'Cuantos reintentos antes de pasar al proveedor de fallback. 0 = sin reintentos.',
          en: 'How many retries before switching to fallback provider. 0 = no retries.',
        },
        min: 0,
        max: 5,
        width: 'half',
      },

      // ── Attachments ──
      { key: '_div_att_general', type: 'divider', label: { es: 'Adjuntos', en: 'Attachments' } },
      {
        key: 'ATTACHMENT_ENABLED',
        type: 'boolean',
        label: { es: 'Procesar adjuntos', en: 'Process attachments' },
        description: { es: 'Activa o desactiva el procesamiento de adjuntos globalmente', en: 'Enable or disable attachment processing globally' },
        icon: '&#128206;',
      },
      {
        key: 'ATTACHMENT_URL_ENABLED',
        type: 'boolean',
        label: { es: 'Extraer contenido de URLs', en: 'Extract URL content' },
        description: { es: 'Detectar y extraer contenido de URLs en mensajes', en: 'Detect and extract content from URLs in messages' },
        icon: '&#128279;',
      },
      { key: '_div_att_docs', type: 'divider', label: { es: 'Clasificacion de documentos', en: 'Document classification' } },
      {
        key: 'ATTACHMENT_SMALL_DOC_TOKENS',
        type: 'number',
        label: { es: 'Umbral doc pequeno (tokens)', en: 'Small doc threshold (tokens)' },
        info: { es: 'Documentos con menos tokens se inyectan completos en el contexto', en: 'Documents with fewer tokens are fully injected into context' },
        min: 1000,
        max: 50000,
        width: 'half',
      },
      {
        key: 'ATTACHMENT_MEDIUM_DOC_TOKENS',
        type: 'number',
        label: { es: 'Umbral doc mediano (tokens)', en: 'Medium doc threshold (tokens)' },
        info: { es: 'Documentos entre pequeno y mediano se cachean en Redis y se inyectan parcialmente', en: 'Documents between small and medium are cached in Redis and partially injected' },
        min: 1000,
        max: 200000,
        width: 'half',
      },
      {
        key: 'ATTACHMENT_SUMMARY_MAX_TOKENS',
        type: 'number',
        label: { es: 'Max tokens de resumen', en: 'Summary max tokens' },
        info: { es: 'Longitud maxima del resumen para documentos grandes', en: 'Maximum summary length for large documents' },
        min: 100,
        max: 10000,
        width: 'half',
      },
      {
        key: 'ATTACHMENT_CACHE_TTL_MS',
        type: 'duration',
        label: { es: 'Cache TTL', en: 'Cache TTL' },
        info: { es: 'Tiempo que los documentos medianos/grandes permanecen en cache Redis', en: 'Time medium/large docs stay cached in Redis' },
        unit: 'ms',
        width: 'half',
      },
      { key: '_div_att_urls', type: 'divider', label: { es: 'Extraccion de URLs', en: 'URL extraction' } },
      {
        key: 'ATTACHMENT_URL_FETCH_TIMEOUT_MS',
        type: 'duration',
        label: { es: 'Timeout de fetch (ms)', en: 'Fetch timeout (ms)' },
        info: { es: 'Tiempo maximo para descargar contenido de una URL', en: 'Maximum time to download content from a URL' },
        unit: 'ms',
        width: 'half',
      },
      {
        key: 'ATTACHMENT_URL_MAX_SIZE_MB',
        type: 'number',
        label: { es: 'Max tamano URL (MB)', en: 'Max URL size (MB)' },
        info: { es: 'Tamano maximo del contenido descargado de una URL', en: 'Maximum size of content downloaded from a URL' },
        min: 1,
        max: 20,
        unit: 'MB',
        width: 'half',
      },
    ],
    apiRoutes: [
      {
        method: 'GET',
        path: 'stats',
        handler: async (_req, res) => {
          const stats = getEngineStats()
          jsonResponse(res, 200, stats)
        },
      },
    ],
  },

  async init(registry: Registry) {
    const db = registry.getDb()

    // Ensure ack_messages table exists (for ACK predefined pool)
    try {
      await db.query(`
        CREATE TABLE IF NOT EXISTS ack_messages (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          channel TEXT NOT NULL DEFAULT '',
          text TEXT NOT NULL,
          active BOOLEAN DEFAULT true,
          sort_order INTEGER DEFAULT 0,
          created_at TIMESTAMPTZ DEFAULT now(),
          updated_at TIMESTAMPTZ DEFAULT now()
        )
      `)
      // Seed only if table is empty
      const { rows } = await db.query(`SELECT COUNT(*)::int AS cnt FROM ack_messages`)
      if (rows[0]?.cnt === 0) {
        await db.query(`
          INSERT INTO ack_messages (channel, text, sort_order) VALUES
            ('', 'Un momento...', 0),
            ('', 'Dame un segundo...', 1),
            ('', 'Estoy en eso...', 2),
            ('whatsapp', 'Ya te reviso...', 0),
            ('whatsapp', 'Un momento, déjame ver...', 1),
            ('email', 'Procesando su consulta...', 0)
        `)
      }
    } catch {
      // Non-critical — ACK will fallback to in-memory defaults
    }

    // Run attachment_extractions table migration
    await runAttachmentMigration(db)

    initEngine(registry)

    // Register attachment tools (after engine init, tools:registry may now be available)
    await registerQueryAttachmentTool(registry)
    await registerWebExploreTool(registry)

    // ── Attachment engine config service (hot-reloadable via console) ──
    let attConfig = registry.getConfig<EngineModuleConfig>('engine')

    const buildAttEngineConfig = (): AttachmentEngineConfig => ({
      enabled: attConfig.ATTACHMENT_ENABLED,
      smallDocTokens: attConfig.ATTACHMENT_SMALL_DOC_TOKENS,
      mediumDocTokens: attConfig.ATTACHMENT_MEDIUM_DOC_TOKENS,
      summaryMaxTokens: attConfig.ATTACHMENT_SUMMARY_MAX_TOKENS,
      cacheTtlMs: attConfig.ATTACHMENT_CACHE_TTL_MS,
      urlFetchTimeoutMs: attConfig.ATTACHMENT_URL_FETCH_TIMEOUT_MS,
      urlMaxSizeMb: attConfig.ATTACHMENT_URL_MAX_SIZE_MB,
      urlEnabled: attConfig.ATTACHMENT_URL_ENABLED,
    })

    registry.provide('engine:attachment-config', {
      get: buildAttEngineConfig,
    })

    // Hot-reload on console config change
    registry.addHook('engine', 'console:config_applied', async () => {
      attConfig = registry.getConfig<EngineModuleConfig>('engine')
    })
  },

  async stop() {
    await stopEngine()
  },
}

export default manifest
