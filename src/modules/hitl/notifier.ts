// hitl/notifier.ts — Send notifications to humans, follow-ups, contact sharing

import type { Registry } from '../../kernel/registry.js'
import type { HitlTicket, Responder } from './types.js'
import { getHandoffAction, getShareableContact, formatContactForHuman } from './handoff.js'
import pino from 'pino'

const logger = pino({ name: 'hitl:notifier' })

const URGENCY_EMOJI: Record<string, string> = {
  low: '',
  normal: '',
  high: '(!) ',
  critical: '(!!) ',
}

interface ContactMeta {
  displayName: string | null
  contactType: string | null
}

async function loadContactMeta(registry: Registry, contactId: string): Promise<ContactMeta> {
  try {
    const db = registry.getDb()
    const { rows } = await db.query<{ display_name: string | null; contact_type: string | null }>(
      `SELECT display_name, contact_type FROM contacts WHERE id = $1 LIMIT 1`,
      [contactId],
    )
    const row = rows[0]
    return {
      displayName: row?.display_name ?? null,
      contactType: row?.contact_type ?? null,
    }
  } catch {
    return { displayName: null, contactType: null }
  }
}

/**
 * Send the initial HITL notification to the human responder.
 */
export async function sendNotification(
  responder: Responder,
  ticket: HitlTicket,
  registry: Registry,
): Promise<void> {
  const urgencyPrefix = URGENCY_EMOJI[ticket.urgency] ?? ''
  const roleLabel = ticket.targetRole === 'admin' ? 'Admin' : 'Coworker'
  const ticketShort = ticket.id.slice(-6).toUpperCase()

  // Load contact metadata for the notification
  const meta = await loadContactMeta(registry, ticket.requesterContactId)
  const contactName = meta.displayName ?? ticket.requesterSenderId
  const contactPhone = meta.displayName ? ticket.requesterSenderId : null
  const contactType = meta.contactType ?? ticket.requesterChannel

  let message = `${urgencyPrefix}*HITL — ${roleLabel} Request*\n`
  // Contact line: "Contacto: Name (phone) [type]" or "Contacto: senderId [channel]"
  if (contactPhone) {
    message += `Contacto: ${contactName} (${contactPhone}) [${contactType}]\n`
  } else {
    message += `Contacto: ${contactName} [${contactType}]\n`
  }
  message += `Ticket: #${ticketShort}\n`
  message += `Type: ${ticket.requestType}\n`
  message += `Summary: ${ticket.requestSummary}\n`

  // Add conversation context if available
  const ctx = ticket.requestContext
  if (ctx.clientMessage && typeof ctx.clientMessage === 'string') {
    message += `\nClient message: "${ctx.clientMessage}"\n`
  }

  message += `\n↩️ Cita este mensaje para responder al ticket.`

  // Check if handoff triggers should share contact
  const handoffAction = getHandoffAction(ticket.requesterChannel)
  if (ticket.handoffMode === 'share_contact' || handoffAction === 'share_contact') {
    try {
      const db = registry.getDb()
      const contactInfo = await getShareableContact(
        ticket.requesterSenderId, ticket.requesterChannel, db,
      )
      message += `\n\n${formatContactForHuman(contactInfo)}`
    } catch (err) {
      logger.warn({ err, ticketId: ticket.id }, 'Failed to get shareable contact')
    }
  }

  await registry.runHook('message:send', {
    channel: responder.channel,
    to: responder.senderId,
    content: { type: 'text', text: message },
  })

  logger.info({
    ticketId: ticket.id,
    responder: responder.userId,
    channel: responder.channel,
  }, 'HITL notification sent')
}

/**
 * Send a follow-up reminder to the current assignee.
 */
export async function sendFollowup(
  ticket: HitlTicket,
  registry: Registry,
): Promise<void> {
  if (!ticket.assignedSenderId || !ticket.assignedChannel) {
    logger.warn({ ticketId: ticket.id }, 'Cannot send follow-up: no assignee')
    return
  }

  const ageMinutes = Math.round((Date.now() - ticket.createdAt.getTime()) / 60_000)
  const ticketShort = ticket.id.slice(-6).toUpperCase()
  const message = `*HITL Reminder*\n`
    + `Ticket: #${ticketShort}\n`
    + `Pending request (${ageMinutes} min ago): ${ticket.requestSummary}\n`
    + `↩️ Cita este mensaje para responder al ticket.`

  await registry.runHook('message:send', {
    channel: ticket.assignedChannel,
    to: ticket.assignedSenderId,
    content: { type: 'text', text: message },
  })

  logger.info({ ticketId: ticket.id, followup: ticket.notificationCount + 1 }, 'Follow-up sent')
}

/**
 * Notify the client that their ticket expired (no human responded in time).
 */
export async function notifyRequesterExpired(
  ticket: HitlTicket,
  registry: Registry,
): Promise<void> {
  // Load system prompt from .md, fallback to inline
  const promptsSvc = registry.getOptional<{ getSystemPrompt(name: string): Promise<string> }>('prompts:service')
  const hitlSystem = promptsSvc
    ? await promptsSvc.getSystemPrompt('hitl-expire-message')
    : ''

  // Use LLM to compose a natural expiration message
  const result = await registry.callHook('llm:chat', {
    task: 'hitl-expire-message',
    system: hitlSystem,
    messages: [
      {
        role: 'user',
        content: `The client asked about: "${ticket.requestSummary}". Generate an apologetic message.`,
      },
    ],
    maxTokens: 150,
    temperature: 0.7,
  })

  const text = result?.text ?? 'Lo siento, no pude obtener una respuesta del equipo en este momento. Dare seguimiento y te contactare pronto.'

  await registry.runHook('message:send', {
    channel: ticket.requesterChannel,
    to: ticket.requesterSenderId,
    content: { type: 'text', text },
  })

  logger.info({ ticketId: ticket.id }, 'Expiration notice sent to requester')
}
