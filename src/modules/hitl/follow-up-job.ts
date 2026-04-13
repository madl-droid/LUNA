// hitl/follow-up-job.ts — Interval-based job for follow-up reminders + supervisor escalation

import type { Redis } from 'ioredis'
import type { Registry } from '../../kernel/registry.js'
import type { HitlConfig } from './types.js'
import { TicketStore } from './ticket-store.js'
import { sendFollowup } from './notifier.js'
import { getSupervisorChain, findNextInChain } from './responder-selector.js'
import { sendNotification } from './notifier.js'
import { deactivateHandoff } from './handoff.js'
import pino from 'pino'

const logger = pino({ name: 'hitl:followup' })

let followUpInterval: ReturnType<typeof setInterval> | null = null

/**
 * Register the HITL follow-up job using setInterval.
 * Runs every 2 minutes to check for stale tickets and expired tickets.
 */
export function registerFollowUpJob(
  registry: Registry,
  ticketStore: TicketStore,
  redis: Redis,
  getConfig: () => HitlConfig,
): void {
  if (followUpInterval) {
    clearInterval(followUpInterval)
  }

  followUpInterval = setInterval(() => {
    const config = getConfig()
    if (!config.HITL_ENABLED) return

    processStaleTickets(registry, ticketStore, redis, config).catch(err => {
      logger.error({ err }, 'hitl:follow-up processStaleTickets error')
    })
    processExpiredTickets(registry, ticketStore, redis, config).catch(err => {
      logger.error({ err }, 'hitl:follow-up processExpiredTickets error')
    })
  }, 2 * 60_000) // Every 2 minutes

  logger.info('HITL follow-up job started (interval: 2 min)')
}

export function stopFollowUpJob(): void {
  if (followUpInterval) {
    clearInterval(followUpInterval)
    followUpInterval = null
    logger.info('HITL follow-up job stopped')
  }
}

async function processStaleTickets(
  registry: Registry,
  ticketStore: TicketStore,
  redis: Redis,
  config: HitlConfig,
): Promise<void> {
  const intervalMs = config.HITL_FOLLOWUP_INTERVAL_MIN * 60_000
  const stale = await ticketStore.findStaleTickets(intervalMs)

  for (const ticket of stale) {
    try {
      if (ticket.notificationCount >= config.HITL_MAX_FOLLOWUPS) {
        // Max follow-ups exhausted → escalate to supervisor
        await escalateToSupervisor(ticket, registry, ticketStore, redis, config)
      } else {
        // Send follow-up reminder
        await sendFollowup(ticket, registry)
        await ticketStore.incrementFollowup(ticket.id)
      }
    } catch (err) {
      logger.error({ err, ticketId: ticket.id }, 'Failed to process stale ticket')
    }
  }
}

async function escalateToSupervisor(
  ticket: import('./types.js').HitlTicket,
  registry: Registry,
  ticketStore: TicketStore,
  redis: Redis,
  config: HitlConfig,
): Promise<void> {
  if (!ticket.assignedUserId) {
    logger.warn({ ticketId: ticket.id }, 'Cannot escalate: no assigned user')
    await expireTicket(ticket, registry, ticketStore, redis, config)
    return
  }

  // Walk the supervisor chain
  const chain = await getSupervisorChain(ticket.assignedUserId, registry)

  // Find who we haven't tried yet
  const triedUserIds = ticket.escalationHistory.map(e => e.userId)
  triedUserIds.push(ticket.assignedUserId)
  const nextSupervisor = findNextInChain(chain, triedUserIds)

  if (nextSupervisor) {
    // Escalate to supervisor
    await ticketStore.escalate(ticket.id, {
      userId: nextSupervisor.userId,
      channel: nextSupervisor.channel,
      senderId: nextSupervisor.senderId,
    }, ticket.escalationHistory)

    // Send notification to new assignee
    await sendNotification(nextSupervisor, ticket, registry)

    // Fire hook
    await registry.runHook('hitl:ticket_escalated', {
      ticketId: ticket.id,
      fromUserId: ticket.assignedUserId,
      toUserId: nextSupervisor.userId,
      level: ticket.escalationLevel + 1,
    })

    logger.info({
      ticketId: ticket.id,
      from: ticket.assignedUserId,
      to: nextSupervisor.userId,
      level: ticket.escalationLevel + 1,
    }, 'Ticket escalated to supervisor')
  } else {
    // No more supervisors — mark as escalated, let TTL handle natural expiry
    logger.warn({ ticketId: ticket.id }, 'No supervisor available — marking escalated, waiting for TTL expiry')
    await ticketStore.setEscalated(ticket.id)
    if (ticket.handoffActive) {
      await deactivateHandoff(ticket.requesterChannel, ticket.requesterSenderId, redis)
    }
  }
}

async function expireTicket(
  ticket: import('./types.js').HitlTicket,
  registry: Registry,
  ticketStore: TicketStore,
  redis: Redis,
  config: HitlConfig,
): Promise<void> {
  await ticketStore.expire(ticket.id)

  // Clear Redis keys
  await redis.del(`hitl:pending:${ticket.requesterChannel}:${ticket.requesterSenderId}`)
  if (ticket.handoffActive) {
    await deactivateHandoff(ticket.requesterChannel, ticket.requesterSenderId, redis)
  }

  // Fire hook — engine listens and routes notification through proactive pipeline
  // so the response respects the channel's response format
  await registry.runHook('hitl:ticket_expired', {
    ticketId: ticket.id,
    requestType: ticket.requestType,
    notifyRequester: config.HITL_AUTO_EXPIRE_NOTIFY,
    requesterContactId: ticket.requesterContactId,
    requesterChannel: ticket.requesterChannel,
    requesterSenderId: ticket.requesterSenderId,
    requestSummary: ticket.requestSummary,
  })
}

async function processExpiredTickets(
  registry: Registry,
  ticketStore: TicketStore,
  redis: Redis,
  config: HitlConfig,
): Promise<void> {
  const expired = await ticketStore.findExpiredTickets()

  for (const ticket of expired) {
    try {
      await expireTicket(ticket, registry, ticketStore, redis, config)
    } catch (err) {
      logger.error({ err, ticketId: ticket.id }, 'Failed to expire ticket')
    }
  }
}
