// LUNA — Leads Unified Nurturing Agent
// Entry point: carga config, inicia admin UI, logea estado.

import pino from 'pino'
import { config } from './config.js'
import { startAdminServer } from './admin/config-server.js'

const logger = pino({ name: 'luna', level: config.logLevel })

function main(): void {
  logger.info({
    env: config.nodeEnv,
    port: config.port,
    modules: config.modules,
    instanceConfig: {
      whatsappEnabled: config.instanceConfig.whatsapp.enabled,
      llmPrimaryProvider: config.instanceConfig.llm.primaryProvider,
      enabledChannels: config.instanceConfig.channels.enabledChannels,
      memoryBufferSize: config.instanceConfig.memory.bufferMessageCount,
    },
  }, 'LUNA starting...')

  // Start admin UI if enabled
  if (config.admin.enabled) {
    startAdminServer()
    logger.info({ port: config.admin.port }, 'Admin UI available')
  }

  // TODO: Initialize channels, pipeline, memory manager
  logger.info('LUNA initialized (channels + pipeline pending)')
}

main()
