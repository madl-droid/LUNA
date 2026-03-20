// LUNA — Module: knowledge
// Base de conocimiento del agente. Documentos, FAQs, sync, búsqueda híbrida.
// Dos modos: core (siempre inyectado) y consultable (bajo demanda via tool).

import { z } from 'zod'
import pino from 'pino'
import type { ModuleManifest, ApiRoute } from '../../kernel/types.js'
import type { Registry } from '../../kernel/registry.js'
import { jsonResponse, parseBody, parseQuery } from '../../kernel/http-helpers.js'
import { numEnvMin, boolEnv } from '../../kernel/config-helpers.js'
import type { KnowledgeConfig, KnowledgeCategory, SyncFrequency } from './types.js'
import { KnowledgePgStore } from './pg-store.js'
import { KnowledgeSearchEngine } from './search-engine.js'
import { KnowledgeCache } from './cache.js'
import { KnowledgeManager } from './knowledge-manager.js'
import { SyncManager } from './sync-manager.js'
import { FAQManager } from './faq-manager.js'
import type { ToolRegistry } from '../tools/tool-registry.js'

const logger = pino({ name: 'knowledge' })

let pgStore: KnowledgePgStore | null = null
let knowledgeManager: KnowledgeManager | null = null
let syncManager: SyncManager | null = null
let faqManager: FAQManager | null = null
let downgradeTimer: ReturnType<typeof setInterval> | null = null

// ═══════════════════════════════════════════
// Helper to guard initialized state
// ═══════════════════════════════════════════

function getManager(): KnowledgeManager {
  if (!knowledgeManager) throw new Error('Knowledge module not initialized')
  return knowledgeManager
}
function getFaqManager(): FAQManager {
  if (!faqManager) throw new Error('Knowledge module not initialized')
  return faqManager
}
function getSyncManager(): SyncManager {
  if (!syncManager) throw new Error('Knowledge module not initialized')
  return syncManager
}
function getPgStore(): KnowledgePgStore {
  if (!pgStore) throw new Error('Knowledge module not initialized')
  return pgStore
}

// ═══════════════════════════════════════════
// API Routes
// ═══════════════════════════════════════════

