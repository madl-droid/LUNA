// LUNA — Module: subagents
// CRUD de tipos de subagent + métricas de uso.
// Console bajo grupo "agent". Expone subagents:catalog al engine.

import type { ModuleManifest, ApiRoute } from '../../kernel/types.js'
import type { Registry } from '../../kernel/registry.js'
import type { Pool } from 'pg'
import { jsonResponse, parseBody, parseQuery } from '../../kernel/http-helpers.js'
import * as repo from './repository.js'
import { createCatalogService } from './service.js'
import { renderSubagentsSection } from './templates.js'
import type { CreateSubagentType, UpdateSubagentType, SubagentUsageSummary } from './types.js'

/** Build API routes (called from init with closure over db + registry) */
function createApiRoutes(db: Pool, registry: Registry): ApiRoute[] {
  const reloadCatalog = async () => {
    const catalog = registry.getOptional<{ reload(): Promise<void> }>('subagents:catalog')
    await catalog?.reload()
  }

  return [
    // ── List all subagent types ──
    {
      method: 'GET',
      path: 'types',
      handler: async (_req, res) => {
        try {
          const types = await repo.listTypes(db)
          jsonResponse(res, 200, { types })
        } catch (err) {
          jsonResponse(res, 500, { error: String(err) })
        }
      },
    },
    // ── Get single subagent type ──
    {
      method: 'GET',
      path: 'type',
      handler: async (req, res) => {
        try {
          const q = parseQuery(req)
          const id = q.get('id')
          if (!id) {
            jsonResponse(res, 400, { error: 'Missing id' })
            return
          }
          const type = await repo.getTypeById(db, id)
          if (!type) {
            jsonResponse(res, 404, { error: 'Not found' })
            return
          }
          jsonResponse(res, 200, { type })
        } catch (err) {
          jsonResponse(res, 500, { error: String(err) })
        }
      },
    },
    // ── Create subagent type ──
    {
      method: 'POST',
      path: 'type',
      handler: async (req, res) => {
        try {
          const body = await parseBody<CreateSubagentType>(req)
          if (!body.slug || !body.name) {
            jsonResponse(res, 400, { error: 'slug and name are required' })
            return
          }
          if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(body.slug)) {
            jsonResponse(res, 400, { error: 'slug must be lowercase alphanumeric with hyphens (e.g. "my-researcher")' })
            return
          }
          if (body.modelTier && !['normal', 'complex'].includes(body.modelTier)) {
            jsonResponse(res, 400, { error: 'modelTier must be "normal" or "complex"' })
            return
          }
          if (body.tokenBudget !== undefined && body.tokenBudget < 5000) {
            jsonResponse(res, 400, { error: 'tokenBudget minimum is 5000' })
            return
          }

          const type = await repo.createType(db, body)
          await reloadCatalog()
          jsonResponse(res, 201, { type })
        } catch (err) {
          const msg = String(err)
          if (msg.includes('unique') || msg.includes('duplicate')) {
            jsonResponse(res, 409, { error: 'A subagent with that slug already exists' })
          } else {
            jsonResponse(res, 500, { error: msg })
          }
        }
      },
    },
    // ── Update subagent type ──
    {
      method: 'PUT',
      path: 'type',
      handler: async (req, res) => {
        try {
          const body = await parseBody<UpdateSubagentType & { id: string }>(req)
          if (!body.id) {
            jsonResponse(res, 400, { error: 'id is required' })
            return
          }
          if (body.modelTier && !['normal', 'complex'].includes(body.modelTier)) {
            jsonResponse(res, 400, { error: 'modelTier must be "normal" or "complex"' })
            return
          }
          if (body.tokenBudget !== undefined && body.tokenBudget < 5000) {
            jsonResponse(res, 400, { error: 'tokenBudget minimum is 5000' })
            return
          }

          // Check if system subagent — protected fields are filtered in repository
          const existing = await repo.getTypeById(db, body.id)
          const isSystem = existing?.isSystem ?? false

          const type = await repo.updateType(db, body.id, body, isSystem)
          if (!type) {
            jsonResponse(res, 404, { error: 'Not found' })
            return
          }
          await reloadCatalog()
          jsonResponse(res, 200, { type })
        } catch (err) {
          jsonResponse(res, 500, { error: String(err) })
        }
      },
    },
    // ── Delete subagent type ──
    {
      method: 'DELETE',
      path: 'type',
      handler: async (req, res) => {
        try {
          const q = parseQuery(req)
          const id = q.get('id')
          if (!id) {
            jsonResponse(res, 400, { error: 'Missing id' })
            return
          }
          const result = await repo.deleteType(db, id)
          if (result.isSystem) {
            jsonResponse(res, 403, { error: 'System subagents cannot be deleted. You can disable them instead.' })
            return
          }
          await reloadCatalog()
          jsonResponse(res, result.deleted ? 200 : 404, { ok: result.deleted })
        } catch (err) {
          jsonResponse(res, 500, { error: String(err) })
        }
      },
    },
    // ── Usage stats (with period filter) ──
    {
      method: 'GET',
      path: 'usage',
      handler: async (req, res) => {
        try {
          const q = parseQuery(req)
          const period = (q.get('period') ?? 'day') as 'hour' | 'day' | 'week' | 'month'
          if (!['hour', 'day', 'week', 'month'].includes(period)) {
            jsonResponse(res, 400, { error: 'period must be hour, day, week, or month' })
            return
          }
          const summary = await repo.getUsageSummary(db, period)
          jsonResponse(res, 200, summary)
        } catch (err) {
          jsonResponse(res, 500, { error: String(err) })
        }
      },
    },
    // ── Get available tools (for tool selector in console UI) ──
    {
      method: 'GET',
      path: 'available-tools',
      handler: async (_req, res) => {
        try {
          interface ToolCatalogEntry { name: string; description: string }
          const toolsRegistry = registry.getOptional<{
            getCatalog(): ToolCatalogEntry[]
          }>('tools:registry')
          const tools = toolsRegistry?.getCatalog() ?? []
          jsonResponse(res, 200, { tools: tools.map(t => ({ name: t.name, description: t.description })) })
        } catch (err) {
          jsonResponse(res, 500, { error: String(err) })
        }
      },
    },
  ]
}

