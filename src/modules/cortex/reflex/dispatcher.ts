// cortex/reflex/dispatcher.ts — Multi-channel alert dispatch
// Sends alerts through configured channels. Respects dependency map.

import type { Registry } from '../../../kernel/registry.js'
import type { Alert, CortexConfig, DispatchChannel, CHANNEL_DEPENDENCIES } from '../types.js'
import pino from 'pino'

const logger = pino({ name: 'cortex:dispatcher' })

interface AdminContact {
  senderId: string
  channel: string
  displayName: string | null
}

/**
 * Dispatch an alert to all configured channels.
 * Filters out channels that depend on the failed component.
 */
export async function dispatchAlert(
  alert: Alert,
  failedComponents: string[],
  config: CortexConfig,
  registry: Registry,
  channelDeps: typeof CHANNEL_DEPENDENCIES,
): Promise<void> {
  const enabledChannels = config.CORTEX_REFLEX_CHANNELS
    .split(',')
    .map(c => c.trim())
    .filter(Boolean) as DispatchChannel[]

  if (enabledChannels.length === 0) {
    logger.warn('No dispatch channels configured')
    return
  }

  // Silence check: INFO alerts silenced during quiet hours (CRITICAL always passes)
  if (alert.severity === 'info' && isInSilenceWindow(config)) {
    logger.debug({ rule: alert.rule }, 'Alert silenced (quiet hours)')
    return
  }

  // Filter out channels that depend on failed components
  const availableChannels = enabledChannels.filter(ch => {
    const deps = channelDeps[ch] ?? []
    return !deps.some(dep => failedComponents.includes(dep))
  })

  if (availableChannels.length === 0) {
    logger.error({ failedComponents, enabledChannels }, 'All dispatch channels depend on failed components — cannot send alert')
    return
  }

  const message = formatAlertMessage(alert)

  // Resolve admin contacts
  const admins = await resolveAdmins(registry)

  // Dispatch through each available channel concurrently
  await Promise.allSettled(
    availableChannels.map(ch => sendViaChannel(ch, message, admins, config, registry)),
  )
}

/**
 * Dispatch a resolution notification.
 */
export async function dispatchResolution(
  alert: Alert,
  config: CortexConfig,
  registry: Registry,
  _channelDeps: typeof CHANNEL_DEPENDENCIES,
): Promise<void> {
  const enabledChannels = config.CORTEX_REFLEX_CHANNELS
    .split(',')
    .map(c => c.trim())
    .filter(Boolean) as DispatchChannel[]

  const message = formatResolutionMessage(alert)
  const admins = await resolveAdmins(registry)

  await Promise.allSettled(
    enabledChannels.map(ch => sendViaChannel(ch, message, admins, config, registry)),
  )
}

// ─── Formatting ────────────────────────

function formatAlertMessage(alert: Alert): string {
  const severityIcon = alert.severity === 'critical' ? '🔴' : alert.severity === 'degraded' ? '🟡' : 'ℹ️'
  const ts = new Date(alert.triggeredAt).toISOString()

  let msg = `${severityIcon} ${alert.severity.toUpperCase()} — ${alert.rule}\n`
  msg += `Timestamp: ${ts}\n\n`
  msg += alert.message

  if (alert.logs.length > 0) {
    msg += '\n\nÚltimos logs relevantes:\n'
    msg += alert.logs.join('\n')
  }

  return msg
}

function formatResolutionMessage(alert: Alert): string {
  const duration = alert.resolvedAt
    ? Math.round((alert.resolvedAt - alert.triggeredAt) / 1000)
    : 0
  return `✅ RESUELTO — ${alert.rule}\nDuración: ${duration}s\nResuelto: ${new Date().toISOString()}`
}

// ─── Channel senders ───────────────────

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
    logger.debug({ channel }, 'Alert dispatched')
  } catch (err) {
    logger.warn({ channel, err }, 'Failed to dispatch alert via channel')
    // Don't retry — other channels cover
  }
}

async function sendTelegram(message: string, config: CortexConfig): Promise<void> {
  const token = config.CORTEX_TELEGRAM_BOT_TOKEN
  const chatId = config.CORTEX_TELEGRAM_CHAT_ID
  if (!token || !chatId) {
    logger.warn('Telegram not configured (missing bot token or chat ID)')
    return
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: message,
      parse_mode: 'HTML',
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

// ─── Admin resolution ──────────────────

// ─── Silence window ─────────────────────

function isInSilenceWindow(config: CortexConfig): boolean {
  const now = new Date()
  const currentMinutes = now.getHours() * 60 + now.getMinutes()

  const [startH, startM] = config.CORTEX_REFLEX_SILENCE_START.split(':').map(Number)
  const [endH, endM] = config.CORTEX_REFLEX_SILENCE_END.split(':').map(Number)

  if (startH === undefined || startM === undefined || endH === undefined || endM === undefined) {
    return false
  }

  const startMinutes = startH * 60 + startM
  const endMinutes = endH * 60 + endM

  if (startMinutes <= endMinutes) {
    // Same day: e.g. 09:00 - 17:00
    return currentMinutes >= startMinutes && currentMinutes < endMinutes
  }
  // Crosses midnight: e.g. 23:00 - 07:00
  return currentMinutes >= startMinutes || currentMinutes < endMinutes
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