function createApiRoutes(): ApiRoute[] {
  return [
    // ─── Documents ───

    // GET /oficina/api/knowledge/documents?category=&search=&limit=50&offset=0
    {
      method: 'GET',
      path: 'documents',
      handler: async (req, res) => {
        try {
          const q = parseQuery(req)
          const result = await getPgStore().listDocuments({
            category: (q.get('category') as KnowledgeCategory) ?? undefined,
            search: q.get('search') ?? undefined,
            limit: q.has('limit') ? parseInt(q.get('limit')!, 10) : 50,
            offset: q.has('offset') ? parseInt(q.get('offset')!, 10) : 0,
          })
          jsonResponse(res, 200, result)
        } catch (err) {
          jsonResponse(res, 500, { error: String(err) })
        }
      },
    },

    // POST /oficina/api/knowledge/documents/upload
    // Body: JSON { fileName, category, content (base64) }
    {
      method: 'POST',
      path: 'documents/upload',
      handler: async (req, res) => {
        try {
          const body = await parseBody<{
            fileName: string
            category?: KnowledgeCategory
            content: string  // base64
            mimeType?: string
          }>(req)

          if (!body.fileName || !body.content) {
            jsonResponse(res, 400, { error: 'Missing fileName or content' })
            return
          }

          const buffer = Buffer.from(body.content, 'base64')
          const doc = await getManager().addDocument(
            buffer,
            body.fileName,
            body.category ?? 'consultable',
            { mimeType: body.mimeType },
          )

          jsonResponse(res, 201, { document: doc })
        } catch (err) {
          jsonResponse(res, 400, { error: String(err) })
        }
      },
    },

    // PUT /oficina/api/knowledge/documents/category
    {
      method: 'PUT',
      path: 'documents/category',
      handler: async (req, res) => {
        try {
          const body = await parseBody<{ id: string; category: KnowledgeCategory }>(req)
          if (!body.id || !body.category) {
            jsonResponse(res, 400, { error: 'Missing id or category' })
            return
          }
          await getManager().updateCategory(body.id, body.category)
          jsonResponse(res, 200, { ok: true })
        } catch (err) {
          jsonResponse(res, 400, { error: String(err) })
        }
      },
    },

    // DELETE /oficina/api/knowledge/documents/delete
    {
      method: 'POST',
      path: 'documents/delete',
      handler: async (req, res) => {
        try {
          const body = await parseBody<{ id: string }>(req)
          if (!body.id) {
            jsonResponse(res, 400, { error: 'Missing id' })
            return
          }
          await getManager().removeDocument(body.id)
          jsonResponse(res, 200, { ok: true })
        } catch (err) {
          jsonResponse(res, 400, { error: String(err) })
        }
      },
    },

    // POST /oficina/api/knowledge/documents/reprocess
    {
      method: 'POST',
      path: 'documents/reprocess',
      handler: async (req, res) => {
        try {
          const body = await parseBody<{ id: string }>(req)
          if (!body.id) {
            jsonResponse(res, 400, { error: 'Missing id' })
            return
          }
          await getManager().reprocessDocument(body.id)
          jsonResponse(res, 200, { ok: true })
        } catch (err) {
          jsonResponse(res, 400, { error: String(err) })
        }
      },
    },

    // ─── FAQs ───

    // GET /oficina/api/knowledge/faqs?category=&search=&limit=50&offset=0
    {
      method: 'GET',
      path: 'faqs',
      handler: async (req, res) => {
        try {
          const q = parseQuery(req)
          const result = await getFaqManager().listFAQs({
            category: q.get('category') ?? undefined,
            search: q.get('search') ?? undefined,
            limit: q.has('limit') ? parseInt(q.get('limit')!, 10) : 50,
            offset: q.has('offset') ? parseInt(q.get('offset')!, 10) : 0,
          })
          jsonResponse(res, 200, { ...result, sourceType: getFaqManager().getSourceType() })
        } catch (err) {
          jsonResponse(res, 500, { error: String(err) })
        }
      },
    },

    // POST /oficina/api/knowledge/faqs
    {
      method: 'POST',
      path: 'faqs',
      handler: async (req, res) => {
        try {
          const body = await parseBody<{
            question: string
            answer: string
            variants?: string[]
            category?: string
          }>(req)

          if (!body.question || !body.answer) {
            jsonResponse(res, 400, { error: 'Missing question or answer' })
            return
          }

          const id = await getFaqManager().createFAQ(body)
          jsonResponse(res, 201, { id })
        } catch (err) {
          jsonResponse(res, 400, { error: String(err) })
        }
      },
    },

    // PUT /oficina/api/knowledge/faqs
    {
      method: 'PUT',
      path: 'faqs',
      handler: async (req, res) => {
        try {
          const body = await parseBody<{
            id: string
            question?: string
            answer?: string
            variants?: string[]
            category?: string | null
            active?: boolean
          }>(req)

          if (!body.id) {
            jsonResponse(res, 400, { error: 'Missing id' })
            return
          }

          await getFaqManager().updateFAQ(body.id, body)
          jsonResponse(res, 200, { ok: true })
        } catch (err) {
          jsonResponse(res, 400, { error: String(err) })
        }
      },
    },

    // POST /oficina/api/knowledge/faqs/delete
    {
      method: 'POST',
      path: 'faqs/delete',
      handler: async (req, res) => {
        try {
          const body = await parseBody<{ id: string }>(req)
          if (!body.id) {
            jsonResponse(res, 400, { error: 'Missing id' })
            return
          }
          await getFaqManager().deleteFAQ(body.id)
          jsonResponse(res, 200, { ok: true })
        } catch (err) {
          jsonResponse(res, 400, { error: String(err) })
        }
      },
    },

    // POST /oficina/api/knowledge/faqs/import
    {
      method: 'POST',
      path: 'faqs/import',
      handler: async (req, res) => {
        try {
          const body = await parseBody<{
            content: string  // base64
            spreadsheetId?: string  // for sheets mode
          }>(req)

          const source = getFaqManager().getSourceType()

          if (source === 'file') {
            if (!body.content) {
              jsonResponse(res, 400, { error: 'Missing content (base64 encoded file)' })
              return
            }
            const buffer = Buffer.from(body.content, 'base64')
            const count = await getFaqManager().importFromFile(buffer)
            jsonResponse(res, 200, { ok: true, imported: count })
          } else if (source === 'sheets') {
            if (!body.spreadsheetId) {
              jsonResponse(res, 400, { error: 'Missing spreadsheetId' })
              return
            }
            const count = await getFaqManager().syncFromSheets(body.spreadsheetId)
            jsonResponse(res, 200, { ok: true, imported: count })
          } else {
            jsonResponse(res, 400, { error: 'Import not available in manual mode. Use CRUD endpoints.' })
          }
        } catch (err) {
          jsonResponse(res, 400, { error: String(err) })
        }
      },
    },

    // ─── Sync sources ───

    // GET /oficina/api/knowledge/sync-sources
    {
      method: 'GET',
      path: 'sync-sources',
      handler: async (_req, res) => {
        try {
          const sources = await getPgStore().listSyncSources()
          const driveAvailable = !!_req // always true — checked at front
          jsonResponse(res, 200, { sources, driveAvailable })
        } catch (err) {
          jsonResponse(res, 500, { error: String(err) })
        }
      },
    },

    // POST /oficina/api/knowledge/sync-sources
    {
      method: 'POST',
      path: 'sync-sources',
      handler: async (req, res) => {
        try {
          const body = await parseBody<{
            type: 'drive' | 'url'
            label: string
            ref: string
            frequency?: SyncFrequency
            autoCategory?: KnowledgeCategory
          }>(req)

          if (!body.type || !body.label || !body.ref) {
            jsonResponse(res, 400, { error: 'Missing type, label, or ref' })
            return
          }

          const id = await getPgStore().insertSyncSource({
            type: body.type,
            label: body.label,
            ref: body.ref,
            frequency: body.frequency ?? '24h',
            autoCategory: body.autoCategory ?? 'consultable',
          })

          // Schedule the new source
          const source = await getPgStore().getSyncSource(id)
          if (source) getSyncManager().scheduleSync(source)

          jsonResponse(res, 201, { id })
        } catch (err) {
          jsonResponse(res, 400, { error: String(err) })
        }
      },
    },

    // PUT /oficina/api/knowledge/sync-sources
    {
      method: 'PUT',
      path: 'sync-sources',
      handler: async (req, res) => {
        try {
          const body = await parseBody<{
            id: string
            label?: string
            frequency?: SyncFrequency
            autoCategory?: KnowledgeCategory
          }>(req)

          if (!body.id) {
            jsonResponse(res, 400, { error: 'Missing id' })
            return
          }

          await getPgStore().updateSyncSource(body.id, body)

          // Reschedule if frequency changed
          if (body.frequency) {
            const source = await getPgStore().getSyncSource(body.id)
            if (source) getSyncManager().scheduleSync(source)
          }

          jsonResponse(res, 200, { ok: true })
        } catch (err) {
          jsonResponse(res, 400, { error: String(err) })
        }
      },
    },

    // POST /oficina/api/knowledge/sync-sources/delete
    {
      method: 'POST',
      path: 'sync-sources/delete',
      handler: async (req, res) => {
        try {
          const body = await parseBody<{ id: string }>(req)
          if (!body.id) {
            jsonResponse(res, 400, { error: 'Missing id' })
            return
          }
          getSyncManager().unscheduleSync(body.id)
          await getPgStore().deleteSyncSource(body.id)
          jsonResponse(res, 200, { ok: true })
        } catch (err) {
          jsonResponse(res, 400, { error: String(err) })
        }
      },
    },

    // POST /oficina/api/knowledge/sync-sources/sync-now
    {
      method: 'POST',
      path: 'sync-sources/sync-now',
      handler: async (req, res) => {
        try {
          const body = await parseBody<{ id: string }>(req)
          if (!body.id) {
            jsonResponse(res, 400, { error: 'Missing id' })
            return
          }
          const result = await getSyncManager().runSync(body.id)
          jsonResponse(res, 200, result)
        } catch (err) {
          jsonResponse(res, 400, { error: String(err) })
        }
      },
    },

    // ─── Search (for testing/debugging) ───

    // GET /oficina/api/knowledge/search?q=&mode=core|consultable&limit=5
    {
      method: 'GET',
      path: 'search',
      handler: async (req, res) => {
        try {
          const q = parseQuery(req)
          const query = q.get('q') ?? ''
          const mode = (q.get('mode') as KnowledgeCategory) ?? 'core'
          const limit = q.has('limit') ? parseInt(q.get('limit')!, 10) : 5

          const results = mode === 'core'
            ? await getManager().searchCore(query, limit)
            : await getManager().searchConsultable(query, limit)

          jsonResponse(res, 200, { results })
        } catch (err) {
          jsonResponse(res, 500, { error: String(err) })
        }
      },
    },

    // ─── Stats and suggestions ───

    // GET /oficina/api/knowledge/stats
    {
      method: 'GET',
      path: 'stats',
      handler: async (_req, res) => {
        try {
          const stats = await getManager().getStats()
          jsonResponse(res, 200, { stats })
        } catch (err) {
          jsonResponse(res, 500, { error: String(err) })
        }
      },
    },

    // GET /oficina/api/knowledge/suggestions
    {
      method: 'GET',
      path: 'suggestions',
      handler: async (_req, res) => {
        try {
          const suggestions = await getManager().getUpgradeSuggestions()
          jsonResponse(res, 200, { suggestions })
        } catch (err) {
          jsonResponse(res, 500, { error: String(err) })
        }
      },
    },

    // POST /oficina/api/knowledge/rebuild-index
    {
      method: 'POST',
      path: 'rebuild-index',
      handler: async (_req, res) => {
        try {
          await getManager().rebuildIndex()
          jsonResponse(res, 200, { ok: true })
        } catch (err) {
          jsonResponse(res, 500, { error: String(err) })
        }
      },
    },
  ]
}

