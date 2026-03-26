// LUNA — Module: freshdesk
// Wrapper que registra las tools de Freshdesk KB y el job de sync semanal.
// La lógica vive en src/tools/freshdesk/. Este módulo solo hace el bridge.

import { z } from 'zod'
import { Queue, Worker, type Job } from 'bullmq'
import pino from 'pino'
import type { ModuleManifest } from '../../kernel/types.js'
import type { Registry } from '../../kernel/registry.js'
import { boolEnv, numEnvMin } from '../../kernel/config-helpers.js'
import { registerFreshdeskGetArticleTool } from '../../tools/freshdesk/freshdesk-get-article.js'
import { registerFreshdeskSearchTool } from '../../tools/freshdesk/freshdesk-search.js'
import { runFreshdeskSync, isSyncStale } from '../../tools/freshdesk/freshdesk-sync.js'
import { invalidateFreshdeskIndex } from '../../tools/freshdesk/freshdesk-rag.js'
import type { FreshdeskModuleConfig } from '../../tools/freshdesk/types.js'

const logger = pino({ name: 'module:freshdesk' })

const QUEUE_NAME = 'luna:freshdesk-sync'

let syncQueue: Queue | null = null
let syncWorker: Worker | null = null

const manifest: ModuleManifest = {
  name: 'freshdesk',
  version: '1.0.0',
  description: {
    es: 'Integración con Freshdesk Knowledge Base (búsqueda y sync de artículos)',
    en: 'Freshdesk Knowledge Base integration (article search and sync)',
  },
  type: 'feature',
  removable: true,
  activateByDefault: false,
  depends: ['tools'],

  configSchema: z.object({
    FRESHDESK_DOMAIN: z.string().default(''),
    FRESHDESK_API_KEY: z.string().default(''),
    FRESHDESK_SYNC_ENABLED: boolEnv(false),
    FRESHDESK_SYNC_CRON: z.string().default('0 1 * * 0'),
    FRESHDESK_CACHE_TTL_HOURS: numEnvMin(1, 24),
    FRESHDESK_CATEGORIES: z.string().default(''),
  }),

  console: {
    title: { es: 'Freshdesk', en: 'Freshdesk' },
    info: {
      es: 'Integración con la Knowledge Base de Freshdesk. Sincroniza artículos y permite búsqueda desde el agente.',
      en: 'Freshdesk Knowledge Base integration. Syncs articles and enables search from the agent.',
    },
    order: 36,
    group: 'agent',
    icon: '&#128218;',
    fields: [
      {
        key: 'FRESHDESK_DOMAIN',
        type: 'text',
        label: { es: 'Dominio Freshdesk', en: 'Freshdesk Domain' },
        description: {
          es: 'Tu dominio de Freshdesk (ej: miempresa.freshdesk.com). Sin https://.',
          en: 'Your Freshdesk domain (e.g., mycompany.freshdesk.com). Without https://.',
        },
        placeholder: 'miempresa.freshdesk.com',
      },
      {
        key: 'FRESHDESK_API_KEY',
        type: 'secret',
        label: { es: 'API Key', en: 'API Key' },
        description: {
          es: 'API Key de Freshdesk. Se obtiene desde Perfil > API Key en Freshdesk.',
          en: 'Freshdesk API Key. Found under Profile > API Key in Freshdesk.',
        },
        placeholder: 'xxxxxxxxxx',
      },
      { key: '_div_sync', type: 'divider', label: { es: 'Sincronización', en: 'Sync' } },
      {
        key: 'FRESHDESK_SYNC_ENABLED',
        type: 'boolean',
        label: { es: 'Habilitar sync automático', en: 'Enable automatic sync' },
        description: {
          es: 'Sincroniza automáticamente los artículos de la Knowledge Base según el cron configurado.',
          en: 'Automatically syncs Knowledge Base articles according to the configured cron schedule.',
        },
      },
      {
        key: 'FRESHDESK_SYNC_CRON',
        type: 'text',
        label: { es: 'Cron de sincronización', en: 'Sync cron' },
        description: {
          es: 'Expresión cron para el sync (default: domingos 1AM). Formato: min hora día mes díaSemana.',
          en: 'Cron expression for sync (default: Sundays 1AM). Format: min hour day month weekday.',
        },
        placeholder: '0 1 * * 0',
        width: 'half',
      },
      {
        key: 'FRESHDESK_CACHE_TTL_HOURS',
        type: 'number',
        label: { es: 'TTL cache artículos (horas)', en: 'Article cache TTL (hours)' },
        description: {
          es: 'Tiempo que un artículo completo permanece cacheado en Redis después de consultarse.',
          en: 'How long a full article stays cached in Redis after being fetched.',
        },
        min: 1,
        max: 168,
        width: 'half',
      },
      {
        key: 'FRESHDESK_CATEGORIES',
        type: 'text',
        label: { es: 'Categorías a sincronizar', en: 'Categories to sync' },
        description: {
          es: 'IDs de categorías Freshdesk separados por coma. Vacío = todas las categorías.',
          en: 'Freshdesk category IDs, comma-separated. Empty = all categories.',
        },
        placeholder: '123,456,789',
      },
    ],
    apiRoutes: [],
  },

  async init(registry: Registry) {
    const config = registry.getConfig<FreshdeskModuleConfig>('freshdesk')

    // Validate required config
    if (!config.FRESHDESK_DOMAIN || !config.FRESHDESK_API_KEY) {
      logger.warn('Freshdesk domain or API key not configured — module inactive')
      return
    }

    // Register tools
    await registerFreshdeskGetArticleTool(registry, config)
    await registerFreshdeskSearchTool(registry, config)

    // Check for stale cache
    const redis = registry.getRedis()
    const stale = await isSyncStale(redis)
    if (stale) {
      logger.warn('Freshdesk cache is stale or empty — consider running a manual sync')
    }

    // Set up sync job if enabled
    if (config.FRESHDESK_SYNC_ENABLED) {
      await startSyncScheduler(redis, config)
    }

    // Expose sync trigger as a service (for admin endpoints or manual trigger)
    registry.provide('freshdesk:sync', {
      run: async () => {
        const result = await runFreshdeskSync(redis, config)
        await invalidateFreshdeskIndex()
        return result
      },
    })

    logger.info({
      domain: config.FRESHDESK_DOMAIN,
      syncEnabled: config.FRESHDESK_SYNC_ENABLED,
      syncCron: config.FRESHDESK_SYNC_CRON,
      cacheTtlHours: config.FRESHDESK_CACHE_TTL_HOURS,
    }, 'Freshdesk module initialized')
  },

  async stop() {
    if (syncWorker) {
      await syncWorker.close()
      syncWorker = null
    }
    if (syncQueue) {
      await syncQueue.close()
      syncQueue = null
    }
    logger.info('Freshdesk module stopped')
  },
}

