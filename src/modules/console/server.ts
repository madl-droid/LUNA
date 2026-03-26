// LUNA — Console server logic (SSR multi-page)
// Sirve páginas SSR, APIs para config y módulos, y archivos estáticos.

import * as fs from 'node:fs'
import * as path from 'node:path'
import { createRequire } from 'node:module'
import type * as http from 'node:http'
import type { Registry } from '../../kernel/registry.js'
import type { ApiRoute } from '../../kernel/types.js'
import { jsonResponse, parseBody, parseQuery, readBody, buildBaseUrl, oauthCallbackPage } from '../../kernel/http-helpers.js'
import { reloadKernelConfig, kernelConfig } from '../../kernel/config.js'
import * as configStore from '../../kernel/config-store.js'
import { detectLang } from './templates-i18n.js'
import { pageLayout, type DynamicSidebarModule, type SidebarChannelInfo } from './templates.js'
import { renderSection, SECTION_REDIRECTS } from './templates-sections.js'
import type { SectionData } from './templates-sections.js'
import type { ModuleInfo } from './templates-modules.js'
import { renderChannelSettingsPage } from './templates-channel-settings.js'
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
  googleChatConnected: boolean
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
      channelType: m.manifest.channelType,
      active: m.active,
      removable: m.manifest.removable,
      console: m.manifest.console ? {
        title: m.manifest.console.title,
        info: m.manifest.console.info,
        fields: m.manifest.console.fields,
      } : null,
      connectionWizard: m.manifest.console?.connectionWizard ? {
        title: m.manifest.console.connectionWizard.title,
        steps: m.manifest.console.connectionWizard.steps.map(s => ({
          title: s.title,
          instructions: s.instructions,
          fields: s.fields,
        })),
        saveEndpoint: m.manifest.console.connectionWizard.saveEndpoint,
        applyAfterSave: m.manifest.console.connectionWizard.applyAfterSave,
        verifyEndpoint: m.manifest.console.connectionWizard.verifyEndpoint,
      } : undefined,
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

  // Gmail auth — check standalone OAuth or shared OAuth
  const gmailAuth = { connected: false, email: null as string | null }
  try {
    const gmailOAuth = registry.getOptional<{ isConnected(): boolean; getState(): { email: string | null } }>('gmail:oauth-manager')
    if (gmailOAuth && gmailOAuth.isConnected()) {
      gmailAuth.connected = true
      gmailAuth.email = gmailOAuth.getState().email
    } else {
      // Fallback: shared google-apps OAuth
      const sharedOAuth = registry.getOptional<{ isConnected(): boolean; getState(): { email: string | null } }>('google:oauth-manager')
      if (sharedOAuth && sharedOAuth.isConnected()) {
        gmailAuth.connected = true
        gmailAuth.email = sharedOAuth.getState().email
      }
    }
  } catch { /* gmail not available */ }

  // Google Apps auth — try to get state from OAuthManager service.
  const googleAppsAuth = { connected: false, email: null as string | null }
  try {
    const oauthManager = registry.getOptional<{ isConnected(): boolean; getState(): { status: string; email: string | null } }>('google:oauth-manager')
    if (oauthManager) {
      googleAppsAuth.connected = oauthManager.isConnected()
      googleAppsAuth.email = oauthManager.getState().email
    }
  } catch { /* google-apps not available */ }

  // Google Chat — check if adapter is connected
  let googleChatConnected = false
  try {
    const chatAdapter = registry.getOptional<{ getState(): { status: string } }>('google-chat:adapter')
    if (chatAdapter) {
      googleChatConnected = chatAdapter.getState().status === 'connected'
    }
  } catch { /* google-chat not available */ }

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
    googleChatConnected,
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

    // 2b. Shared OAuth callback — GET /console/oauth/callback?code=...&state=gmail|google-apps
    if (localUrl === '/oauth/callback' && req.method === 'GET') {
      const query = new URL(url, 'http://localhost').searchParams
      const code = query.get('code')
      const error = query.get('error')
      const state = query.get('state') || ''

      if (error) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(oauthCallbackPage({ success: false, title: 'Error de autorizacion', message: error }))
        return true
      }
      if (!code) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(oauthCallbackPage({ success: false, title: 'Error', message: 'Codigo de autorizacion no recibido' }))
        return true
      }

      const redirectUri = `${buildBaseUrl(req)}/console/oauth/callback`
      try {
        let email = ''
        if (state === 'gmail') {
          const gmailOAuth = registry.getOptional<{ handleAuthCallback(code: string, uri: string): Promise<void>; getState(): { email: string | null }; getClient(): unknown; isConnected(): boolean }>('gmail:oauth-manager')
          if (!gmailOAuth) throw new Error('Gmail OAuth manager not available')
          await gmailOAuth.handleAuthCallback(code, redirectUri)
          email = gmailOAuth.getState().email ?? ''
          // Initialize adapter if needed
          if (!registry.getOptional<unknown>('email:adapter') && gmailOAuth.isConnected()) {
            try {
              // Trigger adapter init by running the gmail module's post-auth hook
              const gmailMod = registry.getModule('gmail')
              if (gmailMod?.active) {
                // Adapter will be created on next status check or page load
              }
            } catch { /* non-critical */ }
          }
        } else {
          const gappsOAuth = registry.getOptional<{ handleAuthCallback(code: string, uri: string): Promise<void>; getState(): { email: string | null } }>('google:oauth-manager')
          if (!gappsOAuth) throw new Error('Google Apps OAuth manager not available')
          await gappsOAuth.handleAuthCallback(code, redirectUri)
          email = gappsOAuth.getState().email ?? ''
        }

        const label = state === 'gmail' ? 'Gmail' : 'Google Apps'
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(oauthCallbackPage({
          success: true,
          title: `${label} conectado`,
          message: email ? `Autenticado como ${email}` : 'Esta ventana se cerrara automaticamente',
        }))
      } catch (err) {
        logger.error({ err, state }, 'OAuth callback failed')
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(oauthCallbackPage({ success: false, title: 'Error de autenticacion', message: String(err) }))
      }
      return true
    }

    // 3. POST handlers (form submissions)
    if (req.method === 'POST') {
      const body = await parseFormBody(req)
      const lang = body['_lang'] || 'es'
      const section = body['_section'] || 'whatsapp'

      if (localUrl === '/save') {
        const updates: Record<string, string> = {}
        const userPermUpdates: Record<string, string> = {}
        for (const [k, v] of Object.entries(body)) {
          if (k.startsWith('_')) continue
          // Route user/contact config fields to users module
          if (k.startsWith('perm_') || k.startsWith('mod_') || k.startsWith('tool_') || k.startsWith('sub_') || k.startsWith('kcat_') || k.startsWith('assignment_') || k.startsWith('disable_') || k.startsWith('list_enabled_') || k.startsWith('webhook_') || k === 'unregisteredBehavior' || k === 'unregisteredMessage') {
            userPermUpdates[k] = v
          } else {
            updates[k] = v
          }
        }

        try {
          // Standard config save (DB + .env)
          if (Object.keys(updates).length > 0) {
            const envFile = findEnvFile()
            writeEnvFile(envFile, updates)
            await configStore.setMultiple(registry.getDb(), updates)
            logger.info(`Config saved: ${Object.keys(updates).join(', ')}`)
            await registry.runHook('console:config_saved', { keys: Object.keys(updates) })
          }

          // Users permissions save (to user_list_config table)
          if (Object.keys(userPermUpdates).length > 0) {
            try {
              const usersDb = registry.getOptional<import('../users/db.js').UsersDb>('users:db')
              const usersCache = registry.getOptional<import('../users/cache.js').UserCache>('users:cache')
              if (usersDb && usersCache) {
                // Collect per-list updates from form fields
                const up = userPermUpdates
                const listsToUpdate = new Set<string>()

                // Identify all list types mentioned in the form
                for (const k of Object.keys(up)) {
                  const m = k.match(/^(?:mod|tool|sub|kcat|assignment_enabled|assignment_prompt|disable|list_enabled|perm)_([^_]+)/)
                  if (m) listsToUpdate.add(m[1]!)
                }
                // Coworker domains/roles fields → ensure coworker is in the update set
                if (up['coworker_domains'] !== undefined || up['coworker_roles'] !== undefined) {
                  listsToUpdate.add('coworker')
                }
                // Lead webhook fields → ensure lead is in the update set
                if (up['webhook_enabled_lead'] !== undefined || up['webhook_token_lead'] !== undefined
                  || up['webhook_channel_lead'] !== undefined) {
                  listsToUpdate.add('lead')
                }

                for (const lt of listsToUpdate) {
                  const existing = await usersDb.getListConfig(lt)
                  if (!existing) continue

                  // Build tools array from tool_* fields
                  const tools: string[] = []
                  for (const [k, v] of Object.entries(up)) {
                    const tm = k.match(new RegExp(`^tool_${lt}_(.+)$`))
                    if (tm && v === 'on') tools.push(tm[1]!)
                  }

                  // Subagents
                  const subagents = up[`sub_${lt}`] === 'on'

                  // Knowledge categories
                  const kCats: string[] = []
                  for (const [k, v] of Object.entries(up)) {
                    const km = k.match(new RegExp(`^kcat_${lt}_(.+)$`))
                    if (km && v === 'on') kCats.push(km[1]!)
                  }

                  // List enabled
                  const isEnabled = up[`list_enabled_${lt}`] === 'true' || up[`list_enabled_${lt}`] === 'on'

                  // Merge coworker domains/roles into syncConfig
                  const syncCfg = { ...existing.syncConfig }
                  if (lt === 'coworker') {
                    if (up['coworker_domains'] !== undefined) {
                      syncCfg.domains = up['coworker_domains'] ? up['coworker_domains'].split(',').map((d: string) => d.trim()).filter(Boolean) : []
                    }
                    if (up['coworker_roles'] !== undefined) {
                      syncCfg.roles = up['coworker_roles'] ? up['coworker_roles'].split(',').map((r: string) => r.trim()).filter(Boolean) : []
                    }
                  }
                  // Lead webhook settings
                  if (lt === 'lead') {
                    if (up['webhook_enabled_lead'] !== undefined) {
                      syncCfg.webhookEnabled = up['webhook_enabled_lead'] === 'on'
                    }
                    if (up['webhook_token_lead'] !== undefined && up['webhook_token_lead']) {
                      syncCfg.webhookToken = up['webhook_token_lead']
                    }
                    if (up['webhook_channel_lead'] !== undefined) {
                      syncCfg.webhookPreferredChannel = up['webhook_channel_lead']
                    }
                  }

                  await usersDb.upsertListConfig(lt, existing.displayName, {
                    tools: tools.length > 0 ? tools : existing.permissions.tools,
                    skills: existing.permissions.skills,
                    subagents,
                    allAccess: lt === 'admin',
                  }, {
                    isEnabled: up[`list_enabled_${lt}`] !== undefined ? isEnabled : existing.isEnabled,
                    knowledgeCategories: kCats,
                    assignmentEnabled: up[`assignment_enabled_${lt}`] === 'on',
                    assignmentPrompt: up[`assignment_prompt_${lt}`] ?? existing.assignmentPrompt,
                    disableBehavior: up[`disable_${lt}_behavior`] ?? existing.disableBehavior,
                    disableTargetList: up[`disable_${lt}_target`] ?? existing.disableTargetList,
                    unregisteredBehavior: lt === 'lead' && up['unregisteredBehavior'] ? up['unregisteredBehavior'] as 'silence' | 'generic_message' | 'register_only' | 'leads' : existing.unregisteredBehavior,
                    unregisteredMessage: lt === 'lead' && up['unregisteredMessage'] !== undefined ? up['unregisteredMessage'] : existing.unregisteredMessage,
                    maxUsers: existing.maxUsers,
                    syncConfig: syncCfg,
                  })
                }

                // Handle unregistered behavior without per-list changes
                if (up['unregisteredBehavior'] && listsToUpdate.size === 0) {
                  const leadCfg = await usersDb.getListConfig('lead')
                  if (leadCfg) {
                    await usersDb.upsertListConfig('lead', leadCfg.displayName, leadCfg.permissions, {
                      isEnabled: leadCfg.isEnabled,
                      unregisteredBehavior: up['unregisteredBehavior'] as 'silence' | 'generic_message' | 'register_only' | 'leads',
                      unregisteredMessage: up['unregisteredMessage'] ?? leadCfg.unregisteredMessage,
                      maxUsers: leadCfg.maxUsers,
                    })
                  }
                }

                await usersCache.invalidateAll()
                logger.info({ lists: [...listsToUpdate] }, 'Contact list config saved')
              }
            } catch (err) {
              logger.error({ err }, 'Failed to save user permissions')
            }
          }
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
          // Reload all module configs from fresh env + DB, then notify modules
          await registry.reloadAllModuleConfigs()
          if (Object.keys(updates).length > 0) {
            await registry.runHook('console:config_saved', { keys: Object.keys(updates) })
          }
          await registry.runHook('console:config_applied', {})
          logger.info('Config saved, reloaded and applied')
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
        const redirect = body['_redirect'] || `/console/modules?flash=toggled&lang=${lang}`
        const sep = redirect.includes('?') ? '&' : '?'
        res.writeHead(302, { Location: `${redirect}${sep}flash=toggled` })
        res.end()
        return true
      }

      // User management routes — uses users:db and users:cache from registry

      // Contact ID validation per channel
      function validateContactId(channel: string, senderId: string): boolean {
        if (!senderId) return false
        switch (channel) {
          case 'whatsapp':
          case 'twilio-voice':
            return /^\+[0-9]{7,15}$/.test(senderId)
          case 'gmail':
            return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(senderId)
          default:
            return senderId.length > 0
        }
      }

      if (localUrl === '/users/add') {
        try {
          const usersDb = registry.getOptional<import('../users/db.js').UsersDb>('users:db')
          const usersCache = registry.getOptional<import('../users/cache.js').UserCache>('users:cache')
          if (!usersDb || !usersCache) throw new Error('Users module not available')

          const displayName = body['displayName'] || null
          const listType = body['listType'] || 'lead'

          // Collect dynamic contact fields: contact_channel_0, contact_senderid_0, etc.
          const contacts: Array<{ channel: string; senderId: string }> = []
          for (let i = 0; i < 10; i++) {
            const ch = body[`contact_channel_${i}`]
            const sid = body[`contact_senderid_${i}`]?.trim()
            if (!ch || !sid) continue
            if (!validateContactId(ch, sid)) {
              logger.warn({ channel: ch, senderId: sid }, 'Invalid contact format on create, skipping')
              continue
            }
            contacts.push({ channel: ch, senderId: sid })
          }

          if (contacts.length === 0) throw new Error('At least one contact is required')
          if (!displayName?.trim()) throw new Error('Name is required')

          // Check for duplicate contacts
          for (const c of contacts) {
            const existing = await usersDb.resolveByContact(c.senderId, c.channel)
            if (existing) {
              throw new Error(`Contact ${c.senderId} (${c.channel}) already belongs to user ${existing.userId}`)
            }
          }

          // Build metadata (role for coworkers)
          const metadata: Record<string, unknown> = {}
          const userRole = body['userRole']?.trim()
          if (userRole && listType === 'coworker') metadata.role = userRole

          const user = await usersDb.createUser({ displayName: displayName || undefined, listType, contacts, metadata: Object.keys(metadata).length > 0 ? metadata : undefined })
          // Invalidate cache for all new contacts
          for (const c of contacts) await usersCache.invalidate(c.senderId)

          logger.info({ userId: user.id, listType, contacts: contacts.length }, 'User created from console')
        } catch (err) {
          logger.error({ err }, 'Failed to create user')
          const errMsg = encodeURIComponent((err as Error).message)
          res.writeHead(302, { Location: `/console/contacts/${body['listType'] || 'admin'}?flash=error&error=${errMsg}&lang=${lang}` })
          res.end()
          return true
        }
        res.writeHead(302, { Location: `/console/contacts/${body['listType'] || 'admin'}?flash=user_added&lang=${lang}` })
        res.end()
        return true
      }

      if (localUrl === '/users/update') {
        try {
          const usersDb = registry.getOptional<import('../users/db.js').UsersDb>('users:db')
          const usersCache = registry.getOptional<import('../users/cache.js').UserCache>('users:cache')
          if (!usersDb || !usersCache) throw new Error('Users module not available')

          const userId = body['userId']
          if (!userId) throw new Error('Missing userId')

          // Build metadata update (role for coworkers)
          const updateMeta: Record<string, unknown> = {}
          const lt = body['listType'] || ''
          if (lt === 'coworker' && body['userRole'] !== undefined) {
            updateMeta.role = body['userRole']?.trim() || null
          }

          // Update name + metadata
          await usersDb.updateUser(userId, {
            displayName: body['displayName'] || undefined,
            listType: lt || undefined,
            metadata: Object.keys(updateMeta).length > 0 ? updateMeta : undefined,
          })

          // Sync contacts: for each channel, update/add/remove
          const user = await usersDb.findUserById(userId)
          if (user) {
            for (let i = 0; i < 10; i++) {
              const ch = body[`contact_channel_${i}`]
              const sid = body[`contact_senderid_${i}`]?.trim()
              if (!ch) continue

              // Server-side validation
              if (sid && !validateContactId(ch, sid)) {
                logger.warn({ channel: ch, senderId: sid }, 'Invalid contact format, skipping')
                continue
              }

              const existing = user.contacts.find(c => c.channel === ch)
              if (sid && !existing) {
                // New contact for this channel
                await usersDb.addContact(userId, ch, sid)
                await usersCache.invalidate(sid)
              } else if (sid && existing && existing.senderId !== sid) {
                // Changed value — update in place
                await usersCache.invalidate(existing.senderId)
                await usersDb.updateContact(existing.id, sid)
                await usersCache.invalidate(sid)
              } else if (!sid && existing) {
                // Cleared — remove (only if not last)
                try {
                  const removed = await usersDb.removeContact(existing.id)
                  if (removed) await usersCache.invalidate(removed.senderId)
                } catch { /* can't remove last contact */ }
              }
            }
          }

          const contacts = await usersDb.getContactsForUser(userId)
          for (const c of contacts) await usersCache.invalidate(c.senderId)

          logger.info({ userId }, 'User updated from console')
        } catch (err) {
          logger.error({ err }, 'Failed to update user')
        }
        res.writeHead(302, { Location: `/console/users?flash=user_updated&lang=${lang}` })
        res.end()
        return true
      }

      if (localUrl === '/users/deactivate') {
        try {
          const usersDb = registry.getOptional<import('../users/db.js').UsersDb>('users:db')
          const usersCache = registry.getOptional<import('../users/cache.js').UserCache>('users:cache')
          if (!usersDb || !usersCache) throw new Error('Users module not available')

          const userId = body['userId']
          if (!userId) throw new Error('Missing userId')

          const user = await usersDb.findUserById(userId)
          if (user) {
            await usersDb.deactivateUser(userId)
            for (const c of user.contacts) await usersCache.invalidate(c.senderId)
          }

          logger.info({ userId }, 'User deactivated from console')
        } catch (err) {
          logger.error({ err }, 'Failed to deactivate user')
        }
        res.writeHead(302, { Location: `/console/users?flash=user_deactivated&lang=${lang}` })
        res.end()
        return true
      }

      if (localUrl === '/users/reactivate') {
        try {
          const usersDb = registry.getOptional<import('../users/db.js').UsersDb>('users:db')
          const usersCache = registry.getOptional<import('../users/cache.js').UserCache>('users:cache')
          if (!usersDb || !usersCache) throw new Error('Users module not available')

          const userId = body['userId']
          if (!userId) throw new Error('Missing userId')

          await usersDb.updateUser(userId, {})  // triggers updated_at
          // Reactivate by setting is_active = true
          await registry.getDb().query(`UPDATE users SET is_active = true, updated_at = NOW() WHERE id = $1`, [userId])
          const contacts = await usersDb.getContactsForUser(userId)
          for (const c of contacts) await usersCache.invalidate(c.senderId)

          logger.info({ userId }, 'User reactivated from console')
        } catch (err) {
          logger.error({ err }, 'Failed to reactivate user')
        }
        res.writeHead(302, { Location: `/console/users?flash=user_reactivated&lang=${lang}` })
        res.end()
        return true
      }

      if (localUrl === '/users/add-contact') {
        try {
          const usersDb = registry.getOptional<import('../users/db.js').UsersDb>('users:db')
          const usersCache = registry.getOptional<import('../users/cache.js').UserCache>('users:cache')
          if (!usersDb || !usersCache) throw new Error('Users module not available')

          const userId = body['userId']
          const channel = body['channel']
          const senderId = body['senderId']
          if (!userId || !channel || !senderId) throw new Error('Missing fields')

          await usersDb.addContact(userId, channel, senderId)
          await usersCache.invalidate(senderId)

          logger.info({ userId, channel, senderId }, 'Contact added from console')
        } catch (err) {
          logger.error({ err }, 'Failed to add contact')
        }
        res.writeHead(302, { Location: `/console/users?flash=contact_added&lang=${lang}` })
        res.end()
        return true
      }

      if (localUrl === '/users/remove-contact') {
        try {
          const usersDb = registry.getOptional<import('../users/db.js').UsersDb>('users:db')
          const usersCache = registry.getOptional<import('../users/cache.js').UserCache>('users:cache')
          if (!usersDb || !usersCache) throw new Error('Users module not available')

          const contactId = body['contactId']
          if (!contactId) throw new Error('Missing contactId')

          const removed = await usersDb.removeContact(contactId)
          if (removed) await usersCache.invalidate(removed.senderId)

          logger.info({ contactId }, 'Contact removed from console')
        } catch (err) {
          logger.error({ err }, 'Failed to remove contact')
        }
        res.writeHead(302, { Location: `/console/users?flash=contact_removed&lang=${lang}` })
        res.end()
        return true
      }

      if (localUrl === '/users/merge') {
        try {
          const usersDb = registry.getOptional<import('../users/db.js').UsersDb>('users:db')
          const usersCache = registry.getOptional<import('../users/cache.js').UserCache>('users:cache')
          if (!usersDb || !usersCache) throw new Error('Users module not available')

          const keepId = body['keepId']
          const mergeId = body['mergeId']
          if (!keepId || !mergeId) throw new Error('Missing keepId or mergeId')

          // Get all contacts before merge for cache invalidation
          const keepContacts = await usersDb.getContactsForUser(keepId)
          const mergeContacts = await usersDb.getContactsForUser(mergeId)

          await usersDb.mergeUsers(keepId, mergeId)

          for (const c of [...keepContacts, ...mergeContacts]) await usersCache.invalidate(c.senderId)

          logger.info({ keepId, mergeId }, 'Users merged from console')
        } catch (err) {
          logger.error({ err }, 'Failed to merge users')
        }
        res.writeHead(302, { Location: `/console/users?flash=users_merged&lang=${lang}` })
        res.end()
        return true
      }

      if (localUrl === '/users/create-list') {
        try {
          const usersDb = registry.getOptional<import('../users/db.js').UsersDb>('users:db')
          if (!usersDb) throw new Error('Users module not available')

          const listName = body['listName']?.trim()
          const listDescription = body['listDescription']?.trim()
          if (!listName) throw new Error('List name is required')
          if (!listDescription || listDescription.length < 80 || listDescription.length > 200) {
            throw new Error('Description must be 80-200 characters')
          }

          // Check max 5 active
          const configs = await usersDb.getAllListConfigs()
          if (configs.filter(c => c.isEnabled).length >= 5) throw new Error('Maximum 5 active lists')

          // Generate list type from name (kebab-case)
          const listType = listName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
          if (configs.find(c => c.listType === listType)) throw new Error('A list with this name already exists')

          await usersDb.upsertListConfig(listType, listName, { tools: [], skills: [], subagents: false, allAccess: false }, {
            isEnabled: true,
            description: listDescription,
          })

          logger.info({ listType, listName }, 'Custom contact list created')
        } catch (err) {
          logger.error({ err }, 'Failed to create custom list')
        }
        res.writeHead(302, { Location: `/console/contacts?lang=${lang}` })
        res.end()
        return true
      }

      if (localUrl === '/users/toggle-list') {
        try {
          const usersDb = registry.getOptional<import('../users/db.js').UsersDb>('users:db')
          const usersCache = registry.getOptional<import('../users/cache.js').UserCache>('users:cache')
          if (!usersDb || !usersCache) throw new Error('Users module not available')

          const listType = body['listType']
          const isEnabled = body['enabled'] === 'true'
          const disableBehavior = body['disableBehavior'] as 'leads' | 'silence' | 'move' | undefined
          const disableTarget = body['disableTarget'] as string | undefined
          if (!listType) throw new Error('Missing listType')

          const existing = await usersDb.getListConfig(listType)
          if (existing) {
            await usersDb.upsertListConfig(listType, existing.displayName, existing.permissions, {
              isEnabled,
              ...(disableBehavior ? { disableBehavior } : {}),
              ...(disableTarget ? { disableTargetList: disableTarget } : {}),
            })
            await usersCache.invalidateAll()
            logger.info({ listType, isEnabled }, 'Contact list toggled')
          }
        } catch (err) {
          logger.error({ err }, 'Failed to toggle contact list')
        }
        const redirect = body['_redirect'] || `/console/contacts?page=config&lang=${lang}`
        res.writeHead(302, { Location: redirect })
        res.end()
        return true
      }

      if (localUrl === '/users/delete-list') {
        try {
          const usersDb = registry.getOptional<import('../users/db.js').UsersDb>('users:db')
          const usersCache = registry.getOptional<import('../users/cache.js').UserCache>('users:cache')
          if (!usersDb || !usersCache) throw new Error('Users module not available')

          const listType = body['listType']
          if (!listType) throw new Error('Missing listType')

          await usersDb.deleteListConfig(listType)
          await usersCache.invalidateAll()

          logger.info({ listType }, 'Custom contact list deleted')
        } catch (err) {
          logger.error({ err }, 'Failed to delete custom list')
        }
        res.writeHead(302, { Location: `/console/contacts?lang=${lang}` })
        res.end()
        return true
      }

      if (localUrl === '/users/config') {
        try {
          const usersDb = registry.getOptional<import('../users/db.js').UsersDb>('users:db')
          const usersCache = registry.getOptional<import('../users/cache.js').UserCache>('users:cache')
          if (!usersDb || !usersCache) throw new Error('Users module not available')

          const listType = body['listType']
          if (!listType) throw new Error('Missing listType')

          const config = await usersDb.getListConfig(listType)
          const displayName = body['displayName'] || config?.displayName || listType

          // Parse tools from form: perm_tool_xxx = 'on' checkboxes
          const tools: string[] = []
          const skills: string[] = []
          for (const [key, value] of Object.entries(body)) {
            if (key.startsWith('perm_tool_') && value === 'on') {
              tools.push(key.replace('perm_tool_', ''))
            }
            if (key.startsWith('perm_skill_') && value === 'on') {
              skills.push(key.replace('perm_skill_', ''))
            }
          }

          // Check for "all" wildcard
          if (body['perm_tools_all'] === 'on') tools.splice(0, tools.length, '*')
          if (body['perm_skills_all'] === 'on') skills.splice(0, skills.length, '*')

          const permissions = {
            tools,
            skills,
            subagents: body['perm_subagents'] === 'on',
            allAccess: listType === 'admin',
          }

          await usersDb.upsertListConfig(listType, displayName, permissions, {
            isEnabled: body['isEnabled'] !== 'false',
            unregisteredBehavior: (body['unregisteredBehavior'] || 'silence') as any,
            unregisteredMessage: body['unregisteredMessage'] || null,
            maxUsers: body['maxUsers'] ? parseInt(body['maxUsers'], 10) : config?.maxUsers ?? null,
          })

          await usersCache.invalidateAll()

          logger.info({ listType }, 'User list config updated from console')
        } catch (err) {
          logger.error({ err }, 'Failed to update user list config')
        }
        res.writeHead(302, { Location: `/console/users?flash=config_saved&lang=${lang}` })
        res.end()
        return true
      }
    }

    // 4. GET pages — SSR
    if (req.method === 'GET') {
      // Strip query string for path matching
      const pathOnly = localUrl.split('?')[0]!

      let section = pathOnly.replace(/^\//, '')

      // /console (root) renders dashboard directly
      if (section === '' || section === '/') {
        section = 'dashboard'
      }

      // Nested channel settings: /console/channels/{channelId} → render channel section inside channels layout
      let channelSettingsId: string | null = null
      const channelMatch = section.match(/^channels\/(.+)$/)
      if (channelMatch?.[1]) {
        channelSettingsId = channelMatch[1]
        // Map channel ID to its section renderer ID
        const channelSectionMap: Record<string, string> = {
          'whatsapp': 'whatsapp',
          'gmail': 'email',
          'google-chat': 'google-chat',
          'twilio-voice': 'twilio-voice',
          'ack-messages': 'ack-messages',
        }
        section = channelSectionMap[channelSettingsId] ?? channelSettingsId
      }

      // Nested contacts: /console/contacts/{subpage} → render contacts section with subpage
      let contactsSubpage: string | null = null
      const contactsMatch = section.match(/^contacts\/(.+)$/)
      if (contactsMatch?.[1]) {
        contactsSubpage = contactsMatch[1]
        section = 'contacts'
      }
      // /console/contacts without subpage → show config page
      if (section === 'contacts' && !contactsSubpage) {
        contactsSubpage = 'config'
      }
      // Nested agente: /console/agente/{subpage} → render agente section with subpage
      let agenteSubpage: string | null = null
      const agenteMatch = section.match(/^agente\/(.+)$/)
      if (agenteMatch?.[1]) {
        agenteSubpage = agenteMatch[1]
        section = 'agente'
      }
      // /console/agente without subpage → default to knowledge
      if (section === 'agente' && !agenteSubpage) {
        agenteSubpage = 'knowledge'
      }

      // Redirect old section IDs to unified agente page
      const agenteRedirects: Record<string, string> = {
        llm: 'advanced', pipeline: 'advanced', infra: 'advanced',
        knowledge: 'knowledge', memory: 'memory', prompts: 'identity',
      }
      if (agenteRedirects[section]) {
        const lang = detectLang(req)
        res.writeHead(302, { Location: `/console/agente/${agenteRedirects[section]}?lang=${lang}` })
        res.end()
        return true
      }

      // Nested herramientas: /console/herramientas/{subpage}
      let herramientasSubpage: string | null = null
      const herramientasMatch = section.match(/^herramientas\/(.+)$/)
      if (herramientasMatch?.[1]) {
        herramientasSubpage = herramientasMatch[1]
        section = 'herramientas'
      }
      // /console/herramientas without subpage → default to tools
      if (section === 'herramientas' && !herramientasSubpage) {
        herramientasSubpage = 'tools'
      }

      // Redirect old section IDs to unified herramientas page
      const herramientasRedirects: Record<string, string> = {
        'tools': 'tools', 'lead-scoring': 'lead-scoring', 'freight': 'freight',
        'medilink': 'medilink', 'scheduled-tasks': 'scheduled-tasks', 'google-apps': 'google-apps',
      }
      if (herramientasRedirects[section]) {
        const lang = detectLang(req)
        res.writeHead(302, { Location: `/console/herramientas/${herramientasRedirects[section]}?lang=${lang}` })
        res.end()
        return true
      }

      // Redirect old /console/users to /console/contacts
      if (section === 'users') {
        const lang = detectLang(req)
        res.writeHead(302, { Location: `/console/contacts/admin?lang=${lang}` })
        res.end()
        return true
      }

      // Redirect old section IDs to unified pages (skip if already a nested channel route)
      const redirectTo = !channelSettingsId ? SECTION_REDIRECTS[section] : undefined
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
        googleChatConnected: data.googleChatConnected,
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

      // Lead scoring: render inline via module service
      if (section === 'lead-scoring') {
        try {
          const renderFn = registry.getOptional<(lang: string) => string>('lead-scoring:renderSection')
          if (renderFn) {
            sectionData.leadScoringHtml = renderFn(lang)
          }
        } catch { /* module not available */ }
      }

      // Contacts: fetch data from users module service
      if (section === 'contacts') {
        try {
          const dataFn = registry.getOptional<() => Promise<unknown>>('users:sectionData')
          if (dataFn) {
            sectionData.usersData = await dataFn() as typeof sectionData.usersData
            sectionData.contactsSubpage = contactsSubpage ?? undefined
          }
        } catch { /* module not available */ }
      }

      // Agente unified page: render sub-page content
      if (section === 'agente' && agenteSubpage) {
        sectionData.agenteSubpage = agenteSubpage
        // Map sub-pages to their actual section renderers
        if (agenteSubpage === 'advanced') {
          // Combine LLM + Pipeline + Engine + Infra with dividers
          const llmHtml = renderSection('llm', sectionData) || ''
          const pipelineHtml = renderSection('pipeline', sectionData) || ''
          const engineMod = data.moduleStates.find(m => m.name === 'engine')
          const engineHtml = engineMod?.active && engineMod.console?.fields?.length
            ? renderModulePanels([engineMod], data.config, lang, 'engine')
            : ''
          const infraHtml = renderSection('infra', sectionData) || ''
          sectionData.agenteContent = llmHtml + pipelineHtml + engineHtml + infraHtml
        } else if (agenteSubpage === 'knowledge') {
          const knowledgeMod = data.moduleStates.find(m => m.name === 'knowledge')
          sectionData.agenteContent = knowledgeMod?.active && knowledgeMod.console?.fields?.length
            ? renderModulePanels([knowledgeMod], data.config, lang, 'knowledge')
            : `<div class="panel"><div class="panel-body"><p>${lang === 'es' ? 'Modulo de conocimiento no disponible.' : 'Knowledge module not available.'}</p></div></div>`
        } else if (agenteSubpage === 'memory') {
          const memoryMod = data.moduleStates.find(m => m.name === 'memory')
          sectionData.agenteContent = memoryMod?.active && memoryMod.console?.fields?.length
            ? renderModulePanels([memoryMod], data.config, lang, 'memory')
            : `<div class="panel"><div class="panel-body"><p>${lang === 'es' ? 'Modulo de memoria no disponible.' : 'Memory module not available.'}</p></div></div>`
        } else if (agenteSubpage === 'identity') {
          const promptsMod = data.moduleStates.find(m => m.name === 'prompts')
          sectionData.agenteContent = promptsMod?.active && promptsMod.console?.fields?.length
            ? renderModulePanels([promptsMod], data.config, lang, 'prompts')
            : `<div class="panel"><div class="panel-body"><p>${lang === 'es' ? 'Modulo de prompts no disponible.' : 'Prompts module not available.'}</p></div></div>`
        }
      }

      // Herramientas unified page: render sub-page content
      if (section === 'herramientas' && herramientasSubpage) {
        sectionData.herramientasSubpage = herramientasSubpage
        const notAvailable = (name: string) => `<div class="panel"><div class="panel-body"><p>${lang === 'es' ? `Modulo de ${name} no disponible.` : `${name} module not available.`}</p></div></div>`

        if (herramientasSubpage === 'tools') {
          const toolsMod = data.moduleStates.find(m => m.name === 'tools')
          sectionData.herramientasContent = toolsMod?.active && toolsMod.console?.fields?.length
            ? renderModulePanels([toolsMod], data.config, lang, 'tools')
            : notAvailable('herramientas')
        } else if (herramientasSubpage === 'lead-scoring') {
          // Use lead-scoring's custom renderer if available
          try {
            const renderFn = registry.getOptional<(lang: string) => string>('lead-scoring:renderSection')
            if (renderFn) {
              sectionData.herramientasContent = renderFn(lang)
            }
          } catch { /* ignore */ }
          if (!sectionData.herramientasContent) {
            sectionData.herramientasContent = notAvailable('calificacion')
          }
        } else if (herramientasSubpage === 'freight') {
          const freightMod = data.moduleStates.find(m => m.name === 'freight')
          sectionData.herramientasContent = freightMod?.active && freightMod.console?.fields?.length
            ? renderModulePanels([freightMod], data.config, lang, 'freight')
            : notAvailable('flete')
        } else if (herramientasSubpage === 'medilink') {
          const medilinkMod = data.moduleStates.find(m => m.name === 'medilink')
          sectionData.herramientasContent = medilinkMod?.active && medilinkMod.console?.fields?.length
            ? renderModulePanels([medilinkMod], data.config, lang, 'medilink')
            : notAvailable('medilink')
        } else if (herramientasSubpage === 'scheduled-tasks') {
          try {
            const renderFn = registry.getOptional<(lang: string) => Promise<string>>('scheduled-tasks:renderSection')
            if (renderFn) {
              sectionData.herramientasContent = await renderFn(lang)
            }
          } catch { /* ignore */ }
          if (!sectionData.herramientasContent) {
            sectionData.herramientasContent = notAvailable('tareas programadas')
          }
        } else if (herramientasSubpage === 'google-apps') {
          sectionData.herramientasContent = renderSection('google-apps', sectionData) || notAvailable('Google API')
        }
      }

      // Channel settings pages: use the 2-column channel settings renderer
      let content: string | null = null
      if (channelSettingsId === 'ack-messages') {
        content = renderAckMessagesPage(lang)
      } else if (channelSettingsId) {
        const chMod = data.moduleStates.find(m => m.name === channelSettingsId)
        if (chMod && chMod.type === 'channel') {
          content = renderChannelSettingsPage(chMod, sectionData)
        }
      }

      // Try custom section renderer, then fall back to dynamic module rendering
      if (!content) {
        content = renderSection(section, sectionData)
      }

      if (!content) {
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

      // For nested channel settings, set section to 'channels' for sidebar highlighting
      // and keep the original section for content rendering
      const sidebarSection = channelSettingsId ? 'channels' : section

      // Build channel list for sidebar submenu
      const channelModules: SidebarChannelInfo[] = []
      for (const mod of data.moduleStates) {
        if (mod.type !== 'channel' || !mod.active) continue
        let chStatus: SidebarChannelInfo['status'] = 'disconnected'
        if (mod.name === 'whatsapp' && data.waConnected) chStatus = 'connected'
        else if (mod.name === 'gmail' && data.gmailConnected) chStatus = 'connected'
        else if (mod.name === 'google-chat' && data.googleChatConnected) chStatus = 'connected'
        // For others, default to disconnected (status checked client-side)
        const chTitle = mod.console?.title?.[lang] ?? mod.name
        channelModules.push({ id: mod.name, name: chTitle, status: chStatus })
      }

      // Get channel display name from manifest for breadcrumb/title
      const channelDisplayName = channelSettingsId
        ? data.moduleStates.find(m => m.name === channelSettingsId)?.console?.title?.[lang] ?? channelSettingsId
        : undefined

      // Build contacts submenu data (always load for sidebar, even on non-contacts pages)
      let contactLists: Array<{ listType: string; displayName: string; count: number; isEnabled?: boolean }> = []
      if (sectionData.usersData) {
        contactLists = sectionData.usersData.configs.map(c => ({
          listType: c.listType,
          displayName: c.displayName,
          count: sectionData.usersData?.counts?.[c.listType] ?? 0,
          isEnabled: c.isEnabled,
        }))
      } else {
        // Fetch minimal list data for sidebar even when not on contacts page
        try {
          const dataFn = registry.getOptional<() => Promise<unknown>>('users:sectionData')
          if (dataFn) {
            const ud = await dataFn() as Record<string, unknown>
            if (ud) {
              const configs = (ud.configs ?? []) as Array<{ listType: string; displayName: string; isEnabled: boolean }>
              const counts = (ud.counts ?? {}) as Record<string, number>
              contactLists = configs.map(c => ({
                listType: c.listType,
                displayName: c.displayName,
                count: counts[c.listType] ?? 0,
                isEnabled: c.isEnabled,
              }))
            }
          }
        } catch { /* users module not available */ }
      }

      const html = pageLayout({
        section: sidebarSection,
        content,
        lang,
        channelSettingsId: channelSettingsId ?? undefined,
        channelDisplayName,
        version: data.version,
        flash,
        waConnected: data.waConnected,
        gmailConnected: data.gmailConnected,
        googleAppsConnected: data.googleAppsConnected,
        dynamicModules: data.dynamicModules,
        channelModules,
        testMode: data.config.ENGINE_TEST_MODE === 'true',
        debugCacheEnabled: data.config.DEBUG_CACHE_ENABLED !== 'false',
        debugExtremeLog: data.config.DEBUG_EXTREME_LOG === 'true',
        debugAdminOnly: data.config.DEBUG_ADMIN_ONLY !== 'false',
        contactsSubpage: contactsSubpage ?? undefined,
        contactLists,
        agenteSubpage: agenteSubpage ?? undefined,
        herramientasSubpage: herramientasSubpage ?? undefined,
      })
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(html)
      return true
    }

    return false
  }
}

/**
 * Render the ACK Messages management page (subtab under Canales)
 */
function renderAckMessagesPage(lang: string): string {
  const isEs = lang === 'es'
  const title = isEs ? 'Mensajes ACK' : 'ACK Messages'
  const desc = isEs
    ? 'Mensajes de reconocimiento que se envían mientras el agente procesa una respuesta. Se usan como respaldo cuando el LLM ACK no está disponible.'
    : 'Acknowledgment messages sent while the agent processes a response. Used as fallback when LLM ACK is unavailable.'
  const channelLabel = isEs ? 'Canal' : 'Channel'
  const textLabel = isEs ? 'Mensaje' : 'Message'
  const activeLabel = isEs ? 'Activo' : 'Active'
  const addLabel = isEs ? 'Agregar mensaje' : 'Add message'
  const saveLabel = isEs ? 'Guardar' : 'Save'
  const deleteLabel = isEs ? 'Eliminar' : 'Delete'
  const allChannels = isEs ? 'Todos los canales' : 'All channels'
  const filterLabel = isEs ? 'Filtrar por canal' : 'Filter by channel'
  const emptyLabel = isEs ? 'No hay mensajes ACK configurados.' : 'No ACK messages configured.'

  return `
    <div class="chs-desc">${desc}</div>
    <div class="panel">
      <div class="panel-header" onclick="togglePanel(this)">
        <span class="panel-title">${title}</span>
        <span class="panel-chevron">&#9660;</span>
      </div>
      <div class="panel-body">
        <div style="display:flex;gap:12px;align-items:center;margin-bottom:16px;flex-wrap:wrap">
          <label style="font-size:13px;color:var(--on-surface-dim)">${filterLabel}:</label>
          <select id="ack-channel-filter" class="js-custom-select" style="min-width:150px" onchange="ackLoadMessages()">
            <option value="">${allChannels}</option>
            <option value="whatsapp">WhatsApp</option>
            <option value="email">Email</option>
            <option value="google-chat">Google Chat</option>
          </select>
          <button class="ch-btn-action ch-btn-connect" onclick="ackAddRow()" style="margin-left:auto">${addLabel}</button>
        </div>
        <table class="ack-table" style="width:100%;border-collapse:collapse">
          <thead>
            <tr style="text-align:left;border-bottom:1px solid var(--outline)">
              <th style="padding:8px;width:130px">${channelLabel}</th>
              <th style="padding:8px">${textLabel}</th>
              <th style="padding:8px;width:70px;text-align:center">${activeLabel}</th>
              <th style="padding:8px;width:80px"></th>
            </tr>
          </thead>
          <tbody id="ack-tbody"></tbody>
        </table>
        <div id="ack-empty" style="display:none;text-align:center;padding:24px;color:var(--on-surface-dim)">${emptyLabel}</div>
      </div>
    </div>
    <script>
    (function(){
      var allCh = '${allChannels}';
      var saveL = '${saveLabel}';
      var delL = '${deleteLabel}';

      window.ackLoadMessages = function() {
        var ch = document.getElementById('ack-channel-filter').value;
        var url = '/console/api/console/ack-messages' + (ch ? '?channel='+ch : '');
        fetch(url).then(function(r){return r.json()}).then(function(d){
          var tbody = document.getElementById('ack-tbody');
          var empty = document.getElementById('ack-empty');
          if (!d.messages || d.messages.length === 0) {
            tbody.innerHTML = '';
            empty.style.display = 'block';
            return;
          }
          empty.style.display = 'none';
          tbody.innerHTML = d.messages.map(function(m){
            return '<tr data-id="'+m.id+'" style="border-bottom:1px solid var(--outline-variant)">'
              +'<td style="padding:8px"><select class="ack-ch js-custom-select" style="width:120px">'
              +'<option value=""'+(m.channel===''?' selected':'')+'>'+allCh+'</option>'
              +'<option value="whatsapp"'+(m.channel==='whatsapp'?' selected':'')+'>WhatsApp</option>'
              +'<option value="email"'+(m.channel==='email'?' selected':'')+'>Email</option>'
              +'<option value="google-chat"'+(m.channel==='google-chat'?' selected':'')+'>Google Chat</option>'
              +'</select></td>'
              +'<td style="padding:8px"><input type="text" class="ack-text" value="'+m.text.replace(/"/g,'&quot;')+'" style="width:100%;padding:6px 8px;border:1px solid var(--outline);border-radius:6px;background:var(--surface);color:var(--on-surface)"></td>'
              +'<td style="padding:8px;text-align:center"><label class="toggle toggle-sm"><input type="checkbox" class="ack-active"'+(m.active?' checked':'')+' onchange="ackSave(this)"><span class="toggle-slider"></span></label></td>'
              +'<td style="padding:8px;display:flex;gap:4px">'
              +'<button class="ch-btn-action" onclick="ackSave(this)" style="font-size:12px;padding:4px 10px">'+saveL+'</button>'
              +'<button class="ch-btn-action ch-btn-disconnect" onclick="ackDelete(this)" style="font-size:12px;padding:4px 10px">'+delL+'</button>'
              +'</td></tr>';
          }).join('');
        }).catch(function(){});
      };

      window.ackAddRow = function() {
        var ch = document.getElementById('ack-channel-filter').value || '';
        fetch('/console/api/console/ack-messages', {
          method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({channel:ch, text:'Nuevo mensaje...'})
        }).then(function(){ackLoadMessages()});
      };

      window.ackSave = function(el) {
        var tr = el.closest('tr');
        var id = tr.getAttribute('data-id');
        var ch = tr.querySelector('.ack-ch').value;
        var text = tr.querySelector('.ack-text').value;
        var active = tr.querySelector('.ack-active').checked;
        fetch('/console/api/console/ack-messages/'+id, {
          method:'PUT', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({channel:ch, text:text, active:active})
        }).then(function(r){
          if(r.ok) { tr.style.background='var(--success-container)'; setTimeout(function(){tr.style.background='';},600); }
        });
      };

      window.ackDelete = function(el) {
        var tr = el.closest('tr');
        var id = tr.getAttribute('data-id');
        fetch('/console/api/console/ack-messages/'+id, {method:'DELETE'}).then(function(){ackLoadMessages()});
      };

      ackLoadMessages();
    })();
    </script>`
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
            const reg = getRegistryRef()
            if (reg) {
              await configStore.setMultiple(reg.getDb(), updates)
              await reg.runHook('console:config_saved', { keys: Object.keys(updates) })
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
          const { getRegistryRef } = await import('./manifest-ref.js')
          const reg = getRegistryRef()
          if (reg) {
            await reg.reloadAllModuleConfigs()
            await reg.runHook('console:config_applied', {})
          }
          logger.info('Config hot-reloaded and applied')
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

    // POST /console/api/console/clear-cache — flush Redis (test mode only)
    {
      method: 'POST',
      path: 'clear-cache',
      handler: async (_req, res) => {
        try {
          const { getRegistryRef } = await import('./manifest-ref.js')
          const registry = getRegistryRef()
          if (!registry) { jsonResponse(res, 500, { error: 'Registry not available' }); return }
          const config = await (await import('./manifest-ref.js')).getRegistryRef()?.getOptional?.('config:store')
          // Gate behind test mode
          const db = registry.getDb()
          const tmResult = await db.query(`SELECT value FROM config_store WHERE key = 'ENGINE_TEST_MODE'`)
          if (tmResult.rows[0]?.value !== 'true') { jsonResponse(res, 403, { error: 'Test mode not active' }); return }

          await registry.getRedis().flushdb()
          logger.info('Redis cache flushed (debug panel)')
          jsonResponse(res, 200, { ok: true })
        } catch (err) {
          logger.error({ err }, 'Failed to clear cache')
          jsonResponse(res, 500, { error: String(err) })
        }
      },
    },

    // POST /console/api/console/clear-memory — truncate all except config + users (test mode only)
    {
      method: 'POST',
      path: 'clear-memory',
      handler: async (_req, res) => {
        try {
          const { getRegistryRef } = await import('./manifest-ref.js')
          const registry = getRegistryRef()
          if (!registry) { jsonResponse(res, 500, { error: 'Registry not available' }); return }
          const db = registry.getDb()
          const tmResult = await db.query(`SELECT value FROM config_store WHERE key = 'ENGINE_TEST_MODE'`)
          if (tmResult.rows[0]?.value !== 'true') { jsonResponse(res, 403, { error: 'Test mode not active' }); return }

          const tables = [
            'messages', 'sessions', 'session_summaries', 'commitments', 'conversation_archives',
            'pipeline_logs', 'daily_reports', 'ack_messages',
            'contacts', 'contact_channels', 'agent_contacts', 'companies',
            'attachment_extractions',
            'tools', 'tool_access_rules', 'tool_executions',
            'prompt_slots', 'campaigns',
            'llm_usage', 'llm_daily_stats',
            'knowledge_documents', 'knowledge_document_categories', 'knowledge_chunks',
            'knowledge_faqs', 'knowledge_sync_sources', 'knowledge_gaps',
            'knowledge_api_connectors', 'knowledge_web_sources', 'knowledge_categories',
            'scheduled_tasks', 'scheduled_task_executions',
            'voice_calls', 'voice_call_transcripts',
            'email_state', 'email_threads',
            'google_chat_spaces',
          ]
          for (const t of tables) {
            try { await db.query(`TRUNCATE ${t} CASCADE`) } catch { /* table may not exist */ }
          }
          await registry.getRedis().flushdb()
          logger.info('All memory cleared (debug panel) — config_store, users preserved')
          jsonResponse(res, 200, { ok: true })
        } catch (err) {
          logger.error({ err }, 'Failed to clear memory')
          jsonResponse(res, 500, { error: String(err) })
        }
      },
    },

    // POST /console/api/console/factory-reset — verify admin password, prefill wizard, mark SETUP_COMPLETED=false
    {
      method: 'POST',
      path: 'factory-reset',
      handler: async (req, res) => {
        try {
          const { getRegistryRef } = await import('./manifest-ref.js')
          const registry = getRegistryRef()
          if (!registry) { jsonResponse(res, 500, { error: 'Registry not available' }); return }
          const db = registry.getDb()
          const redis = registry.getRedis()

          // Parse password from body
          const body = await parseBody<{ password?: string }>(req)
          const password = body?.password?.trim() ?? ''
          if (!password) { jsonResponse(res, 400, { error: 'Password required' }); return }

          // Get current user from session
          const { getSessionToken, validateSession, getCredentials, verifyPassword } = await import('../../kernel/setup/auth.js')
          const token = getSessionToken(req.headers['cookie'])
          const userId = token ? await validateSession(redis, token) : null
          if (!userId) { jsonResponse(res, 401, { error: 'Unauthorized' }); return }

          // Verify password
          const storedHash = await getCredentials(db, userId)
          if (!storedHash || !await verifyPassword(password, storedHash)) {
            jsonResponse(res, 403, { error: 'Invalid password' })
            return
          }

          // Save current config as prefill for wizard
          const { saveFactoryResetPrefill } = await import('../../kernel/setup/handler.js')
          const prefillToken = await saveFactoryResetPrefill(db, redis)

          // Mark setup as not completed
          await configStore.set(db, 'SETUP_COMPLETED', 'false')

          // Activate the setup wizard on the running server
          const server = registry.getOptional<import('../../kernel/server.js').Server>('kernel:server')
          if (server) server.activateSetupWizard()

          logger.info({ userId }, 'Factory reset initiated — wizard activated')
          jsonResponse(res, 200, { ok: true, prefillToken })
        } catch (err) {
          logger.error({ err }, 'Failed to initiate factory reset')
          jsonResponse(res, 500, { error: 'Internal server error' })
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

    // ── ACK Messages CRUD ──

    // GET /console/api/console/ack-messages?channel=whatsapp
    {
      method: 'GET',
      path: 'ack-messages',
      handler: async (req, res) => {
        try {
          const { getRegistryRef } = await import('./manifest-ref.js')
          const registry = getRegistryRef()
          if (!registry) { jsonResponse(res, 500, { error: 'Registry not available' }); return }

          const query = parseQuery(req)
          const channel = query.get('channel')
          const db = registry.getDb()

          let result
          if (channel) {
            result = await db.query(
              `SELECT id, channel, text, active, sort_order, created_at, updated_at FROM ack_messages WHERE channel = $1 ORDER BY sort_order, created_at`,
              [channel],
            )
          } else {
            result = await db.query(
              `SELECT id, channel, text, active, sort_order, created_at, updated_at FROM ack_messages ORDER BY channel, sort_order, created_at`,
            )
          }
          jsonResponse(res, 200, { messages: result.rows })
        } catch (err) {
          logger.warn({ err }, 'Failed to fetch ack messages')
          jsonResponse(res, 200, { messages: [] })
        }
      },
    },

    // POST /console/api/console/ack-messages
    {
      method: 'POST',
      path: 'ack-messages',
      handler: async (req, res) => {
        try {
          const { getRegistryRef } = await import('./manifest-ref.js')
          const registry = getRegistryRef()
          if (!registry) { jsonResponse(res, 500, { error: 'Registry not available' }); return }

          const body = await parseBody<{ channel?: string; text: string; sort_order?: number }>(req)
          if (!body?.text) { jsonResponse(res, 400, { error: 'text is required' }); return }

          const db = registry.getDb()
          const result = await db.query(
            `INSERT INTO ack_messages (channel, text, sort_order) VALUES ($1, $2, $3) RETURNING id, channel, text, active, sort_order, created_at`,
            [body.channel ?? '', body.text, body.sort_order ?? 0],
          )
          jsonResponse(res, 201, { message: result.rows[0] })
        } catch (err) {
          logger.error({ err }, 'Failed to create ack message')
          jsonResponse(res, 500, { error: 'Failed to create' })
        }
      },
    },

    // PUT /console/api/console/ack-messages/:id
    {
      method: 'PUT',
      path: 'ack-messages',
      handler: async (req, res) => {
        try {
          const { getRegistryRef } = await import('./manifest-ref.js')
          const registry = getRegistryRef()
          if (!registry) { jsonResponse(res, 500, { error: 'Registry not available' }); return }

          // Extract ID from URL path: /console/api/console/ack-messages/{id}
          const url = req.url ?? ''
          const idMatch = url.match(/ack-messages\/([^?/]+)/)
          const id = idMatch?.[1]
          if (!id) { jsonResponse(res, 400, { error: 'Missing id' }); return }

          const body = await parseBody<{ channel?: string; text?: string; active?: boolean; sort_order?: number }>(req)
          if (!body) { jsonResponse(res, 400, { error: 'Invalid body' }); return }

          const db = registry.getDb()
          const sets: string[] = []
          const vals: unknown[] = []
          let idx = 1

          if (body.text !== undefined) { sets.push(`text = $${idx++}`); vals.push(body.text) }
          if (body.channel !== undefined) { sets.push(`channel = $${idx++}`); vals.push(body.channel) }
          if (body.active !== undefined) { sets.push(`active = $${idx++}`); vals.push(body.active) }
          if (body.sort_order !== undefined) { sets.push(`sort_order = $${idx++}`); vals.push(body.sort_order) }
          sets.push(`updated_at = now()`)

          if (sets.length <= 1) { jsonResponse(res, 400, { error: 'Nothing to update' }); return }

          vals.push(id)
          const result = await db.query(
            `UPDATE ack_messages SET ${sets.join(', ')} WHERE id = $${idx} RETURNING id, channel, text, active, sort_order, updated_at`,
            vals,
          )
          if (result.rows.length === 0) { jsonResponse(res, 404, { error: 'Not found' }); return }
          jsonResponse(res, 200, { message: result.rows[0] })
        } catch (err) {
          logger.error({ err }, 'Failed to update ack message')
          jsonResponse(res, 500, { error: 'Failed to update' })
        }
      },
    },

    // DELETE /console/api/console/ack-messages/:id
    {
      method: 'DELETE',
      path: 'ack-messages',
      handler: async (req, res) => {
        try {
          const { getRegistryRef } = await import('./manifest-ref.js')
          const registry = getRegistryRef()
          if (!registry) { jsonResponse(res, 500, { error: 'Registry not available' }); return }

          const url = req.url ?? ''
          const idMatch = url.match(/ack-messages\/([^?/]+)/)
          const id = idMatch?.[1]
          if (!id) { jsonResponse(res, 400, { error: 'Missing id' }); return }

          const db = registry.getDb()
          const result = await db.query(`DELETE FROM ack_messages WHERE id = $1 RETURNING id`, [id])
          if (result.rows.length === 0) { jsonResponse(res, 404, { error: 'Not found' }); return }
          jsonResponse(res, 200, { ok: true })
        } catch (err) {
          logger.error({ err }, 'Failed to delete ack message')
          jsonResponse(res, 500, { error: 'Failed to delete' })
        }
      },
    },

    // GET /console/api/console/channel-metrics?channel=whatsapp&period=30d
    {
      method: 'GET',
      path: 'channel-metrics',
      handler: async (req, res) => {
        try {
          const { getRegistryRef } = await import('./manifest-ref.js')
          const registry = getRegistryRef()
          if (!registry) {
            jsonResponse(res, 500, { error: 'Registry not available' })
            return
          }

          const query = parseQuery(req)
          const channel = query.get('channel') || ''
          const period = query.get('period') || '30d'
          const chType = query.get('type') || 'instant'

          const db = registry.getDb()

          // Build WHERE clause for time filtering
          const truncMap: Record<string, string> = {
            'today': 'day', 'this_week': 'week', 'this_month': 'month',
            'this_quarter': 'quarter', 'this_half': 'quarter', 'this_year': 'year',
          }
          const intervalMap: Record<string, string> = {
            '1h': '1 hour', '24h': '24 hours', '7d': '7 days', '30d': '30 days',
            '90d': '90 days', '180d': '180 days', '365d': '365 days',
          }
          let whereTime: string
          if (truncMap[period]) {
            const unit = period === 'this_half' ? `date_trunc('month', now()) - interval '5 months'` : `date_trunc('${truncMap[period]}', now())`
            whereTime = `created_at >= ${unit}`
          } else {
            const interval = intervalMap[period] ?? '30 days'
            whereTime = `created_at > now() - '${interval}'::interval`
          }

          // Standardized 4 metrics for ALL channel types: active, inbound, outbound, avg_duration_s
          // Active sessions with activity in last 24h
          const activeRes = await db.query(
            `SELECT COUNT(*)::int AS active FROM sessions WHERE channel_name = $1 AND last_activity_at > now() - interval '24 hours'`,
            [channel],
          )

          // Inbound (client-initiated) in period
          const inRes = await db.query(
            `SELECT COUNT(DISTINCT session_id)::int AS inbound FROM messages WHERE channel_name = $1 AND sender_type = 'user' AND ${whereTime} AND session_id IN (SELECT id FROM sessions WHERE channel_name = $1 AND ${whereTime.replace(/created_at/g, 'started_at')})`,
            [channel],
          )

          // Outbound (agent-initiated) in period
          const outRes = await db.query(
            `SELECT COUNT(DISTINCT session_id)::int AS outbound FROM messages WHERE channel_name = $1 AND sender_type = 'agent' AND ${whereTime} AND session_id IN (SELECT id FROM sessions WHERE channel_name = $1 AND ${whereTime.replace(/created_at/g, 'started_at')})`,
            [channel],
          )

          // Avg session/call duration in period
          const durRes = await db.query(
            `SELECT ROUND(AVG(EXTRACT(EPOCH FROM (last_activity_at - started_at))))::int AS avg_duration_s FROM sessions WHERE channel_name = $1 AND ${whereTime.replace(/created_at/g, 'started_at')} AND last_activity_at > started_at`,
            [channel],
          )

          jsonResponse(res, 200, {
            channel, period, type: chType,
            active: activeRes.rows[0]?.active ?? 0,
            inbound: inRes.rows[0]?.inbound ?? 0,
            outbound: outRes.rows[0]?.outbound ?? 0,
            avg_duration_s: durRes.rows[0]?.avg_duration_s ?? 0,
          })
        } catch (err) {
          // Tables may not exist yet — return zeros gracefully
          logger.warn({ err, channel: parseQuery(req).get('channel') }, 'Channel metrics query failed (tables may not exist)')
          const fallbackType = parseQuery(req).get('type') || 'instant'
          jsonResponse(res, 200, { channel: '', period: '30d', type: fallbackType, active: 0, inbound: 0, outbound: 0, avg_duration_s: 0 })
        }
      },
    },
  ]
}
