import 'varlock/auto';
import pino from 'pino';
import { loadConfig } from './config.js';
import { startConfigServer } from './admin/config-server.js';

const logger = pino({ level: process.env['LOG_LEVEL'] ?? 'info' });

async function main(): Promise<void> {
  logger.info('Luna starting...');

  const config = loadConfig();
  logger.info({ nodeEnv: config.env.nodeEnv }, 'Config loaded');
  logger.info(
    { enabledChannels: config.instance.channels.enabledChannels },
    'Channels configured',
  );
  logger.info(
    {
      primaryProvider: config.instance.llm.primaryProvider,
      fallbackProvider: config.instance.llm.fallbackProvider,
    },
    'LLM providers configured',
  );
  logger.info(
    {
      bufferSize: config.instance.memory.bufferMessageCount,
      sessionTTL: `${config.instance.memory.sessionMaxTTLHours}h`,
      inactivityTimeout: `${config.instance.memory.sessionInactivityTimeoutMinutes}min`,
    },
    'Memory buffer configured',
  );

  // Start admin config UI
  startConfigServer();

  logger.info('Luna ready');
}

main().catch((err) => {
  logger.fatal(err, 'Failed to start Luna');
  process.exit(1);
});
