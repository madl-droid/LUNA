// LUNA — Module: memory (v3)
// Sistema de memoria: Redis buffer (rápido) + PostgreSQL (persistencia).
// 3 niveles: caliente (messages), tibio (session_summaries), frío (contact_memory).

import { z } from 'zod'
import type { ModuleManifest } from '../../kernel/types.js'
import type { Registry } from '../../kernel/registry.js'
import { numEnv, boolEnv } from '../../kernel/config-helpers.js'
import { MemoryManager } from './memory-manager.js'
import { CompressionWorker } from './compression-worker.js'
import { searchSessionMemory } from './memory-search.js'

let manager: MemoryManager | null = null
let compressionWorker: CompressionWorker | null = null

const manifest: ModuleManifest = {
  name: 'memory',
  version: '3.0.0',
  description: {
    es: 'Memoria conversacional del agente con almacenamiento persistente.',
    en: 'Agent conversational memory with persistent storage.',
  },
  type: 'core-module',
  removable: false,
  activateByDefault: true,
  depends: [],

  configSchema: z.object({
    // Buffer and sessions
    MEMORY_BUFFER_MESSAGE_COUNT: numEnv(50),
    MEMORY_SESSION_INACTIVITY_TIMEOUT_MIN: numEnv(30),
    MEMORY_SESSION_MAX_TTL_HOURS: numEnv(24),
    MEMORY_SESSION_REOPEN_WINDOW_HOURS: numEnv(12),
    MEMORY_COMPRESSION_THRESHOLD: numEnv(30),
    MEMORY_COMPRESSION_KEEP_RECENT: numEnv(10),

    // History turns per channel category (how many turns Phase 1 loads)
    MEMORY_BUFFER_TURNS_INSTANT: numEnv(25),
    MEMORY_BUFFER_TURNS_ASYNC: numEnv(10),
    MEMORY_BUFFER_TURNS_VOICE: numEnv(7),

    // Cross-session context: how many past interaction summaries to inject (per channel category)
    MEMORY_CONTEXT_SUMMARIES_INSTANT: numEnv(3),
    MEMORY_CONTEXT_SUMMARIES_ASYNC: numEnv(5),
    MEMORY_CONTEXT_SUMMARIES_VOICE: numEnv(2),

    // Compression and models
    MEMORY_COMPRESSION_MODEL: z.string().default('claude-haiku-4-5-20251001'),
    MEMORY_EMBEDDING_MODEL: z.string().default('text-embedding-3-small'),
    MEMORY_MAX_CONTACT_MEMORY_WORDS: numEnv(2000),

    // Retention and purge
    MEMORY_SUMMARY_RETENTION_DAYS: numEnv(120),
    MEMORY_ARCHIVE_RETENTION_YEARS: numEnv(2),
    MEMORY_PIPELINE_LOGS_RETENTION_DAYS: numEnv(90),
    MEMORY_MEDIA_RETENTION_MONTHS: numEnv(3),
    MEMORY_HOT_MESSAGES_PURGE_AFTER_COMPRESS: boolEnv(true),
    MEMORY_PURGE_MERGED_SUMMARIES: boolEnv(false),
    MEMORY_RECOMPRESSION_INTERVAL_DAYS: numEnv(30),

    // Prompt cache (shared with LLM module)
    LLM_PROMPT_CACHE_ENABLED: boolEnv(true),

    // Batch crons
    MEMORY_BATCH_COMPRESS_CRON: z.string().default('0 2 * * *'),
    MEMORY_BATCH_EMBEDDINGS_CRON: z.string().default('30 2 * * *'),
    MEMORY_BATCH_MERGE_CRON: z.string().default('0 3 * * *'),
    MEMORY_BATCH_RECOMPRESS_CRON: z.string().default('0 4 1 * *'),
    MEMORY_BATCH_MEDIA_PURGE_CRON: z.string().default('0 5 * * 0'),
    MEMORY_BATCH_LOGS_PURGE_CRON: z.string().default('0 5 * * 0'),
    MEMORY_BATCH_ARCHIVE_PURGE_CRON: z.string().default('0 5 1 * *'),
  }),

  console: {
    title: { es: 'Memoria del agente', en: 'Agent memory' },
    info: {
      es: 'Configura como el agente recuerda conversaciones y por cuanto tiempo conserva la informacion.',
      en: 'Configure how the agent remembers conversations and how long it retains information.',
    },
    order: 40,
    group: 'data',
    icon: '&#128190;',
    fields: [
      // ── Sesiones ──
      { key: '_div_sessions', type: 'divider', label: { es: 'Sesiones', en: 'Sessions' } },
      {
        key: 'MEMORY_SESSION_REOPEN_WINDOW_HOURS',
        type: 'number',
        label: { es: 'Ventana de reapertura (h)', en: 'Session reopen window (h)' },
        info: { es: 'Horas en que un nuevo mensaje reactiva la sesion anterior en vez de abrir una nueva. Maximo 24h.', en: 'Hours in which a new message reactivates the previous session instead of opening a new one. Max 24h.' },
        width: 'half',
        min: 1,
        max: 24,
      },
      {
        key: 'LLM_PROMPT_CACHE_ENABLED',
        type: 'boolean',
        label: { es: 'Cache de prompts', en: 'Prompt cache' },
        info: { es: 'Cachea el system prompt y el historial para reducir costos en conversaciones largas', en: 'Caches the system prompt and history to reduce costs in long conversations' },
      },
      { key: 'MEMORY_BUFFER_TURNS_INSTANT', type: 'number', label: { es: 'Historial canales instantáneos', en: 'Instant channel history' }, info: { es: 'Turnos de conversacion que se cargan en canales instantáneos (WhatsApp, Google Chat)', en: 'Conversation turns loaded for instant channels (WhatsApp, Google Chat)' }, width: 'half', min: 5, max: 50 },
      { key: 'MEMORY_BUFFER_TURNS_ASYNC', type: 'number', label: { es: 'Historial canales asíncronos', en: 'Async channel history' }, info: { es: 'Turnos de conversacion que se cargan en canales asíncronos (Gmail)', en: 'Conversation turns loaded for async channels (Gmail)' }, width: 'half', min: 5, max: 50 },
      { key: 'MEMORY_BUFFER_TURNS_VOICE', type: 'number', label: { es: 'Historial canales de voz', en: 'Voice channel history' }, info: { es: 'Turnos de conversacion que se cargan en canales de voz (Twilio)', en: 'Conversation turns loaded for voice channels (Twilio)' }, width: 'half', min: 3, max: 20 },
      { key: 'MEMORY_CONTEXT_SUMMARIES_INSTANT', type: 'number', label: { es: 'Interacciones previas (instantáneo)', en: 'Past interactions (instant)' }, info: { es: 'Resumenes de interacciones anteriores inyectados en canales instantáneos (WhatsApp, Google Chat)', en: 'Past interaction summaries injected for instant channels (WhatsApp, Google Chat)' }, width: 'half', min: 0, max: 10 },
      { key: 'MEMORY_CONTEXT_SUMMARIES_ASYNC', type: 'number', label: { es: 'Interacciones previas (asíncrono)', en: 'Past interactions (async)' }, info: { es: 'Resumenes de interacciones anteriores inyectados en canales asíncronos (Gmail)', en: 'Past interaction summaries injected for async channels (Gmail)' }, width: 'half', min: 0, max: 10 },
      { key: 'MEMORY_CONTEXT_SUMMARIES_VOICE', type: 'number', label: { es: 'Interacciones previas (voz)', en: 'Past interactions (voice)' }, info: { es: 'Resumenes de interacciones anteriores inyectados en canales de voz (Twilio)', en: 'Past interaction summaries injected for voice channels (Twilio)' }, width: 'half', min: 0, max: 10 },

      // ── Compresion ──
      { key: '_div_compression', type: 'divider', label: { es: 'Compresion de memoria', en: 'Memory compression' } },
      { key: 'MEMORY_COMPRESSION_THRESHOLD', type: 'number', label: { es: 'Umbral de compresion', en: 'Compression threshold' }, info: { es: 'Cantidad minima de mensajes en una sesion para activar compresion automatica', en: 'Minimum messages in a session to trigger automatic compression' }, width: 'half' },
      { key: 'MEMORY_COMPRESSION_KEEP_RECENT', type: 'number', label: { es: 'Mensajes recientes a conservar', en: 'Recent messages to keep' }, info: { es: 'Mensajes que se mantienen sin comprimir para contexto inmediato', en: 'Messages kept uncompressed for immediate context' }, width: 'half' },
      { key: 'MEMORY_COMPRESSION_MODEL', type: 'text', label: { es: 'Modelo de compresion', en: 'Compression model' }, info: { es: 'Modelo LLM usado para resumir sesiones. Usa un modelo rapido y economico.', en: 'LLM model used to summarize sessions. Use a fast, cost-effective model.' }, width: 'half' },
      { key: 'MEMORY_EMBEDDING_MODEL', type: 'text', label: { es: 'Modelo de embeddings', en: 'Embedding model' }, info: { es: 'Modelo para generar vectores de busqueda semantica', en: 'Model for generating semantic search vectors' }, width: 'half' },
      { key: 'MEMORY_MAX_CONTACT_MEMORY_WORDS', type: 'number', label: { es: 'Max palabras por contacto', en: 'Max words per contact' }, info: { es: 'Limite de palabras en la memoria permanente de cada contacto. Si se excede, se re-comprime.', en: 'Word limit in each contact\'s permanent memory. If exceeded, re-compressed.' } },

      // ── Retencion ──
      { key: '_div_retention', type: 'divider', label: { es: 'Retencion de datos', en: 'Data retention' } },
      { key: 'MEMORY_SUMMARY_RETENTION_DAYS', type: 'number', label: { es: 'Resumenes de interacciones (dias)', en: 'Interaction summaries (days)' }, info: { es: 'Dias antes de eliminar resumenes de sesion. Maximo 730 dias (2 anos).', en: 'Days before deleting session summaries. Maximum 730 days (2 years).' }, width: 'half', min: 30, max: 730 },
      { key: 'MEMORY_PIPELINE_LOGS_RETENTION_DAYS', type: 'number', label: { es: 'Registros del sistema (dias)', en: 'System logs (days)' }, info: { es: 'Dias antes de eliminar registros de procesamiento interno', en: 'Days before deleting internal processing logs' }, width: 'half' },
      {
        key: 'MEMORY_ARCHIVE_RETENTION_YEARS',
        type: 'select',
        label: { es: 'Duracion del backup legal', en: 'Legal backup duration' },
        info: { es: 'Tiempo de retencion de conversaciones completas para cumplimiento legal. "Desactivado" no guarda backups.', en: 'Retention time for full conversations for legal compliance. "Disabled" skips backups.' },
        width: 'half',
        options: [
          { value: '0', label: { es: 'Desactivado', en: 'Disabled' } },
          { value: '1', label: { es: '1 ano', en: '1 year' } },
          { value: '2', label: { es: '2 anos', en: '2 years' } },
          { value: '5', label: { es: '5 anos', en: '5 years' } },
          { value: '10', label: { es: '10 anos', en: '10 years' } },
          { value: '999', label: { es: 'Vitalicio', en: 'Lifetime' } },
        ],
      },
      {
        key: 'MEMORY_MEDIA_RETENTION_MONTHS',
        type: 'number',
        label: { es: 'Almacenamiento de archivos (meses)', en: 'File storage (months)' },
        info: { es: 'Meses de retencion de imagenes y archivos multimedia. Maximo 24 meses (2 anos).', en: 'Months to retain images and media files. Maximum 24 months (2 years).' },
        width: 'half',
        min: 1,
        max: 24,
      },
      { key: 'MEMORY_HOT_MESSAGES_PURGE_AFTER_COMPRESS', type: 'boolean', label: { es: 'Borrar mensajes tras comprimir', en: 'Purge messages after compress' }, info: { es: 'Eliminar mensajes originales una vez generado el resumen', en: 'Delete original messages once summary is generated' } },
      { key: 'MEMORY_PURGE_MERGED_SUMMARIES', type: 'boolean', label: { es: 'Borrar resumenes fusionados', en: 'Purge merged summaries' }, info: { es: 'Eliminar resumenes intermedios ya integrados en la memoria permanente', en: 'Delete intermediate summaries already integrated into permanent memory' } },
      { key: 'MEMORY_RECOMPRESSION_INTERVAL_DAYS', type: 'number', label: { es: 'Re-compresion (dias)', en: 'Recompression interval (days)' }, info: { es: 'Dias entre re-compresiones de la memoria permanente del contacto', en: 'Days between re-compressions of permanent contact memory' } },

      // ── Tareas programadas ──
      { key: '_div_crons', type: 'divider', label: { es: 'Tareas programadas', en: 'Scheduled tasks' } },
      { key: 'MEMORY_BATCH_COMPRESS_CRON', type: 'text', label: { es: 'Compresion nocturna', en: 'Nightly compression' }, info: { es: 'Horario cron (UTC) para comprimir sesiones inactivas', en: 'Cron schedule (UTC) for compressing inactive sessions' }, width: 'half' },
      { key: 'MEMORY_BATCH_EMBEDDINGS_CRON', type: 'text', label: { es: 'Generacion de embeddings', en: 'Embedding generation' }, info: { es: 'Horario cron para generar vectores de busqueda', en: 'Cron schedule for generating search vectors' }, width: 'half' },
      { key: 'MEMORY_BATCH_MERGE_CRON', type: 'text', label: { es: 'Fusion de resumenes', en: 'Summary merge' }, info: { es: 'Horario cron para fusionar resumenes en memoria permanente', en: 'Cron schedule for merging summaries into permanent memory' }, width: 'half' },
      { key: 'MEMORY_BATCH_RECOMPRESS_CRON', type: 'text', label: { es: 'Re-compresion mensual', en: 'Monthly recompression' }, info: { es: 'Horario cron para re-comprimir memorias permanentes extensas', en: 'Cron schedule for recompressing large permanent memories' }, width: 'half' },
      { key: 'MEMORY_BATCH_MEDIA_PURGE_CRON', type: 'text', label: { es: 'Purga de media', en: 'Media purge' }, info: { es: 'Horario cron para eliminar archivos media expirados', en: 'Cron schedule for deleting expired media files' }, width: 'half' },
      { key: 'MEMORY_BATCH_LOGS_PURGE_CRON', type: 'text', label: { es: 'Purga de logs', en: 'Logs purge' }, info: { es: 'Horario cron para eliminar logs de pipeline expirados', en: 'Cron schedule for deleting expired pipeline logs' }, width: 'half' },
      { key: 'MEMORY_BATCH_ARCHIVE_PURGE_CRON', type: 'text', label: { es: 'Purga de archivos', en: 'Archive purge' }, info: { es: 'Horario cron para eliminar archivos legales expirados', en: 'Cron schedule for deleting expired legal archives' }, width: 'half' },
    ],
  },

  async init(registry: Registry) {
    const config = registry.getConfig<{
      MEMORY_BUFFER_MESSAGE_COUNT: number
      MEMORY_SESSION_MAX_TTL_HOURS: number
      MEMORY_SESSION_REOPEN_WINDOW_HOURS: number
      MEMORY_COMPRESSION_THRESHOLD: number
      MEMORY_COMPRESSION_KEEP_RECENT: number
      MEMORY_COMPRESSION_MODEL: string
      MEMORY_EMBEDDING_MODEL: string
      MEMORY_MAX_CONTACT_MEMORY_WORDS: number
      MEMORY_SUMMARY_RETENTION_DAYS: number
      MEMORY_ARCHIVE_RETENTION_YEARS: number
      MEMORY_PIPELINE_LOGS_RETENTION_DAYS: number
      MEMORY_MEDIA_RETENTION_MONTHS: number
      MEMORY_HOT_MESSAGES_PURGE_AFTER_COMPRESS: boolean
      MEMORY_PURGE_MERGED_SUMMARIES: boolean
      MEMORY_RECOMPRESSION_INTERVAL_DAYS: number
      MEMORY_BUFFER_TURNS_INSTANT: number
      MEMORY_BUFFER_TURNS_ASYNC: number
      MEMORY_BUFFER_TURNS_VOICE: number
      MEMORY_CONTEXT_SUMMARIES_INSTANT: number
      MEMORY_CONTEXT_SUMMARIES_ASYNC: number
      MEMORY_CONTEXT_SUMMARIES_VOICE: number
    }>('memory')

    manager = new MemoryManager(registry.getDb(), registry.getRedis(), config)
    await manager.initialize()

    // Expose as service
    registry.provide('memory:manager', manager)

    // History turns per channel category — read by channel-config services and Phase 1
    registry.provide('memory:buffer-turns', {
      get: () => ({
        instant: config.MEMORY_BUFFER_TURNS_INSTANT,
        async: config.MEMORY_BUFFER_TURNS_ASYNC,
        voice: config.MEMORY_BUFFER_TURNS_VOICE,
      }),
    })

    // Compression worker (BullMQ queue for session compression v2)
    compressionWorker = new CompressionWorker(registry.getDb(), registry.getRedis(), registry)
    registry.provide('memory:compression-worker', compressionWorker)

    // Memory search service (long-term memory via session_memory_chunks)
    const db = registry.getDb()
    registry.provide('memory:search', {
      search: async (contactId: string, query: string, limit?: number) => {
        const embeddingService = registry.getOptional<{ generateEmbedding(text: string): Promise<number[] | null> }>('knowledge:embedding-service')
        return searchSessionMemory(db, embeddingService, contactId, query, limit)
      },
    })

    // Cross-session summaries limit per channel category — read by Phase 1
    registry.provide('memory:context-summaries', {
      get: () => ({
        instant: config.MEMORY_CONTEXT_SUMMARIES_INSTANT,
        async: config.MEMORY_CONTEXT_SUMMARIES_ASYNC,
        voice: config.MEMORY_CONTEXT_SUMMARIES_VOICE,
      }),
    })
  },

  async stop() {
    if (compressionWorker) {
      await compressionWorker.stop()
      compressionWorker = null
    }
    if (manager) {
      await manager.shutdown()
      manager = null
    }
  },
}

export default manifest
