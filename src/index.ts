// LUNA — Leads Unified Nurturing Agent
// Entry point: kernel boots, loads modules, starts server.

import { createPool } from './kernel/db.js'
import { createRedis } from './kernel/redis.js'
import { Registry } from './kernel/registry.js'
import { loadModules } from './kernel/loader.js'
import { Server } from './kernel/server.js'
import { kernelConfig } from './kernel/config.js'
import pino from 'pino'

const logger = pino({ name: 'luna' })

async function main(): Promise<void> {
  logger.info({ env: kernelConfig.nodeEnv }, 'LUNA starting...')

  const db = await createPool()
  const redis = await createRedis()
  const registry = new Registry(db, redis)

  // Load and activate modules from src/modules/
  await loadModules(registry)

  // Start HTTP server (mounts module routes + /health)
  const server = new Server(registry)

  // Mount API routes from active modules
  for (const mod of registry.listModules()) {
    if (mod.active && mod.manifest.oficina?.apiRoutes) {
      server.mountModuleRoutes(mod.manifest.name, mod.manifest.oficina.apiRoutes)
    }
  }

  await server.start()

  const activeModules = registry.listModules().filter(m => m.active).map(m => m.manifest.name)
  logger.info({ modules: activeModules }, 'LUNA ready')
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
