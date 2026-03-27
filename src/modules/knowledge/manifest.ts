// LUNA — Module: knowledge v2
// Base de conocimiento del agente. Documentos, FAQs, sync, búsqueda híbrida.
// v2: categorías como tabla, embeddings vectoriales, API connectors, web sources.

import { z } from 'zod'
import pino from 'pino'
import type { ModuleManifest, ApiRoute } from '../../kernel/types.js'
import type { Registry } from '../../kernel/registry.js'
import { jsonResponse, parseBody, parseQuery } from '../../kernel/http-helpers.js'
import { numEnvMin, boolEnv } from '../../kernel/config-helpers.js'
import type { KnowledgeConfig, SyncFrequency } from './types.js'
import { KnowledgePgStore } from './pg-store.js'
import { KnowledgeSearchEngine } from './search-engine.js'
import { KnowledgeCache } from './cache.js'
import { KnowledgeManager } from './knowledge-manager.js'
import { EmbeddingService } from './embedding-service.js'
import { VectorizeWorker } from './vectorize-worker.js'
import { SyncManager } from './sync-manager.js'
import { FAQManager } from './faq-manager.js'
import { ApiConnectorManager } from './api-connector.js'
import { WebSourceManager } from './web-source-manager.js'
import { KnowledgeItemManager } from './item-manager.js'
import { renderKnowledgeSection } from './console-section.js'
import type { ToolRegistry } from '../tools/tool-registry.js'

const logger = pino({ name: 'knowledge' })

let pgStore: KnowledgePgStore | null = null
let knowledgeManager: KnowledgeManager | null = null
let syncManager: SyncManager | null = null
let faqManager: FAQManager | null = null
let apiConnectorManager: ApiConnectorManager | null = null
let webSourceManager: WebSourceManager | null = null
let itemManager: KnowledgeItemManager | null = null
let vectorizeWorker: VectorizeWorker | null = null
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
            categoryId?: string; refreshFrequency?: SyncFrequency
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
            frequency?: SyncFrequency; autoCategoryId?: string
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
            autoCategoryId: body.autoCategoryId ?? null,
          })
          const source = await getPgStore().getSyncSource(id)
          if (source) getSyncManager().scheduleSync(source)
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
            id: string; label?: string; frequency?: SyncFrequency; autoCategoryId?: string
          }>(req)
          if (!body.id) {
            jsonResponse(res, 400, { error: 'Missing id' })
            return
          }
          await getPgStore().updateSyncSource(body.id, body)
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
          getSyncManager().unscheduleSync(body.id)
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
          const item = await getPgStore().getPool().query<{ item_id: string }>(
            `SELECT item_id FROM knowledge_item_tabs WHERE id = $1`, [body.tabId],
          )
          const itemId = item.rows[0]?.item_id
          if (itemId) {
            const refreshed = await getItemManager().get(itemId)
            jsonResponse(res, 200, { item: refreshed })
          } else {
            jsonResponse(res, 200, { ok: true })
          }
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

    // GET /console/api/knowledge/suggestions
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
    KNOWLEDGE_PRODUCTS_SHEET_URL: z.string().default(''),
    KNOWLEDGE_MAX_FILE_SIZE_MB: numEnvMin(1, 50),
    KNOWLEDGE_CORE_MAX_CHUNKS: numEnvMin(1, 200),
    KNOWLEDGE_CACHE_TTL_MIN: numEnvMin(1, 30),
    KNOWLEDGE_AUTO_DOWNGRADE_DAYS: numEnvMin(1, 60),
    KNOWLEDGE_FAQ_SOURCE: z.string().default('manual'),
    KNOWLEDGE_SYNC_ENABLED: boolEnv(true),
    KNOWLEDGE_GOOGLE_AI_API_KEY: z.string().default(''),
    KNOWLEDGE_EMBEDDING_ENABLED: boolEnv(true),
    KNOWLEDGE_VECTORIZE_CONCURRENCY: numEnvMin(1, 2),
    KNOWLEDGE_MAX_WEB_SOURCES: numEnvMin(1, 5),
    KNOWLEDGE_MAX_API_CONNECTORS: numEnvMin(1, 10),
    KNOWLEDGE_MAX_CATEGORIES: numEnvMin(1, 25),
    KNOWLEDGE_MAX_CORE_DOCS: numEnvMin(1, 3),
  }),

  console: {
    title: { es: 'Base de Conocimiento', en: 'Knowledge Base' },
    info: {
      es: 'Gestiona documentos, categorías, FAQs, API connectors y web sources.',
      en: 'Manage documents, categories, FAQs, API connectors, and web sources.',
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
        key: 'KNOWLEDGE_SYNC_ENABLED',
        type: 'boolean',
        label: { es: 'Sincronizacion automatica', en: 'Auto sync' },
        info: { es: 'Sincroniza fuentes externas (Drive, URLs) automaticamente', en: 'Auto-sync external sources (Drive, URLs)' },
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

    // Ensure default category exists
    await pgStore.ensureDefaultCategory()

    // Initialize cache
    const cache = new KnowledgeCache(redis, config.KNOWLEDGE_CACHE_TTL_MIN)

    // Initialize embedding service (if enabled and API key provided)
    let embeddingService: EmbeddingService | null = null
    if (config.KNOWLEDGE_EMBEDDING_ENABLED && config.KNOWLEDGE_GOOGLE_AI_API_KEY) {
      embeddingService = new EmbeddingService(config.KNOWLEDGE_GOOGLE_AI_API_KEY, logger)
      logger.info('Embedding service initialized')
    } else {
      logger.info('Embeddings disabled — search will use FTS only')
    }

    // Initialize search engine
    const searchEngine = new KnowledgeSearchEngine(pgStore, embeddingService, redis)

    // Initialize knowledge manager
    knowledgeManager = new KnowledgeManager(pgStore, searchEngine, cache, config, registry)

    // Initialize vectorize worker (if embeddings enabled)
    if (embeddingService) {
      vectorizeWorker = new VectorizeWorker(redis, pgStore, embeddingService, logger)
      knowledgeManager.setVectorizeWorker(vectorizeWorker)
      logger.info('Vectorize worker initialized')
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

    // Register service
    registry.provide('knowledge:manager', knowledgeManager)

    // Register console section renderer
    registry.provide('knowledge:renderSection', async (lang: 'es' | 'en') => {
      const items = await itemManager!.list()
      const categories = await pgStore!.listCategories()
      const cfg = registry.getConfig<{ KNOWLEDGE_FAQ_SHEET_URL: string; KNOWLEDGE_PRODUCTS_SHEET_URL: string }>('knowledge')
      return renderKnowledgeSection(items, categories, lang, {
        faqSheetUrl: cfg?.KNOWLEDGE_FAQ_SHEET_URL ?? '',
        productsSheetUrl: cfg?.KNOWLEDGE_PRODUCTS_SHEET_URL ?? '',
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
        handler: async (input) => {
          try {
            const query = input.query as string
            const hint = input.category_hint as string | undefined
            const results = await knowledgeManager!.searchConsultable(query, 5, hint)
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
    registry.addHook('knowledge', 'console:config_applied', async () => {
      logger.info('Config applied — invalidating caches')
      await cache.invalidate()
    })

    logger.info('Knowledge module v2 initialized')
  },

  async stop() {
    if (vectorizeWorker) {
      await vectorizeWorker.stop()
      vectorizeWorker = null
    }
    if (syncManager) syncManager.stopAll()
    if (downgradeTimer) {
      clearInterval(downgradeTimer)
      downgradeTimer = null
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
