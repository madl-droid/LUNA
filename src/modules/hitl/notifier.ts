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

  let message = `${urgencyPrefix}*HITL — ${roleLabel} Request*\n`
  message += `Type: ${ticket.requestType}\n`
  message += `Summary: ${ticket.requestSummary}\n`

  // Add conversation context if available
  const ctx = ticket.requestContext
  if (ctx.clientMessage && typeof ctx.clientMessage === 'string') {
    message += `\nClient message: "${ctx.clientMessage}"\n`
  }

  message += `\nPlease reply to this message with your response.`

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
  const message = `*HITL Reminder*\n`
    + `Pending request (${ageMinutes} min ago): ${ticket.requestSummary}\n`
    + `Please respond when available.`

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
  // Use LLM to compose a natural expiration message
  const result = await registry.callHook('llm:chat', {
    task: 'hitl-expire-message',
    system: `You are a helpful customer service agent. Generate a brief, natural message informing the client that you were unable to get a response from the team right now, but you will follow up later. Be empathetic and professional. One short paragraph, no greetings.`,
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
