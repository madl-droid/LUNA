// LUNA — Oficina server logic
// Sirve el HTML de la UI y expone APIs para config y módulos.

import * as fs from 'node:fs'
import * as path from 'node:path'
import { createRequire } from 'node:module'
import type * as http from 'node:http'
import type { Registry } from '../../kernel/registry.js'
import type { ApiRoute } from '../../kernel/types.js'
import { jsonResponse, readBody } from '../../kernel/http-helpers.js'
import { reloadKernelConfig, kernelConfig } from '../../kernel/config.js'
import * as configStore from '../../kernel/config-store.js'
import pino from 'pino'

const logger = pino({ name: 'oficina' })

// Read package.json version once at import time
let packageJsonVersion = 'dev'
try {
  const require = createRequire(import.meta.url)
  const pkg = require('../../../package.json') as { version?: string }
  packageJsonVersion = pkg.version ?? 'dev'
} catch { /* fallback to dev */ }

function findEnvFile(): string {
  const candidates = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), '..', '.env'),
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }
  return candidates[0]!
}

function parseEnvFile(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) return {}
  const content = fs.readFileSync(filePath, 'utf-8')
  const result: Record<string, string> = {}
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIndex = trimmed.indexOf('=')
    if (eqIndex === -1) continue
    const key = trimmed.slice(0, eqIndex).trim()
    const value = trimmed.slice(eqIndex + 1).trim()
    result[key] = value
  }
  return result
}

function writeEnvFile(filePath: string, values: Record<string, string>): void {
  let content = ''
  if (fs.existsSync(filePath)) {
    content = fs.readFileSync(filePath, 'utf-8')
  }

  for (const [key, value] of Object.entries(values)) {
    const regex = new RegExp(`^${key}=.*$`, 'm')
    if (regex.test(content)) {
      content = content.replace(regex, `${key}=${value}`)
    } else {
      content += `\n${key}=${value}`
    }
  }

  fs.writeFileSync(filePath, content, 'utf-8')
}

/**
 * Creates the request handler for serving /oficina HTML
 */
export function createOficinaHandler(registry: Registry): (req: http.IncomingMessage, res: http.ServerResponse) => Promise<boolean> {
  return async (req, res) => {
    const url = req.url ?? '/'
    const localUrl = url.slice('/oficina'.length) || '/'

    // GET /oficina or /oficina/ → serve HTML
    if ((localUrl === '/' || localUrl === '') && req.method === 'GET') {
      const candidates = [
        path.resolve(process.cwd(), 'dist', 'oficina', 'config-ui.html'),
        path.resolve(process.cwd(), 'src', 'modules', 'oficina', 'ui', 'config-ui.html'),
        path.resolve(process.cwd(), 'src', 'oficina', 'config-ui.html'),
      ]

      for (const htmlPath of candidates) {
        if (fs.existsSync(htmlPath)) {
          const html = fs.readFileSync(htmlPath, 'utf-8')
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end(html)
          return true
        }
      }

      res.writeHead(404, { 'Content-Type': 'text/plain' })
      res.end('Oficina UI not found')
      return true
    }

    return false
  }
}

/**
 * Creates API routes for oficina module endpoints
 */
