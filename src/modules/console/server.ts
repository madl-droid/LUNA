// LUNA — Console server logic (SSR multi-page)
// Sirve páginas SSR, APIs para config y módulos, y archivos estáticos.

import * as fs from 'node:fs'
import * as path from 'node:path'
import { createRequire } from 'node:module'
import type * as http from 'node:http'
import type { Registry } from '../../kernel/registry.js'
import type { ApiRoute } from '../../kernel/types.js'
import { jsonResponse, parseQuery, readBody } from '../../kernel/http-helpers.js'
import { reloadKernelConfig, kernelConfig } from '../../kernel/config.js'
import * as configStore from '../../kernel/config-store.js'
import { detectLang } from './templates-i18n.js'
import { pageLayout, type DynamicSidebarModule } from './templates.js'
import { renderSection, SECTION_REDIRECTS } from './templates-sections.js'
import type { SectionData } from './templates-sections.js'
import type { ModuleInfo } from './templates-modules.js'
import { renderModulePanels } from './templates-modules.js'
import pino from 'pino'

const logger = pino({ name: 'console' })

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

// Parse form body (application/x-www-form-urlencoded)
function parseFormBody(req: http.IncomingMessage): Promise<Record<string, string>> {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (chunk: Buffer) => { body += chunk.toString() })
    req.on('end', () => {
      const params = new URLSearchParams(body)
      const result: Record<string, string> = {}
      for (const [key, value] of params) result[key] = value
      resolve(result)
    })
    req.on('error', reject)
  })
}

// Fetch section data server-side (no HTTP round-trips)
async function fetchSectionData(registry: Registry, _section: string): Promise<{
  config: Record<string, string>
  version: string
  allModels: Record<string, string[]>
  lastScan: { lastScanAt: string; replacements: Array<{ configKey: string; oldModel: string; newModel: string }> } | null
  moduleStates: ModuleInfo[]
  waState: { status: string; qrDataUrl: string | null; lastDisconnectReason: string | null; moduleEnabled: boolean }
  gmailAuth: { connected: boolean; email: string | null }
  googleAppsAuth: { connected: boolean; email: string | null }
  waConnected: boolean
  gmailConnected: boolean
  googleAppsConnected: boolean
  dynamicModules: DynamicSidebarModule[]
}> {
  // Config: DB > .env > defaults
  const envFile = findEnvFile()
  const envValues = parseEnvFile(envFile)
  const defaults: Record<string, string> = {
    DB_HOST: 'localhost', DB_PORT: '5432', DB_NAME: 'luna', DB_USER: 'luna',
    REDIS_HOST: 'localhost', REDIS_PORT: '6379',
  }

  let dbValues: Record<string, string> = {}
  try {
    dbValues = await configStore.getAll(registry.getDb())
  } catch (err) {
    logger.warn({ err }, 'Could not read config from DB')
  }
  const config = { ...defaults, ...envValues, ...dbValues }

  // Version
  const version = kernelConfig.buildVersion || packageJsonVersion || 'dev'

  // Models: try to get from model-scanner's exported function
  let allModels: Record<string, string[]> = { anthropic: [], gemini: [] }
  let lastScan: { lastScanAt: string; replacements: Array<{ configKey: string; oldModel: string; newModel: string }> } | null = null
  try {
    const { getLastScanResult } = await import('../model-scanner/scanner.js')
    const scan = getLastScanResult()
    if (scan) {
      allModels = {
        anthropic: scan.anthropic?.map((m: { id: string }) => m.id) ?? [],
        gemini: scan.google?.map((m: { id: string }) => m.id) ?? [],
      }
      lastScan = scan.lastScanAt ? { lastScanAt: scan.lastScanAt, replacements: scan.replacements ?? [] } : null
    }
  } catch { /* model-scanner not available */ }

  // Module states
  let moduleStates: ModuleInfo[] = []
  try {
    moduleStates = registry.listModules().map(m => ({
      name: m.manifest.name,
      type: m.manifest.type,
      active: m.active,
      removable: m.manifest.removable,
      console: m.manifest.console ? {
        title: m.manifest.console.title,
        info: m.manifest.console.info,
        fields: m.manifest.console.fields,
      } : null,
    }))
    moduleStates.sort((a, b) => {
      const aOrder = registry.listModules().find(m => m.manifest.name === a.name)?.manifest.console?.order ?? 999
      const bOrder = registry.listModules().find(m => m.manifest.name === b.name)?.manifest.console?.order ?? 999
      return aOrder - bOrder
    })
  } catch { /* ignore */ }

  // WhatsApp state (adapter provides getState(), not a separate status service)
  let waState = { status: 'not_initialized', qrDataUrl: null as string | null, lastDisconnectReason: null as string | null, moduleEnabled: false }
  try {
    const moduleEnabled = registry.isActive('whatsapp')
    waState.moduleEnabled = moduleEnabled
    const adapter = registry.getOptional<{ getState(): { status: string; qr: string | null; lastDisconnectReason: string | null; connectedNumber: string | null } }>('whatsapp:adapter')
    if (adapter) {
      const state = adapter.getState()
      waState.status = state.status
      waState.lastDisconnectReason = state.lastDisconnectReason
      // QR data URL is generated by the API route handler, not stored on adapter
      // Initial render won't have QR — client JS polling will get it via API
    }
  } catch { /* whatsapp not available */ }

  // Gmail auth — only API routes, no server-side state available at SSR time.
  const gmailAuth = { connected: false, email: null as string | null }
  // Google Apps auth — try to get state from OAuthManager service.
  const googleAppsAuth = { connected: false, email: null as string | null }
  try {
    const oauthState = registry.getOptional<{ getState(): { status: string; email: string | null } }>('google-apps:oauth')
    if (oauthState) {
      const state = oauthState.getState()
      googleAppsAuth.connected = state.status === 'connected' || state.status === 'active'
      googleAppsAuth.email = state.email
    }
  } catch { /* google-apps not available */ }

  // Dynamic sidebar modules (modules with console.group defined)
  const dynamicModules: DynamicSidebarModule[] = []
  for (const m of moduleStates) {
    const manifest = registry.listModules().find(lm => lm.manifest.name === m.name)?.manifest
    if (manifest?.console?.group) {
      dynamicModules.push({
        name: manifest.name,
        group: manifest.console.group,
        icon: manifest.console.icon || '&#128230;',
        order: manifest.console.order,
        title: manifest.console.title,
        active: m.active,
      })
    }
  }

  return {
    config,
    version,
    allModels,
    lastScan,
    moduleStates,
    waState,
    gmailAuth,
    googleAppsAuth,
    waConnected: waState.status === 'connected',
    gmailConnected: gmailAuth.connected,
    googleAppsConnected: googleAppsAuth.connected,
    dynamicModules,
  }
}

