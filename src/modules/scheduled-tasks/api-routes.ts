// scheduled-tasks/api-routes.ts — CRUD + trigger + user groups API routes

import type { Pool } from 'pg'
import type { ApiRoute } from '../../kernel/types.js'
import type { Registry } from '../../kernel/registry.js'
import { jsonResponse, parseBody } from '../../kernel/http-helpers.js'
import type { CreateTaskInput, UpdateTaskInput, ScheduledTasksConfig } from './types.js'
import * as store from './store.js'
import { scheduleTask, unscheduleTask, triggerNow } from './scheduler.js'

// FIX: ST-3 — Validar cron expression antes de guardar/schedule
function isValidCron(expression: string): boolean {
  const parts = expression.trim().split(/\s+/)
  if (parts.length < 5 || parts.length > 6) return false
  const ranges: [number, number][] = [
    [0, 59],  // minute
    [0, 23],  // hour
    [1, 31],  // day of month
    [1, 12],  // month
    [0, 7],   // day of week
  ]
  for (let i = 0; i < Math.min(parts.length, 5); i++) {
    const part = parts[i]!
    if (part === '*' || /^\*\/\d+$/.test(part)) continue
    // Handle ranges (1-5) and lists (1,3,5)
    const segments = part.split(',')
    for (const seg of segments) {
      const rangeParts = seg.split('-')
      for (const rp of rangeParts) {
        const num = parseInt(rp, 10)
        if (isNaN(num) || num < ranges[i]![0] || num > ranges[i]![1]) return false
      }
    }
  }
  return true
}

