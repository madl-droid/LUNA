// LUNA — Module: lead-scoring — Webhook Handler
// Registra leads desde sistemas externos via HTTP webhook.
// Auth por bearer token, valida campaña por keyword, crea contacto, dispara outbound.

import crypto from 'node:crypto'
import type { Pool } from 'pg'
import type { Registry } from '../../kernel/registry.js'
import type { CampaignQueries } from './campaign-queries.js'
import * as configStore from '../../kernel/config-store.js'
import pino from 'pino'

const logger = pino({ name: 'lead-scoring:webhook' })

// ═══════════════════════════════════════════
// Types
// ═══════════════════════════════════════════

export interface WebhookRegisterBody {
  email?: string
  phone?: string
  name?: string
  campaign: string  // keyword or visible_id
}

export interface WebhookRegisterResult {
  ok: boolean
  contactId: string
  channel: string
  campaignId?: string
  campaignName?: string
  warning?: string
}

export interface WebhookConfig {
  enabled: boolean
  token: string
  preferredChannel: string  // 'auto' | 'whatsapp' | 'email' | 'google-chat'
}

// ═══════════════════════════════════════════
// Config helpers
// ═══════════════════════════════════════════

const CONFIG_KEYS = {
  ENABLED: 'LEAD_WEBHOOK_ENABLED',
  TOKEN: 'LEAD_WEBHOOK_TOKEN',
  PREFERRED_CHANNEL: 'LEAD_WEBHOOK_PREFERRED_CHANNEL',
} as const

export async function loadWebhookConfig(db: Pool): Promise<WebhookConfig> {
  const enabled = await configStore.get(db, CONFIG_KEYS.ENABLED)
  const token = await configStore.get(db, CONFIG_KEYS.TOKEN)
  const preferredChannel = await configStore.get(db, CONFIG_KEYS.PREFERRED_CHANNEL)
  return {
    enabled: enabled === 'true',
    token: token ?? '',
    preferredChannel: preferredChannel || 'auto',
  }
}

export function generateToken(): string {
  return crypto.randomBytes(32).toString('hex')
}

export async function ensureToken(db: Pool): Promise<string> {
  const existing = await configStore.get(db, CONFIG_KEYS.TOKEN)
  if (existing) return existing
  const token = generateToken()
  await configStore.set(db, CONFIG_KEYS.TOKEN, token, true)
  // Also ensure defaults for other webhook config keys
  const enabled = await configStore.get(db, CONFIG_KEYS.ENABLED)
  if (enabled === null) {
    await configStore.set(db, CONFIG_KEYS.ENABLED, 'false')
  }
  const channel = await configStore.get(db, CONFIG_KEYS.PREFERRED_CHANNEL)
  if (channel === null) {
    await configStore.set(db, CONFIG_KEYS.PREFERRED_CHANNEL, 'auto')
  }
  logger.info('Webhook token auto-generated')
  return token
}

// ═══════════════════════════════════════════
// Auth
// ═══════════════════════════════════════════

export function extractBearerToken(authHeader: string | undefined): string | null {
  if (!authHeader) return null
  const match = authHeader.match(/^Bearer\s+(.+)$/i)
  return match?.[1] ?? null
}

// ═══════════════════════════════════════════
// DB: webhook log table
// ═══════════════════════════════════════════

export async function ensureWebhookTables(db: Pool): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS webhook_lead_log (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email TEXT,
      phone TEXT,
      display_name TEXT,
      campaign_keyword TEXT,
      campaign_id UUID,
      contact_id UUID,
      channel_used TEXT,
      success BOOLEAN DEFAULT true,
      error_message TEXT,
      created_at TIMESTAMPTZ DEFAULT now()
    )
  `)
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_webhook_lead_log_created
    ON webhook_lead_log (created_at DESC)
  `).catch(() => {})
}

// ═══════════════════════════════════════════
// Core: register lead
// ═══════════════════════════════════════════

