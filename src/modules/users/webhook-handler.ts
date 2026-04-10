// LUNA — Module: users — Webhook Handler
// Registro de contactos (coworker) via webhook externo.
// Crea/actualiza contactos con contact_origin = 'outbound', vincula canales,
// atribuye campaña, verifica WhatsApp, dispara primer contacto.

import crypto from 'node:crypto'
import type { Pool } from 'pg'
import type { Registry } from '../../kernel/registry.js'
import pino from 'pino'

export interface WebhookLeadsConfig {
  WEBHOOK_LEADS_ENABLED: boolean
  WEBHOOK_LEADS_TOKEN: string
  WEBHOOK_LEADS_PREFERRED_CHANNEL: string
}

export interface WebhookRegisterBody {
  email?: string
  phone?: string
  name?: string
  campaign?: string                      // OPCIONAL — keyword/visibleId/UUID de campaña
  utm?: Record<string, string>           // UTMs: {utm_source, utm_medium, utm_campaign, ...}
}

export interface WebhookRegisterResult {
  ok: boolean
  contactId: string
  channel: string
  campaignId?: string
  campaignName?: string
  matchSource?: string
  warning?: string
}

const logger = pino({ name: 'webhook-leads' })

// ═══════════════════════════════════════════
// Config helpers — reads from coworker syncConfig
// ═══════════════════════════════════════════

export async function loadWebhookConfig(registry: Registry): Promise<WebhookLeadsConfig> {
  type UDb = { getListConfig(lt: string): Promise<{ syncConfig: Record<string, unknown> } | null> }
  const usersDb = registry.getOptional<UDb>('users:db')
  if (!usersDb) return { WEBHOOK_LEADS_ENABLED: false, WEBHOOK_LEADS_TOKEN: '', WEBHOOK_LEADS_PREFERRED_CHANNEL: 'auto' }

  const cfg = await usersDb.getListConfig('lead')
  if (!cfg) return { WEBHOOK_LEADS_ENABLED: false, WEBHOOK_LEADS_TOKEN: '', WEBHOOK_LEADS_PREFERRED_CHANNEL: 'auto' }

  const sc = cfg.syncConfig
  return {
    WEBHOOK_LEADS_ENABLED: sc.webhookEnabled === true,
    WEBHOOK_LEADS_TOKEN: (sc.webhookToken as string) ?? '',
    WEBHOOK_LEADS_PREFERRED_CHANNEL: (sc.webhookPreferredChannel as string) || 'auto',
  }
}

