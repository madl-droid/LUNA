import { readBody, parseBody, parseQuery, jsonResponse } from '../../kernel/http-helpers.js'
import type { ApiRoute } from '../../kernel/types.js'
import { reloadKernelConfig, kernelConfig } from '../../kernel/config.js'
import * as configStore from '../../kernel/config-store.js'
import { logger, findEnvFile, parseEnvFile, writeEnvFile, guardDebugEndpoint, flushRedisExceptSessions, purgeAllData, purgeMemoryData, purgeAgentData, packageJsonVersion, checkSuperAdmin } from './server-helpers.js'

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

    // GET /console/api/console/admin-override — get current admin override type
    {
      method: 'GET',
      path: 'admin-override',
      handler: async (_req, res) => {
        try {
          const { getRegistryRef } = await import('./manifest-ref.js')
          const registry = getRegistryRef()
          if (!registry) { jsonResponse(res, 500, { error: 'Registry not available' }); return }
          const value = await configStore.get(registry.getDb(), 'ADMIN_OVERRIDE_TYPE')
          jsonResponse(res, 200, { overrideType: value || '' })
        } catch (err) {
          jsonResponse(res, 500, { error: String(err) })
        }
      },
    },

    // POST /console/api/console/admin-override — set admin override type (test mode + super admin only)
    {
      method: 'POST',
      path: 'admin-override',
      handler: async (req, res) => {
        try {
          const { getRegistryRef } = await import('./manifest-ref.js')
          const registry = getRegistryRef()
          if (!registry) { jsonResponse(res, 500, { error: 'Registry not available' }); return }
          if (await guardDebugEndpoint(req, res, registry)) return

          const body = await parseBody<{ overrideType: string }>(req)
          const overrideType = body.overrideType?.trim() || ''
          const validOverrides = ['', 'admin', 'lead', 'coworker']
          if (!validOverrides.includes(overrideType)) {
            jsonResponse(res, 400, { error: `Invalid override type: ${overrideType}. Must be one of: ${validOverrides.join(', ')}` })
            return
          }

          const db = registry.getDb()
          if (overrideType === '' || overrideType === 'admin') {
            await db.query(`DELETE FROM config_store WHERE key = 'ADMIN_OVERRIDE_TYPE'`).catch(() => {})
          } else {
            await configStore.set(db, 'ADMIN_OVERRIDE_TYPE', overrideType)
          }

          const redis = registry.getRedis()
          let cursor = '0'
          do {
            const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', 'user_type:*', 'COUNT', 200)
            cursor = nextCursor
            if (keys.length > 0) await redis.del(...(keys as [string, ...string[]]))
          } while (cursor !== '0')

          logger.info({ overrideType: overrideType || '(cleared)' }, 'Admin override type updated')
          jsonResponse(res, 200, { ok: true, overrideType })
        } catch (err) {
          logger.error({ err }, 'Failed to set admin override')
          jsonResponse(res, 500, { error: String(err) })
        }
      },
    },

    // POST /console/api/console/clear-cache — flush Redis (test mode + super admin only)
    {
      method: 'POST',
      path: 'clear-cache',
      handler: async (req, res) => {
        try {
          const { getRegistryRef } = await import('./manifest-ref.js')
          const registry = getRegistryRef()
          if (!registry) { jsonResponse(res, 500, { error: 'Registry not available' }); return }
          if (await guardDebugEndpoint(req, res, registry)) return

          await flushRedisExceptSessions(registry.getRedis())
          logger.info('Redis cache flushed (debug panel) — sessions preserved')
          jsonResponse(res, 200, { ok: true })
        } catch (err) {
          logger.error({ err }, 'Failed to clear cache')
          jsonResponse(res, 500, { error: String(err) })
        }
      },
    },

    // POST /console/api/console/clear-memory — purge conversation/interaction data only (test mode + super admin only)
    {
      method: 'POST',
      path: 'clear-memory',
      handler: async (req, res) => {
        try {
          const { getRegistryRef } = await import('./manifest-ref.js')
          const registry = getRegistryRef()
          if (!registry) { jsonResponse(res, 500, { error: 'Registry not available' }); return }
          if (await guardDebugEndpoint(req, res, registry)) return

          await purgeMemoryData(registry, { preserveSuperAdmin: true })
          logger.info('Memory cleared (debug panel) — agent intelligence, config_store, super admin preserved')
          jsonResponse(res, 200, { ok: true })
        } catch (err) {
          logger.error({ err }, 'Failed to clear memory')
          jsonResponse(res, 500, { error: String(err) })
        }
      },
    },

    // POST /console/api/console/clear-agent — purge agent intelligence (knowledge, subagents, tools, prompts)
    {
      method: 'POST',
      path: 'clear-agent',
      handler: async (req, res) => {
        try {
          const { getRegistryRef } = await import('./manifest-ref.js')
          const registry = getRegistryRef()
          if (!registry) { jsonResponse(res, 500, { error: 'Registry not available' }); return }
          if (await guardDebugEndpoint(req, res, registry)) return

          await purgeAgentData(registry)
          logger.info('Agent intelligence cleared (debug panel) — subagents re-seeded')
          jsonResponse(res, 200, { ok: true })
        } catch (err) {
          logger.error({ err }, 'Failed to clear agent data')
          jsonResponse(res, 500, { error: String(err) })
        }
      },
    },

    // POST /console/api/console/factory-reset — real factory reset (super admin only)
    {
      method: 'POST',
      path: 'factory-reset',
      handler: async (req, res) => {
        try {
          const { getRegistryRef } = await import('./manifest-ref.js')
          const registry = getRegistryRef()
          if (!registry) { jsonResponse(res, 500, { error: 'Registry not available' }); return }
          // Super admin gate (no test-mode requirement for factory reset)
          const isSA = await checkSuperAdmin(registry, req.headers['cookie'])
          if (!isSA) { jsonResponse(res, 403, { error: 'Super admin required' }); return }
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

          // Real factory reset: purge ALL data (including super admin)
          await purgeAllData(registry, { preserveSuperAdmin: false })

          // Mark setup as not completed (must be after purge since purge flushes Redis)
          await configStore.set(db, 'SETUP_COMPLETED', 'false')

          // Activate the setup wizard on the running server (no prefill — start from scratch)
          const server = registry.getOptional<import('../../kernel/server.js').Server>('kernel:server')
          if (server) server.activateSetupWizard()

          logger.info({ userId }, 'Factory reset completed — all data purged, wizard activated')
          jsonResponse(res, 200, { ok: true })
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
          // FIX: SEC-1.1 — Whitelist period values
          const intervalMap: Record<string, string> = {
            '24h': '24 hours',
            '7d': '7 days',
            '30d': '30 days',
          }
          const interval = intervalMap[period]
          if (!interval) {
            jsonResponse(res, 400, { error: 'Invalid period' })
            return
          }

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

          // FIX: SEC-1.1 — Whitelist period values to prevent SQL injection
          const VALID_WHERE_TIME: Record<string, string> = {
            'today':        "created_at >= date_trunc('day', now())",
            'this_week':    "created_at >= date_trunc('week', now())",
            'this_month':   "created_at >= date_trunc('month', now())",
            'this_quarter': "created_at >= date_trunc('quarter', now())",
            'this_half':    "created_at >= date_trunc('month', now()) - interval '5 months'",
            'this_year':    "created_at >= date_trunc('year', now())",
            '1h':           "created_at > now() - interval '1 hour'",
            '24h':          "created_at > now() - interval '24 hours'",
            '7d':           "created_at > now() - interval '7 days'",
            '30d':          "created_at > now() - interval '30 days'",
            '90d':          "created_at > now() - interval '90 days'",
            '180d':         "created_at > now() - interval '180 days'",
            '365d':         "created_at > now() - interval '365 days'",
          }
          const whereTime = VALID_WHERE_TIME[period]
          if (!whereTime) {
            jsonResponse(res, 400, { error: 'Invalid period' })
            return
          }

          // Standardized 4 metrics for ALL channel types: active, inbound, outbound, avg_duration_s
          // Active sessions with activity in last 24h
          const activeRes = await db.query(
            `SELECT COUNT(*)::int AS active FROM sessions WHERE channel_name = $1 AND last_activity_at > now() - interval '24 hours'`,
            [channel],
          )

          // Inbound (client-initiated) in period — messages has no channel_name, join via sessions
          const inRes = await db.query(
            `SELECT COUNT(DISTINCT m.session_id)::int AS inbound FROM messages m JOIN sessions s ON s.id = m.session_id WHERE s.channel_name = $1 AND m.role = 'user' AND m.${whereTime} AND s.${whereTime.replace(/created_at/g, 'started_at')}`,
            [channel],
          )

          // Outbound (agent-initiated) in period
          const outRes = await db.query(
            `SELECT COUNT(DISTINCT m.session_id)::int AS outbound FROM messages m JOIN sessions s ON s.id = m.session_id WHERE s.channel_name = $1 AND m.role = 'assistant' AND m.${whereTime} AND s.${whereTime.replace(/created_at/g, 'started_at')}`,
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

    // GET /console/api/console/channel-spend?channel=whatsapp&period=month
    {
      method: 'GET',
      path: 'channel-spend',
      handler: async (req, res) => {
        try {
          const { getRegistryRef } = await import('./manifest-ref.js')
          const registry = getRegistryRef()
          if (!registry) { jsonResponse(res, 500, { error: 'Registry not available' }); return }

          const query = parseQuery(req)
          const channel = query.get('channel') || ''
          const period = query.get('period') || 'month'

          const VALID_SINCE: Record<string, string> = {
            'today':  "date_trunc('day', now())",
            'week':   "date_trunc('week', now())",
            'month':  "date_trunc('month', now())",
            '7d':     "now() - interval '7 days'",
            '30d':    "now() - interval '30 days'",
            '90d':    "now() - interval '90 days'",
          }
          const since = VALID_SINCE[period]
          if (!since) { jsonResponse(res, 400, { error: 'Invalid period' }); return }
          if (!channel) { jsonResponse(res, 400, { error: 'channel required' }); return }

          const db = registry.getDb()
          const spendRes = await db.query<{ total_spend: string; avg_cost: string; interactions: string }>(
            `SELECT
               COALESCE(SUM(pl.estimated_cost), 0)::numeric(10,6)                   AS total_spend,
               CASE WHEN COUNT(pl.id) > 0
                    THEN (SUM(pl.estimated_cost) / COUNT(pl.id))::numeric(10,6)
                    ELSE 0 END                                                        AS avg_cost,
               COUNT(pl.id)::int                                                     AS interactions
             FROM pipeline_logs pl
             JOIN sessions s ON s.id = pl.session_id
             WHERE s.channel_name = $1
               AND pl.created_at >= ${since}`,
            [channel],
          )

          const row = spendRes.rows[0]
          jsonResponse(res, 200, {
            channel,
            period,
            total_spend: parseFloat(row?.total_spend ?? '0'),
            avg_cost: parseFloat(row?.avg_cost ?? '0'),
            interactions: row?.interactions ?? 0,
          })
        } catch (err) {
          logger.warn({ err }, 'channel-spend query failed')
          jsonResponse(res, 200, { channel: '', period: 'month', total_spend: 0, avg_cost: 0, interactions: 0 })
        }
      },
    },

    // POST /console/api/console/db-viewer-auth — verify admin password for database viewer access (super admin only)
    {
      method: 'POST',
      path: 'db-viewer-auth',
      handler: async (req, res) => {
        try {
          const { getRegistryRef } = await import('./manifest-ref.js')
          const registry = getRegistryRef()
          if (!registry) { jsonResponse(res, 500, { error: 'Registry not available' }); return }
          if (await guardDebugEndpoint(req, res, registry)) return
          const db = registry.getDb()
          const redis = registry.getRedis()

          // Parse password
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

          // Set db-viewer access flag in Redis (30 min TTL)
          await redis.set(`db-viewer:${userId}`, '1', 'EX', 1800)

          logger.info({ userId }, 'Database viewer access granted')
          jsonResponse(res, 200, { ok: true })
        } catch (err) {
          logger.error({ err }, 'db-viewer-auth failed')
          jsonResponse(res, 500, { error: 'Internal server error' })
        }
      },
    },

    // GET /console/api/console/db-tables — list all public tables with row counts
    {
      method: 'GET',
      path: 'db-tables',
      handler: async (req, res) => {
        try {
          const { getRegistryRef } = await import('./manifest-ref.js')
          const registry = getRegistryRef()
          if (!registry) { jsonResponse(res, 500, { error: 'Registry not available' }); return }
          if (await guardDebugEndpoint(req, res, registry)) return
          const db = registry.getDb()
          const redis = registry.getRedis()

          // Session + db-viewer auth gate
          const { getSessionToken, validateSession } = await import('../../kernel/setup/auth.js')
          const token = getSessionToken(req.headers['cookie'])
          const userId = token ? await validateSession(redis, token) : null
          if (!userId) { jsonResponse(res, 401, { error: 'Unauthorized' }); return }
          const dbAccess = await redis.get(`db-viewer:${userId}`)
          if (!dbAccess) { jsonResponse(res, 403, { error: 'Database viewer auth required' }); return }

          // List tables
          const tablesRes = await db.query(
            `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`
          )
          const tables: Array<{ name: string; rowCount: number }> = []
          for (const row of tablesRes.rows) {
            const tableName = row.table_name as string
            // Validate table name: only alphanumeric + underscore
            if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tableName)) continue
            try {
              const countRes = await db.query(`SELECT COUNT(*)::int AS cnt FROM "${tableName}"`)
              tables.push({ name: tableName, rowCount: countRes.rows[0]?.cnt ?? 0 })
            } catch {
              tables.push({ name: tableName, rowCount: -1 })
            }
          }

          jsonResponse(res, 200, { tables })
        } catch (err) {
          logger.error({ err }, 'db-tables failed')
          jsonResponse(res, 500, { error: 'Internal server error' })
        }
      },
    },

    // GET /console/api/console/db-table-data?table=X&page=1&limit=50 — get table rows with pagination
    {
      method: 'GET',
      path: 'db-table-data',
      handler: async (req, res) => {
        try {
          const { getRegistryRef } = await import('./manifest-ref.js')
          const registry = getRegistryRef()
          if (!registry) { jsonResponse(res, 500, { error: 'Registry not available' }); return }
          if (await guardDebugEndpoint(req, res, registry)) return
          const db = registry.getDb()
          const redis = registry.getRedis()

          // Session + db-viewer auth gate
          const { getSessionToken, validateSession } = await import('../../kernel/setup/auth.js')
          const token = getSessionToken(req.headers['cookie'])
          const userId = token ? await validateSession(redis, token) : null
          if (!userId) { jsonResponse(res, 401, { error: 'Unauthorized' }); return }
          const dbAccess = await redis.get(`db-viewer:${userId}`)
          if (!dbAccess) { jsonResponse(res, 403, { error: 'Database viewer auth required' }); return }

          // Parse query params
          const query = parseQuery(req)
          const tableName = query.get('table') ?? ''
          const page = Math.max(1, parseInt(query.get('page') ?? '1', 10) || 1)
          const limit = Math.min(100, Math.max(1, parseInt(query.get('limit') ?? '50', 10) || 50))
          const offset = (page - 1) * limit

          // Validate table exists in information_schema (prevents SQL injection)
          const tableCheck = await db.query(
            `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`,
            [tableName]
          )
          if (tableCheck.rowCount === 0) {
            jsonResponse(res, 404, { error: 'Table not found' })
            return
          }

          // Get columns
          const colsRes = await db.query(
            `SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`,
            [tableName]
          )
          const columns = colsRes.rows.map((r: Record<string, unknown>) => ({ name: r.column_name as string, type: r.data_type as string }))

          // Get total count
          const countRes = await db.query(`SELECT COUNT(*)::int AS cnt FROM "${tableName}"`)
          const total = countRes.rows[0]?.cnt ?? 0

          // Get rows with pagination
          const dataRes = await db.query(`SELECT * FROM "${tableName}" ORDER BY 1 LIMIT $1 OFFSET $2`, [limit, offset])

          // Process rows: truncate long values
          const rows = dataRes.rows.map((row: Record<string, unknown>) => {
            const processed: Record<string, unknown> = {}
            for (const col of columns) {
              let val = row[col.name]
              if (val === null || val === undefined) {
                processed[col.name] = null
              } else if (typeof val === 'object') {
                const json = JSON.stringify(val)
                processed[col.name] = json.length > 200 ? json.slice(0, 200) + '…' : json
              } else if (typeof val === 'string' && val.length > 200) {
                processed[col.name] = val.slice(0, 200) + '…'
              } else {
                processed[col.name] = val
              }
            }
            return processed
          })

          jsonResponse(res, 200, { columns, rows, total, page, limit })
        } catch (err) {
          logger.error({ err }, 'db-table-data failed')
          jsonResponse(res, 500, { error: 'Internal server error' })
        }
      },
    },

    // GET /console/api/console/search-index — search index for header search bar
    {
      method: 'GET',
      path: 'search-index',
      handler: async (req, res) => {
        try {
          const { getRegistryRef } = await import('./manifest-ref.js')
          const registry = getRegistryRef()
          const lang = (parseQuery(req).get('lang') || 'es') as 'es' | 'en'
          const items: Array<{ key: string; label: string; section: string; url: string }> = []

          // Collect from all module console fields
          if (registry) {
            for (const lm of registry.listModules()) {
              const manifest = lm.manifest
              if (!manifest?.console?.fields) continue
              const sectionTitle = manifest.console.title?.[lang] || manifest.console.title?.['es'] || manifest.name
              const group = (manifest.console as unknown as Record<string, unknown>).group as string || ''
              let url = `/console/${manifest.name}`
              if (group === 'channels') url = `/console/channels/${manifest.name}`
              for (const field of manifest.console.fields) {
                if (field.type === 'divider') continue
                const label = field.label?.[lang] || field.label?.['es'] || field.key
                items.push({ key: field.key, label, section: sectionTitle, url: `${url}#${field.key}` })
              }
            }
          }

          // Add fixed sidebar sections
          const sections = [
            { label: 'Dashboard', section: 'Dashboard', url: '/console/dashboard' },
            { label: 'Canales', section: 'Navegación', url: '/console/channels' },
            { label: 'Contactos', section: 'Navegación', url: '/console/contacts' },
            { label: 'Conocimiento', section: 'Agente', url: '/console/agente/knowledge' },
            { label: 'Memoria', section: 'Agente', url: '/console/agente/memory' },
            { label: 'Identidad', section: 'Agente', url: '/console/agente/identity' },
            { label: 'Avanzado', section: 'Agente', url: '/console/agente/advanced' },
            { label: 'Herramientas', section: 'Herramientas', url: '/console/herramientas' },
            { label: 'LLM', section: 'Sistema', url: '/console/llm' },
            { label: 'Módulos', section: 'Sistema', url: '/console/modules' },
          ]
          for (const s of sections) {
            items.push({ key: '', label: s.label, section: s.section, url: s.url })
          }

          jsonResponse(res, 200, { items })
        } catch (err) {
          logger.error({ err }, 'search-index failed')
          jsonResponse(res, 500, { error: 'Internal server error' })
        }
      },
    },

    // POST /console/api/console/tts-preview — generate TTS preview audio via Gemini TTS
    {
      method: 'POST',
      path: 'tts-preview',
      handler: async (req, res) => {
        try {
          const body = await parseBody<{
            voiceName: string
            text: string
          }>(req)
          if (!body?.voiceName || !body?.text) {
            jsonResponse(res, 400, { error: 'voiceName and text required' })
            return
          }
          // Get Google AI API key from config store (same key as Gemini LLM)
          const { getRegistryRef } = await import('./manifest-ref.js')
          const registry = getRegistryRef()!
          const config = await configStore.getAll(registry.getDb())
          const apiKey = config['GOOGLE_AI_API_KEY']
          if (!apiKey) {
            jsonResponse(res, 400, { error: 'Google AI API key not configured' })
            return
          }
          const ttsResponse = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ role: 'user', parts: [{ text: body.text.substring(0, 500) }] }],
              generationConfig: {
                responseModalities: ['AUDIO'],
                speechConfig: {
                  voiceConfig: {
                    prebuiltVoiceConfig: { voiceName: body.voiceName },
                  },
                },
              },
            }),
          })
          if (!ttsResponse.ok) {
            const errText = await ttsResponse.text()
            logger.error({ status: ttsResponse.status, body: errText }, 'TTS preview API error')
            jsonResponse(res, 502, { error: 'Gemini TTS API error' })
            return
          }
          const data = await ttsResponse.json() as {
            candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data?: string } }> } }>
          }
          const base64Audio = data.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data
          if (!base64Audio) {
            logger.error('TTS preview: no audio data in Gemini response')
            jsonResponse(res, 502, { error: 'No audio data in response' })
            return
          }
          const pcmBuffer = Buffer.from(base64Audio, 'base64')
          // Convert raw PCM (16-bit LE, mono, 24kHz) to WAV for browser playback
          const sampleRate = 24000
          const channels = 1
          const bitsPerSample = 16
          const byteRate = sampleRate * channels * (bitsPerSample / 8)
          const blockAlign = channels * (bitsPerSample / 8)
          const dataSize = pcmBuffer.length
          const header = Buffer.alloc(44)
          header.write('RIFF', 0)
          header.writeUInt32LE(36 + dataSize, 4)
          header.write('WAVE', 8)
          header.write('fmt ', 12)
          header.writeUInt32LE(16, 16)
          header.writeUInt16LE(1, 20)
          header.writeUInt16LE(channels, 22)
          header.writeUInt32LE(sampleRate, 24)
          header.writeUInt32LE(byteRate, 28)
          header.writeUInt16LE(blockAlign, 32)
          header.writeUInt16LE(bitsPerSample, 34)
          header.write('data', 36)
          header.writeUInt32LE(dataSize, 40)
          const audioBuffer = Buffer.concat([header, pcmBuffer])
          res.writeHead(200, {
            'Content-Type': 'audio/wav',
            'Content-Length': String(audioBuffer.length),
          })
          res.end(audioBuffer)
        } catch (err) {
          logger.error({ err }, 'TTS preview failed')
          jsonResponse(res, 500, { error: 'Internal server error' })
        }
      },
    },
  ]
}
