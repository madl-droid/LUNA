// cortex/pulse/dispatch-bridge.ts — Bridge to Reflex dispatch channels
// Reuses the shared channel senders from reflex/dispatcher.ts.
// No silence window — Pulse messages are always delivered.

import type { Registry } from '../../../kernel/registry.js'
import type { CortexConfig, DispatchChannel } from '../types.js'
import { sendViaChannel, resolveAdmins } from '../reflex/dispatcher.js'
import pino from 'pino'

const logger = pino({ name: 'cortex:pulse:dispatch' })

/**
 * Send a Pulse message through all configured Reflex channels.
 * No silence window — Pulse messages are always delivered.
 */
export async function dispatchPulseMessage(
  message: string,
  config: CortexConfig,
  registry: Registry,
): Promise<void> {
  const enabledChannels = config.CORTEX_REFLEX_CHANNELS
    .split(',')
    .map(c => c.trim())
    .filter(Boolean) as DispatchChannel[]

  if (enabledChannels.length === 0) {
    logger.warn('No dispatch channels configured for Pulse')
    return
  }

  const admins = await resolveAdmins(registry)

  await Promise.allSettled(
    enabledChannels.map(ch => sendViaChannel(ch, message, admins, config, registry)),
  )
}