export function createApiRoutes(): ApiRoute[] {
  // We need registry at runtime, so we capture it via closure when init() runs
  // For now, these routes are mounted by the kernel server via oficina manifest
  let _registry: Registry | null = null

  // Helper to lazily get registry (set after init)
  const getRegistry = (): Registry => {
    if (!_registry) throw new Error('Oficina not initialized')
    return _registry
  }

  // The routes need access to registry, so we use a trick:
  // The manifest's init() provides the registry. But apiRoutes are defined at import time.
  // Solution: use module-level variable set by init() in manifest.ts
  // For now, return routes that work with the module-level registry reference.

  return [
    // GET /oficina/api/oficina/version
    {
      method: 'GET',
      path: 'version',
      handler: async (_req, res) => {
        const version = kernelConfig.buildVersion || packageJsonVersion || 'dev'
        jsonResponse(res, 200, { version })
      },
    },

    // GET /oficina/api/oficina/config — return current config (DB > .env > defaults)
    {
      method: 'GET',
      path: 'config',
      handler: async (_req, res) => {
        const envFile = findEnvFile()
        const envValues = parseEnvFile(envFile)
        const defaults: Record<string, string> = {
          DB_HOST: 'localhost', DB_PORT: '5432', DB_NAME: 'luna', DB_USER: 'luna',
          REDIS_HOST: 'localhost', REDIS_PORT: '6379',
        }
        // Try to read DB config (DB has priority over .env)
        let dbValues: Record<string, string> = {}
        try {
          const { getRegistryRef } = await import('./manifest-ref.js')
          const registry = getRegistryRef()
          if (registry) {
            dbValues = await configStore.getAll(registry.getDb())
          }
        } catch (err) {
          logger.warn({ err }, 'Could not read config from DB, using .env only')
        }
        // Merge: DB > .env > defaults
        const values = { ...defaults, ...envValues, ...dbValues }
        jsonResponse(res, 200, { file: envFile, values })
      },
    },

    // PUT /oficina/api/oficina/config — update config (DB primary + .env backward compat)
    {
      method: 'PUT',
      path: 'config',
      handler: async (req, res) => {
        try {
          const body = await readBody(req)
          const updates = JSON.parse(body) as Record<string, string>

          // Write to .env for backward compatibility
          const envFile = findEnvFile()
          writeEnvFile(envFile, updates)

          // Write to DB (primary storage, encrypted for secrets)
          try {
            const { getRegistryRef } = await import('./manifest-ref.js')
            const registry = getRegistryRef()
            if (registry) {
              await configStore.setMultiple(registry.getDb(), updates)
            }
          } catch (err) {
            logger.warn({ err }, 'Could not write config to DB, .env was updated')
          }

          logger.info(`Config updated: ${Object.keys(updates).join(', ')}`)
          jsonResponse(res, 200, { ok: true, updated: Object.keys(updates) })
        } catch (err) {
          logger.error({ err }, 'Failed to update config')
          jsonResponse(res, 400, { error: 'Invalid request body' })
        }
      },
    },

    // POST /oficina/api/oficina/apply — hot-reload config
    {
      method: 'POST',
      path: 'apply',
      handler: async (_req, res) => {
        try {
          reloadKernelConfig()
          logger.info('Config hot-reloaded from disk')
          jsonResponse(res, 200, { ok: true })
        } catch (err) {
          logger.error({ err }, 'Failed to reload config')
          jsonResponse(res, 500, { error: 'Failed to reload: ' + String(err) })
        }
      },
    },

    // GET /oficina/api/oficina/modules — list all modules with their oficina defs
    {
      method: 'GET',
      path: 'modules',
      handler: async (_req, res) => {
        // This handler captures _registry from module scope
        // It will be set to null until oficina is initialized
        // For now we read from the global module ref
        try {
          // Import the registry reference from manifest module scope
          const { getRegistryRef } = await import('./manifest-ref.js')
          const registry = getRegistryRef()
          if (!registry) {
            jsonResponse(res, 500, { error: 'Registry not available' })
            return
          }

          const modules = registry.listModules().map(m => ({
            name: m.manifest.name,
            version: m.manifest.version,
            description: m.manifest.description,
            type: m.manifest.type,
            removable: m.manifest.removable,
            active: m.active,
            oficina: m.manifest.oficina ? {
              title: m.manifest.oficina.title,
              info: m.manifest.oficina.info,
              order: m.manifest.oficina.order,
              fields: m.manifest.oficina.fields,
            } : null,
          }))

          modules.sort((a, b) => (a.oficina?.order ?? 999) - (b.oficina?.order ?? 999))
          jsonResponse(res, 200, { modules })
        } catch (err) {
          logger.error({ err }, 'Failed to list modules')
          jsonResponse(res, 500, { error: 'Failed to list modules' })
        }
      },
    },

    // POST /oficina/api/oficina/modules/{name}/activate
    {
      method: 'POST',
      path: 'activate',
      handler: async (req, res) => {
        try {
          const { getRegistryRef } = await import('./manifest-ref.js')
          const registry = getRegistryRef()
          if (!registry) {
            jsonResponse(res, 500, { error: 'Registry not available' })
            return
          }

          const body = await readBody(req)
          const { name } = JSON.parse(body) as { name: string }
          await registry.activate(name)
          jsonResponse(res, 200, { ok: true, module: name })
        } catch (err) {
          jsonResponse(res, 400, { error: String(err) })
        }
      },
    },

    // POST /oficina/api/oficina/deactivate
    {
      method: 'POST',
      path: 'deactivate',
      handler: async (req, res) => {
        try {
          const { getRegistryRef } = await import('./manifest-ref.js')
          const registry = getRegistryRef()
          if (!registry) {
            jsonResponse(res, 500, { error: 'Registry not available' })
            return
          }

          const body = await readBody(req)
          const { name } = JSON.parse(body) as { name: string }
          await registry.deactivate(name)
          jsonResponse(res, 200, { ok: true, module: name })
        } catch (err) {
          jsonResponse(res, 400, { error: String(err) })
        }
      },
    },

    // POST /oficina/api/oficina/reset-db — testing only
    {
      method: 'POST',
      path: 'reset-db',
      handler: async (_req, res) => {
        try {
          const { getRegistryRef } = await import('./manifest-ref.js')
          const registry = getRegistryRef()
          if (!registry) {
            jsonResponse(res, 500, { error: 'Registry not available' })
            return
          }

          const db = registry.getDb()
          await db.query('TRUNCATE messages CASCADE')
          await registry.getRedis().flushdb()

          logger.info('Database and Redis flushed (testing reset)')
          jsonResponse(res, 200, { ok: true })
        } catch (err) {
          logger.error({ err }, 'Failed to reset databases')
          jsonResponse(res, 500, { error: 'Failed to reset: ' + String(err) })
        }
      },
    },
  ]
}
