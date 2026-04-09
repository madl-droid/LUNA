// hitl/message-interceptor.ts — Hook on message:incoming to consume human replies

import type { Redis } from 'ioredis'
import type { Registry } from '../../kernel/registry.js'
import type { HitlConfig } from './types.js'
import { TicketStore } from './ticket-store.js'
import { resolveTicket } from './resolver.js'
import { getHandoffAction, activateHandoff, deactivateHandoff, getShareableContact, formatContactForHuman } from './handoff.js'
import pino from 'pino'

const logger = pino({ name: 'hitl:interceptor' })

// Matches the [Citando: "..."] prefix injected by the WhatsApp adapter
const CITE_PREFIX = /^\[Citando: "(.+?)"\]\n?/s

// Detects "Ticket: #XXXXXX" inside a quoted message (6 hex chars, case-insensitive)
const HITL_TICKET_PATTERN = /Ticket:\s*#([A-Fa-f0-9]{6})/

// Natural language patterns to trigger ticket listing
const TICKET_LIST_PATTERNS = [
  /tickets?\s*(abiertos?|pendientes?|activos?)/i,
  /hitl\s*(pendientes?|abiertos?)/i,
  /open\s*tickets?/i,
  /qu[eé]\s*tickets?\s*(hay|tenemos)/i,
]

// Keywords that indicate the human wants to take over the conversation
const HANDOFF_PATTERNS = [
  /voy a contactar/i,
  /pasame los datos/i,
  /dame los datos/i,
  /yo me encargo/i,
  /i'?ll (handle|contact|take)/i,
  /give me (the|their) (contact|info|data|number|email)/i,
  /transfer/i,
  /lo atiendo yo/i,
  /me hago cargo/i,
]

/**
 * Parse a HITL citation from an incoming message text.
 * Returns ticketShortId and the response text after the citation, or null if not a HITL quote.
 */
function parseHitlCitation(text: string): { ticketShortId: string; responseText: string } | null {
  const citeMatch = text.match(CITE_PREFIX)
  if (!citeMatch) return null

  const quotedText = citeMatch[1]!
  const ticketMatch = quotedText.match(HITL_TICKET_PATTERN)
  if (!ticketMatch) return null

  const responseText = text.slice(citeMatch[0].length).trim()
  return { ticketShortId: ticketMatch[1]!, responseText }
}

function formatTicketAge(createdAt: Date): string {
  const ageMs = Date.now() - createdAt.getTime()
  const minutes = Math.floor(ageMs / 60_000)
  if (minutes < 60) return `${minutes}min`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  return `${days}d`
}

/**
 * Register the message interceptor hooks.
 * - Priority 5: intercept HITL replies (quote-based) and ticket listing commands
 * - Priority 4: detect handoff returns (@agent mention)
 */
