// LUNA — Module: knowledge v2
// Base de conocimiento del agente. Documentos, FAQs, sync, búsqueda híbrida.
// v2: categorías como tabla, embeddings vectoriales, API connectors, web sources.

import { z } from 'zod'
import pino from 'pino'
import type { ModuleManifest, ApiRoute } from '../../kernel/types.js'
import type { Registry } from '../../kernel/registry.js'
import { jsonResponse, parseBody, parseQuery } from '../../kernel/http-helpers.js'
import { numEnvMin, boolEnv } from '../../kernel/config-helpers.js'
import type { KnowledgeConfig } from './types.js'
import { KnowledgePgStore } from './pg-store.js'
import { KnowledgeSearchEngine } from './search-engine.js'
import { KnowledgeCache } from './cache.js'
import { KnowledgeManager } from './knowledge-manager.js'
import { EmbeddingService } from './embedding-service.js'
import { VectorizeWorker } from './vectorize-worker.js'
import { EmbeddingQueue } from './embedding-queue.js'
import { SyncManager } from './sync-manager.js'
import { unifiedSearch, type MemorySearchService } from '../../engine/unified-search.js'
import { FAQManager } from './faq-manager.js'
import { ApiConnectorManager } from './api-connector.js'
import { WebSourceManager } from './web-source-manager.js'
import { KnowledgeItemManager, extractGoogleId } from './item-manager.js'
import { renderKnowledgeSection } from './console-section.js'
import type { ToolRegistry } from '../tools/tool-registry.js'

const logger = pino({ name: 'knowledge' })

interface LLMConfigForKnowledge {
  GOOGLE_AI_API_KEY?: string
}

let _registry: Registry | null = null
let pgStore: KnowledgePgStore | null = null
let knowledgeManager: KnowledgeManager | null = null
let syncManager: SyncManager | null = null
let faqManager: FAQManager | null = null
let apiConnectorManager: ApiConnectorManager | null = null
let webSourceManager: WebSourceManager | null = null
let itemManager: KnowledgeItemManager | null = null
let vectorizeWorker: VectorizeWorker | null = null
let embeddingQueue: EmbeddingQueue | null = null
let downgradeTimer: ReturnType<typeof setInterval> | null = null
let binaryCleanupTimer: ReturnType<typeof setInterval> | null = null

function resolveKnowledgeGoogleApiKey(registry: Registry, config: KnowledgeConfig): string {
  if (config.KNOWLEDGE_GOOGLE_AI_API_KEY) return config.KNOWLEDGE_GOOGLE_AI_API_KEY
  const llmConfig = registry.getConfig<LLMConfigForKnowledge>('llm')
  return llmConfig.GOOGLE_AI_API_KEY ?? ''
}

function resolveKnowledgeConfig(registry: Registry): KnowledgeConfig {
  const config = registry.getConfig<KnowledgeConfig>('knowledge')
  return {
    ...config,
    KNOWLEDGE_GOOGLE_AI_API_KEY: resolveKnowledgeGoogleApiKey(registry, config),
  }
}

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
function getApiConnectorManager(): ApiConnectorManager {
  if (!apiConnectorManager) throw new Error('Knowledge module not initialized')
  return apiConnectorManager
}
function getWebSourceManager(): WebSourceManager {
  if (!webSourceManager) throw new Error('Knowledge module not initialized')
  return webSourceManager
}
function getItemManager(): KnowledgeItemManager {
  if (!itemManager) throw new Error('Knowledge module not initialized')
  return itemManager
}

// ═══════════════════════════════════════════
// API Routes
// ═══════════════════════════════════════════

