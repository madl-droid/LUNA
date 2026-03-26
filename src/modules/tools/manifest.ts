// LUNA — Module: tools
// Registro y ejecución de herramientas del agente. Las tools las proveen otros módulos.

import { z } from 'zod'
import type { ModuleManifest, ApiRoute } from '../../kernel/types.js'
import type { Registry } from '../../kernel/registry.js'
import { jsonResponse, parseBody, parseQuery } from '../../kernel/http-helpers.js'
import { numEnv } from '../../kernel/config-helpers.js'
import type { ToolsConfig } from './types.js'
import { PgStore } from './pg-store.js'
import { ToolExecutor } from './tool-executor.js'
import { ToolRegistry } from './tool-registry.js'

let toolRegistry: ToolRegistry | null = null

function createApiRoutes(): ApiRoute[] {
  const getRegistry = (): ToolRegistry => {
    if (!toolRegistry) throw new Error('Tools module not initialized')
    return toolRegistry
  }

  return [
    // GET /console/api/tools/by-module/:moduleName
    // Ruta: by-module?module=nombre
    {
      method: 'GET',
      path: 'by-module',
      handler: async (req, res) => {
        try {
          const query = parseQuery(req)
          const moduleName = query.get('module')
          if (!moduleName) {
            jsonResponse(res, 400, { error: 'Missing "module" query parameter' })
            return
          }
          const tools = getRegistry().getToolsByModule(moduleName)
          jsonResponse(res, 200, { tools })
        } catch (err) {
          jsonResponse(res, 500, { error: String(err) })
        }
      },
    },

    // PUT /console/api/tools/settings
    {
      method: 'PUT',
      path: 'settings',
      handler: async (req, res) => {
        try {
          const body = await parseBody<{
            toolName: string
            enabled?: boolean
            maxRetries?: number
            maxUsesPerLoop?: number
          }>(req)
          if (!body.toolName) {
            jsonResponse(res, 400, { error: 'Missing toolName' })
            return
          }
          await getRegistry().updateToolSettings(body.toolName, {
            enabled: body.enabled,
            maxRetries: body.maxRetries,
            maxUsesPerLoop: body.maxUsesPerLoop,
          })
          jsonResponse(res, 200, { ok: true })
        } catch (err) {
          jsonResponse(res, 400, { error: String(err) })
        }
      },
    },

    // GET /console/api/tools/access?tool=nombre
    {
      method: 'GET',
      path: 'access',
      handler: async (req, res) => {
        try {
          const query = parseQuery(req)
          const toolName = query.get('tool')
          if (!toolName) {
            jsonResponse(res, 400, { error: 'Missing "tool" query parameter' })
            return
          }
          const rules = await getRegistry().getAccessRules(toolName)
          jsonResponse(res, 200, { rules })
        } catch (err) {
          jsonResponse(res, 500, { error: String(err) })
        }
      },
    },

    // PUT /console/api/tools/access
    {
      method: 'PUT',
      path: 'access',
      handler: async (req, res) => {
        try {
          const body = await parseBody<{
            toolName: string
            contactType: string
            allowed: boolean
          }>(req)
          if (!body.toolName || !body.contactType) {
            jsonResponse(res, 400, { error: 'Missing toolName or contactType' })
            return
          }
          await getRegistry().setAccessRule(body.toolName, body.contactType, body.allowed)
          jsonResponse(res, 200, { ok: true })
        } catch (err) {
          jsonResponse(res, 400, { error: String(err) })
        }
      },
    },

    // GET /console/api/tools/executions?tool=nombre&limit=50
    {
      method: 'GET',
      path: 'executions',
      handler: async (req, res) => {
        try {
          const query = parseQuery(req)
          const toolName = query.get('tool') ?? undefined
          const limit = query.has('limit') ? parseInt(query.get('limit')!, 10) : 50
          const executions = await getRegistry().getRecentExecutions(toolName, limit)
          jsonResponse(res, 200, { executions })
        } catch (err) {
          jsonResponse(res, 500, { error: String(err) })
        }
      },
    },

    // GET /console/api/tools/catalog
    {
      method: 'GET',
      path: 'catalog',
      handler: async (_req, res) => {
        try {
          const catalog = getRegistry().getCatalog()
          jsonResponse(res, 200, { catalog })
        } catch (err) {
          jsonResponse(res, 500, { error: String(err) })
        }
      },
    },
  ]
}

const manifest: ModuleManifest = {
  name: 'tools',
  version: '1.0.0',
  description: {
    es: 'Registro y ejecución de herramientas del agente',
    en: 'Agent tool registry and execution engine',
  },
  type: 'feature',
  removable: true,
  activateByDefault: true,
  depends: [],

  configSchema: z.object({
    TOOLS_RETRY_BACKOFF_MS: numEnv(1000),
    TOOLS_EXECUTION_TIMEOUT_MS: numEnv(30000),
    PIPELINE_MAX_TOOL_CALLS_PER_TURN: numEnv(5),
  }),

  console: {
    title: { es: 'Herramientas', en: 'Tools' },
    info: { es: 'Configuración global de herramientas del agente', en: 'Global agent tools configuration' },
    order: 30,
    group: 'agent',
    icon: '&#128295;',
    fields: [
      {
        key: 'TOOLS_RETRY_BACKOFF_MS',
        type: 'number',
        label: { es: 'Backoff entre reintentos (ms)', en: 'Retry backoff (ms)' },
        info: { es: 'Tiempo de espera base entre reintentos de una herramienta fallida (crece exponencialmente).', en: 'Base wait time between retries of a failed tool (grows exponentially).' },
      },
      {
        key: 'TOOLS_EXECUTION_TIMEOUT_MS',
        type: 'number',
        label: { es: 'Timeout de ejecución (ms)', en: 'Execution timeout (ms)' },
        info: { es: 'Tiempo máximo para ejecutar una herramienta antes de cancelarla.', en: 'Maximum time to execute a tool before cancelling it.' },
      },
      {
        key: 'PIPELINE_MAX_TOOL_CALLS_PER_TURN',
        type: 'number',
        label: { es: 'Max herramientas por turno', en: 'Max tool calls per turn' },
        info: { es: 'Límite de herramientas que el agente puede ejecutar en un solo turno de conversación.', en: 'Limit of tools the agent can execute in a single conversation turn.' },
      },
    ],
    apiRoutes: createApiRoutes(),
  },

  async init(registry: Registry) {
    const config = registry.getConfig<ToolsConfig>('tools')
    const db = registry.getDb()
    const redis = registry.getRedis()

    const pgStore = new PgStore(db)
    await pgStore.ensureTable()

    const executor = new ToolExecutor(config)
    toolRegistry = new ToolRegistry(pgStore, executor, config, db, redis, registry)
    await toolRegistry.initialize()

    // Servicio principal
    registry.provide('tools:registry', toolRegistry)

    // Cuando un módulo se desactiva, quitar sus tools
    registry.addHook('tools', 'module:deactivated', async ({ name }) => {
      toolRegistry!.unregisterModuleTools(name)
    })
  },

  async stop() {
    toolRegistry = null
  },
}

export default manifest