export function createApiRoutes(db: Pool, registry: Registry, config: ScheduledTasksConfig): ApiRoute[] {
  return [
    // GET /console/api/scheduled-tasks/list
    {
      method: 'GET',
      path: 'list',
      handler: async (_req, res) => {
        try {
          const tasks = await store.listTasks(db)
          jsonResponse(res, 200, { tasks })
        } catch (err) {
          jsonResponse(res, 500, { error: String(err) })
        }
      },
    },

    // GET /console/api/scheduled-tasks/groups — user groups with users for recipient dropdown
    {
      method: 'GET',
      path: 'groups',
      handler: async (_req, res) => {
        try {
          const usersDb = registry.getOptional<{
            getAllListConfigs(): Promise<Array<{ listType: string; displayName: string; isEnabled: boolean }>>
            listUsers(listType: string, activeOnly?: boolean): Promise<Array<{ id: string; senderId: string; displayName: string | null; channel: string }>>
          }>('users:db')

          if (!usersDb) {
            jsonResponse(res, 200, { groups: [] })
            return
          }

          const configs = await usersDb.getAllListConfigs()
          const groups = []
          for (const cfg of configs) {
            if (!cfg.isEnabled) continue
            const users = await usersDb.listUsers(cfg.listType)
            groups.push({
              listType: cfg.listType,
              displayName: cfg.displayName,
              users: users.map(u => ({
                id: u.id,
                senderId: u.senderId,
                displayName: u.displayName,
                channel: u.channel,
              })),
            })
          }
          jsonResponse(res, 200, { groups })
        } catch (err) {
          jsonResponse(res, 500, { error: String(err) })
        }
      },
    },

    // GET /console/api/scheduled-tasks/tools — available tools for action selector
    {
      method: 'GET',
      path: 'tools',
      handler: async (_req, res) => {
        try {
          const toolsReg = registry.getOptional<{
            getCatalog(): Array<{ name: string; description: string; category: string }>
          }>('tools:registry')

          if (!toolsReg) {
            jsonResponse(res, 200, { tools: [] })
            return
          }

          jsonResponse(res, 200, { tools: toolsReg.getCatalog() })
        } catch (err) {
          jsonResponse(res, 500, { error: String(err) })
        }
      },
    },

    // POST /console/api/scheduled-tasks/create
    {
      method: 'POST',
      path: 'create',
      handler: async (req, res) => {
        try {
          const input = await parseBody<CreateTaskInput>(req)
          if (!input.name || !input.prompt) {
            jsonResponse(res, 400, { error: 'name and prompt are required' })
            return
          }
          // cron required only for cron trigger type
          if ((!input.trigger_type || input.trigger_type === 'cron') && !input.cron) {
            jsonResponse(res, 400, { error: 'cron is required for cron-triggered tasks' })
            return
          }
          // Default cron for non-cron triggers
          if (!input.cron) input.cron = '0 0 1 1 *' // placeholder for non-cron tasks (valid, never scheduled)

          // FIX: ST-3 — Validar cron string antes de guardar
          if (input.cron && !isValidCron(input.cron)) {
            jsonResponse(res, 400, { error: 'Invalid cron expression' })
            return
          }

          const task = await store.createTask(db, input)
          if (task.enabled && task.trigger_type === 'cron') {
            await scheduleTask(task)
          }
          jsonResponse(res, 201, { task })
        } catch (err) {
          jsonResponse(res, 500, { error: String(err) })
        }
      },
    },

    // PUT /console/api/scheduled-tasks/update
    {
      method: 'PUT',
      path: 'update',
      handler: async (req, res) => {
        try {
          const body = await parseBody<UpdateTaskInput & { id: string }>(req)
          if (!body.id) {
            jsonResponse(res, 400, { error: 'id is required' })
            return
          }
          // FIX: ST-3 — Validar cron string en updates también
          if (body.cron && !isValidCron(body.cron)) {
            jsonResponse(res, 400, { error: 'Invalid cron expression' })
            return
          }
          const task = await store.updateTask(db, body.id, body)
          if (!task) {
            jsonResponse(res, 404, { error: 'Task not found' })
            return
          }
          // Reschedule cron tasks (handles enable/disable + cron changes)
          if (task.trigger_type === 'cron' && task.enabled) {
            await scheduleTask(task)
          } else {
            await unscheduleTask(task.id)
          }
          jsonResponse(res, 200, { task })
        } catch (err) {
          jsonResponse(res, 500, { error: String(err) })
        }
      },
    },

    // DELETE /console/api/scheduled-tasks/delete
    {
      method: 'DELETE',
      path: 'delete',
      handler: async (req, res) => {
        try {
          const body = await parseBody<{ id: string }>(req)
          if (!body.id) {
            jsonResponse(res, 400, { error: 'id is required' })
            return
          }
          await unscheduleTask(body.id)
          const deleted = await store.deleteTask(db, body.id)
          jsonResponse(res, deleted ? 200 : 404, { ok: deleted })
        } catch (err) {
          jsonResponse(res, 500, { error: String(err) })
        }
      },
    },

    // POST /console/api/scheduled-tasks/trigger
    {
      method: 'POST',
      path: 'trigger',
      handler: async (req, res) => {
        try {
          const body = await parseBody<{ id: string }>(req)
          if (!body.id) {
            jsonResponse(res, 400, { error: 'id is required' })
            return
          }
          const task = await store.getTask(db, body.id)
          if (!task) {
            jsonResponse(res, 404, { error: 'Task not found' })
            return
          }
          const result = await triggerNow(db, registry, task, config)
          jsonResponse(res, 200, { result })
        } catch (err) {
          jsonResponse(res, 500, { error: String(err) })
        }
      },
    },

    // GET /console/api/scheduled-tasks/executions
    {
      method: 'GET',
      path: 'executions',
      handler: async (req, res) => {
        try {
          const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`)
          const taskId = url.searchParams.get('taskId')
          if (!taskId) {
            jsonResponse(res, 400, { error: 'taskId query param required' })
            return
          }
          const executions = await store.listExecutions(db, taskId)
          jsonResponse(res, 200, { executions })
        } catch (err) {
          jsonResponse(res, 500, { error: String(err) })
        }
      },
    },
  ]
}
