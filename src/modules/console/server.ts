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
          // Route perm_* and unregisteredBehavior fields to users module
          if (k.startsWith('perm_') || k === 'unregisteredBehavior' || k === 'unregisteredMessage') {
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
                // Group perm fields by list type: perm_{listType}_tool_{name}, perm_{listType}_subagents, etc.
                const listUpdates = new Map<string, { tools: string[]; skills: string[]; subagents: boolean }>()

                for (const [k, v] of Object.entries(userPermUpdates)) {
                  const toolMatch = k.match(/^perm_(.+)_tool_(.+)$/)
                  if (toolMatch) {
                    const lt = toolMatch[1]!
                    if (!listUpdates.has(lt)) listUpdates.set(lt, { tools: [], skills: [], subagents: false })
                    if (v === 'on') listUpdates.get(lt)!.tools.push(toolMatch[2]!)
                    continue
                  }
                  const allToolsMatch = k.match(/^perm_(.+)_tools_all$/)
                  if (allToolsMatch && v === 'on') {
                    const lt = allToolsMatch[1]!
                    if (!listUpdates.has(lt)) listUpdates.set(lt, { tools: [], skills: [], subagents: false })
                    listUpdates.get(lt)!.tools = ['*']
                    continue
                  }
                  const subMatch = k.match(/^perm_(.+)_subagents$/)
                  if (subMatch) {
                    const lt = subMatch[1]!
                    if (!listUpdates.has(lt)) listUpdates.set(lt, { tools: [], skills: [], subagents: false })
                    listUpdates.get(lt)!.subagents = v === 'on'
                    continue
                  }
                }

                for (const [lt, perms] of listUpdates) {
                  const existing = await usersDb.getListConfig(lt)
                  if (existing) {
                    await usersDb.upsertListConfig(lt, existing.displayName, {
                      ...perms, allAccess: lt === 'admin',
                    }, {
                      isEnabled: existing.isEnabled,
                      unregisteredBehavior: userPermUpdates['unregisteredBehavior'] as 'silence' | 'generic_message' | 'register_only' | 'leads' ?? existing.unregisteredBehavior,
                      unregisteredMessage: userPermUpdates['unregisteredMessage'] ?? existing.unregisteredMessage,
                      maxUsers: existing.maxUsers,
                    })
                  }
                }

                // Handle unregistered behavior without permission changes
                if (userPermUpdates['unregisteredBehavior'] && listUpdates.size === 0) {
                  const leadCfg = await usersDb.getListConfig('lead')
                  if (leadCfg) {
                    await usersDb.upsertListConfig('lead', leadCfg.displayName, leadCfg.permissions, {
                      isEnabled: leadCfg.isEnabled,
                      unregisteredBehavior: userPermUpdates['unregisteredBehavior'] as 'silence' | 'generic_message' | 'register_only' | 'leads',
                      unregisteredMessage: userPermUpdates['unregisteredMessage'] ?? leadCfg.unregisteredMessage,
                      maxUsers: leadCfg.maxUsers,
                    })
                  }
                }

                await usersCache.invalidateAll()
                logger.info({ lists: [...listUpdates.keys()] }, 'User permissions saved')
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
            const sid = body[`contact_senderid_${i}`]
            if (ch && sid && sid.trim()) contacts.push({ channel: ch, senderId: sid.trim() })
          }

          if (contacts.length === 0) throw new Error('At least one contact is required')

          const user = await usersDb.createUser({ displayName: displayName || undefined, listType, contacts })
          // Invalidate cache for all new contacts
          for (const c of contacts) await usersCache.invalidate(c.senderId)

          logger.info({ userId: user.id, listType, contacts: contacts.length }, 'User created from console')
        } catch (err) {
          logger.error({ err }, 'Failed to create user')
        }
        res.writeHead(302, { Location: `/console/users?flash=user_added&lang=${lang}` })
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

          await usersDb.updateUser(userId, {
            displayName: body['displayName'] || undefined,
            listType: body['listType'] || undefined,
          })

          // Sync contact fields from modal: contact_channel_0, contact_senderid_0
          const user = await usersDb.findUserById(userId)
          if (user) {
            for (let i = 0; i < 10; i++) {
              const ch = body[`contact_channel_${i}`]
              const sid = body[`contact_senderid_${i}`]?.trim()
              if (!ch) continue

              const existing = user.contacts.find(c => c.channel === ch)
              if (sid && !existing) {
                // Add new contact for this channel
                await usersDb.addContact(userId, ch, sid)
                await usersCache.invalidate(sid)
              } else if (sid && existing && existing.senderId !== sid) {
                // Changed — remove old, add new
                try { await usersDb.removeContact(existing.id) } catch { /* last contact guard */ }
                await usersDb.addContact(userId, ch, sid)
                await usersCache.invalidate(existing.senderId)
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

      // Redirect root to /console/channels
      if (pathOnly === '/' || pathOnly === '') {
        const lang = detectLang(req)
        res.writeHead(302, { Location: `/console/channels?lang=${lang}` })
        res.end()
        return true
      }

      let section = pathOnly.replace(/^\//, '')

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

      // Users: fetch data from users module service
      if (section === 'users') {
        try {
          const dataFn = registry.getOptional<() => Promise<unknown>>('users:sectionData')
          if (dataFn) {
            sectionData.usersData = await dataFn() as typeof sectionData.usersData
          }
        } catch { /* module not available */ }
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
