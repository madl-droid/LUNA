// LUNA — Leads Unified Nurturing Agent
// Entry point: kernel boots, checks setup, loads modules, starts server.

import * as http from 'node:http'
import { createPool } from './kernel/db.js'
import { createRedis } from './kernel/redis.js'
import { Registry } from './kernel/registry.js'
import { loadModules } from './kernel/loader.js'
import { Server } from './kernel/server.js'
import { kernelConfig } from './kernel/config.js'
import { initCacheFlag } from './kernel/cache-flag.js'
import { initExtremeLogger } from './kernel/extreme-logger.js'
import { isSetupCompleted } from './kernel/setup/detect.js'
import { createSetupHandler } from './kernel/setup/handler.js'
import { ensureInstanceDirs } from './kernel/bootstrap.js'
import pino from 'pino'

// FIX: SEC-12.1 — PII redaction en logs
const logger = pino({
  name: 'luna',
  redact: {
    paths: ['email', 'phone', 'contactPhone', 'document', 'patientId',
            '*.email', '*.phone', '*.contactPhone', '*.document'],
    censor: '[REDACTED]',
  },
})

/** Run the setup wizard on a temporary HTTP server. Blocks until setup completes. */
async function runSetupWizard(db: import('pg').Pool, redis: import('ioredis').Redis): Promise<void> {
  logger.info('Setup not completed — starting installation wizard...')

  return new Promise<void>((resolve) => {
    const handler = createSetupHandler(db, redis, () => {
      // On setup complete, close temp server and continue boot
      tempServer.close(() => {
        logger.info('Setup wizard completed, continuing boot sequence...')
        resolve()
      })
    })

    const tempServer = http.createServer(async (req: http.IncomingMessage, res: http.ServerResponse) => {
      try {
        await handler(req, res)
      } catch (err) {
        logger.error({ err, url: req.url }, 'Setup handler error')
        res.writeHead(500, { 'Content-Type': 'text/plain' })
        res.end('Internal server error')
      }
    })

    const port = kernelConfig.port
    tempServer.listen(port, () => {
      logger.info({ port }, 'Setup wizard available at http://localhost:%d/setup', port)
    })
  })
}

// FIX: K-3 — Handlers globales para errores no capturados
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception — shutting down')
  process.exit(1)
})
process.on('unhandledRejection', (reason) => {
  logger.fatal({ reason }, 'Unhandled rejection — shutting down')
  process.exit(1)
})

async function main(): Promise<void> {
  logger.info({ env: kernelConfig.nodeEnv }, 'LUNA starting...')

  // Ensure instance/ directories exist (fresh containers)
  await ensureInstanceDirs()

  const db = await createPool()
  initCacheFlag(db)
  initExtremeLogger(db)
  const redis = await createRedis()

  // Check if setup wizard is needed (fresh install)
  if (!await isSetupCompleted(db)) {
    await runSetupWizard(db, redis)
  }

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