export async function registerLead(
  body: WebhookRegisterBody,
  db: Pool,
  registry: Registry,
  campaignQueries: CampaignQueries,
): Promise<WebhookRegisterResult> {
  // ── Validate inputs ──
  if (!body.email && !body.phone) {
    throw new Error('Se requiere al menos email o phone')
  }

  // ── Find campaign by keyword ──
  let campaignId: string | null = null
  let campaignName: string | null = null
  let warning: string | undefined

  if (body.campaign) {
    const campaign = await findCampaignByKeyword(db, body.campaign)
    if (campaign) {
      campaignId = campaign.id
      campaignName = campaign.name
    } else {
      warning = `Keyword de campaña "${body.campaign}" no encontrada. Lead registrado sin campaña.`
      logger.warn({ keyword: body.campaign }, 'Webhook: campaign keyword not found')
    }
  }

  // ── Determine channel ──
  const config = await loadWebhookConfig(db)
  const preferredChannel = resolvePreferredChannel(config.preferredChannel, body, registry)

  const channelContactId = getChannelContactId(preferredChannel, body)
  if (!channelContactId) {
    throw new Error(
      `No se puede contactar por ${preferredChannel}: falta ${preferredChannel === 'email' ? 'email' : 'phone'}`,
    )
  }

  // ── Create or find contact ──
  const contactId = await upsertContact(db, body, channelContactId, preferredChannel, registry)

  // ── Link additional channels ──
  if (body.email && preferredChannel !== 'email') {
    await ensureContactChannel(db, contactId, 'email', body.email, false)
  }
  if (body.phone && preferredChannel !== 'whatsapp') {
    await ensureContactChannel(db, contactId, 'whatsapp', normalizePhone(body.phone), false)
  }

  // ── Record campaign attribution ──
  if (campaignId) {
    await campaignQueries.recordMatch(contactId, campaignId, null, preferredChannel, 1.0)
  }

  // ── Mark as outbound source ──
  await markOutboundSource(db, contactId)

  // ── Trigger outbound contact ──
  await triggerOutbound(registry, preferredChannel, channelContactId, body.name, campaignName)

  // ── Log ──
  await logWebhookAttempt(db, {
    email: body.email,
    phone: body.phone,
    displayName: body.name,
    campaignKeyword: body.campaign,
    campaignId,
    contactId,
    channelUsed: preferredChannel,
    success: true,
  })

  logger.info({ contactId, channel: preferredChannel, campaignId }, 'Webhook: lead registered')

  return {
    ok: true,
    contactId,
    channel: preferredChannel,
    campaignId: campaignId ?? undefined,
    campaignName: campaignName ?? undefined,
    warning,
  }
}

// ═══════════════════════════════════════════
// Campaign lookup
// ═══════════════════════════════════════════

async function findCampaignByKeyword(
  db: Pool,
  keyword: string,
): Promise<{ id: string; name: string } | null> {
  // Exact keyword match (case-insensitive)
  const byKeyword = await db.query<{ id: string; name: string }>(
    `SELECT id, name FROM campaigns WHERE LOWER(keyword) = LOWER($1) AND active = true LIMIT 1`,
    [keyword.trim()],
  )
  if (byKeyword.rows.length > 0) return byKeyword.rows[0]!

  // Try by visible_id (numeric)
  const numericId = parseInt(keyword, 10)
  if (!isNaN(numericId)) {
    const byVisibleId = await db.query<{ id: string; name: string }>(
      `SELECT id, name FROM campaigns WHERE visible_id = $1 AND active = true LIMIT 1`,
      [numericId],
    )
    if (byVisibleId.rows.length > 0) return byVisibleId.rows[0]!
  }

  // Try by UUID
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (uuidRegex.test(keyword.trim())) {
    const byUuid = await db.query<{ id: string; name: string }>(
      `SELECT id, name FROM campaigns WHERE id = $1 AND active = true LIMIT 1`,
      [keyword.trim()],
    )
    if (byUuid.rows.length > 0) return byUuid.rows[0]!
  }

  return null
}

