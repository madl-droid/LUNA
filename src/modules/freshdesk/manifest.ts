// LUNA — Module: freshdesk
// Wrapper que registra las tools de Freshdesk KB y el job de sync semanal.
// La lógica vive en src/tools/freshdesk/. Este módulo solo hace el bridge.

import { z } from 'zod'
import { Queue, Worker, type Job } from 'bullmq'
import pino from 'pino'
import type { ModuleManifest, ApiRoute } from '../../kernel/types.js'
import type { Registry } from '../../kernel/registry.js'
import { numEnvMin } from '../../kernel/config-helpers.js'
import { jsonResponse } from '../../kernel/http-helpers.js'
import { registerFreshdeskGetArticleTool } from '../../tools/freshdesk/freshdesk-get-article.js'
import { registerFreshdeskSearchTool } from '../../tools/freshdesk/freshdesk-search.js'
import { runFreshdeskSync, loadFreshdeskIndex, isSyncStale } from '../../tools/freshdesk/freshdesk-sync.js'
import { invalidateFreshdeskIndex } from '../../tools/freshdesk/freshdesk-rag.js'
import type { FreshdeskModuleConfig } from '../../tools/freshdesk/types.js'
import { renderFreshdeskSection } from './console-section.js'

const logger = pino({ name: 'module:freshdesk' })

const QUEUE_NAME = 'luna:freshdesk-sync'
const SYNC_CRON = '0 1 * * 0' // Sundays 1 AM — system-level, not user-configurable

let syncQueue: Queue | null = null
let syncWorker: Worker | null = null

function createApiRoutes(registry: Registry, config: FreshdeskModuleConfig): ApiRoute[] {
  return [
    {
      method: 'GET',
      path: 'articles',
      handler: async (_req, res) => {
        const redis = registry.getRedis()
        const index = await loadFreshdeskIndex(redis)
        const syncAt = await redis.get('freshdesk:sync_at')
        jsonResponse(res, 200, {
          articles: index.map(a => ({ article_id: a.article_id, title: a.title, category_name: a.category_name, folder_name: a.folder_name })),
          total: index.length,
          lastSyncAt: syncAt,
        })
      },
    },
    {
      method: 'GET',
      path: 'cached-articles',
      handler: async (_req, res) => {
        const redis = registry.getRedis()
        const keys = await redis.keys('freshdesk:article:*')
        const ttlSeconds = config.FRESHDESK_CACHE_TTL_HOURS * 3600

        const items: Array<{ article_id: number; title: string; cached_at: string; ttl_remaining_s: number }> = []
        for (const key of keys) {
          const ttl = await redis.ttl(key)
          if (ttl <= 0) continue
          const raw = await redis.get(key)
          if (!raw) continue
          try {
            const article = JSON.parse(raw) as { article_id: number; title: string; cached_at: string }
            items.push({
              article_id: article.article_id,
              title: article.title,
              cached_at: article.cached_at,
              ttl_remaining_s: ttl,
            })
          } catch { /* skip corrupted */ }
        }

        items.sort((a, b) => b.ttl_remaining_s - a.ttl_remaining_s)
        jsonResponse(res, 200, { articles: items, total: items.length, ttlConfigured: ttlSeconds })
      },
    },
  ]
}

const manifest: ModuleManifest = {
  name: 'freshdesk',
  version: '1.0.0',
  description: {
    es: 'Conecta con la base de conocimiento de Freshdesk para responder consultas de soporte',
    en: 'Connects to Freshdesk knowledge base to answer support queries',
  },
  type: 'feature',
  removable: true,
  activateByDefault: false,
  depends: ['tools'],

  configSchema: z.object({
    FRESHDESK_DOMAIN: z.string().default(''),
    FRESHDESK_API_KEY: z.string().default(''),
    FRESHDESK_CACHE_TTL_HOURS: numEnvMin(1, 24),
    FRESHDESK_CATEGORIES: z.string().default(''),
  }),

  console: {
    title: { es: 'Freshdesk Knowledge Base', en: 'Freshdesk Knowledge Base' },
    info: {
      es: 'Conecta la base de conocimiento de Freshdesk para que el agente pueda buscar y consultar artículos de soporte.',
      en: 'Connects the Freshdesk knowledge base so the agent can search and query support articles.',
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
        width: 'half',
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
        width: 'half',
      },
      {
        key: 'FRESHDESK_CACHE_TTL_HOURS',
        type: 'select',
        label: { es: 'Cache de artículos completos', en: 'Full article cache' },
        description: {
          es: 'Tiempo que un artículo completo permanece cacheado después de consultarse.',
          en: 'How long a full article stays cached after being fetched.',
        },
        options: [
          { value: '1', label: { es: '1 hora', en: '1 hour' } },
          { value: '6', label: { es: '6 horas', en: '6 hours' } },
          { value: '12', label: { es: '12 horas', en: '12 hours' } },
          { value: '24', label: { es: '24 horas', en: '24 hours' } },
          { value: '48', label: { es: '48 horas', en: '48 hours' } },
          { value: '72', label: { es: '72 horas', en: '72 hours' } },
        ],
        width: 'half',
      },
    ],
    apiRoutes: [], // populated at init time
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

    // Always start sync scheduler (system-level, not user-configurable)
    await startSyncScheduler(redis, config)

    // Expose sync trigger as a service (for admin endpoints or manual trigger)
    registry.provide('freshdesk:sync', {
      run: async () => {
        const result = await runFreshdeskSync(redis, config)
        await invalidateFreshdeskIndex()
        return result
      },
    })

    // Mount API routes
    const apiRoutes = createApiRoutes(registry, config)
    if (manifest.console) {
      manifest.console.apiRoutes = apiRoutes
    }

    // Register custom console section renderer
    registry.provide('freshdesk:renderSection', (lang: string) => {
      return renderFreshdeskSection(lang as 'es' | 'en')
    })

    logger.info({
      domain: config.FRESHDESK_DOMAIN,
      syncCron: SYNC_CRON,
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
    repeat: { pattern: SYNC_CRON },
    jobId: 'repeat:freshdesk-sync',
  })

  logger.info({ cron: SYNC_CRON }, 'Freshdesk sync scheduler started')
}

export default manifest
