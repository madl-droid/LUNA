// LUNA — Module: memory (v3)
// Sistema de memoria: Redis buffer (rápido) + PostgreSQL (persistencia).
// 3 niveles: caliente (messages), tibio (session_summaries), frío (contact_memory).

import { z } from 'zod'
import type { ModuleManifest } from '../../kernel/types.js'
import type { Registry } from '../../kernel/registry.js'
import { numEnv, boolEnv } from '../../kernel/config-helpers.js'
import { MemoryManager } from './memory-manager.js'

let manager: MemoryManager | null = null

const manifest: ModuleManifest = {
  name: 'memory',
  version: '3.0.0',
  description: {
    es: 'Sistema de memoria: Redis (buffer) + PostgreSQL (persistencia) — 3 niveles: caliente/tibio/frío',
    en: 'Memory system: Redis (buffer) + PostgreSQL (persistence) — 3 tiers: hot/warm/cold',
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
    MEMORY_COMPRESSION_THRESHOLD: numEnv(30),
    MEMORY_COMPRESSION_KEEP_RECENT: numEnv(10),

    // Compression and models
    MEMORY_COMPRESSION_MODEL: z.string().default('claude-haiku-4-5-20251001'),
    MEMORY_EMBEDDING_MODEL: z.string().default('text-embedding-3-small'),
    MEMORY_MAX_CONTACT_MEMORY_WORDS: numEnv(2000),

    // Retention and purge
    MEMORY_SUMMARY_RETENTION_DAYS: numEnv(90),
    MEMORY_ARCHIVE_RETENTION_YEARS: numEnv(5),
    MEMORY_PIPELINE_LOGS_RETENTION_DAYS: numEnv(90),
    MEMORY_MEDIA_IMAGE_RETENTION_YEARS: numEnv(5),
    MEMORY_HOT_MESSAGES_PURGE_AFTER_COMPRESS: boolEnv(true),
    MEMORY_PURGE_MERGED_SUMMARIES: boolEnv(false),
    MEMORY_RECOMPRESSION_INTERVAL_DAYS: numEnv(30),

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
    title: { es: 'Memoria', en: 'Memory' },
    info: {
      es: 'Buffer de mensajes en Redis + persistencia en PostgreSQL. 3 niveles: caliente (mensajes), tibio (resúmenes), frío (memoria de contacto).',
      en: 'Message buffer in Redis + persistence in PostgreSQL. 3 tiers: hot (messages), warm (summaries), cold (contact memory).',
    },
    order: 40,
    group: 'data',
    icon: '&#128190;',
    fields: [
      // ── Buffer y sesiones ──
      { key: 'MEMORY_BUFFER_MESSAGE_COUNT', type: 'number', label: { es: 'Mensajes en buffer', en: 'Buffer message count' }, info: { es: 'Cantidad de mensajes recientes en Redis antes de comprimir', en: 'Number of recent messages kept in Redis before compression' } },
      { key: 'MEMORY_SESSION_MAX_TTL_HOURS', type: 'number', label: { es: 'TTL sesión (horas)', en: 'Session TTL (hours)' }, info: { es: 'Duración máxima de una sesión activa', en: 'Maximum duration of an active session' } },
      { key: 'MEMORY_SESSION_INACTIVITY_TIMEOUT_MIN', type: 'number', label: { es: 'Timeout inactividad (min)', en: 'Inactivity timeout (min)' }, info: { es: 'Minutos sin actividad para cerrar sesión automáticamente', en: 'Minutes of inactivity before auto-closing session' } },
      { key: 'MEMORY_COMPRESSION_THRESHOLD', type: 'number', label: { es: 'Umbral de compresión', en: 'Compression threshold' }, info: { es: 'Mensajes mínimos en sesión para activar compresión', en: 'Minimum messages in session to trigger compression' } },
      { key: 'MEMORY_COMPRESSION_KEEP_RECENT', type: 'number', label: { es: 'Mensajes recientes a conservar', en: 'Recent messages to keep' }, info: { es: 'Mensajes recientes que no se comprimen', en: 'Recent messages excluded from compression' } },

      // ── Compresión y modelos ──
      { key: 'MEMORY_COMPRESSION_MODEL', type: 'text', label: { es: 'Modelo de compresión', en: 'Compression model' }, info: { es: 'Modelo LLM para comprimir sesiones', en: 'LLM model for compressing sessions' } },
      { key: 'MEMORY_EMBEDDING_MODEL', type: 'text', label: { es: 'Modelo de embeddings', en: 'Embedding model' }, info: { es: 'Modelo para generar embeddings vectoriales', en: 'Model for generating vector embeddings' } },
      { key: 'MEMORY_MAX_CONTACT_MEMORY_WORDS', type: 'number', label: { es: 'Máx. palabras memoria contacto', en: 'Max contact memory words' }, info: { es: 'Límite antes de re-compresión', en: 'Limit before re-compression' } },

      // ── Retención y purga ──
      { key: 'MEMORY_SUMMARY_RETENTION_DAYS', type: 'number', label: { es: 'Retención resúmenes (días)', en: 'Summary retention (days)' }, info: { es: 'Días antes de purgar resúmenes de sesión', en: 'Days before purging session summaries' } },
      { key: 'MEMORY_ARCHIVE_RETENTION_YEARS', type: 'number', label: { es: 'Retención archivos legales (años)', en: 'Legal archive retention (years)' }, info: { es: 'Años de retención de archivos de conversación', en: 'Years to retain conversation archives' } },
      { key: 'MEMORY_PIPELINE_LOGS_RETENTION_DAYS', type: 'number', label: { es: 'Retención pipeline logs (días)', en: 'Pipeline logs retention (days)' }, info: { es: 'Días antes de purgar logs del pipeline', en: 'Days before purging pipeline logs' } },
      { key: 'MEMORY_MEDIA_IMAGE_RETENTION_YEARS', type: 'number', label: { es: 'Retención media (años)', en: 'Media retention (years)' }, info: { es: 'Años de retención de imágenes y archivos media', en: 'Years to retain images and media files' } },
      { key: 'MEMORY_HOT_MESSAGES_PURGE_AFTER_COMPRESS', type: 'boolean', label: { es: 'Borrar mensajes tras comprimir', en: 'Purge messages after compress' }, info: { es: 'Eliminar mensajes hot después de generar resumen', en: 'Delete hot messages after summary is generated' } },
      { key: 'MEMORY_PURGE_MERGED_SUMMARIES', type: 'boolean', label: { es: 'Borrar resúmenes fusionados', en: 'Purge merged summaries' }, info: { es: 'Eliminar resúmenes tibios ya fusionados en memoria fría', en: 'Delete warm summaries already merged into cold memory' } },
      { key: 'MEMORY_RECOMPRESSION_INTERVAL_DAYS', type: 'number', label: { es: 'Re-compresión (días)', en: 'Recompression interval (days)' }, info: { es: 'Días entre re-compresiones de memoria fría', en: 'Days between cold memory recompressions' } },

      // ── Batch nocturno ──
      { key: 'MEMORY_BATCH_COMPRESS_CRON', type: 'text', label: { es: 'Cron compresión', en: 'Compression cron' }, info: { es: 'Horario cron para compresión nocturna de sesiones', en: 'Cron schedule for nightly session compression' } },
      { key: 'MEMORY_BATCH_EMBEDDINGS_CRON', type: 'text', label: { es: 'Cron embeddings', en: 'Embeddings cron' }, info: { es: 'Horario cron para generar embeddings vectoriales', en: 'Cron schedule for generating vector embeddings' } },
      { key: 'MEMORY_BATCH_MERGE_CRON', type: 'text', label: { es: 'Cron fusión', en: 'Merge cron' }, info: { es: 'Horario cron para fusionar resúmenes en memoria fría', en: 'Cron schedule for merging summaries into cold memory' } },
      { key: 'MEMORY_BATCH_RECOMPRESS_CRON', type: 'text', label: { es: 'Cron re-compresión', en: 'Recompression cron' }, info: { es: 'Horario cron para re-comprimir memoria fría', en: 'Cron schedule for recompressing cold memory' } },
      { key: 'MEMORY_BATCH_MEDIA_PURGE_CRON', type: 'text', label: { es: 'Cron purga media', en: 'Media purge cron' }, info: { es: 'Horario cron para purgar archivos media expirados', en: 'Cron schedule for purging expired media files' } },
      { key: 'MEMORY_BATCH_LOGS_PURGE_CRON', type: 'text', label: { es: 'Cron purga logs', en: 'Logs purge cron' }, info: { es: 'Horario cron para purgar pipeline logs expirados', en: 'Cron schedule for purging expired pipeline logs' } },
      { key: 'MEMORY_BATCH_ARCHIVE_PURGE_CRON', type: 'text', label: { es: 'Cron purga archivos', en: 'Archive purge cron' }, info: { es: 'Horario cron para purgar archivos legales expirados', en: 'Cron schedule for purging expired legal archives' } },
    ],
  },

  async init(registry: Registry) {
    const config = registry.getConfig<{
      MEMORY_BUFFER_MESSAGE_COUNT: number
      MEMORY_SESSION_MAX_TTL_HOURS: number
      MEMORY_COMPRESSION_THRESHOLD: number
      MEMORY_COMPRESSION_KEEP_RECENT: number
      MEMORY_COMPRESSION_MODEL: string
      MEMORY_EMBEDDING_MODEL: string
      MEMORY_MAX_CONTACT_MEMORY_WORDS: number
      MEMORY_SUMMARY_RETENTION_DAYS: number
      MEMORY_ARCHIVE_RETENTION_YEARS: number
      MEMORY_PIPELINE_LOGS_RETENTION_DAYS: number
      MEMORY_MEDIA_IMAGE_RETENTION_YEARS: number
      MEMORY_HOT_MESSAGES_PURGE_AFTER_COMPRESS: boolean
      MEMORY_PURGE_MERGED_SUMMARIES: boolean
      MEMORY_RECOMPRESSION_INTERVAL_DAYS: number
    }>('memory')

    manager = new MemoryManager(registry.getDb(), registry.getRedis(), config)
    await manager.initialize()

    // Expose as service
    registry.provide('memory:manager', manager)
  },

  async stop() {
    if (manager) {
      await manager.shutdown()
      manager = null
    }
  },
}

export default manifest