async function startSyncScheduler(redis: import('ioredis').Redis, config: FreshdeskModuleConfig): Promise<void> {
  const connection = {
    host: redis.options.host ?? 'localhost',
    port: redis.options.port ?? 6379,
    password: redis.options.password as string | undefined,
    db: redis.options.db ?? 0,
  }

  syncQueue = new Queue(QUEUE_NAME, {
    connection,
    defaultJobOptions: {
      removeOnComplete: { count: 10 },
      removeOnFail: { count: 10 },
      attempts: 3,
      backoff: { type: 'exponential', delay: 60_000 }, // 1min, 2min, 4min
    },
  })

  syncWorker = new Worker(
    QUEUE_NAME,
    async (_job: Job) => {
      logger.info('Starting scheduled Freshdesk sync')
      const result = await runFreshdeskSync(redis, config)
      await invalidateFreshdeskIndex()
      logger.info(result, 'Scheduled Freshdesk sync completed')
    },
    { connection, concurrency: 1 },
  )

  syncWorker.on('failed', (job: Job | undefined, err: Error) => {
    logger.error({ jobId: job?.id, err: String(err) }, 'Freshdesk sync job failed')
  })

  // Schedule repeatable cron job
  await syncQueue.add('freshdesk-sync', {}, {
    repeat: { pattern: config.FRESHDESK_SYNC_CRON },
    jobId: 'repeat:freshdesk-sync',
  })

  logger.info({ cron: config.FRESHDESK_SYNC_CRON }, 'Freshdesk sync scheduler started')
}

export default manifest
