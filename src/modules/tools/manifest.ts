// LUNA — Module: tools
// Registro y ejecución de herramientas del agente. Las tools las proveen otros módulos.

import { z } from 'zod'
import type { ModuleManifest, ApiRoute } from '../../kernel/types.js'
import type { Registry } from '../../kernel/registry.js'
import type { ToolsConfig } from './types.js'
import { PgStore } from './pg-store.js'
import { ToolExecutor } from './tool-executor.js'
import { ToolRegistry } from './tool-registry.js'

let toolRegistry: ToolRegistry | null = null

function readBody(req: import('node:http').IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks).toString()))
    req.on('error', reject)
  })
}

function jsonResponse(res: import('node:http').ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(data))
}

function parseQuery(url: string | undefined): Record<string, string> {
  if (!url) return {}
  const idx = url.indexOf('?')
  if (idx === -1) return {}
  const params: Record<string, string> = {}
  for (const part of url.slice(idx + 1).split('&')) {
    const [k, v] = part.split('=')
    if (k) params[decodeURIComponent(k)] = decodeURIComponent(v ?? '')
  }
  return params
}

function createApiRoutes(): ApiRoute[] {
  const getRegistry = (): ToolRegistry => {
    if (!toolRegistry) throw new Error('Tools module not initialized')
    return toolRegistry
  }

  return [
    // GET /oficina/api/tools/by-module/:moduleName
    // Ruta: by-module?module=nombre
    {
      method: 'GET',
      path: 'by-module',
      handler: async (req, res) => {
        try {
          const query = parseQuery(req.url)
          const moduleName = query['module']
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

    // PUT /oficina/api/tools/settings
    {
      method: 'PUT',
      path: 'settings',
      handler: async (req, res) => {
        try {
          const body = JSON.parse(await readBody(req)) as {
            toolName: string
            enabled?: boolean
            maxRetries?: number
            maxUsesPerLoop?: number
          }
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

    // GET /oficina/api/tools/access?tool=nombre
    {
      method: 'GET',
      path: 'access',
      handler: async (req, res) => {
        try {
          const query = parseQuery(req.url)
          const toolName = query['tool']
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

    // PUT /oficina/api/tools/access
    {
      method: 'PUT',
      path: 'access',
      handler: async (req, res) => {
        try {
          const body = JSON.parse(await readBody(req)) as {
            toolName: string
            contactType: string
            allowed: boolean
          }
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

    // GET /oficina/api/tools/executions?tool=nombre&limit=50
    {
      method: 'GET',
      path: 'executions',
      handler: async (req, res) => {
        try {
          const query = parseQuery(req.url)
          const toolName = query['tool'] || undefined
          const limit = query['limit'] ? parseInt(query['limit'], 10) : 50
          const executions = await getRegistry().getRecentExecutions(toolName, limit)
          jsonResponse(res, 200, { executions })
        } catch (err) {
          jsonResponse(res, 500, { error: String(err) })
        }
      },
    },

    // GET /oficina/api/tools/catalog
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
    TOOLS_RETRY_BACKOFF_MS: z.string().transform(Number).pipe(z.number().int()).default('1000'),
    TOOLS_EXECUTION_TIMEOUT_MS: z.string().transform(Number).pipe(z.number().int()).default('30000'),
    PIPELINE_MAX_TOOL_CALLS_PER_TURN: z.string().transform(Number).pipe(z.number().int()).default('5'),
  }),

  oficina: {
    title: { es: 'Herramientas', en: 'Tools' },
    info: { es: 'Configuración global de herramientas del agente', en: 'Global agent tools configuration' },
    order: 30,
    fields: [
      {
        key: 'TOOLS_RETRY_BACKOFF_MS',
        type: 'number',
        label: { es: 'Backoff entre reintentos (ms)', en: 'Retry backoff (ms)' },
      },
      {
        key: 'TOOLS_EXECUTION_TIMEOUT_MS',
        type: 'number',
        label: { es: 'Timeout de ejecución (ms)', en: 'Execution timeout (ms)' },
      },
      {
        key: 'PIPELINE_MAX_TOOL_CALLS_PER_TURN',
        type: 'number',
        label: { es: 'Max herramientas por turno', en: 'Max tool calls per turn' },
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
