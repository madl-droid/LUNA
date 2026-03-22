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
  registry.provide('kernel:server', server)

  // Mount API routes from active modules
  for (const mod of registry.listModules()) {
    if (mod.active && mod.manifest.console?.apiRoutes) {
      server.mountModuleRoutes(mod.manifest.name, mod.manifest.console.apiRoutes)
    }
  }

  // Auto-mount/unmount routes when modules are activated/deactivated at runtime
  registry.addHook('kernel', 'module:activated', async (payload) => {
    const mod = registry.getModule(payload.name)
    if (mod?.manifest.console?.apiRoutes) {
      server.mountModuleRoutes(mod.manifest.name, mod.manifest.console.apiRoutes)
    }
  })

  registry.addHook('kernel', 'module:deactivated', async (payload) => {
    server.unmountModuleRoutes(payload.name)
  })

  await server.start()

  const activeModules = registry.listModules().filter(m => m.active).map(m => m.manifest.name)
  logger.info({ modules: activeModules }, 'LUNA ready')

  // Graceful shutdown: stop modules cleanly so Baileys preserves auth in DB
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutdown signal received, stopping modules...')
    try {
      await server.stop()
      await registry.stopAll()
      await redis.quit()
      await db.end()
      logger.info('LUNA shut down cleanly')
      process.exit(0)
    } catch (err) {
      logger.error({ err }, 'Error during shutdown')
      process.exit(1)
    }
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
