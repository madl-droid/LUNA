// LUNA — Module: webhook-leads — Handler
// Lógica de registro de leads via webhook externo.
// Crea contactos con contact_origin = 'outbound', vincula canales,
// atribuye campaña (vía lead-scoring), dispara primer contacto.

import crypto from 'node:crypto'
import type { Pool } from 'pg'
import type { Registry } from '../../kernel/registry.js'
import * as configStore from '../../kernel/config-store.js'
import pino from 'pino'
import type {
  WebhookLeadsConfig,
  WebhookRegisterBody,
  WebhookRegisterResult,
} from './types.js'

const logger = pino({ name: 'webhook-leads' })

// ═══════════════════════════════════════════
// Config helpers
// ═══════════════════════════════════════════

const CONFIG_KEYS = {
  ENABLED: 'WEBHOOK_LEADS_ENABLED',
  TOKEN: 'WEBHOOK_LEADS_TOKEN',
  PREFERRED_CHANNEL: 'WEBHOOK_LEADS_PREFERRED_CHANNEL',
} as const

export async function loadWebhookConfig(db: Pool): Promise<WebhookLeadsConfig> {
  const enabled = await configStore.get(db, CONFIG_KEYS.ENABLED)
  const token = await configStore.get(db, CONFIG_KEYS.TOKEN)
  const preferredChannel = await configStore.get(db, CONFIG_KEYS.PREFERRED_CHANNEL)
  return {
    WEBHOOK_LEADS_ENABLED: enabled === 'true',
    WEBHOOK_LEADS_TOKEN: token ?? '',
    WEBHOOK_LEADS_PREFERRED_CHANNEL: preferredChannel || 'auto',
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

  // Set defaults for other webhook keys if not present
  const enabled = await configStore.get(db, CONFIG_KEYS.ENABLED)
  if (enabled === null) await configStore.set(db, CONFIG_KEYS.ENABLED, 'false')

  const channel = await configStore.get(db, CONFIG_KEYS.PREFERRED_CHANNEL)
  if (channel === null) await configStore.set(db, CONFIG_KEYS.PREFERRED_CHANNEL, 'auto')

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
  config: WebhookLeadsConfig,
): Promise<WebhookRegisterResult> {
  // ── Validate inputs ──
  if (!body.email && !body.phone) {
    throw new Error('Se requiere al menos email o phone')
  }

  // ── Find campaign by keyword (via lead-scoring service) ──
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
      logger.warn({ keyword: body.campaign }, 'Campaign keyword not found')
    }
  }

  // ── Determine preferred channel ──
  const preferredChannel = resolvePreferredChannel(
    config.WEBHOOK_LEADS_PREFERRED_CHANNEL,
    body,
    registry,
  )

  const channelContactId = getChannelContactId(preferredChannel, body)
  if (!channelContactId) {
    throw new Error(
      `No se puede contactar por ${preferredChannel}: falta ${preferredChannel === 'email' || preferredChannel === 'gmail' ? 'email' : 'phone'}`,
    )
  }

  // ── Create or find contact ──
  const contactId = await upsertContact(db, registry, body, channelContactId, preferredChannel)

  // ── Link additional channels (cross-channel unification) ──
  if (body.email && preferredChannel !== 'email' && preferredChannel !== 'gmail') {
    await ensureContactChannel(db, contactId, 'email', body.email.trim().toLowerCase(), false)
  }
  if (body.phone) {
    const normalizedPhone = normalizePhone(body.phone)
    if (preferredChannel !== 'whatsapp') {
      await ensureContactChannel(db, contactId, 'whatsapp', normalizedPhone, false)
    }
    // Also link voice channel for call linking
    await ensureContactChannel(db, contactId, 'voice', normalizedPhone, false)
  }

  // ── Record campaign attribution (via lead-scoring service) ──
  if (campaignId) {
    await recordCampaignMatch(registry, contactId, campaignId, preferredChannel)
  }

  // ── Trigger outbound contact ──
  await triggerOutbound(registry, preferredChannel, channelContactId, body.name, campaignName)

  // ── Log success ──
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

  logger.info({ contactId, channel: preferredChannel, campaignId }, 'Lead registered via webhook')

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
// Campaign lookup (direct SQL — no direct import from lead-scoring)
// ═══════════════════════════════════════════

