// LUNA — Module: engine
// Wrapper que inicializa el pipeline de procesamiento de mensajes.
// Expone configSchema para engine params (editable desde console).

import { z } from 'zod'
import type { ModuleManifest } from '../../kernel/types.js'
import type { Registry } from '../../kernel/registry.js'
import { boolEnv, numEnvMin } from '../../kernel/config-helpers.js'
import { initEngine, stopEngine, getEngineStats, reloadEngineConfig } from '../../engine/index.js'
import { runAttachmentMigration } from '../../engine/attachments/migration.js'
import { registerQueryAttachmentTool } from '../../engine/attachments/tools/query-attachment.js'
import { registerWebExploreTool } from '../../engine/attachments/tools/web-explore.js'
import type { AttachmentEngineConfig } from '../../engine/attachments/types.js'
import { SYSTEM_HARD_LIMITS } from '../../engine/attachments/types.js'
import { jsonResponse } from '../../kernel/http-helpers.js'
import { kernelConfig } from '../../kernel/config.js'

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
  MEMORY_SESSION_REOPEN_WINDOW_HOURS: number
  SESSION_REOPEN_WINDOW_MS: number
  ENGINE_PIPELINE_TIMEOUT_MS: number
  ENGINE_CHECKPOINT_ENABLED: boolean
  ENGINE_CHECKPOINT_RESUME_WINDOW_MS: number
  ENGINE_CHECKPOINT_CLEANUP_DAYS: number
  // Nightly batch
  NIGHTLY_SCORING_ENABLED: boolean
  NIGHTLY_SCORING_THRESHOLD: number
  NIGHTLY_SCORING_BATCH_SIZE: number
  NIGHTLY_COMPRESSION_ENABLED: boolean
  NIGHTLY_COMPRESSION_MIN_MESSAGES: number
  NIGHTLY_COMPRESSION_BATCH_SIZE: number
  NIGHTLY_REPORT_ENABLED: boolean
  NIGHTLY_REPORT_SHEET_ID: string
  NIGHTLY_REPORT_SHEET_NAME: string
  NIGHTLY_CONCURRENCY: number
  NIGHTLY_MAX_RETRIES: number
  // Agentic engine (v2)
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
    MEMORY_SESSION_REOPEN_WINDOW_HOURS: numEnvMin(0, 1),
    SESSION_REOPEN_WINDOW_MS: numEnvMin(60000, 3600000),
    ENGINE_PIPELINE_TIMEOUT_MS: numEnvMin(1000, 120000),
    ENGINE_CHECKPOINT_ENABLED: boolEnv(true),
    ENGINE_CHECKPOINT_RESUME_WINDOW_MS: numEnvMin(1000, 300000),
    ENGINE_CHECKPOINT_CLEANUP_DAYS: numEnvMin(1, 7),
    // Nightly batch
    NIGHTLY_SCORING_ENABLED: boolEnv(true),
    NIGHTLY_SCORING_THRESHOLD: numEnvMin(0, 40),
    NIGHTLY_SCORING_BATCH_SIZE: numEnvMin(1, 100),
    NIGHTLY_COMPRESSION_ENABLED: boolEnv(true),
    NIGHTLY_COMPRESSION_MIN_MESSAGES: numEnvMin(10, 30),
    NIGHTLY_COMPRESSION_BATCH_SIZE: numEnvMin(1, 20),
    NIGHTLY_REPORT_ENABLED: boolEnv(true),
    NIGHTLY_REPORT_SHEET_ID: z.string().default(''),
    NIGHTLY_REPORT_SHEET_NAME: z.string().default('Daily Report'),
    NIGHTLY_CONCURRENCY: numEnvMin(1, 5),
    NIGHTLY_MAX_RETRIES: numEnvMin(0, 2),
    // Agentic engine (v2)
    ENGINE_AGENTIC_MAX_TURNS: numEnvMin(1, 15),
    ENGINE_EFFORT_ROUTING: boolEnv(true),
    AGENTIC_LOOP_WARN_THRESHOLD: numEnvMin(2, 3),
    AGENTIC_LOOP_BLOCK_THRESHOLD: numEnvMin(3, 5),
    AGENTIC_LOOP_CIRCUIT_THRESHOLD: numEnvMin(4, 8),
    LLM_CRITICIZER_MODE: z.string().default('complex_only'),
    LLM_LOW_EFFORT_MODEL: z.string().default('claude-haiku-4-5-20251001'),
    LLM_LOW_EFFORT_PROVIDER: z.string().default('anthropic'),
    LLM_MEDIUM_EFFORT_MODEL: z.string().default('claude-sonnet-4-6'),
    LLM_MEDIUM_EFFORT_PROVIDER: z.string().default('anthropic'),
    LLM_HIGH_EFFORT_MODEL: z.string().default('claude-sonnet-4-6'),
    LLM_HIGH_EFFORT_PROVIDER: z.string().default('anthropic'),
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
        info: {
          es: 'Este mensaje se muestra al usuario cuando el motor esta sobrecargado y no puede procesar mas solicitudes. Personalizalo para que sea claro y amigable.',
          en: 'This message is shown to users when the engine is overloaded and cannot process more requests. Customize it to be clear and friendly.',
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

      // ── Runtime ──
      { key: '_div_runtime', type: 'divider', label: { es: 'Runtime', en: 'Runtime' } },
      {
        key: 'MEMORY_SESSION_REOPEN_WINDOW_HOURS',
        type: 'number',
        label: { es: 'Reapertura de sesion (horas)', en: 'Session reopen window (hours)' },
        description: {
          es: 'Cuantas horas puede reabrirse una sesion activa antes de crear una nueva.',
          en: 'How many hours an active session may be reopened before creating a new one.',
        },
        min: 0,
        max: 168,
        width: 'half',
      },
      {
        key: 'ENGINE_PIPELINE_TIMEOUT_MS',
        type: 'duration',
        label: { es: 'Timeout global del pipeline', en: 'Global pipeline timeout' },
        description: {
          es: 'Tiempo maximo total antes de abortar un pipeline atascado.',
          en: 'Maximum total time before aborting a stuck pipeline.',
        },
        unit: 'ms',
        width: 'half',
      },
      {
        key: 'ENGINE_CHECKPOINT_ENABLED',
        type: 'boolean',
        label: { es: 'Checkpoints activos', en: 'Enable checkpoints' },
        description: {
          es: 'Guarda checkpoints para reanudar pipelines interrumpidos.',
          en: 'Stores checkpoints to resume interrupted pipelines.',
        },
      },
      {
        key: 'ENGINE_CHECKPOINT_RESUME_WINDOW_MS',
        type: 'duration',
        label: { es: 'Ventana de reanudacion', en: 'Resume window' },
        description: {
          es: 'Edad maxima de checkpoints incompletos candidatos a reanudacion.',
          en: 'Maximum age of incomplete checkpoints eligible for resume.',
        },
        unit: 'ms',
        width: 'half',
      },
      {
        key: 'ENGINE_CHECKPOINT_CLEANUP_DAYS',
        type: 'number',
        label: { es: 'Limpieza de checkpoints (dias)', en: 'Checkpoint cleanup (days)' },
        description: {
          es: 'Dias antes de purgar checkpoints completados o fallidos.',
          en: 'Days before purging completed or failed checkpoints.',
        },
        min: 1,
        max: 90,
        width: 'half',
      },

      // ── Nightly Batch ──
      { key: '_div_nightly', type: 'divider', label: { es: 'Lote Nocturno', en: 'Nightly Batch' } },
      {
        key: 'NIGHTLY_SCORING_ENABLED',
        type: 'boolean',
        label: { es: 'Scoring de leads frios', en: 'Cold lead scoring' },
        description: {
          es: 'Re-evalua leads frios con LLM para decidir si vale la pena reactivarlos.',
          en: 'Re-evaluate cold leads with LLM to decide if reactivation is worthwhile.',
        },
      },
      {
        key: 'NIGHTLY_SCORING_THRESHOLD',
        type: 'number',
        label: { es: 'Threshold de reactivacion', en: 'Reactivation threshold' },
        description: {
          es: 'Score minimo (0-100) para que un lead frio pase a qualifying automaticamente.',
          en: 'Minimum score (0-100) for a cold lead to transition to qualifying automatically.',
        },
        min: 0,
        max: 100,
        width: 'half',
      },
      {
        key: 'NIGHTLY_SCORING_BATCH_SIZE',
        type: 'number',
        label: { es: 'Batch size (scoring)', en: 'Batch size (scoring)' },
        description: { es: 'Max leads procesados por ejecucion', en: 'Max leads processed per run' },
        min: 1,
        max: 500,
        width: 'half',
      },
      {
        key: 'NIGHTLY_COMPRESSION_ENABLED',
        type: 'boolean',
        label: { es: 'Compresion de sesiones', en: 'Session compression' },
        description: {
          es: 'Comprime sesiones con muchos mensajes a un resumen usando LLM.',
          en: 'Compress sessions with many messages into a summary using LLM.',
        },
      },
      {
        key: 'NIGHTLY_COMPRESSION_MIN_MESSAGES',
        type: 'number',
        label: { es: 'Min mensajes para comprimir', en: 'Min messages to compress' },
        description: { es: 'Una sesion necesita al menos esta cantidad de mensajes para ser comprimida.', en: 'A session needs at least this many messages to be compressed.' },
        min: 10,
        max: 200,
        width: 'half',
      },
      {
        key: 'NIGHTLY_COMPRESSION_BATCH_SIZE',
        type: 'number',
        label: { es: 'Batch size (compresion)', en: 'Batch size (compression)' },
        description: { es: 'Max sesiones comprimidas por ejecucion', en: 'Max sessions compressed per run' },
        min: 1,
        max: 100,
        width: 'half',
      },
      {
        key: 'NIGHTLY_REPORT_ENABLED',
        type: 'boolean',
        label: { es: 'Reporte diario', en: 'Daily report' },
        description: {
          es: 'Genera metricas del dia y las sincroniza a Google Sheets.',
          en: 'Generate daily metrics and sync them to Google Sheets.',
        },
      },
      {
        key: 'NIGHTLY_REPORT_SHEET_ID',
        type: 'text',
        label: { es: 'Spreadsheet ID', en: 'Spreadsheet ID' },
        description: { es: 'ID del spreadsheet de Google donde sincronizar reportes', en: 'Google spreadsheet ID for report sync' },
        placeholder: '1BxiMV...',
        width: 'half',
      },
      {
        key: 'NIGHTLY_REPORT_SHEET_NAME',
        type: 'text',
        label: { es: 'Nombre de hoja', en: 'Sheet name' },
        description: { es: 'Nombre de la hoja dentro del spreadsheet', en: 'Sheet tab name within the spreadsheet' },
        placeholder: 'Daily Report',
        width: 'half',
      },
      {
        key: 'NIGHTLY_CONCURRENCY',
        type: 'number',
        label: { es: 'Concurrencia del lote', en: 'Batch concurrency' },
        description: {
          es: 'Cuantas tareas se procesan en paralelo durante el lote nocturno.',
          en: 'How many tasks are processed in parallel during the nightly batch.',
        },
        min: 1,
        max: 20,
        width: 'half',
      },
      {
        key: 'NIGHTLY_MAX_RETRIES',
        type: 'number',
        label: { es: 'Reintentos por tarea', en: 'Retries per task' },
        description: {
          es: 'Reintentos con backoff exponencial antes de marcar una tarea como fallida.',
          en: 'Retries with exponential backoff before marking a task as failed.',
        },
        min: 0,
        max: 5,
        width: 'half',
      },

      // ── Agentic Engine ──
      { key: '_div_agentic', type: 'divider', label: { es: 'Motor Agentico (v2)', en: 'Agentic Engine (v2)' } },
      {
        key: 'ENGINE_AGENTIC_MAX_TURNS',
        type: 'number',
        label: { es: 'Turnos maximos de herramientas', en: 'Max tool turns' },
        info: {
          es: 'Maximo de iteraciones de tool-use por mensaje antes de forzar una respuesta de texto.',
          en: 'Maximum tool-use iterations per message before forcing a text response.',
        },
        min: 1,
        max: 30,
        width: 'half',
      },
      {
        key: 'ENGINE_EFFORT_ROUTING',
        type: 'boolean',
        label: { es: 'Enrutamiento por esfuerzo', en: 'Effort routing' },
        info: {
          es: 'Clasifica mensajes por complejidad para usar el modelo mas apropiado y optimizar costos.',
          en: 'Classifies messages by complexity to use the most appropriate model and optimize costs.',
        },
      },

      // ── Loop Detection ──
      { key: '_div_loop', type: 'divider', label: { es: 'Protecciones del Loop', en: 'Loop Safeguards' } },
      {
        key: 'AGENTIC_LOOP_WARN_THRESHOLD',
        type: 'number',
        label: { es: 'Umbral de advertencia', en: 'Warning threshold' },
        info: {
          es: 'Llamadas identicas antes de advertir al LLM del posible loop.',
          en: 'Identical calls before warning the LLM of a possible loop.',
        },
        min: 2,
        max: 10,
        width: 'third',
      },
      {
        key: 'AGENTIC_LOOP_BLOCK_THRESHOLD',
        type: 'number',
        label: { es: 'Umbral de bloqueo', en: 'Block threshold' },
        info: {
          es: 'Llamadas identicas antes de bloquear la herramienta.',
          en: 'Identical calls before blocking the tool.',
        },
        min: 3,
        max: 15,
        width: 'third',
      },
      {
        key: 'AGENTIC_LOOP_CIRCUIT_THRESHOLD',
        type: 'number',
        label: { es: 'Umbral de corte (circuit)', en: 'Circuit break threshold' },
        info: {
          es: 'Llamadas identicas antes de forzar una respuesta de texto sin herramientas.',
          en: 'Identical calls before forcing a text response without tools.',
        },
        min: 4,
        max: 20,
        width: 'third',
      },
      {
        key: 'LLM_CRITICIZER_MODE',
        type: 'select',
        label: { es: 'Modo del verificador de calidad', en: 'Quality checker mode' },
        info: {
          es: 'Controla cuando se activa el verificador de calidad antes de enviar la respuesta.',
          en: 'Controls when the quality checker activates before sending the response.',
        },
        options: [
          { value: 'disabled', label: { es: 'Desactivado', en: 'Disabled' } },
          { value: 'complex_only', label: { es: 'Solo mensajes complejos (recomendado)', en: 'Complex messages only (recommended)' } },
          { value: 'always', label: { es: 'Siempre', en: 'Always' } },
        ],
        width: 'half',
      },

      // ── Models by Effort ──
      { key: '_div_effort_models', type: 'divider', label: { es: 'Modelos por Esfuerzo', en: 'Models by Effort' } },
      {
        key: 'LLM_LOW_EFFORT_MODEL',
        type: 'model-select',
        label: { es: 'Modelo bajo esfuerzo', en: 'Low effort model' },
        info: {
          es: 'Modelo para mensajes simples: saludos, confirmaciones, preguntas directas.',
          en: 'Model for simple messages: greetings, confirmations, direct questions.',
        },
        width: 'half',
      },
      {
        key: 'LLM_MEDIUM_EFFORT_MODEL',
        type: 'model-select',
        label: { es: 'Modelo medio esfuerzo', en: 'Medium effort model' },
        info: {
          es: 'Modelo para mensajes de complejidad media: consultas con contexto, seguimientos.',
          en: 'Model for medium complexity messages: contextual queries, follow-ups.',
        },
        width: 'half',
      },
      {
        key: 'LLM_HIGH_EFFORT_MODEL',
        type: 'model-select',
        label: { es: 'Modelo alto esfuerzo', en: 'High effort model' },
        info: {
          es: 'Modelo para mensajes complejos: multiples herramientas, objeciones, razonamiento profundo.',
          en: 'Model for complex messages: multiple tools, objections, deep reasoning.',
        },
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

    // Ensure ack_messages table exists (for ACK predefined pool, keyed by tone)
    try {
      await db.query(`
        CREATE TABLE IF NOT EXISTS ack_messages (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          tone TEXT NOT NULL DEFAULT '',
          text TEXT NOT NULL,
          active BOOLEAN DEFAULT true,
          sort_order INTEGER DEFAULT 0,
          created_at TIMESTAMPTZ DEFAULT now(),
          updated_at TIMESTAMPTZ DEFAULT now()
        )
      `)
      // Migrate: if old 'channel' column exists, rename to 'tone' and remap values
      try {
        const { rows: cols } = await db.query(
          `SELECT column_name FROM information_schema.columns WHERE table_name = 'ack_messages' AND column_name = 'channel'`,
        )
        if (cols.length > 0) {
          await db.query(`ALTER TABLE ack_messages RENAME COLUMN channel TO tone`)
          await db.query(`UPDATE ack_messages SET tone = 'casual' WHERE tone = 'whatsapp' OR tone = 'google-chat'`)
          await db.query(`UPDATE ack_messages SET tone = 'formal' WHERE tone = 'email'`)
        }
      } catch { /* column already renamed or doesn't exist */ }

      // Seed only if table is empty
      const { rows } = await db.query(`SELECT COUNT(*)::int AS cnt FROM ack_messages`)
      if (rows[0]?.cnt === 0) {
        await db.query(`
          INSERT INTO ack_messages (tone, text, sort_order) VALUES
            ('', 'Un momento...', 0),
            ('', 'Dame un segundo...', 1),
            ('', 'Estoy en eso...', 2),
            ('casual', 'Ya te reviso...', 0),
            ('casual', 'Un momento, déjame ver...', 1),
            ('casual', 'Dame un segundo...', 2),
            ('formal', 'Un momento por favor...', 0),
            ('formal', 'Procesando su consulta...', 1),
            ('express', 'Un seg...', 0),
            ('express', 'Ya va...', 1)
        `)
      }
    } catch {
      // Non-critical — ACK will fallback to in-memory defaults
    }

    // Run attachment_extractions table migration
    await runAttachmentMigration(db)

    // Ensure daily_reports table exists (for nightly batch)
    try {
      await db.query(`
        CREATE TABLE IF NOT EXISTS daily_reports (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          report_date DATE NOT NULL UNIQUE,
          metrics JSONB NOT NULL DEFAULT '{}',
          narrative TEXT,
          synced_to_sheets BOOLEAN DEFAULT false,
          created_at TIMESTAMPTZ DEFAULT now()
        )
      `)
    } catch {
      // Non-critical — nightly batch will log and skip
    }

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

    // ── Nightly batch config service (hot-reloadable via console) ──
    const buildNightlyConfig = () => ({
      scoringEnabled: attConfig.NIGHTLY_SCORING_ENABLED,
      scoringThreshold: attConfig.NIGHTLY_SCORING_THRESHOLD,
      scoringBatchSize: attConfig.NIGHTLY_SCORING_BATCH_SIZE,
      compressionEnabled: attConfig.NIGHTLY_COMPRESSION_ENABLED,
      compressionMinMessages: attConfig.NIGHTLY_COMPRESSION_MIN_MESSAGES,
      compressionBatchSize: attConfig.NIGHTLY_COMPRESSION_BATCH_SIZE,
      reportEnabled: attConfig.NIGHTLY_REPORT_ENABLED,
      reportSheetId: attConfig.NIGHTLY_REPORT_SHEET_ID,
      reportSheetName: attConfig.NIGHTLY_REPORT_SHEET_NAME,
      concurrency: attConfig.NIGHTLY_CONCURRENCY,
      maxRetries: attConfig.NIGHTLY_MAX_RETRIES,
    })

    registry.provide('engine:nightly-config', {
      get: buildNightlyConfig,
    })

    // Hot-reload on console config change
    registry.addHook('engine', 'console:config_applied', async () => {
      attConfig = registry.getConfig<EngineModuleConfig>('engine')

      // Hot-reload core engine config (models, pipeline, concurrency, etc.)
      reloadEngineConfig()

      // Dynamic extreme logging: read DEBUG_EXTREME_LOG and update global pino level
      try {
        const result = await db.query(`SELECT value FROM config_store WHERE key = 'DEBUG_EXTREME_LOG'`)
        const extremeLog = result.rows[0]?.value === 'true'
        const targetLevel = extremeLog ? 'trace' : (kernelConfig.logLevel ?? 'info')
        const pino = (await import('pino')).default
        // Update the root logger level — affects new log statements
        pino({ level: targetLevel })
      } catch { /* non-critical */ }
    })
  },

  async stop() {
    await stopEngine()
  },
}

export default manifest