/**
 * Creates the request handler for serving /console (SSR multi-page)
 */
export function createConsoleHandler(registry: Registry): (req: http.IncomingMessage, res: http.ServerResponse) => Promise<boolean> {
  return async (req, res) => {
    const url = req.url ?? '/'
    const [urlPath] = url.split('?')
    const localUrl = (urlPath ?? '/').slice('/console'.length) || '/'

    // 1. Static files — serve CSS, JS, images
    if (localUrl.startsWith('/static/') && req.method === 'GET') {
      const relativePath = localUrl.slice('/static/'.length)
      if (relativePath.includes('\0')) {
        res.writeHead(400, { 'Content-Type': 'text/plain' })
        res.end('Invalid path')
        return true
      }
      const baseDirs = [
        path.resolve(process.cwd(), 'dist', 'console'),
        path.resolve(process.cwd(), 'src', 'modules', 'console', 'ui'),
      ]
      const mimeTypes: Record<string, string> = {
        '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
        '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
        '.webp': 'image/webp', '.css': 'text/css', '.js': 'application/javascript',
      }
      for (const baseDir of baseDirs) {
        const resolved = path.resolve(baseDir, relativePath)
        if (!resolved.startsWith(baseDir + path.sep) && resolved !== baseDir) continue
        if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
          const ext = path.extname(resolved).toLowerCase()
          const contentType = mimeTypes[ext] || 'application/octet-stream'
          const data = fs.readFileSync(resolved)
          res.writeHead(200, { 'Content-Type': contentType, 'Cache-Control': 'no-cache, no-store, must-revalidate' })
          res.end(data)
          return true
        }
      }
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      res.end('Not found')
      return true
    }

    // 2. API routes — handled by kernel (mounted separately), skip here

    // 3. POST handlers (form submissions)
    if (req.method === 'POST') {
      const body = await parseFormBody(req)
      const lang = body['_lang'] || 'es'
      const section = body['_section'] || 'whatsapp'

      if (localUrl === '/save') {
        const updates: Record<string, string> = {}
        for (const [k, v] of Object.entries(body)) {
          if (!k.startsWith('_')) updates[k] = v
        }
        // Handle checkbox fields: unchecked checkboxes don't submit, hidden field has value
        // Write to DB + .env
        try {
          const envFile = findEnvFile()
          writeEnvFile(envFile, updates)
          await configStore.setMultiple(registry.getDb(), updates)
          logger.info(`Config saved: ${Object.keys(updates).join(', ')}`)
        } catch (err) {
          logger.error({ err }, 'Failed to save config')
          res.writeHead(302, { Location: `/console/${section}?flash=error&lang=${lang}` })
          res.end()
          return true
        }
        res.writeHead(302, { Location: `/console/${section}?flash=saved&lang=${lang}` })
        res.end()
        return true
      }

      if (localUrl === '/apply') {
        const updates: Record<string, string> = {}
        for (const [k, v] of Object.entries(body)) {
          if (!k.startsWith('_')) updates[k] = v
        }
        // Save first, then apply
        try {
          if (Object.keys(updates).length > 0) {
            const envFile = findEnvFile()
            writeEnvFile(envFile, updates)
            await configStore.setMultiple(registry.getDb(), updates)
          }
          reloadKernelConfig()
          logger.info('Config saved and hot-reloaded')
        } catch (err) {
          logger.error({ err }, 'Failed to apply config')
          res.writeHead(302, { Location: `/console/${section}?flash=error&lang=${lang}` })
          res.end()
          return true
        }
        res.writeHead(302, { Location: `/console/${section}?flash=applied&lang=${lang}` })
        res.end()
        return true
      }

      if (localUrl === '/reset-db') {
        try {
          const db = registry.getDb()
          await db.query('TRUNCATE messages CASCADE')
          await registry.getRedis().flushdb()
          logger.info('Database and Redis flushed (reset)')
        } catch (err) {
          logger.error({ err }, 'Failed to reset databases')
        }
        res.writeHead(302, { Location: `/console/${section}?flash=reset&lang=${lang}` })
        res.end()
        return true
      }

      if (localUrl === '/modules/toggle') {
        const modName = body['module']
        const active = body['active']
        try {
          if (modName) {
            if (active === 'true') await registry.activate(modName)
            else await registry.deactivate(modName)
          }
        } catch (err) {
          logger.error({ err, module: modName }, 'Failed to toggle module')
        }
        res.writeHead(302, { Location: `/console/modules?flash=toggled&lang=${lang}` })
        res.end()
        return true
      }
    }

    // 4. GET pages — SSR
    if (req.method === 'GET') {
      // Strip query string for path matching
      const pathOnly = localUrl.split('?')[0]!

      // Redirect root to /console/whatsapp
      if (pathOnly === '/' || pathOnly === '') {
        const lang = detectLang(req)
        res.writeHead(302, { Location: `/console/whatsapp?lang=${lang}` })
        res.end()
        return true
      }

      let section = pathOnly.replace(/^\//, '')

      // Redirect old section IDs to unified pages
      const redirectTo = SECTION_REDIRECTS[section]
      if (redirectTo) {
        const lang = detectLang(req)
        res.writeHead(302, { Location: `/console/${redirectTo}?lang=${lang}` })
        res.end()
        return true
      }

      // Only handle known sections (skip API routes, static files, etc.)
      if (section.startsWith('api/') || section.startsWith('static/')) {
        return false
      }

      const lang = detectLang(req)
      const parsedUrl = new URL(url, `http://${req.headers.host ?? 'localhost'}`)
      const flash = parsedUrl.searchParams.get('flash') ?? undefined

      // Set language cookie
      res.setHeader('Set-Cookie', `luna-lang=${lang}; Path=/; SameSite=Lax`)

      // Fetch data server-side
      const data = await fetchSectionData(registry, section)

      // Render section
      const sectionData: SectionData = {
        config: data.config,
        lang,
        allModels: data.allModels,
        lastScan: data.lastScan,
        waState: data.waState,
        gmailAuth: data.gmailAuth,
        googleAppsAuth: data.googleAppsAuth,
        moduleStates: data.moduleStates,
      }

      // Scheduled tasks: render via module service (needs lang)
      if (section === 'scheduled-tasks') {
        try {
          const renderFn = registry.getOptional<(lang: string) => Promise<string>>('scheduled-tasks:renderSection')
          if (renderFn) {
            sectionData.scheduledTasksHtml = await renderFn(lang)
          }
        } catch { /* module not available */ }
      }

      // Try custom section renderer first, then fall back to dynamic module rendering
      let content = renderSection(section, sectionData)

      if (!content) {
        // Try rendering as a dynamic module page (module with console.fields)
        const modInfo = data.moduleStates.find(m => m.name === section)
        if (modInfo && modInfo.active && modInfo.console?.fields && modInfo.console.fields.length > 0) {
          content = renderModulePanels([modInfo], data.config, lang, section)
        }
      }

      if (!content) {
        res.writeHead(404, { 'Content-Type': 'text/plain' })
        res.end('Section not found')
        return true
      }

      const html = pageLayout({
        section,
        content,
        lang,
        version: data.version,
        flash,
        waConnected: data.waConnected,
        gmailConnected: data.gmailConnected,
        googleAppsConnected: data.googleAppsConnected,
        dynamicModules: data.dynamicModules,
      })
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(html)
      return true
    }

    return false
  }
}