async function findCampaignByKeyword(
  db: Pool,
  keyword: string,
): Promise<{ id: string; name: string } | null> {
  // 1. Exact keyword match (case-insensitive)
  const byKeyword = await db.query<{ id: string; name: string }>(
    `SELECT id, name FROM campaigns WHERE LOWER(keyword) = LOWER($1) AND active = true LIMIT 1`,
    [keyword.trim()],
  )
  if (byKeyword.rows.length > 0) return byKeyword.rows[0]!

  // 2. Try by visible_id (numeric)
  const numericId = parseInt(keyword, 10)
  if (!isNaN(numericId) && String(numericId) === keyword.trim()) {
    const byVisibleId = await db.query<{ id: string; name: string }>(
      `SELECT id, name FROM campaigns WHERE visible_id = $1 AND active = true LIMIT 1`,
      [numericId],
    )
    if (byVisibleId.rows.length > 0) return byVisibleId.rows[0]!
  }

  // 3. Try by UUID
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
// Campaign attribution (via lead-scoring service)
// ═══════════════════════════════════════════

async function recordCampaignMatch(
  registry: Registry,
  contactId: string,
  campaignId: string,
  channelName: string,
): Promise<void> {
  type CQ = {
    recordMatch(
      contactId: string,
      campaignId: string,
      sessionId: string | null,
      channelName: string | null,
      matchScore: number | null,
    ): Promise<void>
  }
  const cq = registry.getOptional<CQ>('lead-scoring:campaign-queries')
  if (cq) {
    try {
      await cq.recordMatch(contactId, campaignId, null, channelName, 1.0)
    } catch (err) {
      logger.warn({ err, contactId, campaignId }, 'Failed to record campaign match')
    }
  }
}

// ═══════════════════════════════════════════
// Channel resolution
// ═══════════════════════════════════════════

function resolvePreferredChannel(
  preferred: string,
  body: WebhookRegisterBody,
  registry: Registry,
): string {
  // Get active non-voice channels
  const activeChannels = registry.listModules()
    .filter(m => m.manifest.type === 'channel' && m.active && m.manifest.channelType !== 'voice')
    .map(m => m.manifest.name)

  if (preferred !== 'auto' && activeChannels.includes(preferred)) {
    return preferred
  }

  // Auto: prefer whatsapp if phone provided, else email
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
  return phone.replace(/[\s\-()]/g, '')
}

// ═══════════════════════════════════════════
// Contact CRUD — uses contacts.contact_origin
// ═══════════════════════════════════════════

async function upsertContact(
  db: Pool,
  registry: Registry,
  body: WebhookRegisterBody,
  channelContactId: string,
  channelName: string,
): Promise<string> {
  // 1. Try by primary channel identifier
  const existing = await db.query<{ id: string }>(
    `SELECT c.id FROM contacts c
     JOIN contact_channels cc ON cc.contact_id = c.id
     WHERE cc.channel_contact_id = $1 AND cc.channel_name = $2
     LIMIT 1`,
    [channelContactId, channelName],
  )
  if (existing.rows.length > 0) {
    const contactId = existing.rows[0]!.id
    await updateContactIfNeeded(db, contactId, body.name)
    return contactId
  }

  // 2. Cross-channel lookup by email
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
      await ensureContactChannel(db, contactId, channelName, channelContactId, false)
      await updateContactIfNeeded(db, contactId, body.name)
      return contactId
    }
  }

  // 3. Cross-channel lookup by phone
  if (body.phone) {
    const normalizedPhone = normalizePhone(body.phone)
    const byPhone = await db.query<{ id: string }>(
      `SELECT c.id FROM contacts c
       JOIN contact_channels cc ON cc.contact_id = c.id
       WHERE cc.channel_contact_id = $1 AND cc.channel_name IN ('whatsapp', 'voice')
       LIMIT 1`,
      [normalizedPhone],
    )
    if (byPhone.rows.length > 0) {
      const contactId = byPhone.rows[0]!.id
      await ensureContactChannel(db, contactId, channelName, channelContactId, false)
      await updateContactIfNeeded(db, contactId, body.name)
      return contactId
    }
  }

  // 4. Create new contact — contact_origin = 'outbound'
  const result = await db.query<{ id: string }>(
    `INSERT INTO contacts (display_name, contact_type, qualification_status, qualification_score, contact_origin)
     VALUES ($1, 'lead', 'new', 0, 'outbound')
     RETURNING id`,
    [body.name?.trim() ?? null],
  )
  const contactId = result.rows[0]!.id

  // Create primary channel
  await ensureContactChannel(db, contactId, channelName, channelContactId, true)

  // Populate extra fields if available
  if (body.email) {
    await db.query(
      `UPDATE contacts SET email = COALESCE(email, $1) WHERE id = $2`,
      [body.email.trim().toLowerCase(), contactId],
    )
  }
  if (body.phone) {
    await db.query(
      `UPDATE contacts SET phone = COALESCE(phone, $1) WHERE id = $2`,
      [normalizePhone(body.phone), contactId],
    )
  }

  // Fire contact:new hook
  await registry.runHook('contact:new', { contactId, channel: channelName })

  return contactId
}

async function updateContactIfNeeded(db: Pool, contactId: string, name?: string): Promise<void> {
  if (!name) return
  await db.query(
    `UPDATE contacts SET display_name = COALESCE(display_name, $1), updated_at = NOW() WHERE id = $2`,
    [name.trim(), contactId],
  )
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
// Trigger outbound message
// ═══════════════════════════════════════════

async function triggerOutbound(
  registry: Registry,
  channel: string,
  to: string,
  name: string | undefined,
  campaignName: string | null,
): Promise<void> {
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
    logger.info({ channel, to }, 'Outbound message triggered')
  } catch (err) {
    logger.error({ err, channel, to }, 'Failed to trigger outbound message')
  }
}

// ═══════════════════════════════════════════
// Logging
// ═══════════════════════════════════════════

export async function logWebhookAttempt(db: Pool, data: {
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