// ═══════════════════════════════════════════
// Channel resolution
// ═══════════════════════════════════════════

function resolvePreferredChannel(
  preferred: string,
  body: WebhookRegisterBody,
  registry: Registry,
): string {
  // Get active channels
  const activeChannels = registry.listModules()
    .filter(m => m.manifest.type === 'channel' && m.active && m.manifest.channelType !== 'voice')
    .map(m => m.manifest.name)

  if (preferred !== 'auto' && activeChannels.includes(preferred)) {
    return preferred
  }

  // Auto: prefer whatsapp if phone provided and active, else email
  if (body.phone && activeChannels.includes('whatsapp')) return 'whatsapp'
  if (body.email && activeChannels.includes('email')) return 'email'
  if (body.email && activeChannels.includes('gmail')) return 'gmail'
  if (body.phone && activeChannels.includes('google-chat')) return 'google-chat'

  // Fallback: first active text channel
  if (activeChannels.length > 0) return activeChannels[0]!

  throw new Error('No hay canales activos disponibles para contactar al lead')
}

function getChannelContactId(channel: string, body: WebhookRegisterBody): string | null {
  if ((channel === 'email' || channel === 'gmail') && body.email) {
    return body.email.trim().toLowerCase()
  }
  if ((channel === 'whatsapp' || channel === 'google-chat') && body.phone) {
    return normalizePhone(body.phone)
  }
  return null
}

function normalizePhone(phone: string): string {
  // Remove spaces, dashes, parentheses — keep + and digits
  return phone.replace(/[\s\-()]/g, '')
}

// ═══════════════════════════════════════════
// Contact CRUD
// ═══════════════════════════════════════════

async function upsertContact(
  db: Pool,
  body: WebhookRegisterBody,
  channelContactId: string,
  channelName: string,
  registry: Registry,
): Promise<string> {
  // Try to find existing contact by channel
  const existing = await db.query<{ id: string }>(
    `SELECT c.id FROM contacts c
     JOIN contact_channels cc ON cc.contact_id = c.id
     WHERE cc.channel_contact_id = $1 AND cc.channel_name = $2
     LIMIT 1`,
    [channelContactId, channelName],
  )

  if (existing.rows.length > 0) {
    const contactId = existing.rows[0]!.id
    // Update display_name if provided and current is null
    if (body.name) {
      await db.query(
        `UPDATE contacts SET display_name = COALESCE(display_name, $1), updated_at = NOW() WHERE id = $2`,
        [body.name.trim(), contactId],
      )
    }
    return contactId
  }

  // Also check by other channel identifiers (cross-channel unification)
  if (body.email) {
    const byEmail = await db.query<{ id: string }>(
      `SELECT c.id FROM contacts c
       JOIN contact_channels cc ON cc.contact_id = c.id
       WHERE cc.channel_contact_id = $1 AND cc.channel_name IN ('email', 'gmail')
       LIMIT 1`,
      [body.email.trim().toLowerCase()],
    )
    if (byEmail.rows.length > 0) {
      const contactId = byEmail.rows[0]!.id
      await ensureContactChannel(db, contactId, channelName, channelContactId, true)
      if (body.name) {
        await db.query(
          `UPDATE contacts SET display_name = COALESCE(display_name, $1), updated_at = NOW() WHERE id = $2`,
          [body.name.trim(), contactId],
        )
      }
      return contactId
    }
  }

  if (body.phone) {
    const normalizedPhone = normalizePhone(body.phone)
    const byPhone = await db.query<{ id: string }>(
      `SELECT c.id FROM contacts c
       JOIN contact_channels cc ON cc.contact_id = c.id
       WHERE cc.channel_contact_id = $1 AND cc.channel_name = 'whatsapp'
       LIMIT 1`,
      [normalizedPhone],
    )
    if (byPhone.rows.length > 0) {
      const contactId = byPhone.rows[0]!.id
      await ensureContactChannel(db, contactId, channelName, channelContactId, true)
      if (body.name) {
        await db.query(
          `UPDATE contacts SET display_name = COALESCE(display_name, $1), updated_at = NOW() WHERE id = $2`,
          [body.name.trim(), contactId],
        )
      }
      return contactId
    }
  }

  // Create new contact
  const result = await db.query<{ id: string }>(
    `INSERT INTO contacts (display_name, contact_type, qualification_status, qualification_score, metadata)
     VALUES ($1, 'lead', 'new', 0, $2)
     RETURNING id`,
    [body.name?.trim() ?? null, JSON.stringify({ source: 'webhook-outbound' })],
  )
  const contactId = result.rows[0]!.id

  // Create primary channel
  await ensureContactChannel(db, contactId, channelName, channelContactId, true)

  // Fire contact:new hook
  await registry.runHook('contact:new', { contactId, channel: channelName })

  return contactId
}

