// hitl/resolver.ts — Resolution delivery: rephrase human answer via LLM + send to client

import type { Pool } from 'pg'
import type { Redis } from 'ioredis'
import type { Registry } from '../../kernel/registry.js'
import type { HitlTicket } from './types.js'
import { TicketStore } from './ticket-store.js'
import { deactivateHandoff } from './handoff.js'
import pino from 'pino'

const logger = pino({ name: 'hitl:resolver' })

/**
 * Resolve a HITL ticket: rephrase the human's answer via LLM and send to client.
 */
export async function resolveTicket(
  ticket: HitlTicket,
  humanResponse: string,
  resolvedBy: string,
  registry: Registry,
  ticketStore: TicketStore,
  redis: Redis,
): Promise<void> {
  // 1. Rephrase via LLM (Phase 4 style)
  const rephrased = await rephraseResolution(ticket, humanResponse, registry)

  // 2. Update ticket in DB
  await ticketStore.resolve(ticket.id, humanResponse, resolvedBy, {
    rephrasedText: rephrased,
    originalHumanResponse: humanResponse,
  })

  // 3. Send rephrased answer to client
  await registry.runHook('message:send', {
    channel: ticket.requesterChannel,
    to: ticket.requesterSenderId,
    content: { type: 'text', text: rephrased },
  })

  // 4. Clear pending context from Redis
  await redis.del(`hitl:pending:${ticket.requesterChannel}:${ticket.requesterSenderId}`)

  // 5. Deactivate handoff if active
  if (ticket.handoffActive) {
    await deactivateHandoff(ticket.requesterChannel, ticket.requesterSenderId, redis)
  }

  // 5b. If full handoff, reassign pending commitments to the human who took responsibility
  if (ticket.handoffMode === 'full_handoff' && ticket.assignedSenderId && ticket.assignedChannel) {
    await reassignCommitmentsToHuman(
      registry.getDb(),
      ticket.requesterContactId,
      ticket.assignedSenderId,
      ticket.assignedChannel,
    )
  }

  // 6. Fire resolved hook
  await registry.runHook('hitl:ticket_resolved', {
    ticketId: ticket.id,
    resolutionText: rephrased,
    resolvedBy,
  })

  logger.info({ ticketId: ticket.id }, 'HITL ticket resolved and answer delivered')
}

/**
 * Rephrase the human's response using LLM, with full context of the original request.
 * Uses the compositor pattern (Phase 4 style) for natural conversation tone.
 */
async function rephraseResolution(
  ticket: HitlTicket,
  humanResponse: string,
  registry: Registry,
): Promise<string> {
  try {
    const result = await registry.callHook('llm:chat', {
      task: 'hitl-rephrase',
      system: buildRephrasePrompt(ticket),
      messages: [
        {
          role: 'user',
          content: `Human team member response:\n"${humanResponse}"\n\nRephrase this as a natural message to the client.`,
        },
      ],
      maxTokens: 300,
      temperature: 0.5,
    })

    if (result?.text) return result.text
  } catch (err) {
    logger.warn({ err, ticketId: ticket.id }, 'LLM rephrase failed, using raw response')
  }

  // Fallback: return human's response as-is
  return humanResponse
}

/**
 * Reassign pending commitments from the agent to a human who took responsibility.
 * The commitment scanner will then notify the human instead of the contact.
 */
async function reassignCommitmentsToHuman(
  db: Pool,
  contactId: string,
  humanSenderId: string,
  humanChannel: string,
): Promise<void> {
  try {
    const result = await db.query(
      `UPDATE commitments
       SET assigned_to = $1, metadata = metadata || $2, updated_at = now()
       WHERE contact_id = $3
         AND status IN ('pending', 'in_progress', 'waiting', 'overdue')
         AND assigned_to IS NULL`,
      [humanSenderId, JSON.stringify({ assigned_channel: humanChannel, assigned_via: 'hitl_handoff' }), contactId],
    )
    if (result.rowCount && result.rowCount > 0) {
      logger.info({ contactId, humanSenderId, count: result.rowCount }, 'Commitments reassigned to human via HITL handoff')
    }
  } catch (err) {
    logger.warn({ err, contactId, humanSenderId }, 'Failed to reassign commitments to human')
  }
}

function buildRephrasePrompt(ticket: HitlTicket): string {
  const ctx = ticket.requestContext
  const clientMsg = typeof ctx.clientMessage === 'string' ? ctx.clientMessage : ''

  return [
    'You are a customer service agent responding to a client.',
    'A team member has provided information that you need to relay naturally.',
    '',
    'RULES:',
    '- Rephrase the team member\'s response in first person as if you are answering the client directly',
    '- Keep the same information and meaning, just make it conversational',
    '- Do NOT mention that you asked a team member or that someone else answered',
    '- Do NOT add greetings or sign-offs',
    '- Match the language the client used (Spanish/English)',
    '- Be concise — one short paragraph maximum',
    '',
    `CONTEXT:`,
    `The client asked about: "${ticket.requestSummary}"`,
    clientMsg ? `Client's original message: "${clientMsg}"` : '',
    `Request type: ${ticket.requestType}`,
  ].filter(Boolean).join('\n')
}