export function generateToken(): string {
  return crypto.randomBytes(32).toString('hex')
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
// Phone normalization (WhatsApp JID format)
// ═══════════════════════════════════════════

/**
 * Normalize a phone number to E.164-ish format suitable for WhatsApp JID.
 * Strips spaces, dashes, parentheses, dots.
 * Ensures country code prefix (no leading +).
 * Result: e.g. "573155524620" (ready for @s.whatsapp.net suffix)
 */
function normalizePhoneForWhatsApp(phone: string): string {
  // Strip all non-digit characters except leading +
  let cleaned = phone.replace(/[^\d+]/g, '')
  // Remove leading +
  if (cleaned.startsWith('+')) cleaned = cleaned.slice(1)
  // Remove leading 00 (international prefix)
  if (cleaned.startsWith('00')) cleaned = cleaned.slice(2)
  return cleaned
}

/**
 * Check if a phone number is registered on WhatsApp via the adapter.
 * Returns { exists: true, jid } or { exists: false }.
 */
async function checkWhatsAppNumber(
  registry: Registry,
  phone: string,
): Promise<{ exists: boolean; jid?: string }> {
  type WaAdapter = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    socket?: any
  }
  const adapter = registry.getOptional<WaAdapter>('whatsapp:adapter')
  if (!adapter?.socket) {
    // WhatsApp not connected — assume exists to avoid losing leads
    return { exists: true }
  }

  try {
    const normalized = normalizePhoneForWhatsApp(phone)
    const jid = `${normalized}@s.whatsapp.net`
    // Baileys onWhatsApp returns array of { exists, jid }
    const results = await adapter.socket.onWhatsApp(jid)
    const result = results?.[0]
    if (result?.exists) {
      return { exists: true, jid: result.jid ?? jid }
    }
    return { exists: false }
  } catch (err) {
    logger.warn({ err, phone }, 'WhatsApp number check failed, assuming exists')
    // On error, assume exists to avoid losing leads
    return { exists: true }
  }
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

  // ── Find campaign: UTM takes priority, keyword is fallback ──
  const NO_CAMPAIGN_ID = '00000000-0000-0000-0000-000000000000'
  let campaignId: string = NO_CAMPAIGN_ID
  let campaignName: string = 'Sin campaña'
  let matchSource: 'webhook' | 'webhook_utm' = 'webhook'
  let utmData: Record<string, string> = {}
  let warning: string | undefined

  // Paso 1: Si hay UTMs, intentar match/auto-create por utm_campaign
  if (body.utm && Object.keys(body.utm).length > 0) {
    const { normalizeUtmData } = await import('../marketing-data/utm-parser.js')
    const normalized = normalizeUtmData(body.utm)

    if (normalized?.utm_campaign) {
      type CQ = {
        findByUtmCampaign(v: string): Promise<{ id: string; name: string; visibleId: number } | null>
        autoCreateFromUtm(v: string, utm: Record<string, string>): Promise<{ id: string; name: string; visibleId: number }>
      }
      const cq = registry.getOptional<CQ>('marketing-data:campaign-queries')
      if (cq) {
        let found = await cq.findByUtmCampaign(normalized.utm_campaign)
        if (!found) {
          found = await cq.autoCreateFromUtm(normalized.utm_campaign, normalized as Record<string, string>)
          // Recargar matcher para que la nueva campaña esté disponible
          const reload = registry.getOptional<() => Promise<void>>('marketing-data:reload-campaigns')
          if (reload) await reload()
        }
        campaignId = found.id
        campaignName = found.name
        matchSource = 'webhook_utm'
        utmData = normalized as Record<string, string>
      }
    } else if (normalized) {
      // Hay UTMs pero sin utm_campaign — guardar UTMs como contexto
      utmData = normalized as Record<string, string>
    }
  }

  // Paso 2: Si UTM no resolvió campaña, intentar por keyword (fallback)
  if (campaignId === NO_CAMPAIGN_ID && body.campaign) {
    const campaign = await findCampaignByKeyword(db, body.campaign)
    if (campaign) {
      campaignId = campaign.id
      campaignName = campaign.name
      matchSource = 'webhook'
    } else {
      warning = `Keyword de campaña "${body.campaign}" no encontrada. Lead asignado a "Sin campaña".`
      logger.warn({ keyword: body.campaign }, 'Campaign keyword not found — assigned to Sin campaña')
    }
  }

  // ── Check WhatsApp number if phone provided ──
  let phoneIsWhatsApp = true
  let normalizedPhone: string | null = null
  if (body.phone) {
    normalizedPhone = normalizePhoneForWhatsApp(body.phone)
    const waCheck = await checkWhatsAppNumber(registry, body.phone)
    phoneIsWhatsApp = waCheck.exists
    if (!phoneIsWhatsApp) {
      logger.info({ phone: normalizedPhone }, 'Phone not on WhatsApp, will save as voice only')
    }
  }

  // ── Determine preferred channel ──
  const preferredChannel = resolvePreferredChannel(
    config.WEBHOOK_LEADS_PREFERRED_CHANNEL,
    body,
    registry,
    phoneIsWhatsApp,
  )

  const channelContactId = getChannelContactId(preferredChannel, body, normalizedPhone)
  if (!channelContactId) {
    throw new Error(
      `No se puede contactar por ${preferredChannel}: falta ${preferredChannel === 'email' || preferredChannel === 'gmail' ? 'email' : 'phone'}`,
    )
  }

  // ── Create or update contact ──
  const { contactId, isNew } = await upsertContact(db, registry, body, channelContactId, preferredChannel, normalizedPhone)

  // ── Link additional channels (cross-channel unification) ──
  if (body.email && preferredChannel !== 'email' && preferredChannel !== 'gmail') {
    await ensureContactChannel(db, contactId, 'email', body.email.trim().toLowerCase(), false)
  }
  if (normalizedPhone) {
    // Only link whatsapp channel if number is on WhatsApp
    if (phoneIsWhatsApp && preferredChannel !== 'whatsapp') {
      await ensureContactChannel(db, contactId, 'whatsapp', normalizedPhone, false)
    }
    // Always link voice channel
    await ensureContactChannel(db, contactId, 'voice', normalizedPhone, false)
  }

  // ── Record campaign attribution (via lead-scoring service) ──
  if (campaignId) {
    await recordCampaignMatch(registry, contactId, campaignId, preferredChannel, matchSource, utmData)
  }

  // ── ALWAYS trigger outbound contact (new or existing) ──
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

  logger.info({ contactId, channel: preferredChannel, campaignId, isNew }, 'Lead registered via webhook')

  return {
    ok: true,
    contactId,
    channel: preferredChannel,
    campaignId: campaignId ?? undefined,
    campaignName: campaignName ?? undefined,
    matchSource,
    warning,
  }
}

