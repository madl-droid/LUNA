// scheduled-tasks/manifest.ts — Module manifest

import { z } from 'zod'
import type { ModuleManifest } from '../../kernel/types.js'
import type { Registry } from '../../kernel/registry.js'
import { boolEnv, numEnv, numEnvMin } from '../../kernel/config-helpers.js'
import type { ScheduledTasksConfig } from './types.js'
import * as store from './store.js'
import { startScheduler, stopScheduler } from './scheduler.js'
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
  }),

  oficina: {
    title: { es: 'Tareas Programadas', en: 'Scheduled Tasks' },
    info: { es: 'Tareas que el agente ejecuta automaticamente', en: 'Tasks the agent runs automatically' },
    order: 45,
    apiRoutes: [], // populated in init()
  },

  async init(registry: Registry) {
    const config = registry.getConfig<ScheduledTasksConfig>('scheduled-tasks')

    const db = registry.getDb()
    const redis = registry.getRedis()

    // Ensure DB tables + migrations
    await store.ensureTables(db)

    // Set up API routes
    const routes = createApiRoutes(db, registry, config)
    if (manifest.oficina) {
      manifest.oficina.apiRoutes = routes
    }

    // Provide render function so oficina can call it
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

    // Register event-based triggers
    if (config.SCHEDULED_TASKS_ENABLED) {
      for (const eventName of SUPPORTED_EVENTS) {
        registry.addHook('scheduled-tasks', eventName, async (payload, correlationId) => {
          const tasks = await store.getTasksByEvent(db, eventName)
          for (const task of tasks) {
            try {
              await executeTask(db, registry, task, config)
            } catch (err) {
              logger.error({ taskId: task.id, event: eventName, err }, 'Event-triggered task failed')
            }
          }
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