/**
 * Creates API routes for console module endpoints
 */
export function createApiRoutes(): ApiRoute[] {
  return [
    // GET /console/api/console/version
    {
      method: 'GET',
      path: 'version',
      handler: async (_req, res) => {
        const version = kernelConfig.buildVersion || packageJsonVersion || 'dev'
        jsonResponse(res, 200, { version })
      },
    },

    // GET /console/api/console/config — return current config (DB > .env > defaults)
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
        const values = { ...defaults, ...envValues, ...dbValues }
        jsonResponse(res, 200, { file: envFile, values })
      },
    },

    // PUT /console/api/console/config — update config (DB primary + .env backward compat)
    {
      method: 'PUT',
      path: 'config',
      handler: async (req, res) => {
        try {
          const body = await readBody(req)
          const updates = JSON.parse(body) as Record<string, string>

          const envFile = findEnvFile()
          writeEnvFile(envFile, updates)

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

    // POST /console/api/console/apply — hot-reload config
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

    // GET /console/api/console/modules — list all modules with their console defs
    {
      method: 'GET',
      path: 'modules',
      handler: async (_req, res) => {
        try {
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
            console: m.manifest.console ? {
              title: m.manifest.console.title,
              info: m.manifest.console.info,
              order: m.manifest.console.order,
              fields: m.manifest.console.fields,
            } : null,
          }))

          modules.sort((a, b) => (a.console?.order ?? 999) - (b.console?.order ?? 999))
          jsonResponse(res, 200, { modules })
        } catch (err) {
          logger.error({ err }, 'Failed to list modules')
          jsonResponse(res, 500, { error: 'Failed to list modules' })
        }
      },
    },

    // POST /console/api/console/activate
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

    // POST /console/api/console/deactivate
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

    // POST /console/api/console/reset-db — testing only
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

    // GET /console/api/console/engine-metrics?period=24h|7d|30d
    {
      method: 'GET',
      path: 'engine-metrics',
      handler: async (req, res) => {
        try {
          const { getRegistryRef } = await import('./manifest-ref.js')
          const registry = getRegistryRef()
          if (!registry) {
            jsonResponse(res, 500, { error: 'Registry not available' })
            return
          }

          const query = parseQuery(req)
          const period = query.get('period') || '24h'
          const intervalMap: Record<string, string> = {
            '24h': '24 hours',
            '7d': '7 days',
            '30d': '30 days',
          }
          const interval = intervalMap[period] ?? '24 hours'

          const db = registry.getDb()

          // Summary aggregates
          const summaryResult = await db.query(
            `SELECT
              COUNT(*)::int AS total_executions,
              COUNT(*) FILTER (WHERE replan_attempts > 0)::int AS executions_with_replan,
              ROUND(AVG(replan_attempts), 2)::float AS avg_replan_attempts,
              COALESCE(MAX(replan_attempts), 0)::int AS max_replan_attempts,
              COUNT(*) FILTER (WHERE subagent_iterations > 0)::int AS executions_with_subagent,
              ROUND(AVG(subagent_iterations) FILTER (WHERE subagent_iterations > 0), 2)::float AS avg_subagent_iterations,
              COALESCE(MAX(subagent_iterations), 0)::int AS max_subagent_iterations,
              ROUND(AVG(total_ms))::int AS avg_total_ms,
              ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY total_ms))::int AS p95_total_ms
            FROM pipeline_logs
            WHERE created_at > now() - $1::interval`,
            [interval],
          )

          // Daily trends (last 30 days max)
          const trendsResult = await db.query(
            `SELECT
              date_trunc('day', created_at)::date AS day,
              COUNT(*)::int AS total,
              ROUND(AVG(replan_attempts), 2)::float AS avg_replan,
              ROUND(AVG(subagent_iterations) FILTER (WHERE subagent_iterations > 0), 2)::float AS avg_subagent_iter,
              ROUND(AVG(total_ms))::int AS avg_ms
            FROM pipeline_logs
            WHERE created_at > now() - interval '30 days'
            GROUP BY 1 ORDER BY 1`,
          )

          jsonResponse(res, 200, {
            period,
            summary: summaryResult.rows[0] ?? {},
            trends: trendsResult.rows,
          })
        } catch (err) {
          logger.error({ err }, 'Failed to fetch engine metrics')
          jsonResponse(res, 500, { error: 'Failed to fetch metrics' })
        }
      },
    },
  ]
}