// ═══════════════════════════════════════════
// Campaign lookup (direct SQL)
// ═══════════════════════════════════════════

async function findCampaignByKeyword(
  db: Pool,
  keyword: string,
): Promise<{ id: string; name: string } | null> {
  try {
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
  } catch (err) {
    // campaigns table may not exist if lead-scoring module is inactive
    logger.warn({ err: (err as Error).message, keyword }, 'Campaign lookup failed (table may not exist)')
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
  matchSource: string = 'webhook',
  utmData: Record<string, string> = {},
): Promise<void> {
  type CQ = {
    recordMatch(
      contactId: string,
      campaignId: string,
      sessionId: string | null,
      channelName: string | null,
      matchScore: number | null,
      matchSource?: string,
      utmData?: Record<string, string>,
    ): Promise<void>
  }
  const cq = registry.getOptional<CQ>('marketing-data:campaign-queries')
  if (cq) {
    try {
      await cq.recordMatch(contactId, campaignId, null, channelName, 1.0, matchSource, utmData)
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
  phoneIsWhatsApp: boolean,
): string {
  // Get active non-voice channels
  const activeChannels = registry.listModules()
    .filter(m => m.manifest.type === 'channel' && m.active && m.manifest.channelType !== 'voice')
    .map(m => m.manifest.name)

  if (preferred !== 'auto' && activeChannels.includes(preferred)) {
    // If preferred is whatsapp but phone isn't on WhatsApp, skip
    if (preferred === 'whatsapp' && !phoneIsWhatsApp) {
      // Fall through to auto logic
    } else {
      return preferred
    }
  }

  // Auto: prefer whatsapp if phone provided AND on WhatsApp, else email
  if (body.phone && phoneIsWhatsApp && activeChannels.includes('whatsapp')) return 'whatsapp'
  if (body.email && activeChannels.includes('email')) return 'email'
  if (body.email && activeChannels.includes('gmail')) return 'gmail'
  if (body.phone && activeChannels.includes('google-chat')) return 'google-chat'

  // Fallback: first active text channel
  if (activeChannels.length > 0) return activeChannels[0]!

  throw new Error('No hay canales activos disponibles para contactar al lead')
}

function getChannelContactId(
  channel: string,
  body: WebhookRegisterBody,
  normalizedPhone: string | null,
): string | null {
  if ((channel === 'email' || channel === 'gmail') && body.email) {
    return body.email.trim().toLowerCase()
  }
  if ((channel === 'whatsapp' || channel === 'google-chat') && normalizedPhone) {
    return normalizedPhone
  }
  return null
}

// ═══════════════════════════════════════════
// Contact CRUD — uses contacts.contact_origin
// ═══════════════════════════════════════════

async function upsertContact(
  db: Pool,
  _registry: Registry,
  body: WebhookRegisterBody,
  channelContactId: string,
  channelName: string,
  normalizedPhone: string | null,
): Promise<{ contactId: string; isNew: boolean }> {
  // Uses users + user_contacts tables (kernel schema)

  // 1. Try by primary channel identifier
  const existing = await db.query<{ user_id: string }>(
    `SELECT uc.user_id FROM user_contacts uc
     JOIN users u ON u.id = uc.user_id
     WHERE uc.sender_id = $1 AND uc.channel = $2
     LIMIT 1`,
    [channelContactId, channelName === 'voice' ? 'whatsapp' : channelName],
  )
  if (existing.rows.length > 0) {
    const contactId = existing.rows[0]!.user_id
    await updateContactData(db, contactId, body)
    return { contactId, isNew: false }
  }

  // 2. Cross-channel lookup by email
  if (body.email) {
    const byEmail = await db.query<{ user_id: string }>(
      `SELECT uc.user_id FROM user_contacts uc
       WHERE uc.sender_id = $1 AND uc.channel IN ('email', 'gmail')
       LIMIT 1`,
      [body.email.trim().toLowerCase()],
    )
    if (byEmail.rows.length > 0) {
      const contactId = byEmail.rows[0]!.user_id
      await ensureContactChannel(db, contactId, channelName, channelContactId, false)
      await updateContactData(db, contactId, body)
      return { contactId, isNew: false }
    }
  }

  // 3. Cross-channel lookup by phone
  if (normalizedPhone) {
    const byPhone = await db.query<{ user_id: string }>(
      `SELECT uc.user_id FROM user_contacts uc
       WHERE uc.sender_id = $1 AND uc.channel IN ('whatsapp', 'twilio-voice')
       LIMIT 1`,
      [normalizedPhone],
    )
    if (byPhone.rows.length > 0) {
      const contactId = byPhone.rows[0]!.user_id
      await ensureContactChannel(db, contactId, channelName, channelContactId, false)
      await updateContactData(db, contactId, body)
      return { contactId, isNew: false }
    }
  }

  // 4. Create new user as lead — generate collision-safe ID (8 bytes = 4.3T combinations)
  let userId: string
  let idAttempts = 0
  while (true) {
    userId = `USR-${crypto.randomBytes(8).toString('hex').toUpperCase()}`
    const exists = await db.query<{ id: string }>(`SELECT id FROM users WHERE id = $1`, [userId])
    if (exists.rows.length === 0) break
    idAttempts++
    logger.warn({ userId, attempt: idAttempts }, 'User ID collision detected — regenerating')
    if (idAttempts >= 3) throw new Error('Failed to generate unique user ID after 3 attempts')
  }
  await db.query(
    `INSERT INTO users (id, display_name, list_type, metadata, source)
     VALUES ($1, $2, 'lead', '{"contact_origin":"outbound"}'::jsonb, 'webhook')`,
    [userId, body.name?.trim() ?? null],
  )

  // Create primary channel contact
  await ensureContactChannel(db, userId, channelName, channelContactId, true)

  return { contactId: userId, isNew: true }
}

/**
 * Update existing user with provided name.
 */
async function updateContactData(
  db: Pool,
  userId: string,
  body: WebhookRegisterBody,
): Promise<void> {
  if (!body.name?.trim()) return
  await db.query(
    `UPDATE users SET display_name = $1, updated_at = NOW() WHERE id = $2`,
    [body.name.trim(), userId],
  )
}

async function ensureContactChannel(
  db: Pool,
  userId: string,
  channelName: string,
  channelContactId: string,
  isPrimary: boolean,
): Promise<void> {
  const channel = channelName === 'voice' ? 'twilio-voice' : (channelName === 'gmail' ? 'email' : channelName)

  // Check for existing channel contact owned by a different user before inserting
  const existing = await db.query<{ user_id: string }>(
    `SELECT user_id FROM user_contacts WHERE channel = $1 AND sender_id = $2 LIMIT 1`,
    [channel, channelContactId],
  )
  if (existing.rows.length > 0) {
    const existingUserId = existing.rows[0]!.user_id
    if (existingUserId !== userId) {
      logger.warn(
        { existingUserId, newUserId: userId, channel, senderId: channelContactId },
        'Contact channel already belongs to a different user — not reassigning (possible contact merge needed)',
      )
      return
    }
  }

  await db.query(
    `INSERT INTO user_contacts (user_id, channel, sender_id, is_primary)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (channel, sender_id) DO NOTHING`,
    [userId, channel, channelContactId, isPrimary],
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
  const hasCampaign = campaignName && campaignName !== 'Sin campaña'
  let greeting: string
  if (displayName && hasCampaign) {
    greeting = `Hola ${displayName}, te contactamos respecto a ${campaignName}. ¿En qué podemos ayudarte?`
  } else if (displayName) {
    greeting = `Hola ${displayName}, ¿en qué podemos ayudarte?`
  } else if (hasCampaign) {
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
