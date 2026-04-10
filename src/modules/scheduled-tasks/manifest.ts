// scheduled-tasks/manifest.ts — Module manifest

import { z } from 'zod'
import type { ModuleManifest } from '../../kernel/types.js'
import type { Registry } from '../../kernel/registry.js'
import { boolEnv, numEnv, numEnvMin } from '../../kernel/config-helpers.js'
import type { ScheduledTasksConfig } from './types.js'
import * as store from './store.js'
import { startScheduler, stopScheduler, addDelayedJob, removeJobById } from './scheduler.js'
import { createApiRoutes } from './api-routes.js'
import { renderTasksSection } from './templates.js'
import { executeTask } from './executor.js'
import pino from 'pino'

const logger = pino({ name: 'scheduled-tasks' })

/** Event hooks that can trigger tasks */
const SUPPORTED_EVENTS = [
  'contact:new',
  'contact:status_changed',
  'message:incoming',
  'module:activated',
  'module:deactivated',
] as const

const manifest: ModuleManifest = {
  name: 'scheduled-tasks',
  version: '2.0.0',
  description: {
    es: 'Tareas programadas con destinatarios, acciones y triggers',
    en: 'Scheduled tasks with recipients, actions, and triggers',
  },
  type: 'feature',
  removable: true,
  activateByDefault: true,
  depends: ['llm'],

  configSchema: z.object({
    SCHEDULED_TASKS_ENABLED: boolEnv(true),
    SCHEDULED_TASKS_MAX_CONCURRENT: numEnvMin(1, 3),
    SCHEDULED_TASKS_EXECUTION_TIMEOUT_MS: numEnv(120_000),
    SCHEDULED_TASKS_MAX_MSG_PER_CONTACT_PER_HOUR: numEnvMin(0, 10),
  }),

  console: {
    title: { es: 'Tareas Automaticas', en: 'Automated Tasks' },
    info: { es: 'Configura tareas que el agente ejecuta automaticamente.', en: 'Configure tasks the agent runs automatically.' },
    order: 45,
    group: 'agent',
    icon: '&#128197;',
    apiRoutes: [], // populated in init()
  },

  async init(registry: Registry) {
    const config = registry.getConfig<ScheduledTasksConfig>('scheduled-tasks')

    const db = registry.getDb()
    const redis = registry.getRedis()

    // Set up API routes
    const routes = createApiRoutes(db, registry, config)
    if (manifest.console) {
      manifest.console.apiRoutes = routes
    }

    // Provide render function so console can call it
    registry.provide('scheduled-tasks:renderSection', async (lang: 'es' | 'en') => {
      const tasks = await store.listTasks(db)

      // Fetch user groups for the template
      let userGroups: Array<{ listType: string; displayName: string; isEnabled: boolean; users: Array<{ id: string; senderId: string; displayName: string | null; channel: string }> }> = []
      try {
        const usersDb = registry.getOptional<{
          getAllListConfigs(): Promise<Array<{ listType: string; displayName: string; isEnabled: boolean }>>
          listUsers(listType: string, activeOnly?: boolean): Promise<Array<{ id: string; senderId: string; displayName: string | null; channel: string }>>
        }>('users:db')
        if (usersDb) {
          const configs = await usersDb.getAllListConfigs()
          for (const cfg of configs) {
            if (!cfg.isEnabled) continue
            const users = await usersDb.listUsers(cfg.listType)
            userGroups.push({
              listType: cfg.listType,
              displayName: cfg.displayName,
              isEnabled: cfg.isEnabled,
              users: users.map(u => ({ id: u.id, senderId: u.senderId, displayName: u.displayName, channel: u.channel })),
            })
          }
        }
      } catch { /* users module not available */ }

      // Fetch available tools for the action selector
      let availableTools: Array<{ name: string; displayName: string }> = []
      try {
        const toolsReg = registry.getOptional<{
          getCatalog(): Array<{ name: string; description: string }>
        }>('tools:registry')
        if (toolsReg) {
          availableTools = toolsReg.getCatalog().map(t => ({ name: t.name, displayName: t.name }))
        }
      } catch { /* tools module not available */ }

      return renderTasksSection(tasks, lang, userGroups, availableTools)
    })

    // Provide programmatic API for other modules (e.g. medilink follow-ups)
    registry.provide('scheduled-tasks:api', {
      createTask: (input: import('./types.js').CreateTaskInput) => store.createTask(db, input),
      deleteTask: async (id: string) => { await store.deleteTask(db, id) },
      getTask: (id: string) => store.getTask(db, id),
      addDelayedJob,
      removeJobById,
    })

    // Register event-based triggers
    if (config.SCHEDULED_TASKS_ENABLED) {
      // FIX: ST-1 — Guard de recursión para prevenir loops infinitos en event-triggered tasks
      const MAX_TASK_DEPTH = 3
      const DEPTH_TTL = 60 // seconds

      for (const eventName of SUPPORTED_EVENTS) {
        registry.addHook('scheduled-tasks', eventName, async (payload, _correlationId) => {
          // Extract identifier from payload to track recursion depth
          const p = payload as Record<string, unknown>
          const entityId = (p['contactId'] ?? p['name'] ?? p['id'] ?? 'global') as string
          const depthKey = `task_depth:${eventName}:${entityId}`

          try {
            const depth = parseInt(await redis.get(depthKey) || '0', 10)
            if (depth >= MAX_TASK_DEPTH) {
              logger.warn({ eventName, entityId, depth }, 'Task recursion limit reached, skipping')
              return
            }
            await redis.set(depthKey, String(depth + 1), 'EX', DEPTH_TTL)
          } catch { /* Redis error — allow execution */ }

          const tasks = await store.getTasksByEvent(db, eventName)
          for (const task of tasks) {
            try {
              await executeTask(db, registry, task, config)
            } catch (err) {
              logger.error({ taskId: task.id, event: eventName, err }, 'Event-triggered task failed')
            }
          }

          try { await redis.decr(depthKey) } catch { /* best effort */ }
        }, 100) // low priority so other handlers run first
      }

      // Start cron scheduler
      await startScheduler(db, redis, registry, config)
    } else {
      logger.info('Scheduled tasks disabled by config')
    }

    logger.info('scheduled-tasks module initialized')
  },

  async stop() {
    await stopScheduler()
    logger.info('scheduled-tasks module stopped')
  },
}

export default manifest
