// LUNA — Users module: API route handlers
// Endpoints CRUD para gestionar usuarios y listas desde la console.

import type { ServerResponse } from 'node:http'
import pino from 'pino'
import type { Registry } from '../../../kernel/registry.js'
import type { ApiRoute } from '../../../kernel/types.js'
import { jsonResponse, parseBody } from '../../../kernel/http-helpers.js'
import type { UsersDb } from '../db.js'
import type { UserCache } from '../cache.js'
import { importCsv, importArray } from './csv-import.js'
import { syncListFromSheet } from './sheet-sync.js'

const logger = pino({ name: 'users:api' })

/** Shorthand: json(res, data) defaults to 200, json(res, data, 201) for custom status */
function json(res: ServerResponse, data: unknown, status = 200): void {
  jsonResponse(res, status, data)
}

function error(res: ServerResponse, message: string, status = 400): void {
  json(res, { error: message }, status)
}

// ─── Route factory ────────────────────────

export function createApiRoutes(registry: Registry, db: UsersDb, cache: UserCache): ApiRoute[] {
  return [
    // GET /console/api/users/status — module status
    {
      method: 'GET',
      path: 'status',
      handler: async (_req, res) => {
        const configs = await db.getAllListConfigs()
        const counts: Record<string, number> = {}
        for (const c of configs) {
          counts[c.listType] = await db.countActiveUsers(c.listType)
        }
        json(res, { enabled: true, lists: configs, counts })
      },
    },

    // POST /console/api/users/create — create user in list
    {
      method: 'POST',
      path: 'create',
      handler: async (req, res) => {
        try {
          const body = await parseBody<{
            senderId: string
            channel: string
            listType: string
            displayName?: string
            metadata?: Record<string, unknown>
          }>(req)

          if (!body.senderId || !body.channel || !body.listType) {
            return error(res, 'Missing required fields: senderId, channel, listType')
          }

          // Enforce max 5 list types
          const config = await db.getListConfig(body.listType)
          if (!config && body.listType !== 'admin' && body.listType !== 'lead') {
            const typeCount = await db.countListTypes()
            if (typeCount >= 5) {
              return error(res, 'Maximum 5 list types allowed')
            }
          }

          const user = await db.createUser({
            listType: body.listType,
            displayName: body.displayName,
            contacts: [{ channel: body.channel, senderId: body.senderId }],
            metadata: body.metadata,
          })
          await cache.invalidate(body.senderId)
          json(res, { ok: true, user }, 201)
        } catch (err) {
          logger.error({ err }, 'Create user failed')
          error(res, (err as Error).message)
        }
      },
    },

    // POST /console/api/users/update — update user
    {
      method: 'POST',
      path: 'update',
      handler: async (req, res) => {
        try {
          const body = await parseBody<{
            id: string
            displayName?: string
            metadata?: Record<string, unknown>
          }>(req)

          if (!body.id) return error(res, 'Missing required field: id')

          const user = await db.updateUser(body.id, {
            displayName: body.displayName,
            metadata: body.metadata,
          })

          if (!user) return error(res, 'User not found', 404)

          // Invalidate cache for all contacts of this user
          const contacts = await db.getContactsForUser(body.id)
          for (const c of contacts) await cache.invalidate(c.senderId)
          json(res, { ok: true, user })
        } catch (err) {
          logger.error({ err }, 'Update user failed')
          error(res, (err as Error).message)
        }
      },
    },

    // POST /console/api/users/deactivate — soft delete
    {
      method: 'POST',
      path: 'deactivate',
      handler: async (req, res) => {
        try {
          const body = await parseBody<{ id: string }>(req)
          if (!body.id) return error(res, 'Missing required field: id')

          const existing = await db.findUserById(body.id)
          if (!existing) return error(res, 'User not found', 404)

          const ok = await db.deactivateUser(body.id)
          if (ok) {
            for (const c of existing.contacts) await cache.invalidate(c.senderId)
          }

          json(res, { ok })
        } catch (err) {
          logger.error({ err }, 'Deactivate user failed')
          error(res, (err as Error).message)
        }
      },
    },

    // POST /console/api/users/list — list users in a list
    {
      method: 'POST',
      path: 'list',
      handler: async (req, res) => {
        try {
          const body = await parseBody<{ listType: string; includeInactive?: boolean }>(req)
          if (!body.listType) return error(res, 'Missing required field: listType')

          const users = await db.listByType(body.listType, !body.includeInactive)
          json(res, { users, count: users.length })
        } catch (err) {
          logger.error({ err }, 'List users failed')
          error(res, (err as Error).message)
        }
      },
    },

    // POST /console/api/users/bulk-import — import CSV or JSON array
    {
      method: 'POST',
      path: 'bulk-import',
      handler: async (req, res) => {
        try {
          const body = await parseBody<{
            listType: string
            format: 'csv' | 'json'
            data: string | Array<{ senderId: string; channel: string; displayName?: string; metadata?: Record<string, unknown> }>
          }>(req)

          if (!body.listType || !body.format || !body.data) {
            return error(res, 'Missing required fields: listType, format, data')
          }

          let result
          if (body.format === 'csv') {
            if (typeof body.data !== 'string') {
              return error(res, 'CSV data must be a string')
            }
            result = await importCsv(db, cache, body.listType, body.data)
          } else {
            if (!Array.isArray(body.data)) {
              return error(res, 'JSON data must be an array')
            }
            result = await importArray(db, cache, body.listType, body.data)
          }

          json(res, { ok: true, result })
        } catch (err) {
          logger.error({ err }, 'Bulk import failed')
          error(res, (err as Error).message)
        }
      },
    },

    // POST /console/api/users/trigger-sync — trigger sheet sync for a list
    {
      method: 'POST',
      path: 'trigger-sync',
      handler: async (req, res) => {
        try {
          const body = await parseBody<{ listType: string }>(req)
          if (!body.listType) return error(res, 'Missing required field: listType')

          const config = await db.getListConfig(body.listType)
          if (!config) return error(res, `List type "${body.listType}" not found`, 404)

          if (!config.syncConfig.sheetUrl) {
            return error(res, `No sheet URL configured for list "${body.listType}"`)
          }

          const result = await syncListFromSheet(registry, db, cache, body.listType, config.syncConfig)
          json(res, { ok: true, result })
        } catch (err) {
          logger.error({ err }, 'Trigger sync failed')
          error(res, (err as Error).message)
        }
      },
    },

    // POST /console/api/users/config-list — get/update list config
    {
      method: 'POST',
      path: 'config-list',
      handler: async (req, res) => {
        try {
          const body = await parseBody<{
            action: 'get' | 'get-all' | 'upsert'
            listType?: string
            displayName?: string
            permissions?: { tools: string[]; skills: string[]; subagents: boolean; allAccess: boolean }
            isEnabled?: boolean
            syncConfig?: Record<string, unknown>
            unregisteredBehavior?: string
            unregisteredMessage?: string
            maxUsers?: number
          }>(req)

          if (body.action === 'get-all') {
            const configs = await db.getAllListConfigs()
            return json(res, { configs })
          }

          if (body.action === 'get') {
            if (!body.listType) return error(res, 'Missing listType')
            const config = await db.getListConfig(body.listType)
            if (!config) return error(res, 'Not found', 404)
            return json(res, { config })
          }

          if (body.action === 'upsert') {
            if (!body.listType || !body.displayName || !body.permissions) {
              return error(res, 'Missing required fields: listType, displayName, permissions')
            }

            // Enforce max 5 list types
            const existing = await db.getListConfig(body.listType)
            if (!existing) {
              const count = await db.countListTypes()
              if (count >= 5) return error(res, 'Maximum 5 list types allowed')
            }

            const config = await db.upsertListConfig(
              body.listType,
              body.displayName,
              body.permissions,
              {
                isEnabled: body.isEnabled,
                syncConfig: body.syncConfig as import('../types.js').SyncConfig,
                unregisteredBehavior: body.unregisteredBehavior as import('../types.js').UnregisteredBehavior,
                unregisteredMessage: body.unregisteredMessage,
                maxUsers: body.maxUsers,
              },
            )

            // Invalidate all caches since permissions changed
            await cache.invalidateAll()
            return json(res, { ok: true, config })
          }

          error(res, 'Invalid action. Use: get, get-all, upsert')
        } catch (err) {
          logger.error({ err }, 'Config list failed')
          error(res, (err as Error).message)
        }
      },
    },

    // POST /console/api/users/resolve — test resolution (for debugging)
    {
      method: 'POST',
      path: 'resolve',
      handler: async (req, res) => {
        try {
          const { resolveUserType } = await import('../resolver.js')
          const { getUserPermissions } = await import('../permissions.js')

          const body = await parseBody<{ senderId: string; channel: string }>(req)
          if (!body.senderId || !body.channel) {
            return error(res, 'Missing required fields: senderId, channel')
          }

          const resolution = await resolveUserType(body.senderId, body.channel)
          const permissions = await getUserPermissions(resolution.userType)

          json(res, { resolution, permissions })
        } catch (err) {
          logger.error({ err }, 'Resolve user failed')
          error(res, (err as Error).message)
        }
      },
    },
  ]
}