const manifest: ModuleManifest = {
  name: 'subagents',
  version: '1.0.0',
  description: {
    es: 'Subagentes especializados: tipos, verificación, spawn recursivo y métricas de uso',
    en: 'Specialized subagents: types, verification, recursive spawn and usage metrics',
  },
  type: 'feature',
  removable: false,
  activateByDefault: true,
  depends: ['llm'],

  console: {
    title: { es: 'Subagentes', en: 'Subagents' },
    info: {
      es: 'Crea y configura subagentes especializados. Cada subagente puede usar herramientas específicas, verificar sus resultados y dividir tareas complejas.',
      en: 'Create and configure specialized subagents. Each subagent can use specific tools, verify its results and split complex tasks.',
    },
    order: 12,
    group: 'agent',
    icon: '&#129302;',
    fields: [],
    apiRoutes: [], // populated in init()
  },

  async init(registry: Registry) {
    const db = registry.getDb()

    // Create and register the catalog service
    const catalogService = createCatalogService(db)
    await catalogService.reload()
    registry.provide('subagents:catalog', catalogService)

    // Set up API routes (closure over db + registry)
    const routes = createApiRoutes(db, registry)
    if (manifest.console) {
      manifest.console.apiRoutes = routes
    }

    // Provide render function so console can call it
    registry.provide('subagents:renderSection', async (lang: 'es' | 'en') => {
      const types = await repo.listTypes(db)
      const usage: SubagentUsageSummary = await repo.getUsageSummary(db, 'day')

      // Fetch available tools for the selector (with displayName + sourceModule for grouping)
      let availableTools: Array<{ name: string; displayName: string; description: string; group: string }> = []
      try {
        interface ToolDef { name: string; displayName: string; description: string; category: string; sourceModule: string }
        const toolsRegistry = registry.getOptional<{ getEnabledToolDefinitions(): ToolDef[] }>('tools:registry')
        if (toolsRegistry) {
          availableTools = toolsRegistry.getEnabledToolDefinitions().map(t => ({
            name: t.name,
            displayName: t.displayName || t.name,
            description: t.description,
            group: t.sourceModule || t.category || 'general',
          }))
        }
      } catch { /* tools module not available */ }

      // Fetch knowledge categories
      let availableKnowledgeCategories: Array<{ id: string; title: string }> = []
      try {
        interface KnowledgePgStore { listCategories(): Promise<Array<{ id: string; title: string }>> }
        const knowledgePgStore = registry.getOptional<KnowledgePgStore>('knowledge:pg-store')
        if (knowledgePgStore) {
          availableKnowledgeCategories = (await knowledgePgStore.listCategories()).map(c => ({ id: c.id, title: c.title }))
        }
      } catch { /* knowledge module not available */ }

      return renderSubagentsSection(types, usage, lang, availableTools, availableKnowledgeCategories)
    })
  },

  async stop() {
    // Nothing to clean up
  },
}

export default manifest
