// hitl/message-interceptor.ts — Hook on message:incoming (priority 5) to consume human replies

import type { Redis } from 'ioredis'
import type { Registry } from '../../kernel/registry.js'
import type { HitlConfig, HumanReplyIntent } from './types.js'
import { TicketStore } from './ticket-store.js'
import { resolveTicket } from './resolver.js'
import { getHandoffAction, activateHandoff, getShareableContact, formatContactForHuman } from './handoff.js'
import pino from 'pino'

const logger = pino({ name: 'hitl:interceptor' })

/**
 * Register the message interceptor hooks.
 * - Priority 5: intercept human replies (before engine at ~50)
 * - Checks for handoff returns (@mention of agent name)
 */
export function registerInterceptor(
  registry: Registry,
  ticketStore: TicketStore,
  redis: Redis,
  getConfig: () => HitlConfig,
): void {
  // Hook 1: Intercept human replies to HITL tickets (priority 5)
  registry.addHook('hitl', 'message:incoming', async (payload) => {
    const config = getConfig()
    if (!config.HITL_ENABLED) return

    // Check if this sender is an assigned responder for any active ticket
    const ticket = await ticketStore.findActiveByResponder(payload.from, payload.channelName)
    if (!ticket) return

    const text = payload.content.text ?? ''
    if (!text.trim()) return

    // Classify the human's reply intent
    const intent = await classifyReplyIntent(text, registry)

    if (intent === 'handoff') {
      // Human wants to handle it directly
      const handoffAction = getHandoffAction(ticket.requesterChannel)

      if (handoffAction === 'full_handoff') {
        // Activate full handoff (agent pauses)
        await activateHandoff(ticket, redis)
        await ticketStore.setHandoffActive(ticket.id, 'full_handoff')

        // Confirm to the human
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

        // Mark handoff in ticket but don't pause agent (can't on this channel)
        await ticketStore.setHandoffActive(ticket.id, 'share_contact')
      }

      // Consume the message
      await redis.set(`hitl:consumed:${payload.id}`, '1', 'EX', 300)
      return
    }

    if (intent === 'question') {
      // Human is asking a clarification — don't resolve, don't consume
      // Let the pipeline handle it normally
      return
    }

    // intent === 'resolve': Human is providing the answer
    // Consume the message (prevent pipeline processing)
    await redis.set(`hitl:consumed:${payload.id}`, '1', 'EX', 300)

    // Resolve the ticket
    await resolveTicket(ticket, text, ticket.assignedUserId ?? 'unknown', registry, ticketStore, redis)

    logger.info({ ticketId: ticket.id, responder: payload.from }, 'HITL ticket resolved by human reply')
  }, 5)

  // Hook 2: Detect handoff return (@mention of agent name)
  registry.addHook('hitl', 'message:incoming', async (payload) => {
    const config = getConfig()
    if (!config.HITL_ENABLED) return

    const text = payload.content.text ?? ''

    // Check for @agent mention (handoff return signal)
    const agentName = getAgentName(registry)
    const mentionPattern = new RegExp(`@${agentName}`, 'i')
    if (!mentionPattern.test(text)) return

    // Check if there's an active handoff for the sender on this channel
    // Note: during handoff, the requester's messages are blocked, but
    // the human (who has control) sends from their account.
    // We need to check if the sender has any active handoff tickets.
    const ticket = await ticketStore.findActiveByResponder(payload.from, payload.channelName)
    if (!ticket || !ticket.handoffActive) return

    // Deactivate handoff
    const { deactivateHandoff } = await import('./handoff.js')
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
  }, 4) // Priority 4: before the main interceptor
}

/**
 * Classify the human's reply intent using simple heuristics.
 * Falls back to LLM only for ambiguous cases.
 */
async function classifyReplyIntent(text: string, _registry: Registry): Promise<HumanReplyIntent> {
  const lower = text.toLowerCase().trim()

  // Handoff keywords (Spanish + English)
  const handoffPatterns = [
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
  if (handoffPatterns.some(p => p.test(lower))) return 'handoff'

  // Question patterns
  const questionPatterns = [
    /\?$/,
    /^(que|what|cuando|when|como|how|donde|where|quien|who|por que|why)/i,
    /^(puede|can|could|should|is there)/i,
  ]
  if (questionPatterns.some(p => p.test(lower)) && lower.length < 100) return 'question'

  // Default: treat as resolution
  return 'resolve'
}

function getAgentName(registry: Registry): string {
  const promptsService = registry.getOptional<{ getAgentName(): string }>('prompts:service')
  return promptsService?.getAgentName() ?? 'Luna'
}