// ═══════════════════════════════════════════
// Manifest
// ═══════════════════════════════════════════

const manifest: ModuleManifest = {
  name: 'knowledge',
  version: '1.0.0',
  description: {
    es: 'Base de conocimiento del agente — documentos, FAQs, sync desde Drive/URLs',
    en: 'Agent knowledge base — documents, FAQs, sync from Drive/URLs',
  },
  type: 'feature',
  removable: true,
  activateByDefault: true,
  depends: ['tools'],

  configSchema: z.object({
    KNOWLEDGE_DIR: z.string().default('instance/knowledge'),
    KNOWLEDGE_MAX_FILE_SIZE_MB: numEnvMin(1, 25),
    KNOWLEDGE_CORE_MAX_CHUNKS: numEnvMin(1, 100),
    KNOWLEDGE_CACHE_TTL_MIN: numEnvMin(1, 30),
    KNOWLEDGE_AUTO_DOWNGRADE_DAYS: numEnvMin(1, 30),
    KNOWLEDGE_FAQ_SOURCE: z.string().default('manual'),
    KNOWLEDGE_SYNC_ENABLED: boolEnv(true),
  }),

  oficina: {
    title: { es: 'Base de Conocimiento', en: 'Knowledge Base' },
    info: {
      es: 'Gestiona documentos, FAQs y fuentes de sincronización para el agente.',
      en: 'Manage documents, FAQs, and sync sources for the agent.',
    },
    order: 12,
    fields: [
      {
        key: 'KNOWLEDGE_DIR',
        type: 'text',
        label: { es: 'Directorio de conocimiento', en: 'Knowledge directory' },
        info: { es: 'Ruta relativa donde se guardan los archivos', en: 'Relative path for stored files' },
      },
      {
        key: 'KNOWLEDGE_MAX_FILE_SIZE_MB',
        type: 'number',
        label: { es: 'Tamaño máximo de archivo (MB)', en: 'Max file size (MB)' },
      },
      {
        key: 'KNOWLEDGE_CORE_MAX_CHUNKS',
        type: 'number',
        label: { es: 'Máx. chunks core (guía)', en: 'Max core chunks (guide)' },
        info: { es: 'Referencia para limitar conocimiento inyectado', en: 'Guidance for injected knowledge limit' },
      },
      {
        key: 'KNOWLEDGE_CACHE_TTL_MIN',
        type: 'number',
        label: { es: 'TTL cache Redis (minutos)', en: 'Redis cache TTL (minutes)' },
      },
      {
        key: 'KNOWLEDGE_AUTO_DOWNGRADE_DAYS',
        type: 'number',
        label: { es: 'Auto-downgrade: días sin uso', en: 'Auto-downgrade: days without use' },
        info: {
          es: 'Docs core sin hits en este período bajan a consultable automáticamente',
          en: 'Core docs without hits in this period are auto-downgraded to consultable',
        },
      },
      {
        key: 'KNOWLEDGE_FAQ_SOURCE',
        type: 'select',
        label: { es: 'Fuente de FAQs', en: 'FAQ source' },
        info: {
          es: 'Solo una fuente activa. Cambiar elimina FAQs existentes.',
          en: 'Only one active source. Changing deletes existing FAQs.',
        },
        options: [
          { value: 'manual', label: 'Manual (crear desde oficina)' },
          { value: 'sheets', label: 'Google Sheets (sync)' },
          { value: 'file', label: 'Archivo (Excel/CSV upload)' },
        ],
      },
      {
        key: 'KNOWLEDGE_SYNC_ENABLED',
        type: 'boolean',
        label: { es: 'Sincronización habilitada', en: 'Sync enabled' },
        info: {
          es: 'Habilita sync periódico desde Drive y URLs',
          en: 'Enable periodic sync from Drive and URLs',
        },
      },
    ],
    apiRoutes: createApiRoutes(),
  },

  async init(registry: Registry) {
    const config = registry.getConfig<KnowledgeConfig>('knowledge')
    const db = registry.getDb()
    const redis = registry.getRedis()

    // Initialize PostgreSQL store and run migrations
    pgStore = new KnowledgePgStore(db)
    await pgStore.runMigrations()

    // Initialize cache
    const cache = new KnowledgeCache(redis, config.KNOWLEDGE_CACHE_TTL_MIN)

    // Initialize search engine
    const searchEngine = new KnowledgeSearchEngine(pgStore, cache)

    // Initialize knowledge manager
    knowledgeManager = new KnowledgeManager(pgStore, searchEngine, cache, config, registry)

    // Initialize FAQ manager
    faqManager = new FAQManager(pgStore, searchEngine, cache, config, registry)

    // Initialize sync manager
    syncManager = new SyncManager(pgStore, knowledgeManager, config, registry, redis)

    // Register service
    registry.provide('knowledge:manager', knowledgeManager)

    // Build initial indices
    searchEngine.rebuildIndices().catch(err => {
      logger.warn({ err }, 'Initial index build failed — will retry on first search')
    })

    // Start sync sources
    syncManager.startAll().catch(err => {
      logger.warn({ err }, 'Failed to start sync sources')
    })

    // Register search_knowledge tool
    const toolRegistry = registry.getOptional<ToolRegistry>('tools:registry')
    if (toolRegistry) {
      await toolRegistry.registerTool({
        definition: {
          name: 'search_knowledge',
          displayName: 'Buscar Conocimiento',
          description: 'Busca información detallada en la base de conocimiento (fichas técnicas, procesos, detalles específicos)',
          category: 'knowledge',
          sourceModule: 'knowledge',
          parameters: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'Consulta de búsqueda en lenguaje natural',
              },
              category: {
                type: 'string',
                description: 'Filtrar por categoría temática (opcional)',
              },
            },
            required: ['query'],
          },
        },
        handler: async (input) => {
          try {
            const query = input.query as string
            const results = await knowledgeManager!.searchConsultable(query, 5)
            return {
              success: true,
              data: {
                results: results.map(r => ({
                  content: r.content,
                  source: r.source,
                  score: r.score,
                  type: r.type,
                })),
                count: results.length,
              },
            }
          } catch (err) {
            return { success: false, error: String(err) }
          }
        },
      })
      logger.info('Tool search_knowledge registered')
    }

    // Schedule auto-downgrade check (daily)
    const DAILY_MS = 24 * 60 * 60 * 1000
    downgradeTimer = setInterval(async () => {
      try {
        const count = await knowledgeManager!.runAutoDowngrade()
        if (count > 0) {
          logger.info({ downgraded: count }, 'Auto-downgrade completed')
        }
      } catch (err) {
        logger.error({ err }, 'Auto-downgrade failed')
      }
    }, DAILY_MS)
    downgradeTimer.unref()

    // Listen for config changes
    registry.addHook('knowledge', 'oficina:config_applied', async () => {
      logger.info('Config applied — rebuilding indices')
      await searchEngine.rebuildIndices()
    })

    logger.info('Knowledge module initialized')
  },

  async stop() {
    if (syncManager) syncManager.stopAll()
    if (downgradeTimer) {
      clearInterval(downgradeTimer)
      downgradeTimer = null
    }
    pgStore = null
    knowledgeManager = null
    syncManager = null
    faqManager = null
    logger.info('Knowledge module stopped')
  },
}

export default manifest
