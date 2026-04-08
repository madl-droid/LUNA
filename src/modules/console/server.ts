// LUNA - Console server logic (SSR multi-page)

import * as fs from 'node:fs'
import * as path from 'node:path'
import type * as http from 'node:http'
import type { Registry } from '../../kernel/registry.js'
import { buildBaseUrl, oauthCallbackPage } from '../../kernel/http-helpers.js'
import { reloadKernelConfig } from '../../kernel/config.js'
import * as configStore from '../../kernel/config-store.js'
import { detectLang } from './templates-i18n.js'
import { pageLayout, type SidebarChannelInfo } from './templates.js'
import { renderSection, renderAdvancedAgentSection, renderEngineMetricsSection } from './templates-section-router.js'
import type { SectionData } from './templates-section-data.js'
import { renderChannelSettingsPage } from './templates-channel-settings.js'
import { renderModulePanels } from './templates-modules.js'
import { logger, render404Page, parseFormBody, findEnvFile, writeEnvFile, checkSuperAdmin } from './server-helpers.js'
import { fetchSectionData } from './server-data.js'
export { createApiRoutes } from './server-api.js'

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
      const notFoundLang = (req.url?.includes('lang=en') ? 'en' : 'es')
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(render404Page(notFoundLang))
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

                  // Subagents toggle + allowed list
                  const subagents = up[`sub_${lt}`] === 'on'
                  const allowedSubagents: string[] = []
                  for (const [k, v] of Object.entries(up)) {
                    const sm = k.match(new RegExp(`^sa_${lt}_(.+)$`))
                    if (sm && v === 'on') allowedSubagents.push(sm[1]!)
                  }

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
                    allowedSubagents,
                    allAccess: lt === 'admin',
                  }, {
                    isEnabled: up[`list_enabled_${lt}`] !== undefined ? isEnabled : existing.isEnabled,
                    knowledgeCategories: kCats,
                    assignmentEnabled: up[`assignment_enabled_${lt}`] === 'on',
                    assignmentPrompt: up[`assignment_prompt_${lt}`] ?? existing.assignmentPrompt,
                    disableBehavior: up[`disable_${lt}_behavior`] ?? existing.disableBehavior,
                    disableTargetList: up[`disable_${lt}_target`] ?? existing.disableTargetList,
                    unregisteredBehavior: lt === 'lead' && up['unregisteredBehavior'] ? up['unregisteredBehavior'] as 'ignore' | 'silence' | 'message' | 'attend' : existing.unregisteredBehavior,
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
                      unregisteredBehavior: up['unregisteredBehavior'] as 'ignore' | 'silence' | 'message' | 'attend',
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
        // Guard debug config keys: only super admin can toggle debug settings
        const debugKeys = ['DEBUG_CACHE_ENABLED', 'DEBUG_EXTREME_LOG', 'DEBUG_ADMIN_ONLY', 'ENGINE_TEST_MODE']
        const hasDebugKeys = Object.keys(updates).some(k => debugKeys.includes(k))
        if (hasDebugKeys) {
          const isSA = await checkSuperAdmin(registry, req.headers['cookie'])
          if (!isSA) {
            res.writeHead(302, { Location: `/console/${section}?flash=error&lang=${lang}` })
            res.end()
            return true
          }
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

      if (localUrl === '/reset-contacts') {
        // Super admin gate
        const isSA = await checkSuperAdmin(registry, req.headers['cookie'])
        if (!isSA) {
          res.writeHead(302, { Location: `/console/${section}?flash=error&lang=${lang}` })
          res.end()
          return true
        }
        try {
          const db = registry.getDb()
          // Preserve super admin (source = 'setup_wizard') and their contacts
          await db.query(`DELETE FROM user_contacts WHERE user_id NOT IN (SELECT id FROM users WHERE source = 'setup_wizard')`)
          await db.query(`DELETE FROM user_lists WHERE user_id NOT IN (SELECT id FROM users WHERE source = 'setup_wizard')`)
          await db.query(`DELETE FROM users WHERE source != 'setup_wizard'`)
          // Invalidate user cache in Redis
          const redis = registry.getRedis()
          const keys = await redis.keys('user_type:*')
          if (keys.length > 0) await redis.del(...keys)
          logger.info('Contact bases cleared — super admin preserved')
        } catch (err) {
          logger.error({ err }, 'Failed to clear contact bases')
        }
        res.writeHead(302, { Location: `/console/${section}?flash=reset&lang=${lang}` })
        res.end()
        return true
      }

      if (localUrl === '/modules/toggle') {
        const modName = body['module']
        // Support both param styles: active=true/false (modules page) and action=activate/deactivate (herramientas page)
        const action = body['action']
        const active = action ? (action === 'activate' ? 'true' : 'false') : body['active']
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

      if (localUrl === '/contacts/add') {
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

      if (localUrl === '/contacts/update') {
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
                await usersDb.updateContact(existing.id, sid, ch)
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
        res.writeHead(302, { Location: `/console/contacts/admin?flash=user_updated&lang=${lang}` })
        res.end()
        return true
      }

      if (localUrl === '/contacts/deactivate') {
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
        const redirect = body['_redirect'] || `/console/contacts/admin?flash=user_deactivated&lang=${lang}`
        const sep = redirect.includes('?') ? '&' : '?'
        res.writeHead(302, { Location: `${redirect}${sep}flash=user_deactivated` })
        res.end()
        return true
      }

      if (localUrl === '/contacts/reactivate') {
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
        res.writeHead(302, { Location: `/console/contacts/admin?flash=user_reactivated&lang=${lang}` })
        res.end()
        return true
      }

      if (localUrl === '/contacts/create-list') {
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

      if (localUrl === '/contacts/toggle-list') {
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

      if (localUrl === '/contacts/delete-list') {
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

      if (localUrl === '/contacts/config') {
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
        res.writeHead(302, { Location: `/console/contacts/admin?flash=config_saved&lang=${lang}` })
        res.end()
        return true
      }
    }

    // 4. GET pages — SSR
    if (req.method === 'GET') {
      // Strip query string for path matching
      const pathOnly = localUrl.split('?')[0]!

      let section = pathOnly.replace(/^\//, '')

      // /console (root) → redirect to agente (which renders dashboard)
      if (section === '' || section === '/') {
        const lang = detectLang(req)
        res.writeHead(302, { Location: `/console/agente?lang=${lang}` })
        res.end()
        return true
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
      // /console/agente without subpage → show dashboard
      if (section === 'agente' && !agenteSubpage) {
        section = 'dashboard'
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

      // Debug database viewer: /console/debug/database
      if (section === 'debug/database') {
        section = 'debug-database'
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

      // Debug database viewer: test mode gate
      if (section === 'debug-database' && data.config.ENGINE_TEST_MODE !== 'true') {
        res.writeHead(302, { Location: `/console?lang=${lang}` })
        res.end()
        return true
      }

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

      // Dashboard: load real metrics from DB
      if (section === 'dashboard') {
        try {
          const db = registry.getDb()
          const CHANNEL_DISPLAY: Record<string, string> = {
            'whatsapp': 'WhatsApp', 'gmail': 'Gmail', 'google-chat': 'Google Chat',
            'twilio-voice': 'Twilio Voice', 'telegram': 'Telegram',
          }
          const [contacts30, contactsPrev30, sessions24h, channels30, cost30, costPrev30, modelsData] = await Promise.all([
            db.query(`SELECT COUNT(*)::int AS c FROM contacts WHERE created_at > now() - interval '30 days'`),
            db.query(`SELECT COUNT(*)::int AS c FROM contacts WHERE created_at > now() - interval '60 days' AND created_at <= now() - interval '30 days'`),
            db.query(`SELECT COUNT(*)::int AS c FROM sessions WHERE last_activity_at > now() - interval '24 hours'`),
            db.query(`SELECT channel_name, COUNT(*)::int AS sessions, COUNT(DISTINCT contact_id)::int AS contacts FROM sessions WHERE started_at > now() - interval '30 days' GROUP BY channel_name ORDER BY sessions DESC LIMIT 6`),
            db.query(`SELECT COALESCE(SUM(cost_usd), 0)::float AS c FROM llm_usage WHERE created_at > now() - interval '30 days'`).catch(() => ({ rows: [{ c: 0 }] })),
            db.query(`SELECT COALESCE(SUM(cost_usd), 0)::float AS c FROM llm_usage WHERE created_at > now() - interval '60 days' AND created_at <= now() - interval '30 days'`).catch(() => ({ rows: [{ c: 0 }] })),
            db.query(`SELECT model, COALESCE(SUM(input_tokens + output_tokens), 0)::bigint AS total_tokens FROM llm_usage WHERE created_at > now() - interval '30 days' GROUP BY model ORDER BY total_tokens DESC LIMIT 4`).catch(() => ({ rows: [] })),
          ])
          const totalContacts = contacts30.rows[0]?.c ?? 0
          const prevContacts = contactsPrev30.rows[0]?.c ?? 0
          const contactsChange = prevContacts > 0 ? Math.round((totalContacts - prevContacts) / prevContacts * 100) : 0
          const activeSessions = sessions24h.rows[0]?.c ?? 0
          const llmCost = Math.round((Number(cost30.rows[0]?.c ?? 0)) * 100) / 100
          const prevCost = Number(costPrev30.rows[0]?.c ?? 0)
          const costChange = prevCost > 0 ? Math.round((llmCost - prevCost) / prevCost * 100) : 0
          const channels = channels30.rows.map((r: Record<string, unknown>) => ({
            name: CHANNEL_DISPLAY[String(r['channel_name'])] ?? String(r['channel_name']),
            contacts: Number(r['contacts']),
            sessions: Number(r['sessions']),
          }))
          // Models breakdown from llm_usage
          const modelRows = (modelsData.rows as Array<Record<string, unknown>>)
          const maxTokens = Math.max(...modelRows.map(r => Number(r['total_tokens'])), 1)
          const models = modelRows.map(r => {
            const total = Number(r['total_tokens'])
            const name = String(r['model'])
            const desc = name.includes('claude') ? 'Anthropic' : (name.includes('gemini') || name.includes('google')) ? 'Google' : ''
            const fmt = total >= 1_000_000 ? (total / 1_000_000).toFixed(1) + 'M' : total >= 1000 ? Math.round(total / 1000) + 'k' : String(total)
            return { name, desc, tokens: fmt, pct: Math.round(total / maxTokens * 100) }
          })
          sectionData.dashboardData = { totalContacts, contactsChange, activeSessions, llmCost, costChange, channels, models, totalSourceContacts: totalContacts }
        } catch { /* use zero fallbacks */ }
      }

      // Scheduled tasks: render via module service (needs lang)
      if (section === 'scheduled-tasks') {
        try {
          const renderFn = registry.getOptional<(lang: string) => Promise<string>>('scheduled-tasks:renderSection')
          if (renderFn) {
            sectionData.scheduledTasksHtml = await renderFn(lang)
          }
        } catch (err) { logger.error({ err }, 'Failed to render scheduled-tasks section (standalone)') }
      }

      // Knowledge: render via module service
      if (section === 'knowledge') {
        try {
          const renderFn = registry.getOptional<(lang: string) => Promise<string>>('knowledge:renderSection')
          if (renderFn) {
            sectionData.knowledgeItemsHtml = await renderFn(lang)
          } else {
            logger.warn('knowledge:renderSection service not found (standalone route)')
          }
        } catch (err) { logger.error({ err }, 'Failed to render knowledge section (standalone)') }
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
          sectionData.agenteContent = renderAdvancedAgentSection(sectionData)
        } else if (agenteSubpage === 'engine-metrics') {
          sectionData.agenteContent = renderEngineMetricsSection(sectionData)
        } else if (agenteSubpage === 'knowledge') {
          // Load knowledge items HTML via module service
          try {
            const renderFn = registry.getOptional<(lang: string) => Promise<string>>('knowledge:renderSection')
            if (renderFn) {
              sectionData.knowledgeItemsHtml = await renderFn(lang)
            } else {
              logger.warn('knowledge:renderSection service not registered — module may be inactive or failed to init')
            }
          } catch (err) {
            logger.error({ err }, 'Failed to render knowledge section')
          }
          sectionData.agenteContent = renderSection('knowledge', sectionData) ?? `<div class="panel"><div class="panel-body"><p>${lang === 'es' ? 'Modulo de conocimiento no disponible.' : 'Knowledge module not available.'}</p></div></div>`
        } else if (agenteSubpage === 'memory') {
          sectionData.agenteContent = renderSection('memory', sectionData) ??
            `<div class="panel"><div class="panel-body"><p>${lang === 'es' ? 'Modulo de memoria no disponible.' : 'Memory module not available.'}</p></div></div>`
        } else if (agenteSubpage === 'identity') {
          // Load skills from filesystem for readonly display
          try {
            const skillsDir = path.join(process.cwd(), 'instance', 'prompts', 'system', 'skills')
            const skillFiles = fs.readdirSync(skillsDir).filter(f => f.endsWith('.md'))
            sectionData.skills = skillFiles.map(file => {
              const content = fs.readFileSync(path.join(skillsDir, file), 'utf-8')
              const descMatch = content.match(/<!--\s*description:\s*(.+?)\s*-->/)
              const userTypesMatch = content.match(/<!--\s*userTypes:\s*(.+?)\s*-->/)
              const patternsMatch = content.match(/<!--\s*triggerPatterns:\s*(.+?)\s*-->/)
              return {
                name: file.replace(/\.md$/, ''),
                description: descMatch?.[1]?.trim() ?? '',
                userTypes: userTypesMatch?.[1]?.trim() ?? 'all',
                triggerPatterns: patternsMatch?.[1]?.trim() ?? '',
              }
            })
          } catch { /* skills dir not accessible */ }
          sectionData.agenteContent = renderSection('identity', sectionData) ??
            `<div class="panel"><div class="panel-body"><p>${lang === 'es' ? 'Modulo de prompts no disponible.' : 'Prompts module not available.'}</p></div></div>`
        } else if (agenteSubpage === 'subagents') {
          try {
            const renderFn = registry.getOptional<(lang: string) => Promise<string>>('subagents:renderSection')
            if (renderFn) {
              sectionData.agenteContent = await renderFn(lang)
            }
          } catch (err) { logger.error({ err }, 'Failed to render subagents section') }
          if (!sectionData.agenteContent) {
            sectionData.agenteContent = `<div class="panel"><div class="panel-body"><p>${lang === 'es' ? 'Modulo de subagentes no disponible.' : 'Subagents module not available.'}</p></div></div>`
          }
        }
      }

      // Herramientas unified page: render sub-page content
      if (section === 'herramientas' && herramientasSubpage) {
        sectionData.herramientasSubpage = herramientasSubpage
        const notAvailable = (name: string) => `<div class="panel"><div class="panel-body"><p>${lang === 'es' ? `Modulo de ${name} no disponible.` : `${name} module not available.`}</p></div></div>`

        if (herramientasSubpage === 'tools') {
          // Load per-tool descriptions for two-tier editing
          try {
            interface ToolDef { name: string; sourceModule: string; shortDescription?: string; detailedGuidance?: string }
            const toolsReg = registry.getOptional<{ getEnabledToolDefinitions(): ToolDef[] }>('tools:registry')
            if (toolsReg) {
              sectionData.toolDescriptions = toolsReg.getEnabledToolDefinitions().map(t => ({
                name: t.name,
                sourceModule: t.sourceModule,
                shortDescription: t.shortDescription ?? '',
                detailedGuidance: t.detailedGuidance ?? '',
              }))
            }
          } catch { /* tools module not available */ }
          sectionData.herramientasContent = renderSection('tools-cards', sectionData) ?? notAvailable('herramientas')
        } else if (herramientasSubpage === 'lead-scoring') {
          try {
            const renderFn = registry.getOptional<(lang: string) => string>('lead-scoring:renderSection')
            if (renderFn) {
              sectionData.herramientasContent = renderFn(lang)
            }
          } catch (err) { logger.error({ err }, 'Failed to render lead-scoring section') }
          if (!sectionData.herramientasContent) {
            sectionData.herramientasContent = notAvailable('calificacion')
          }
        } else if (herramientasSubpage === 'marketing-data') {
          try {
            const renderFn = registry.getOptional<(lang: string) => string>('marketing-data:renderSection')
            if (renderFn) {
              sectionData.herramientasContent = renderFn(lang)
            }
          } catch (err) { logger.error({ err }, 'Failed to render marketing-data section') }
          if (!sectionData.herramientasContent) {
            sectionData.herramientasContent = notAvailable('marketing data')
          }
        } else if (herramientasSubpage === 'freight') {
          const freightMod = data.moduleStates.find(m => m.name === 'freight')
          if (freightMod?.active) {
            try {
              const renderFn = registry.getOptional<(lang: string) => string>('freight:renderSection')
              if (renderFn) {
                sectionData.herramientasContent = renderFn(lang)
              }
            } catch (err) { logger.error({ err }, 'Failed to render freight section') }
          }
          if (!sectionData.herramientasContent) {
            sectionData.herramientasContent = notAvailable('flete')
          }
        } else if (herramientasSubpage === 'medilink') {
          const medilinkMod = data.moduleStates.find(m => m.name === 'medilink')
          if (medilinkMod?.active && medilinkMod.console?.fields?.length) {
            let html = renderModulePanels([medilinkMod], data.config, lang, 'medilink')
            try {
              const renderFn = registry.getOptional<(lang: string) => Promise<string>>('medilink:renderSection')
              if (renderFn) html += await renderFn(lang)
            } catch (err) { logger.error({ err }, 'Failed to render medilink custom section') }
            sectionData.herramientasContent = html
          } else {
            sectionData.herramientasContent = notAvailable('medilink')
          }
        } else if (herramientasSubpage === 'scheduled-tasks') {
          try {
            const renderFn = registry.getOptional<(lang: string) => Promise<string>>('scheduled-tasks:renderSection')
            if (renderFn) {
              sectionData.herramientasContent = await renderFn(lang)
            }
          } catch (err) { logger.error({ err }, 'Failed to render scheduled-tasks section') }
          if (!sectionData.herramientasContent) {
            sectionData.herramientasContent = notAvailable('tareas programadas')
          }
        } else if (herramientasSubpage === 'google-apps/calendar') {
          const renderFn = registry.getOptional<(data: SectionData) => Promise<string>>('google-apps:renderCalendarSection')
          if (renderFn) {
            try {
              sectionData.herramientasContent = await renderFn(sectionData)
            } catch (err) { logger.error({ err }, 'Failed to render calendar settings section') }
          }
          if (!sectionData.herramientasContent) {
            sectionData.herramientasContent = notAvailable('Google Calendar')
          }
        } else if (herramientasSubpage === 'google-apps') {
          sectionData.herramientasContent = renderSection('google-apps', sectionData) || notAvailable('Google API')
        } else if (herramientasSubpage === 'freshdesk') {
          const freshdeskMod = data.moduleStates.find(m => m.name === 'freshdesk')
          if (freshdeskMod?.active && freshdeskMod.console?.fields?.length) {
            let html = renderModulePanels([freshdeskMod], data.config, lang, 'freshdesk')
            try {
              const renderFn = registry.getOptional<(lang: string) => string>('freshdesk:renderSection')
              if (renderFn) html += renderFn(lang)
            } catch (err) { logger.error({ err }, 'Failed to render freshdesk section') }
            sectionData.herramientasContent = html
          } else {
            sectionData.herramientasContent = notAvailable('Freshdesk')
          }
        } else if (herramientasSubpage === 'hitl') {
          const hitlMod = data.moduleStates.find(m => m.name === 'hitl')
          if (hitlMod?.active) {
            let html = renderModulePanels([hitlMod], data.config, lang, 'hitl')
            try {
              const renderFn = registry.getOptional<(config: Record<string, string>, lang: string) => string>('hitl:renderSection')
              if (renderFn) html += renderFn(data.config, lang)
            } catch (err) { logger.error({ err }, 'Failed to render hitl custom section') }
            sectionData.herramientasContent = html
          } else {
            sectionData.herramientasContent = notAvailable('HITL')
          }
        } else if (herramientasSubpage === 'templates') {
          const templatesMod = data.moduleStates.find(m => m.name === 'templates')
          if (templatesMod?.active) {
            let html = renderModulePanels([templatesMod], data.config, lang, 'templates')
            try {
              const renderFn = registry.getOptional<(lang: string) => string>('templates:renderSection')
              if (renderFn) html += renderFn(lang)
            } catch (err) { logger.error({ err }, 'Failed to render templates custom section') }
            sectionData.herramientasContent = html
          } else {
            sectionData.herramientasContent = notAvailable('templates')
          }
        } else if (herramientasSubpage) {
          // Dynamic: any active agent-group module renders as module panel
          const dynMod = data.moduleStates.find(m => m.name === herramientasSubpage)
          if (dynMod) {
            sectionData.herramientasContent = renderModulePanels([dynMod], data.config, lang, herramientasSubpage)
          } else {
            sectionData.herramientasContent = notAvailable(herramientasSubpage)
          }
        }
      }

      // Channel settings pages: use the 2-column channel settings renderer
      let content: string | null = null
      if (channelSettingsId) {
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
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(render404Page(lang))
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

      // Resolve super admin status for debug panel visibility
      const isSuperAdmin = await checkSuperAdmin(registry, req.headers['cookie'])
      const adminOverrideType = data.config.ADMIN_OVERRIDE_TYPE || ''

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
        isSuperAdmin,
        adminOverrideType,
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
 * Creates API routes for console module endpoints
 */
