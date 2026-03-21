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
import pino from 'pino'

const logger = pino({ name: 'scheduled-tasks' })

const manifest: ModuleManifest = {
  name: 'scheduled-tasks',
  version: '1.0.0',
  description: {
    es: 'Tareas programadas que el agente ejecuta automaticamente',
    en: 'Scheduled tasks the agent executes automatically',
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

    // Ensure DB tables
    await store.ensureTables(db)

    // Set up API routes (mutate the array so oficina picks them up)
    const routes = createApiRoutes(db, registry, config)

    // Add the UI route that renders tasks inline (used by oficina section)
    // Not needed since we render inline in the section, but keep list endpoint

    if (manifest.oficina) {
      manifest.oficina.apiRoutes = routes
    }

    // Provide render function so oficina can call it
    registry.provide('scheduled-tasks:renderSection', async (lang: 'es' | 'en') => {
      const tasks = await store.listTasks(db)
      return renderTasksSection(tasks, lang)
    })

    // Start scheduler if enabled
    if (config.SCHEDULED_TASKS_ENABLED) {
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