function createApiRoutes(): ApiRoute[] {
  return [
    // ─── Documents ───

    // GET /console/api/knowledge/documents?categoryId=&search=&limit=50&offset=0
    {
      method: 'GET',
      path: 'documents',
      handler: async (req, res) => {
        try {
          const q = parseQuery(req)
          const result = await getPgStore().listDocuments({
            category: undefined,
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

    // POST /console/api/knowledge/documents/upload
    {
      method: 'POST',
      path: 'documents/upload',
      handler: async (req, res) => {
        try {
          const body = await parseBody<{
            fileName: string
            content: string  // base64
            isCore?: boolean
            categoryIds?: string[]
            description?: string
            mimeType?: string
          }>(req)

          if (!body.fileName || !body.content) {
            jsonResponse(res, 400, { error: 'Missing fileName or content' })
            return
          }

          const buffer = Buffer.from(body.content, 'base64')
          const doc = await getManager().addDocument(buffer, body.fileName, {
            isCore: body.isCore,
            categoryIds: body.categoryIds,
            description: body.description,
            mimeType: body.mimeType,
          })

          jsonResponse(res, 201, { document: doc })
        } catch (err) {
          jsonResponse(res, 400, { error: String(err) })
        }
      },
    },

    // PUT /console/api/knowledge/documents/core
    {
      method: 'PUT',
      path: 'documents/core',
      handler: async (req, res) => {
        try {
          const body = await parseBody<{ id: string; isCore: boolean }>(req)
          if (!body.id) {
            jsonResponse(res, 400, { error: 'Missing id' })
            return
          }
          await getManager().setCore(body.id, body.isCore)
          jsonResponse(res, 200, { ok: true })
        } catch (err) {
          jsonResponse(res, 400, { error: String(err) })
        }
      },
    },

    // POST /console/api/knowledge/documents/delete
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

    // ─── Categories ───

    // GET /console/api/knowledge/categories
    {
      method: 'GET',
      path: 'categories',
      handler: async (_req, res) => {
        try {
          const categories = await getPgStore().listCategories()
          jsonResponse(res, 200, { categories })
        } catch (err) {
          jsonResponse(res, 500, { error: String(err) })
        }
      },
    },

    // POST /console/api/knowledge/categories
    {
      method: 'POST',
      path: 'categories',
      handler: async (req, res) => {
        try {
          const body = await parseBody<{ title: string; description?: string }>(req)
          if (!body.title) {
            jsonResponse(res, 400, { error: 'Missing title' })
            return
          }
          const id = await getPgStore().insertCategory({
            title: body.title,
            description: body.description ?? '',
          })
          jsonResponse(res, 201, { id })
        } catch (err) {
          jsonResponse(res, 400, { error: String(err) })
        }
      },
    },

    // PUT /console/api/knowledge/categories
    {
      method: 'PUT',
      path: 'categories',
      handler: async (req, res) => {
        try {
          const body = await parseBody<{ id: string; title?: string; description?: string }>(req)
          if (!body.id) {
            jsonResponse(res, 400, { error: 'Missing id' })
            return
          }
          await getPgStore().updateCategory(body.id, body)
          jsonResponse(res, 200, { ok: true })
        } catch (err) {
          jsonResponse(res, 400, { error: String(err) })
        }
      },
    },

    // POST /console/api/knowledge/categories/delete
    {
      method: 'POST',
      path: 'categories/delete',
      handler: async (req, res) => {
        try {
          const body = await parseBody<{ id: string }>(req)
          if (!body.id) {
            jsonResponse(res, 400, { error: 'Missing id' })
            return
          }
          await getPgStore().deleteCategory(body.id)
          jsonResponse(res, 200, { ok: true })
        } catch (err) {
          jsonResponse(res, 400, { error: String(err) })
        }
      },
    },

    // ─── API Connectors ───

    // GET /console/api/knowledge/api-connectors
    {
      method: 'GET',
      path: 'api-connectors',
      handler: async (_req, res) => {
        try {
          const connectors = await getApiConnectorManager().list()
          jsonResponse(res, 200, { connectors })
        } catch (err) {
          jsonResponse(res, 500, { error: String(err) })
        }
      },
    },

    // POST /console/api/knowledge/api-connectors
    {
      method: 'POST',
      path: 'api-connectors',
      handler: async (req, res) => {
        try {
          const body = await parseBody<{
            title: string; description: string; baseUrl: string
            authType: string; authConfig: Record<string, string>
            queryInstructions: string
          }>(req)
          if (!body.title || !body.baseUrl) {
            jsonResponse(res, 400, { error: 'Missing title or baseUrl' })
            return
          }
          const id = await getApiConnectorManager().create(body as Parameters<ApiConnectorManager['create']>[0])
          jsonResponse(res, 201, { id })
        } catch (err) {
          jsonResponse(res, 400, { error: String(err) })
        }
      },
    },

    // POST /console/api/knowledge/api-connectors/delete
    {
      method: 'POST',
      path: 'api-connectors/delete',
      handler: async (req, res) => {
        try {
          const body = await parseBody<{ id: string }>(req)
          if (!body.id) {
            jsonResponse(res, 400, { error: 'Missing id' })
            return
          }
          await getApiConnectorManager().remove(body.id)
          jsonResponse(res, 200, { ok: true })
        } catch (err) {
          jsonResponse(res, 400, { error: String(err) })
        }
      },
    },

    // ─── Web Sources ───

    // GET /console/api/knowledge/web-sources
    {
      method: 'GET',
      path: 'web-sources',
      handler: async (_req, res) => {
        try {
          const sources = await getWebSourceManager().list()
          jsonResponse(res, 200, { sources })
        } catch (err) {
          jsonResponse(res, 500, { error: String(err) })
        }
      },
    },

    // POST /console/api/knowledge/web-sources
    {
      method: 'POST',
      path: 'web-sources',
      handler: async (req, res) => {
        try {
          const body = await parseBody<{
            url: string; title: string; description?: string
            categoryId?: string
          }>(req)
          if (!body.url || !body.title) {
            jsonResponse(res, 400, { error: 'Missing url or title' })
            return
          }
          const id = await getWebSourceManager().create(body)
          jsonResponse(res, 201, { id })
        } catch (err) {
          jsonResponse(res, 400, { error: String(err) })
        }
      },
    },

    // POST /console/api/knowledge/web-sources/delete
    {
      method: 'POST',
      path: 'web-sources/delete',
      handler: async (req, res) => {
        try {
          const body = await parseBody<{ id: string }>(req)
          if (!body.id) {
            jsonResponse(res, 400, { error: 'Missing id' })
            return
          }
          await getWebSourceManager().remove(body.id)
          jsonResponse(res, 200, { ok: true })
        } catch (err) {
          jsonResponse(res, 400, { error: String(err) })
        }
      },
    },

    // POST /console/api/knowledge/web-sources/cache
    {
      method: 'POST',
      path: 'web-sources/cache',
      handler: async (req, res) => {
        try {
          const body = await parseBody<{ id: string }>(req)
          if (!body.id) {
            jsonResponse(res, 400, { error: 'Missing id' })
            return
          }
          await getWebSourceManager().cacheWebSource(body.id)
          jsonResponse(res, 200, { ok: true })
        } catch (err) {
          jsonResponse(res, 400, { error: String(err) })
        }
      },
    },

    // ─── Vectorization ───

    // POST /console/api/knowledge/vectorize
    {
      method: 'POST',
      path: 'vectorize',
      handler: async (_req, res) => {
        try {
          // FIX-03: Cargar contenido de items pendientes antes de vectorizar
          const pendingItems = await getPgStore().listItemsPendingContent()
          if (pendingItems.length > 0) {
            logger.info({ count: pendingItems.length }, 'Loading content for pending items before vectorization')
            for (const item of pendingItems) {
              try {
                await getItemManager().loadContent(item.id)
              } catch (err) {
                logger.warn({ err, itemId: item.id }, 'Failed to load content for pending item, continuing')
              }
            }
          }
          const result = await getManager().triggerBulkVectorization()
          jsonResponse(res, 200, result)
        } catch (err) {
          jsonResponse(res, 500, { error: String(err) })
        }
      },
    },

    // GET /console/api/knowledge/vectorize/status
    {
      method: 'GET',
      path: 'vectorize/status',
      handler: async (_req, res) => {
        try {
          if (!vectorizeWorker) {
            jsonResponse(res, 200, { available: false })
            return
          }
          const status = await vectorizeWorker.getStatus()
          jsonResponse(res, 200, { available: true, ...status })
        } catch (err) {
          jsonResponse(res, 500, { error: String(err) })
        }
      },
    },

    // ─── FAQs ───

    // GET /console/api/knowledge/faqs
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

    // POST /console/api/knowledge/faqs
    {
      method: 'POST',
      path: 'faqs',
      handler: async (req, res) => {
        try {
          const body = await parseBody<{
            question: string; answer: string
            variants?: string[]; category?: string
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

    // PUT /console/api/knowledge/faqs
    {
      method: 'PUT',
      path: 'faqs',
      handler: async (req, res) => {
        try {
          const body = await parseBody<{
            id: string; question?: string; answer?: string
            variants?: string[]; category?: string | null; active?: boolean
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

    // POST /console/api/knowledge/faqs/delete
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

    // POST /console/api/knowledge/faqs/import
    {
      method: 'POST',
      path: 'faqs/import',
      handler: async (req, res) => {
        try {
          const body = await parseBody<{
            content: string; spreadsheetId?: string
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
            jsonResponse(res, 400, { error: 'Import not available in manual mode.' })
          }
        } catch (err) {
          jsonResponse(res, 400, { error: String(err) })
        }
      },
    },

    // ─── Sync sources ───

    // GET /console/api/knowledge/sync-sources
    {
      method: 'GET',
      path: 'sync-sources',
      handler: async (_req, res) => {
        try {
          const sources = await getPgStore().listSyncSources()
          jsonResponse(res, 200, { sources })
        } catch (err) {
          jsonResponse(res, 500, { error: String(err) })
        }
      },
    },

    // POST /console/api/knowledge/sync-sources
    {
      method: 'POST',
      path: 'sync-sources',
      handler: async (req, res) => {
        try {
          const body = await parseBody<{
            type: 'drive' | 'url'; label: string; ref: string
            autoCategoryId?: string
          }>(req)
          if (!body.type || !body.label || !body.ref) {
            jsonResponse(res, 400, { error: 'Missing type, label, or ref' })
            return
          }
          const id = await getPgStore().insertSyncSource({
            type: body.type,
            label: body.label,
            ref: body.ref,
            autoCategoryId: body.autoCategoryId ?? null,
          })
          jsonResponse(res, 201, { id })
        } catch (err) {
          jsonResponse(res, 400, { error: String(err) })
        }
      },
    },

    // PUT /console/api/knowledge/sync-sources
    {
      method: 'PUT',
      path: 'sync-sources',
      handler: async (req, res) => {
        try {
          const body = await parseBody<{
            id: string; label?: string; autoCategoryId?: string
          }>(req)
          if (!body.id) {
            jsonResponse(res, 400, { error: 'Missing id' })
            return
          }
          await getPgStore().updateSyncSource(body.id, body)
          jsonResponse(res, 200, { ok: true })
        } catch (err) {
          jsonResponse(res, 400, { error: String(err) })
        }
      },
    },

    // POST /console/api/knowledge/sync-sources/delete
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
          await getPgStore().deleteSyncSource(body.id)
          jsonResponse(res, 200, { ok: true })
        } catch (err) {
          jsonResponse(res, 400, { error: String(err) })
        }
      },
    },

    // POST /console/api/knowledge/sync-sources/sync-now
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

    // ─── Knowledge Items ───

    // GET /console/api/knowledge/items
    {
      method: 'GET',
      path: 'items',
      handler: async (_req, res) => {
        try {
          const items = await getItemManager().list()
          const categories = await getPgStore().listCategories()
          jsonResponse(res, 200, { items, categories })
        } catch (err) {
          jsonResponse(res, 500, { error: String(err) })
        }
      },
    },

    // POST /console/api/knowledge/items
    {
      method: 'POST',
      path: 'items',
      handler: async (req, res) => {
        try {
          const body = await parseBody<{
            title: string; description: string
            categoryId?: string; sourceUrl: string
          }>(req)
          if (!body.title || !body.sourceUrl) {
            jsonResponse(res, 400, { error: 'Faltan title o sourceUrl' })
            return
          }
          const item = await getItemManager().create({
            title: body.title,
            description: body.description ?? '',
            categoryId: body.categoryId ?? null,
            sourceUrl: body.sourceUrl,
          })
          jsonResponse(res, 201, { item })
        } catch (err) {
          jsonResponse(res, 400, { error: String(err) })
        }
      },
    },

    // PUT /console/api/knowledge/items
    {
      method: 'PUT',
      path: 'items',
      handler: async (req, res) => {
        try {
          const body = await parseBody<{
            id: string; title?: string; description?: string; categoryId?: string | null
          }>(req)
          if (!body.id) {
            jsonResponse(res, 400, { error: 'Falta id' })
            return
          }
          await getItemManager().update(body.id, body)
          jsonResponse(res, 200, { ok: true })
        } catch (err) {
          jsonResponse(res, 400, { error: String(err) })
        }
      },
    },

    // PUT /console/api/knowledge/items/active
    {
      method: 'PUT',
      path: 'items/active',
      handler: async (req, res) => {
        try {
          const body = await parseBody<{ id: string; active: boolean }>(req)
          if (!body.id) {
            jsonResponse(res, 400, { error: 'Falta id' })
            return
          }
          await getItemManager().toggleActive(body.id, body.active)
          jsonResponse(res, 200, { ok: true })
        } catch (err) {
          jsonResponse(res, 400, { error: String(err) })
        }
      },
    },

    // PUT /console/api/knowledge/items/core
    {
      method: 'PUT',
      path: 'items/core',
      handler: async (req, res) => {
        try {
          const body = await parseBody<{ id: string; isCore: boolean }>(req)
          if (!body.id) {
            jsonResponse(res, 400, { error: 'Falta id' })
            return
          }
          await getItemManager().toggleCore(body.id, body.isCore)
          jsonResponse(res, 200, { ok: true })
        } catch (err) {
          jsonResponse(res, 400, { error: String(err) })
        }
      },
    },

    // PUT /console/api/knowledge/items/shareable
    {
      method: 'PUT',
      path: 'items/shareable',
      handler: async (req, res) => {
        try {
          const body = await parseBody<{ id: string; shareable: boolean }>(req)
          if (!body.id) {
            jsonResponse(res, 400, { error: 'Falta id' })
            return
          }
          await getPgStore().updateItem(body.id, { shareable: !!body.shareable })
          jsonResponse(res, 200, { ok: true })
        } catch (err) {
          jsonResponse(res, 400, { error: String(err) })
        }
      },
    },

    // POST /console/api/knowledge/items/delete
    {
      method: 'POST',
      path: 'items/delete',
      handler: async (req, res) => {
        try {
          const body = await parseBody<{ id: string }>(req)
          if (!body.id) {
            jsonResponse(res, 400, { error: 'Falta id' })
            return
          }
          await getItemManager().remove(body.id)
          jsonResponse(res, 200, { ok: true })
        } catch (err) {
          jsonResponse(res, 400, { error: String(err) })
        }
      },
    },

    // PUT /console/api/knowledge/items/approve (pending_review → pending)
    {
      method: 'PUT',
      path: 'items/approve',
      handler: async (req, res) => {
        try {
          const body = await parseBody<{ id: string }>(req)
          if (!body.id) { jsonResponse(res, 400, { error: 'Falta id' }); return }
          await getPgStore().approveItem(body.id)
          jsonResponse(res, 200, { ok: true })
        } catch (err) {
          jsonResponse(res, 400, { error: String(err) })
        }
      },
    },

    // PUT /console/api/knowledge/items/reject (pending_review → inactive)
    {
      method: 'PUT',
      path: 'items/reject',
      handler: async (req, res) => {
        try {
          const body = await parseBody<{ id: string }>(req)
          if (!body.id) { jsonResponse(res, 400, { error: 'Falta id' }); return }
          await getPgStore().rejectItem(body.id)
          jsonResponse(res, 200, { ok: true })
        } catch (err) {
          jsonResponse(res, 400, { error: String(err) })
        }
      },
    },

    // POST /console/api/knowledge/items/scan-tabs
    {
      method: 'POST',
      path: 'items/scan-tabs',
      handler: async (req, res) => {
        try {
          const body = await parseBody<{ id: string }>(req)
          if (!body.id) {
            jsonResponse(res, 400, { error: 'Falta id' })
            return
          }
          const tabs = await getItemManager().scanTabs(body.id)
          jsonResponse(res, 200, { tabs })
        } catch (err) {
          jsonResponse(res, 400, { error: String(err) })
        }
      },
    },

    // POST /console/api/knowledge/items/scan-columns
    {
      method: 'POST',
      path: 'items/scan-columns',
      handler: async (req, res) => {
        try {
          const body = await parseBody<{ tabId: string }>(req)
          if (!body.tabId) {
            jsonResponse(res, 400, { error: 'Falta tabId' })
            return
          }
          await getItemManager().scanColumns(body.tabId)
          // Return the columns for this specific tab (client expects { columns: [...] })
          const columns = await getPgStore().getTabColumns(body.tabId)
          jsonResponse(res, 200, { columns })
        } catch (err) {
          jsonResponse(res, 400, { error: String(err) })
        }
      },
    },

    // PUT /console/api/knowledge/items/tab-description
    {
      method: 'PUT',
      path: 'items/tab-description',
      handler: async (req, res) => {
        try {
          const body = await parseBody<{ tabId: string; description: string }>(req)
          if (!body.tabId) {
            jsonResponse(res, 400, { error: 'Falta tabId' })
            return
          }
          await getPgStore().updateTabDescription(body.tabId, body.description ?? '')
          jsonResponse(res, 200, { ok: true })
        } catch (err) {
          jsonResponse(res, 400, { error: String(err) })
        }
      },
    },

    // PUT /console/api/knowledge/items/column-description
    {
      method: 'PUT',
      path: 'items/column-description',
      handler: async (req, res) => {
        try {
          const body = await parseBody<{ columnId: string; description: string }>(req)
          if (!body.columnId) {
            jsonResponse(res, 400, { error: 'Falta columnId' })
            return
          }
          await getPgStore().updateColumnDescription(body.columnId, body.description ?? '')
          jsonResponse(res, 200, { ok: true })
        } catch (err) {
          jsonResponse(res, 400, { error: String(err) })
        }
      },
    },

    // POST /console/api/knowledge/items/load-content
    {
      method: 'POST',
      path: 'items/load-content',
      handler: async (req, res) => {
        try {
          const body = await parseBody<{ id: string }>(req)
          if (!body.id) {
            jsonResponse(res, 400, { error: 'Falta id' })
            return
          }
          const result = await getItemManager().loadContent(body.id)
          jsonResponse(res, 200, result)
        } catch (err) {
          jsonResponse(res, 400, { error: String(err) })
        }
      },
    },

    // PUT /console/api/knowledge/items/tab-ignore — toggle ignored flag on a tab
    {
      method: 'PUT',
      path: 'items/tab-ignore',
      handler: async (req, res) => {
        try {
          const body = await parseBody<{ tabId: string; ignored: boolean }>(req)
          if (!body.tabId) {
            jsonResponse(res, 400, { error: 'Falta tabId' })
            return
          }
          await getPgStore().updateTabIgnored(body.tabId, !!body.ignored)
          jsonResponse(res, 200, { ok: true })
        } catch (err) {
          jsonResponse(res, 400, { error: String(err) })
        }
      },
    },

    // PUT /console/api/knowledge/items/column-ignore — toggle ignored flag on a column
    {
      method: 'PUT',
      path: 'items/column-ignore',
      handler: async (req, res) => {
        try {
          const body = await parseBody<{ columnId: string; ignored: boolean }>(req)
          if (!body.columnId) {
            jsonResponse(res, 400, { error: 'Falta columnId' })
            return
          }
          await getPgStore().updateColumnIgnored(body.columnId, !!body.ignored)
          jsonResponse(res, 200, { ok: true })
        } catch (err) {
          jsonResponse(res, 400, { error: String(err) })
        }
      },
    },

    // POST /console/api/knowledge/items/verify-url — check Google resource accessibility
    {
      method: 'POST',
      path: 'items/verify-url',
      handler: async (req, res) => {
        try {
          const body = await parseBody<{ sourceUrl: string }>(req)
          if (!body.sourceUrl) {
            jsonResponse(res, 400, { error: 'URL requerida', accessible: false })
            return
          }
          const extracted = extractGoogleId(body.sourceUrl)
          if (!extracted) {
            // Unknown URL format — allow only if it looks like an HTTP URL
            if (body.sourceUrl.startsWith('http')) {
              jsonResponse(res, 200, { accessible: true, sourceType: 'web' })
            } else {
              jsonResponse(res, 400, { error: 'URL no válida', accessible: false })
            }
            return
          }
          // Try OAuth first, then public API fallback
          let oauthOk = false
          const googleApps = _registry?.getOptional<{ sheets: { getSpreadsheet: (id: string) => Promise<unknown> }; docs: { getDocument: (id: string) => Promise<unknown> }; drive: { listFiles: (opts: { folderId: string; pageSize: number }) => Promise<unknown> } }>('google-apps:api')
          if (googleApps) {
            try {
              if (extracted.type === 'sheets') await googleApps.sheets.getSpreadsheet(extracted.id)
              else if (extracted.type === 'docs') await googleApps.docs.getDocument(extracted.id)
              else if (extracted.type === 'drive') await googleApps.drive.listFiles({ folderId: extracted.id, pageSize: 1 })
              oauthOk = true
            } catch { /* OAuth failed — try public fallback below */ }
            if (oauthOk) {
              jsonResponse(res, 200, { accessible: true, sourceType: extracted.type })
              return
            }
          }
          // Fallback: verify via public API with API key (works for "Anyone with the link" docs)
          const apiKey = _registry ? resolveKnowledgeConfig(_registry).KNOWLEDGE_GOOGLE_AI_API_KEY : ''
          if (apiKey && (extracted.type === 'sheets' || extracted.type === 'docs' || extracted.type === 'slides')) {
            try {
              const apiBase = extracted.type === 'sheets'
                ? `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(extracted.id)}?fields=spreadsheetId`
                : `https://docs.googleapis.com/v1/documents/${encodeURIComponent(extracted.id)}?fields=documentId`
              const checkRes = await fetch(`${apiBase}&key=${encodeURIComponent(apiKey)}`, { signal: AbortSignal.timeout(10000) })
              if (checkRes.ok) {
                jsonResponse(res, 200, { accessible: true, sourceType: extracted.type })
                return
              }
            } catch { /* public API also failed */ }
          }
          // For web URLs, PDFs, YouTube — just allow (we'll verify on content load)
          // Cannot verify via OAuth or public API — allow with warning (verified on content load)
          jsonResponse(res, 200, { accessible: true, sourceType: extracted.type, warning: 'No se pudo verificar acceso. Asegúrate de que el documento esté compartido.' })
        } catch (err) {
          jsonResponse(res, 400, { error: String(err), accessible: false })
        }
      },
    },

    // GET /console/api/knowledge/items/progress?itemId=xxx
    {
      method: 'GET',
      path: 'items/progress',
      handler: async (req, res) => {
        try {
          const q = parseQuery(req)
          const itemId = q.get('itemId') ?? ''
          if (!itemId) {
            jsonResponse(res, 400, { error: 'Falta itemId' })
            return
          }
          const progress = await getPgStore().getEmbeddingProgress(itemId)
          const percent = progress.total > 0 ? Math.round((progress.embedded / progress.total) * 100) : 0
          jsonResponse(res, 200, { ...progress, percent })
        } catch (err) {
          jsonResponse(res, 500, { error: String(err) })
        }
      },
    },

    // ─── Search & Stats ───

    // GET /console/api/knowledge/search?q=&hint=&limit=5
    {
      method: 'GET',
      path: 'search',
      handler: async (req, res) => {
        try {
          const q = parseQuery(req)
          const query = q.get('q') ?? ''
          const hint = q.get('hint') ?? undefined
          const limit = q.has('limit') ? parseInt(q.get('limit')!, 10) : 5
          const results = await getManager().searchConsultable(query, limit, hint)
          jsonResponse(res, 200, { results })
        } catch (err) {
          jsonResponse(res, 500, { error: String(err) })
        }
      },
    },

    // GET /console/api/knowledge/stats
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

    // GET /console/api/knowledge/suggestions (promotions + demotions)
    {
      method: 'GET',
      path: 'suggestions',
      handler: async (_req, res) => {
        try {
          const [promotions, demotions] = await Promise.all([
            getManager().getUpgradeSuggestions(),
            getPgStore().getDemotionSuggestions(30),
          ])
          jsonResponse(res, 200, { suggestions: promotions, demotions })
        } catch (err) {
          jsonResponse(res, 500, { error: String(err) })
        }
      },
    },

    // POST /console/api/knowledge/rebuild-index
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
  version: '2.0.0',
  description: {
    es: 'Base de conocimiento v2 — embeddings vectoriales, categorías, API connectors, web sources',
    en: 'Knowledge base v2 — vector embeddings, categories, API connectors, web sources',
  },
  type: 'feature',
  removable: true,
  activateByDefault: true,
  depends: ['tools'],

  configSchema: z.object({
    KNOWLEDGE_DIR: z.string().default('instance/knowledge'),
    KNOWLEDGE_FAQ_SHEET_URL: z.string().default(''),
    KNOWLEDGE_FAQ_DESCRIPTION: z.string().default(''),
    KNOWLEDGE_PRODUCTS_SHEET_URL: z.string().default(''),
    KNOWLEDGE_PRODUCTS_DESCRIPTION: z.string().default(''),
    KNOWLEDGE_MAX_FILE_SIZE_MB: numEnvMin(1, 50),
    KNOWLEDGE_CORE_MAX_CHUNKS: numEnvMin(1, 200),
    KNOWLEDGE_CACHE_TTL_MIN: numEnvMin(1, 30),
    KNOWLEDGE_AUTO_DOWNGRADE_DAYS: numEnvMin(1, 60),
    KNOWLEDGE_FAQ_SOURCE: z.string().default('manual'),
    KNOWLEDGE_SYNC_ENABLED: boolEnv(true),
    KNOWLEDGE_SYNC_FREQUENCY: z.string().default('24h'),
    KNOWLEDGE_GOOGLE_AI_API_KEY: z.string().default(''),
    KNOWLEDGE_EMBEDDING_ENABLED: boolEnv(true),
    KNOWLEDGE_VECTORIZE_CONCURRENCY: numEnvMin(1, 2),
    KNOWLEDGE_MAX_WEB_SOURCES: numEnvMin(1, 5),
    KNOWLEDGE_MAX_API_CONNECTORS: numEnvMin(1, 10),
    KNOWLEDGE_MAX_CATEGORIES: numEnvMin(1, 25),
    KNOWLEDGE_MAX_CORE_DOCS: numEnvMin(1, 3),
    KNOWLEDGE_EMBEDDING_MODEL: z.string().default('gemini-embedding-2-preview'),
    KNOWLEDGE_EMBEDDING_DIMENSIONS: numEnvMin(256, 1536),
    /** JSON: { "contact_type": ["categoryId1", ...] } — filtrado de knowledge por tipo de contacto */
    KNOWLEDGE_CONTACT_CATEGORY_MAP: z.string().default('').refine(
      (v) => {
        if (!v) return true
        try {
          const parsed = JSON.parse(v)
          if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return false
          return Object.values(parsed).every(arr => Array.isArray(arr) && arr.every(id => typeof id === 'string'))
        } catch { return false }
      },
      { message: 'Must be valid JSON: {"contact_type": ["category-id", ...]} or empty' },
    ),
  }),

  console: {
    title: { es: 'Conocimiento', en: 'Knowledge' },
    info: {
      es: 'Administra las fuentes de informacion del agente: documentos principales, hojas de calculo, FAQs y fuentes externas.',
      en: 'Manage agent information sources: core documents, spreadsheets, FAQs and external sources.',
    },
    order: 12,
    group: 'data',
    icon: '&#128218;',
    fields: [
      // ── Fixed knowledge bases ──
      { key: '_divider_bases', type: 'divider', label: { es: 'Bases de conocimiento', en: 'Knowledge bases' } },
      {
        key: 'KNOWLEDGE_FAQ_SHEET_URL',
        type: 'text',
        label: { es: 'FAQ — Google Sheet', en: 'FAQ — Google Sheet' },
        info: { es: 'URL del Google Sheet con preguntas frecuentes. Luna sincronizara automaticamente.', en: 'Google Sheet URL with FAQs. Luna will sync automatically.' },
        placeholder: 'https://docs.google.com/spreadsheets/d/...',
      },
      {
        key: 'KNOWLEDGE_PRODUCTS_SHEET_URL',
        type: 'text',
        label: { es: 'Productos y servicios — Google Sheet', en: 'Products & services — Google Sheet' },
        info: { es: 'URL del Google Sheet con informacion de productos y servicios.', en: 'Google Sheet URL with products and services information.' },
        placeholder: 'https://docs.google.com/spreadsheets/d/...',
      },
      // ── Advanced settings ──
      { key: '_divider_advanced', type: 'divider', label: { es: 'Avanzado', en: 'Advanced' } },
      {
        key: 'KNOWLEDGE_MAX_FILE_SIZE_MB',
        type: 'number',
        label: { es: 'Tamaño maximo de archivo (MB)', en: 'Max file size (MB)' },
        info: { es: 'Tamaño maximo permitido para documentos subidos', en: 'Max allowed size for uploaded documents' },
        width: 'half',
      },
      {
        key: 'KNOWLEDGE_MAX_CORE_DOCS',
        type: 'number',
        label: { es: 'Max. documentos core', en: 'Max core documents' },
        info: { es: 'Maximo de documentos marcados como core (inyectados siempre en cada conversacion)', en: 'Max documents marked as core (always injected in every conversation)' },
        width: 'half',
      },
      {
        key: 'KNOWLEDGE_AUTO_DOWNGRADE_DAYS',
        type: 'number',
        label: { es: 'Auto-downgrade (dias)', en: 'Auto-downgrade (days)' },
        info: { es: 'Documentos core sin consultas en este periodo pierden el flag core automaticamente', en: 'Core docs without hits in this period lose core flag automatically' },
        width: 'half',
      },
      {
        key: 'KNOWLEDGE_CONTACT_CATEGORY_MAP',
        type: 'textarea',
        label: { es: 'Filtro de categorias por tipo de contacto', en: 'Category filter by contact type' },
        info: {
          es: 'JSON que mapea tipos de contacto a categorias de conocimiento permitidas. Ejemplo: {"lead":["cat-id-1","cat-id-2"],"coworker":["cat-id-3"]}. Vacio = sin filtro.',
          en: 'JSON mapping contact types to allowed knowledge categories. Example: {"lead":["cat-id-1","cat-id-2"],"coworker":["cat-id-3"]}. Empty = no filter.',
        },
        placeholder: '{"lead":["category-uuid-1"],"coworker":["category-uuid-2"]}',
      },
      {
        key: 'KNOWLEDGE_SYNC_ENABLED',
        type: 'boolean',
        label: { es: 'Sincronizacion automatica', en: 'Auto sync' },
        info: { es: 'Sincroniza fuentes externas (Drive, URLs) automaticamente', en: 'Auto-sync external sources (Drive, URLs)' },
      },
      {
        key: 'KNOWLEDGE_SYNC_FREQUENCY',
        type: 'select',
        label: { es: 'Frecuencia de sincronizacion', en: 'Sync frequency' },
        info: { es: 'Cada cuanto se verifican cambios en todas las fuentes de conocimiento (Drive, URLs, Items)', en: 'How often to check for changes across all knowledge sources (Drive, URLs, Items)' },
        options: [
          { value: '6h', label: { es: 'Cada 6 horas', en: 'Every 6 hours' } },
          { value: '12h', label: { es: 'Cada 12 horas', en: 'Every 12 hours' } },
          { value: '24h', label: { es: 'Cada 24 horas', en: 'Every 24 hours' } },
          { value: '1w', label: { es: 'Cada semana', en: 'Every week' } },
          { value: '1m', label: { es: 'Cada mes', en: 'Every month' } },
        ],
      },
    ],
    apiRoutes: createApiRoutes(),
  },

  async init(registry: Registry) {
    _registry = registry
    const config = resolveKnowledgeConfig(registry)
    const db = registry.getDb()
    const redis = registry.getRedis()

    // Initialize PostgreSQL store and run migrations
    pgStore = new KnowledgePgStore(db)
    await pgStore.runMigrations()

    // Ensure default category exists
    await pgStore.ensureDefaultCategory()

    // Initialize cache
    const cache = new KnowledgeCache(redis, config.KNOWLEDGE_CACHE_TTL_MIN)

    // Initialize embedding service (if enabled and API key provided)
    let embeddingService: EmbeddingService | null = null
    if (config.KNOWLEDGE_EMBEDDING_ENABLED && config.KNOWLEDGE_GOOGLE_AI_API_KEY) {
      embeddingService = new EmbeddingService(
        config.KNOWLEDGE_GOOGLE_AI_API_KEY,
        logger,
        config.KNOWLEDGE_EMBEDDING_MODEL,
        config.KNOWLEDGE_EMBEDDING_DIMENSIONS,
      )
      logger.info('Embedding service initialized')
    } else {
      logger.info('Embeddings disabled — search will use FTS only')
    }

    // Initialize search engine
    const searchEngine = new KnowledgeSearchEngine(pgStore, embeddingService, redis)

    // Initialize knowledge manager
    knowledgeManager = new KnowledgeManager(pgStore, searchEngine, cache, config, registry)

    // Initialize unified embedding queue (if embeddings enabled)
    if (embeddingService) {
      embeddingQueue = new EmbeddingQueue(registry.getDb(), redis, embeddingService, registry, pgStore)
      registry.provide('knowledge:embedding-queue', embeddingQueue)

      // Initialize vectorize worker and connect to unified queue
      vectorizeWorker = new VectorizeWorker(redis, pgStore, embeddingService, logger, registry)
      vectorizeWorker.setEmbeddingQueue(embeddingQueue)
      knowledgeManager.setVectorizeWorker(vectorizeWorker)

      // Recover pending embeddings from previous run
      embeddingQueue.recoverPending().catch((err: unknown) => {
        logger.warn({ err }, 'Failed to recover pending embeddings on startup')
      })

      logger.info('Embedding queue + vectorize worker initialized')
    }

    // Initialize FAQ manager
    faqManager = new FAQManager(pgStore, searchEngine as never, cache as never, config, registry)

    // Initialize sync manager
    syncManager = new SyncManager(pgStore, knowledgeManager, config, registry, redis)

    // Initialize API connector manager
    apiConnectorManager = new ApiConnectorManager(pgStore)

    // Initialize web source manager
    webSourceManager = new WebSourceManager(pgStore, redis, registry)

    // Initialize item manager
    itemManager = new KnowledgeItemManager(pgStore, cache, config, registry, knowledgeManager)
    if (vectorizeWorker) {
      itemManager.setVectorizeWorker(vectorizeWorker)
    }
    // Link item manager to sync manager for incremental Drive folder sync (WP7)
    syncManager.setItemManager(itemManager)

    // Register services
    registry.provide('knowledge:manager', knowledgeManager)
    registry.provide('knowledge:pg-store', pgStore)
    registry.provide('knowledge:item-manager', itemManager)
    if (embeddingService) {
      registry.provide('knowledge:embedding-service', embeddingService)
    }

    // Register unified search (knowledge + session memory)
    const memorySearchSvc = registry.getOptional<MemorySearchService>('memory:search')
    registry.provide('unified:search', {
      search: (contactId: string, query: string, opts?: { limit?: number; hint?: string }) =>
        unifiedSearch(knowledgeManager, memorySearchSvc, contactId, query, opts),
    })

    // Register console section renderer
    registry.provide('knowledge:renderSection', async (lang: 'es' | 'en') => {
      const items = await itemManager!.list()
      const categories = await pgStore!.listCategories()
      const cfg = registry.getConfig<{ KNOWLEDGE_FAQ_SHEET_URL: string; KNOWLEDGE_FAQ_DESCRIPTION: string; KNOWLEDGE_PRODUCTS_SHEET_URL: string; KNOWLEDGE_PRODUCTS_DESCRIPTION: string; KNOWLEDGE_SYNC_FREQUENCY: string }>('knowledge')
      // Check if cooldown should be active — only in production (ENGINE_TEST_MODE explicitly 'false')
      // If ENGINE_TEST_MODE is missing or 'true' → debug/dev mode → no cooldown
      let debugActive = true // default: no cooldown
      try {
        const db = registry.getDb()
        const dbg = await db.query(`SELECT value FROM config_store WHERE key = 'ENGINE_TEST_MODE'`)
        const val = (dbg.rows[0] as { value: string } | undefined)?.value
        debugActive = val !== 'false' // only 'false' means production → cooldown active
      } catch { /* non-critical — default to debug mode */ }
      return renderKnowledgeSection(items, categories, lang, {
        faqSheetUrl: cfg?.KNOWLEDGE_FAQ_SHEET_URL ?? '',
        faqDescription: cfg?.KNOWLEDGE_FAQ_DESCRIPTION ?? '',
        productsSheetUrl: cfg?.KNOWLEDGE_PRODUCTS_SHEET_URL ?? '',
        productsDescription: cfg?.KNOWLEDGE_PRODUCTS_DESCRIPTION ?? '',
        debugMode: debugActive,
        syncFrequency: cfg?.KNOWLEDGE_SYNC_FREQUENCY ?? '24h',
      })
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
              category_hint: {
                type: 'string',
                description: 'Título de categoría para priorizar resultados (opcional)',
              },
            },
            required: ['query'],
          },
        },
        handler: async (input, context) => {
          try {
            const query = input.query as string
            const hint = input.category_hint as string | undefined

            // FIX-01: Category filtering by contact_type (fail-open: no mapping → no filter)
            let allowedCategoryIds: string[] | undefined
            const cfg = resolveKnowledgeConfig(_registry!)
            if (cfg.KNOWLEDGE_CONTACT_CATEGORY_MAP && context.contactType) {
              try {
                const mapping = JSON.parse(cfg.KNOWLEDGE_CONTACT_CATEGORY_MAP) as Record<string, string[]>
                const mapped = mapping[context.contactType]
                if (Array.isArray(mapped) && mapped.length > 0) {
                  allowedCategoryIds = mapped
                }
              } catch {
                // JSON inválido — fail-open, no filtrar
              }
            }

            const results = await knowledgeManager!.searchConsultable(query, 5, hint, allowedCategoryIds)
            return {
              success: true,
              data: {
                results: results.map(r => ({
                  content: r.content,
                  source: r.source,
                  score: r.score,
                  type: r.type,
                  fileUrl: r.fileUrl,
                  documentId: r.documentId,
                  chunkIndex: r.chunkIndex,
                  chunkTotal: r.chunkTotal,
                  sourceType: r.sourceType,
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

      // Register expand_knowledge tool
      await toolRegistry.registerTool({
        definition: {
          name: 'expand_knowledge',
          displayName: 'Expandir Conocimiento',
          description: 'Obtiene el contenido completo de un documento encontrado con search_knowledge. Usar cuando el resultado de búsqueda es insuficiente y se necesita más contexto del documento.',
          category: 'knowledge',
          sourceModule: 'knowledge',
          parameters: {
            type: 'object',
            properties: {
              documentId: {
                type: 'string',
                description: 'ID del documento (viene del campo documentId en los resultados de search_knowledge)',
              },
            },
            required: ['documentId'],
          },
        },
        handler: async (input, context) => {
          try {
            const documentId = input.documentId as string

            // FIX-01: Category access control — same pattern as search_knowledge
            const cfg = resolveKnowledgeConfig(_registry!)
            if (cfg.KNOWLEDGE_CONTACT_CATEGORY_MAP && context.contactType) {
              try {
                const mapping = JSON.parse(cfg.KNOWLEDGE_CONTACT_CATEGORY_MAP) as Record<string, string[]>
                const allowedCategoryIds = mapping[context.contactType]
                if (Array.isArray(allowedCategoryIds) && allowedCategoryIds.length > 0) {
                  const docCategoryIds = await knowledgeManager!.getDocumentCategoryIds(documentId)
                  if (docCategoryIds.length > 0) {
                    const hasAccess = docCategoryIds.some(id => allowedCategoryIds.includes(id))
                    if (!hasAccess) {
                      return { success: false, error: 'Document not accessible' }
                    }
                  }
                  // Uncategorized document (docCategoryIds.length === 0) → fail-open, allow
                }
              } catch {
                // JSON inválido — fail-open, no filtrar
              }
            }

            return await knowledgeManager!.expandKnowledge(documentId)
          } catch (err) {
            return { success: false, error: String(err) }
          }
        },
      })
      logger.info('Tool expand_knowledge registered')
    }

    // Schedule nightly binary cleanup at 3 AM (checks every hour, runs at target hour)
    if (embeddingQueue) {
      const eq = embeddingQueue
      const NIGHTLY_CHECK_MS = 60 * 60 * 1000  // check every hour
      binaryCleanupTimer = setInterval(async () => {
        const now = new Date()
        if (now.getHours() === 3) {
          try {
            const result = await eq.runNightlyBinaryCleanup()
            logger.info(result, '[KNOWLEDGE] Nightly binary cleanup done')
          } catch (err) {
            logger.error({ err }, '[KNOWLEDGE] Nightly binary cleanup error')
          }
        }
      }, NIGHTLY_CHECK_MS)
      binaryCleanupTimer.unref()
      logger.info('Nightly binary cleanup scheduled (3 AM daily)')
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
    registry.addHook('knowledge', 'console:config_applied', async () => {
      logger.info('Config applied — invalidating caches')
      await cache.invalidate()
    })

    logger.info('Knowledge module v2 initialized')
  },

  async stop() {
    if (embeddingQueue) {
      await embeddingQueue.stop()
      embeddingQueue = null
    }
    if (vectorizeWorker) {
      await vectorizeWorker.stop()
      vectorizeWorker = null
    }
    if (syncManager) syncManager.stopAll()
    if (downgradeTimer) {
      clearInterval(downgradeTimer)
      downgradeTimer = null
    }
    if (binaryCleanupTimer) {
      clearInterval(binaryCleanupTimer)
      binaryCleanupTimer = null
    }
    pgStore = null
    knowledgeManager = null
    syncManager = null
    faqManager = null
    apiConnectorManager = null
    webSourceManager = null
    itemManager = null
    logger.info('Knowledge module stopped')
  },
}

export default manifest