async function ensureContactChannel(
  db: Pool,
  contactId: string,
  channelName: string,
  channelContactId: string,
  isPrimary: boolean,
): Promise<void> {
  await db.query(
    `INSERT INTO contact_channels (contact_id, channel_name, channel_contact_id, is_primary)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (channel_name, channel_contact_id) DO NOTHING`,
    [contactId, channelName, channelContactId, isPrimary],
  )
}

// ═══════════════════════════════════════════
// Outbound source marking
// ═══════════════════════════════════════════

async function markOutboundSource(db: Pool, contactId: string): Promise<void> {
  await db.query(
    `UPDATE contacts
     SET metadata = COALESCE(metadata, '{}'::jsonb) || '{"source": "webhook-outbound"}'::jsonb,
         updated_at = NOW()
     WHERE id = $1`,
    [contactId],
  )
}

// ═══════════════════════════════════════════
// Trigger outbound message
// ═══════════════════════════════════════════

async function triggerOutbound(
  registry: Registry,
  channel: string,
  to: string,
  name: string | undefined,
  campaignName: string | null,
): Promise<void> {
  // Build initial greeting
  const displayName = name?.trim()
  let greeting: string
  if (displayName && campaignName) {
    greeting = `Hola ${displayName}, te contactamos respecto a ${campaignName}. ¿En qué podemos ayudarte?`
  } else if (displayName) {
    greeting = `Hola ${displayName}, ¿en qué podemos ayudarte?`
  } else if (campaignName) {
    greeting = `Hola, te contactamos respecto a ${campaignName}. ¿En qué podemos ayudarte?`
  } else {
    greeting = 'Hola, ¿en qué podemos ayudarte?'
  }

  try {
    await registry.runHook('message:send', {
      channel,
      to,
      content: { type: 'text', text: greeting },
      correlationId: `webhook-${crypto.randomUUID()}`,
    })
    logger.info({ channel, to }, 'Webhook: outbound message triggered')
  } catch (err) {
    logger.error({ err, channel, to }, 'Webhook: failed to trigger outbound message')
    // Don't throw — the lead is already registered
  }
}

// ═══════════════════════════════════════════
// Logging
// ═══════════════════════════════════════════

async function logWebhookAttempt(db: Pool, data: {
  email?: string
  phone?: string
  displayName?: string
  campaignKeyword?: string
  campaignId: string | null
  contactId: string | null
  channelUsed: string | null
  success: boolean
  errorMessage?: string
}): Promise<void> {
  try {
    await db.query(
      `INSERT INTO webhook_lead_log
        (email, phone, display_name, campaign_keyword, campaign_id, contact_id, channel_used, success, error_message)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        data.email ?? null,
        data.phone ?? null,
        data.displayName ?? null,
        data.campaignKeyword ?? null,
        data.campaignId,
        data.contactId,
        data.channelUsed,
        data.success,
        data.errorMessage ?? null,
      ],
    )
  } catch (err) {
    logger.warn({ err }, 'Failed to log webhook attempt')
  }
}

export { logWebhookAttempt }
