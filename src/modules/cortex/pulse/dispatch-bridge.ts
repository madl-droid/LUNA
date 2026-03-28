// cortex/pulse/dispatch-bridge.ts — Bridge to Reflex dispatch channels
// Reuses the same admin resolution and channel sending logic.

import type { Registry } from '../../../kernel/registry.js'
import type { CortexConfig, DispatchChannel } from '../types.js'
import pino from 'pino'

const logger = pino({ name: 'cortex:pulse:dispatch' })

interface AdminContact {
  senderId: string
  channel: string
  displayName: string | null
}

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

async function sendViaChannel(
  channel: DispatchChannel,
  message: string,
  admins: AdminContact[],
  config: CortexConfig,
  registry: Registry,
): Promise<void> {
  try {
    switch (channel) {
      case 'telegram':
        await sendTelegram(message, config)
        break
      case 'whatsapp':
        await sendWhatsApp(message, admins, registry)
        break
      case 'email':
        await sendEmail(message, admins, registry)
        break
    }
    logger.debug({ channel }, 'Pulse message dispatched')
  } catch (err) {
    logger.warn({ channel, err }, 'Failed to dispatch Pulse message')
  }
}

async function sendTelegram(message: string, config: CortexConfig): Promise<void> {
  const token = config.CORTEX_TELEGRAM_BOT_TOKEN
  const chatId = config.CORTEX_TELEGRAM_CHAT_ID
  if (!token || !chatId) return

  const resp = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: message,
      disable_web_page_preview: true,
    }),
  })

  if (!resp.ok) {
    const body = await resp.text()
    throw new Error(`Telegram API error ${resp.status}: ${body}`)
  }
}

async function sendWhatsApp(message: string, admins: AdminContact[], registry: Registry): Promise<void> {
  const waAdmins = admins.filter(a => a.channel === 'whatsapp')
  for (const admin of waAdmins) {
    await registry.runHook('message:send', {
      channel: 'whatsapp',
      to: admin.senderId,
      content: { type: 'text', text: message },
    })
  }
}

async function sendEmail(message: string, admins: AdminContact[], registry: Registry): Promise<void> {
  const emailAdmins = admins.filter(a => a.channel === 'email')
  for (const admin of emailAdmins) {
    await registry.runHook('message:send', {
      channel: 'email',
      to: admin.senderId,
      content: { type: 'text', text: message },
    })
  }
}

async function resolveAdmins(registry: Registry): Promise<AdminContact[]> {
  try {
    const usersDb = registry.getOptional<{
      listUsers(listType: string, activeOnly?: boolean): Promise<Array<{
        id: string; senderId: string; displayName: string | null; channel: string
      }>>
    }>('users:db')
    if (!usersDb) return []
    const admins = await usersDb.listUsers('admin', true)
    return admins.map(a => ({
      senderId: a.senderId,
      channel: a.channel,
      displayName: a.displayName,
    }))
  } catch {
    return []
  }
}