export function registerInterceptor(
  registry: Registry,
  ticketStore: TicketStore,
  redis: Redis,
  getConfig: () => HitlConfig,
): void {
  // Hook 1: Quote-based HITL interception (priority 5)
  registry.addHook('hitl', 'message:incoming', async (payload) => {
    const config = getConfig()
    if (!config.HITL_ENABLED) return

    const text = payload.content.text ?? ''
    if (!text.trim()) return

    // Check if sender is asking to list their open tickets
    if (TICKET_LIST_PATTERNS.some(p => p.test(text))) {
      const tickets = await ticketStore.listActiveByResponder(payload.from, payload.channelName)

      let listMessage: string
      if (tickets.length === 0) {
        listMessage = 'No hay tickets HITL abiertos asignados a ti.'
      } else {
        const lines: string[] = [`📋 *Tickets HITL abiertos (${tickets.length}):*\n`]
        tickets.forEach((t, i) => {
          const shortId = t.id.slice(-6).toUpperCase()
          const age = formatTicketAge(t.createdAt)
          const clientMsg = (t.requestContext['clientMessage'] as string | undefined) ?? ''
          const preview = clientMsg.slice(0, 80)
          lines.push(`${i + 1}. #${shortId} — ${t.requestType}`)
          lines.push(`   Contacto: ${t.requesterSenderId}`)
          lines.push(`   Hace: ${age}`)
          if (preview) lines.push(`   "${preview}"`)
          lines.push('')
        })
        lines.push('↩️ Cita el mensaje original del ticket para responder.')
        listMessage = lines.join('\n')
      }

      await registry.runHook('message:send', {
        channel: payload.channelName,
        to: payload.from,
        content: { type: 'text', text: listMessage },
      })

      await redis.set(`hitl:consumed:${payload.id}`, '1', 'EX', 300)
      return
    }

    // Try to parse a HITL citation from the message text
    const citation = parseHitlCitation(text)
    if (!citation) return // No HITL citation — pass through to pipeline

    const { ticketShortId, responseText } = citation

    // Find the active ticket by short ID
    const ticket = await ticketStore.findByShortId(ticketShortId)
    if (!ticket) return // No active ticket with this ID — pass through

    // Security: verify the sender is the assigned responder for this ticket
    if (ticket.assignedSenderId !== payload.from || ticket.assignedChannel !== payload.channelName) {
      logger.warn({ ticketId: ticket.id, sender: payload.from }, 'Sender not assigned to cited ticket — ignoring')
      return
    }

    // Empty response: prompt the human to add content
    if (!responseText) {
      await registry.runHook('message:send', {
        channel: payload.channelName,
        to: payload.from,
        content: { type: 'text', text: 'Por favor escribe tu respuesta al citar el ticket.' },
      })
      await redis.set(`hitl:consumed:${payload.id}`, '1', 'EX', 300)
      return
    }

    // Consume the message (prevent pipeline processing)
    await redis.set(`hitl:consumed:${payload.id}`, '1', 'EX', 300)

    // Check if the response contains handoff intent
    const isHandoff = HANDOFF_PATTERNS.some(p => p.test(responseText))

    if (isHandoff) {
      const handoffAction = getHandoffAction(ticket.requesterChannel)

      if (handoffAction === 'full_handoff') {
        await activateHandoff(ticket, redis)
        await ticketStore.setHandoffActive(ticket.id, 'full_handoff')

        await registry.runHook('message:send', {
          channel: payload.channelName,
          to: payload.from,
          content: { type: 'text', text: 'Handoff activated. The agent is paused for this client. Reply "@agent" when done.' },
        })
      } else {
        // Share contact info (WhatsApp, Google Chat — no direct handoff possible)
        const db = registry.getDb()
        const contactInfo = await getShareableContact(
          ticket.requesterSenderId, ticket.requesterChannel, db,
        )
        const contactMsg = formatContactForHuman(contactInfo)
        await registry.runHook('message:send', {
          channel: payload.channelName,
          to: payload.from,
          content: { type: 'text', text: contactMsg },
        })

        await ticketStore.setHandoffActive(ticket.id, 'share_contact')
      }

      logger.info({ ticketId: ticket.id, responder: payload.from }, 'HITL handoff activated via quote-based reply')
    } else {
      // Resolve the ticket with the quoted response
      await resolveTicket(ticket, responseText, ticket.assignedUserId ?? 'unknown', registry, ticketStore, redis)
      logger.info({ ticketId: ticket.id, responder: payload.from }, 'HITL ticket resolved via quote-based reply')
    }
  }, 5)

  // Hook 2: Detect handoff return (@mention of agent name) — priority 4
  registry.addHook('hitl', 'message:incoming', async (payload) => {
    const config = getConfig()
    if (!config.HITL_ENABLED) return

    const text = payload.content.text ?? ''

    // Check for @agent mention (handoff return signal)
    const agentName = getAgentName(registry)
    const mentionPattern = new RegExp(`@${agentName}`, 'i')
    if (!mentionPattern.test(text)) return

    // Check if there's an active handoff ticket for this sender
    const ticket = await ticketStore.findActiveByResponder(payload.from, payload.channelName)
    if (!ticket || !ticket.handoffActive) return

    // Deactivate handoff
    await deactivateHandoff(ticket.requesterChannel, ticket.requesterSenderId, redis)
    await ticketStore.clearHandoff(ticket.id)

    // Resolve the ticket
    await ticketStore.resolve(ticket.id, 'Handoff completed', ticket.assignedUserId ?? 'human')

    // Fire hook
    await registry.runHook('hitl:handoff_return', {
      channel: ticket.requesterChannel,
      senderId: ticket.requesterSenderId,
      ticketId: ticket.id,
    })

    // Consume the @mention message
    await redis.set(`hitl:consumed:${payload.id}`, '1', 'EX', 300)

    logger.info({ ticketId: ticket.id }, 'Handoff returned — agent resumed')
  }, 4)
}

function getAgentName(registry: Registry): string {
  const promptsService = registry.getOptional<{ getAgentName(): string }>('prompts:service')
  return promptsService?.getAgentName() ?? 'Luna'
}
