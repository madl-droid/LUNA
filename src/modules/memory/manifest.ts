// LUNA — Module: memory (v3)
// Sistema de memoria: Redis buffer (rápido) + PostgreSQL (persistencia).
// 3 niveles: caliente (messages), tibio (session_summaries), frío (contact_memory).

import { z } from 'zod'
import type { ModuleManifest } from '../../kernel/types.js'
import type { Registry } from '../../kernel/registry.js'
import { numEnv, numEnvMin, boolEnv } from '../../kernel/config-helpers.js'
import { MemoryManager } from './memory-manager.js'
import { CompressionWorker } from './compression-worker.js'
import { searchSessionMemory } from './memory-search.js'
import type { ToolRegistry } from '../tools/tool-registry.js'
import { saveContactData } from '../../tools/contacts/save-contact-data.js'
import { executeMergeContacts } from '../../tools/contacts/merge-contacts.js'

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
  depends: ['tools'],

  configSchema: z.object({
    // Buffer and sessions
    MEMORY_BUFFER_MESSAGE_COUNT: numEnv(50),
    MEMORY_SESSION_INACTIVITY_TIMEOUT_MIN: numEnv(30),
    MEMORY_SESSION_MAX_TTL_HOURS: numEnv(24),
    MEMORY_SESSION_REOPEN_WINDOW_HOURS: numEnv(1),
    MEMORY_COMPRESSION_THRESHOLD: numEnv(30).describe(
      'Número de TURNS (ida+vuelta) antes de comprimir. Un turn = mensaje usuario + respuesta asistente.',
    ),
    MEMORY_COMPRESSION_KEEP_RECENT: numEnv(10),

    // History turns per channel category (how many turns Phase 1 loads)
    MEMORY_BUFFER_TURNS_INSTANT: numEnv(25),
    MEMORY_BUFFER_TURNS_ASYNC: numEnv(10),
    MEMORY_BUFFER_TURNS_VOICE: numEnv(7),

    // Cross-session context: how many past interaction summaries to inject (per channel category)
    MEMORY_CONTEXT_SUMMARIES_INSTANT: numEnv(3),
    MEMORY_CONTEXT_SUMMARIES_ASYNC: numEnv(5),
    MEMORY_CONTEXT_SUMMARIES_VOICE: numEnv(2),

    // Commitments + HITL in context (how many items Phase 1 injects)
    MEMORY_CONTEXT_COMMITMENTS_MAX: numEnvMin(0, 5),
    MEMORY_CONTEXT_HITL_MAX: numEnvMin(0, 3),

    // Compression model (backend-only — UI uses LLM_COMPRESS from /agente/advanced)
    MEMORY_COMPRESSION_MODEL: z.string().default('claude-haiku-4-5-20251001'),

    // Retention and purge
    MEMORY_SUMMARY_RETENTION_DAYS: numEnv(120),
    MEMORY_ARCHIVE_RETENTION_YEARS: numEnv(2),
    MEMORY_PIPELINE_LOGS_RETENTION_DAYS: numEnv(90),
    // REMOVED: MEMORY_MEDIA_RETENTION_MONTHS — media now purged with MEMORY_SUMMARY_RETENTION_DAYS
    // backend-only: messages are always purged after compression
    MEMORY_HOT_MESSAGES_PURGE_AFTER_COMPRESS: boolEnv(true),

    // Prompt cache (shared with LLM module)
    LLM_PROMPT_CACHE_ENABLED: boolEnv(true),

    // Batch task hours (UTC) — cron expressions are derived from these at runtime
    MEMORY_BATCH_COMPRESS_HOUR: numEnv(2),   // compression + embeddings (30 min later)
    MEMORY_BATCH_PURGE_HOUR: numEnv(4),      // media purge + logs purge + archive purge

    // Batch crons (backend-only — derived from HOUR fields above)
    MEMORY_BATCH_COMPRESS_CRON: z.string().default('0 2 * * *'),
    MEMORY_BATCH_EMBEDDINGS_CRON: z.string().default('30 2 * * *'),
    MEMORY_BATCH_MEDIA_PURGE_CRON: z.string().default('0 5 1 */6 *'),
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
      // Tab: Memoria de trabajo
      { key: 'MEMORY_BUFFER_TURNS_INSTANT', type: 'number', label: { es: 'Historial canales instantáneos', en: 'Instant channel history' }, info: { es: 'Turnos de conversación que se cargan en canales instantáneos (WhatsApp, Google Chat)', en: 'Conversation turns loaded for instant channels (WhatsApp, Google Chat)' }, width: 'half', min: 5, max: 50 },
      { key: 'MEMORY_BUFFER_TURNS_ASYNC', type: 'number', label: { es: 'Historial canales asíncronos', en: 'Async channel history' }, info: { es: 'Turnos de conversación que se cargan en canales asíncronos (Gmail)', en: 'Conversation turns loaded for async channels (Gmail)' }, width: 'half', min: 5, max: 50 },
      { key: 'MEMORY_BUFFER_TURNS_VOICE', type: 'number', label: { es: 'Historial canales de voz', en: 'Voice channel history' }, info: { es: 'Turnos de conversación que se cargan en canales de voz (Twilio)', en: 'Conversation turns loaded for voice channels (Twilio)' }, width: 'half', min: 3, max: 20 },
      { key: 'MEMORY_CONTEXT_SUMMARIES_INSTANT', type: 'number', label: { es: 'Interacciones previas (instantáneo)', en: 'Past interactions (instant)' }, info: { es: 'Resúmenes de interacciones anteriores inyectados en canales instantáneos', en: 'Past interaction summaries injected for instant channels' }, width: 'half', min: 0, max: 10 },
      { key: 'MEMORY_CONTEXT_SUMMARIES_ASYNC', type: 'number', label: { es: 'Interacciones previas (asíncrono)', en: 'Past interactions (async)' }, info: { es: 'Resúmenes de interacciones anteriores inyectados en canales asíncronos', en: 'Past interaction summaries injected for async channels' }, width: 'half', min: 0, max: 10 },
      { key: 'MEMORY_CONTEXT_SUMMARIES_VOICE', type: 'number', label: { es: 'Interacciones previas (voz)', en: 'Past interactions (voice)' }, info: { es: 'Resúmenes de interacciones anteriores inyectados en canales de voz', en: 'Past interaction summaries injected for voice channels' }, width: 'half', min: 0, max: 10 },
      { key: 'MEMORY_COMPRESSION_THRESHOLD', type: 'number', label: { es: 'Umbral de compresión (turnos)', en: 'Compression threshold (turns)' }, info: { es: 'Cantidad mínima de turnos en una sesión para activar compresión automática del buffer. Un turno = mensaje(s) del usuario + respuesta del agente.', en: 'Minimum turns in a session to trigger automatic buffer compression. A turn = user message(s) + agent response.' }, width: 'half' },
      { key: 'MEMORY_COMPRESSION_KEEP_RECENT', type: 'number', label: { es: 'Turnos recientes a conservar', en: 'Recent turns to keep' }, info: { es: 'Turnos que se mantienen sin comprimir para contexto inmediato', en: 'Turns kept uncompressed for immediate context' }, width: 'half' },
      // Tab: Compromisos en contexto
      { key: 'divider:commitments_context', type: 'divider', label: { es: 'Compromisos en contexto', en: 'Commitments in context' } },
      { key: 'MEMORY_CONTEXT_COMMITMENTS_MAX', type: 'number', label: { es: 'Compromisos en contexto', en: 'Commitments in context' }, info: { es: 'Cantidad máxima de compromisos pendientes que el agente ve en cada conversación. Incluye seguimientos, tareas y promesas activas.', en: 'Maximum pending commitments the agent sees in each conversation. Includes follow-ups, tasks, and active promises.' }, width: 'half', min: 0, max: 50 },
      { key: 'MEMORY_CONTEXT_HITL_MAX', type: 'number', label: { es: 'Tickets HITL en contexto', en: 'HITL tickets in context' }, info: { es: 'Cantidad máxima de tickets de consulta humana (HITL) que el agente ve en cada conversación. Incluye escalamientos y consultas activas.', en: 'Maximum human consultation tickets (HITL) the agent sees in each conversation. Includes escalations and active consultations.' }, width: 'half', min: 0, max: 50 },
      // Tab: Mediano plazo
      { key: 'MEMORY_SUMMARY_RETENTION_DAYS', type: 'number', label: { es: 'Resúmenes de interacciones (días)', en: 'Interaction summaries (days)' }, info: { es: 'Días antes de eliminar resúmenes de sesión. Máximo 730 días (2 años).', en: 'Days before deleting session summaries. Maximum 730 days (2 years).' }, width: 'half', min: 30, max: 730 },
      { key: 'MEMORY_PIPELINE_LOGS_RETENTION_DAYS', type: 'number', label: { es: 'Registros del sistema (días)', en: 'System logs (days)' }, info: { es: 'Días antes de eliminar registros de procesamiento interno', en: 'Days before deleting internal processing logs' }, width: 'half' },
      // REMOVED: MEMORY_MEDIA_RETENTION_MONTHS — media files now purged with MEMORY_SUMMARY_RETENTION_DAYS
      // Tab: Avanzado
      {
        key: 'MEMORY_ARCHIVE_RETENTION_YEARS',
        type: 'select',
        label: { es: 'Duración del backup legal', en: 'Legal backup duration' },
        info: { es: 'Tiempo de retención de conversaciones completas para cumplimiento legal. "Desactivado" no guarda backups.', en: 'Retention time for full conversations for legal compliance. "Disabled" skips backups.' },
        width: 'half',
        options: [
          { value: '0', label: { es: 'Desactivado', en: 'Disabled' } },
          { value: '1', label: { es: '1 año', en: '1 year' } },
          { value: '2', label: { es: '2 años', en: '2 years' } },
          { value: '5', label: { es: '5 años', en: '5 years' } },
          { value: '10', label: { es: '10 años', en: '10 years' } },
          { value: '999', label: { es: 'Vitalicio', en: 'Lifetime' } },
        ],
      },
      { key: 'MEMORY_SESSION_REOPEN_WINDOW_HOURS', type: 'number', label: { es: 'Ventana de reapertura (h)', en: 'Session reopen window (h)' }, info: { es: 'Horas en que un nuevo mensaje reactiva la sesión anterior. Máximo 12h.', en: 'Hours a new message reactivates the previous session. Max 12h.' }, width: 'half', min: 1, max: 12 },
      { key: 'MEMORY_BATCH_COMPRESS_HOUR', type: 'number', label: { es: 'Compresión nocturna', en: 'Nightly compression' }, info: { es: 'Hora UTC para comprimir sesiones inactivas y generar embeddings (30 min después)', en: 'UTC hour to compress inactive sessions and generate embeddings (30 min later)' }, width: 'half', min: 0, max: 23 },
      { key: 'MEMORY_BATCH_PURGE_HOUR', type: 'number', label: { es: 'Purga de datos', en: 'Data purge' }, info: { es: 'Hora UTC para purgar media expirada, logs del pipeline y archivos legales', en: 'UTC hour to purge expired media, pipeline logs and legal archives' }, width: 'half', min: 0, max: 23 },
      { key: 'LLM_PROMPT_CACHE_ENABLED', type: 'boolean', label: { es: 'Cache de prompts', en: 'Prompt cache' }, info: { es: 'Cachea el system prompt y el historial para reducir costos en conversaciones largas', en: 'Caches the system prompt and history to reduce costs in long conversations' } },
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
      MEMORY_SUMMARY_RETENTION_DAYS: number
      MEMORY_ARCHIVE_RETENTION_YEARS: number
      MEMORY_PIPELINE_LOGS_RETENTION_DAYS: number
      // REMOVED: MEMORY_MEDIA_RETENTION_MONTHS
      MEMORY_HOT_MESSAGES_PURGE_AFTER_COMPRESS: boolean
      MEMORY_BUFFER_TURNS_INSTANT: number
      MEMORY_BUFFER_TURNS_ASYNC: number
      MEMORY_BUFFER_TURNS_VOICE: number
      MEMORY_CONTEXT_SUMMARIES_INSTANT: number
      MEMORY_CONTEXT_SUMMARIES_ASYNC: number
      MEMORY_CONTEXT_SUMMARIES_VOICE: number
      MEMORY_BATCH_COMPRESS_HOUR: number
      MEMORY_BATCH_PURGE_HOUR: number
      MEMORY_CONTEXT_COMMITMENTS_MAX: number
      MEMORY_CONTEXT_HITL_MAX: number
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

    // Commitments + HITL context limits — read by Phase 1
    registry.provide('memory:context-limits', {
      get: () => ({
        commitmentsMax: config.MEMORY_CONTEXT_COMMITMENTS_MAX,
        hitlMax: config.MEMORY_CONTEXT_HITL_MAX,
      }),
    })

    // Register contact management tools
    const toolRegistry = registry.getOptional<ToolRegistry>('tools:registry')
    if (toolRegistry) {
      const db = registry.getDb()
      const memManager = manager

      await toolRegistry.registerTool({
        definition: {
          name: 'save_contact_data',
          displayName: 'Guardar datos del contacto',
          description: 'Guarda información del contacto descubierta durante la conversación: puntos de contacto (email, teléfono, WhatsApp), preferencias, fechas importantes, o datos clave. Úsala cuando el usuario comparta información personal relevante.',
          shortDescription: 'Guarda datos del contacto (canales, preferencias, fechas, hechos clave)',
          detailedGuidance: 'Tipos disponibles: contact_point (requiere channel y value), preference (requiere preference_key y preference_value), important_date (requiere date en ISO 8601 y date_description), key_fact (requiere fact). Si detectas un posible contacto duplicado (merge_candidate en la respuesta), informa al usuario y usa merge_contacts si confirma.',
          category: 'contacts',
          sourceModule: 'memory',
          parameters: {
            type: 'object',
            properties: {
              type: {
                type: 'string',
                enum: ['contact_point', 'preference', 'important_date', 'key_fact'],
                description: 'Tipo de dato a guardar',
              },
              channel: {
                type: 'string',
                enum: ['email', 'whatsapp', 'phone', 'voice', 'other'],
                description: 'Canal para contact_point',
              },
              value: {
                type: 'string',
                description: 'Email, teléfono u otro identificador para contact_point',
              },
              preference_key: {
                type: 'string',
                description: 'Clave de la preferencia (ej: "horario_contacto", "idioma", "canal_preferido")',
              },
              preference_value: {
                type: 'string',
                description: 'Valor de la preferencia',
              },
              date: {
                type: 'string',
                description: 'Fecha en formato ISO 8601 (ej: "2026-05-15") para important_date',
              },
              date_description: {
                type: 'string',
                description: 'Descripción de la fecha (ej: "Cumpleaños", "Aniversario de empresa")',
              },
              fact: {
                type: 'string',
                description: 'Dato clave sobre el contacto para key_fact',
              },
            },
            required: ['type'],
          },
        },
        handler: async (input, ctx) => {
          const typedInput = input as unknown as import('../../tools/contacts/save-contact-data.js').SaveContactDataInput
          if (!ctx.contactId) {
            return { success: false, data: { message: 'No hay contacto activo para guardar datos' } }
          }
          if (!memManager) {
            return { success: false, data: { message: 'Memory manager no disponible' } }
          }
          const result = await saveContactData(typedInput, ctx.contactId, db, memManager)
          return { success: result.success, data: result }
        },
      })

      await toolRegistry.registerTool({
        definition: {
          name: 'merge_contacts',
          displayName: 'Fusionar contactos duplicados',
          description: 'Fusiona dos contactos que son la misma persona. Transfiere todos los canales, sesiones, mensajes y memoria al contacto principal (keep_contact_id) y marca el otro como fusionado.',
          shortDescription: 'Fusiona dos contactos duplicados en uno solo',
          detailedGuidance: 'Usar solo cuando estés seguro de que ambos contactos son la misma persona (idealmente después de que el usuario lo confirmó). El contacto merge_contact_id queda soft-deleted. Esta operación es irreversible sin intervención manual.',
          category: 'contacts',
          sourceModule: 'memory',
          parameters: {
            type: 'object',
            properties: {
              keep_contact_id: {
                type: 'string',
                description: 'ID del contacto a mantener como principal',
              },
              merge_contact_id: {
                type: 'string',
                description: 'ID del contacto a absorber (será marcado como fusionado)',
              },
              reason: {
                type: 'string',
                description: 'Razón del merge (ej: "usuario confirmó que es la misma persona", "mismo email detectado")',
              },
            },
            required: ['keep_contact_id', 'merge_contact_id', 'reason'],
          },
        },
        handler: async (input) => {
          const typedInput = input as unknown as import('../../tools/contacts/merge-contacts.js').MergeContactsInput
          const result = await executeMergeContacts(typedInput, db)
          return { success: result.success, data: result }
        },
      })
    }
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
