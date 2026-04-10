// hitl/handoff.ts — Channel-aware handoff logic

import type { Redis } from 'ioredis'
import type { Pool } from 'pg'
import type { HitlTicket } from './types.js'
import pino from 'pino'

const logger = pino({ name: 'hitl:handoff' })

// Channels that support full handoff (human takes direct control)
const FULL_HANDOFF_CHANNELS = new Set(['email', 'gmail'])

// Redis key TTL: 7 days (handoff can last a while)
const HANDOFF_KEY_TTL = 7 * 24 * 3600

export type HandoffAction = 'share_contact' | 'full_handoff'

/**
 * Determine the handoff action based on the requester's channel.
 */
export function getHandoffAction(requesterChannel: string): HandoffAction {
  return FULL_HANDOFF_CHANNELS.has(requesterChannel) ? 'full_handoff' : 'share_contact'
}

/**
 * Get client's shareable contact info (phone, email — NEVER LID or internal IDs).
 */
export async function getShareableContact(
  requesterSenderId: string,
  requesterChannel: string,
  db: Pool,
): Promise<{ name: string | null; phone: string | null; email: string | null }> {
  // Find the user by their sender_id and get all their contacts
  const { rows } = await db.query(
    `SELECT u.display_name, uc.channel, uc.sender_id
     FROM user_contacts uc
     JOIN users u ON u.id = uc.user_id
     WHERE uc.user_id = (
       SELECT user_id FROM user_contacts
       WHERE sender_id = $1 AND channel = $2
       LIMIT 1
     )`,
    [requesterSenderId, requesterChannel],
  )

  let name: string | null = null
  let phone: string | null = null
  let email: string | null = null

  for (const row of rows) {
    if (!name && row.display_name) name = row.display_name as string

    const ch = row.channel as string
    const sid = row.sender_id as string

    // For WhatsApp: senderId might be a LID — resolve to phone from contacts table
    if ((ch === 'whatsapp') && sid && !sid.includes(':')) {
      // Plain phone number (not LID)
      phone = sid.replace(/@s\.whatsapp\.net$/, '')
    } else if (ch === 'email' || ch === 'gmail') {
      email = sid
    } else if (ch === 'twilio-voice') {
      phone = sid
    }
  }

  // If we only have WhatsApp LID and no phone, check contact_channels for resolved phone
  if (!phone && requesterChannel === 'whatsapp') {
    const { rows: contactRows } = await db.query(
      `SELECT c.phone FROM contacts c
       JOIN contact_channels cc ON cc.contact_id = c.id
       WHERE cc.channel_identifier = $1 AND cc.channel_type = 'whatsapp'
       LIMIT 1`,
      [requesterSenderId],
    )
    if (contactRows[0]?.phone) phone = contactRows[0].phone as string
  }

  return { name, phone, email }
}

/**
 * Format shareable contact info for the human responder.
 */
export function formatContactForHuman(
  contact: { name: string | null; phone: string | null; email: string | null },
  lang: 'es' | 'en' = 'es',
): string {
  const lines: string[] = []
  const label = lang === 'es' ? 'Datos del cliente' : 'Client contact info'
  lines.push(`*${label}:*`)
  if (contact.name) lines.push(`- ${lang === 'es' ? 'Nombre' : 'Name'}: ${contact.name}`)
  if (contact.phone) lines.push(`- ${lang === 'es' ? 'Telefono' : 'Phone'}: ${contact.phone}`)
  if (contact.email) lines.push(`- Email: ${contact.email}`)
  if (!contact.phone && !contact.email) {
    lines.push(lang === 'es' ? '(Sin datos de contacto disponibles)' : '(No contact info available)')
  }
  return lines.join('\n')
}

// ═══════════════════════════════════════════
// Full handoff: pause/resume agent
// ═══════════════════════════════════════════

function handoffKey(channel: string, senderId: string): string {
  return `hitl:handoff:${channel}:${senderId}`
}

/**
 * Activate full handoff: agent pauses for this contact+channel.
 */
export async function activateHandoff(ticket: HitlTicket, redis: Redis): Promise<void> {
  const key = handoffKey(ticket.requesterChannel, ticket.requesterSenderId)
  await redis.set(key, ticket.id, 'EX', HANDOFF_KEY_TTL)
  logger.info({ ticketId: ticket.id, channel: ticket.requesterChannel }, 'Handoff activated — agent paused')
}

/**
 * Deactivate full handoff: agent resumes for this contact+channel.
 */
export async function deactivateHandoff(channel: string, senderId: string, redis: Redis): Promise<void> {
  const key = handoffKey(channel, senderId)
  await redis.del(key)
  logger.info({ channel, senderId }, 'Handoff deactivated — agent resumed')
}

/**
 * Check if a contact+channel has an active handoff (agent is paused).
 */
export async function isHandoffActive(channel: string, senderId: string, redis: Redis): Promise<string | null> {
  const key = handoffKey(channel, senderId)
  return redis.get(key)
}
