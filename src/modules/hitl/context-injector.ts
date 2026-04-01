// hitl/context-injector.ts — Inject pending HITL context + rules into pipeline

import type { Redis } from 'ioredis'
import type { Registry } from '../../kernel/registry.js'
import { RulesStore } from './rules-store.js'
import pino from 'pino'

const logger = pino({ name: 'hitl:context' })

/**
 * Check if a contact has a pending HITL ticket.
 * Returns context string for injection into Phase 1, or null.
 */
export async function getPendingContext(
  channel: string,
  senderId: string,
  redis: Redis,
): Promise<string | null> {
  const key = `hitl:pending:${channel}:${senderId}`
  const raw = await redis.get(key)
  if (!raw) return null

  try {
    const data = JSON.parse(raw) as { ticketId: string; requestType: string; summary: string }
    return (
      `[HITL PENDING] There is an active human consultation for this contact.\n`
      + `Type: ${data.requestType}\n`
      + `Summary: ${data.summary}\n`
      + `If the client asks about it, acknowledge naturally that you are waiting for a response from the team.`
    )
  } catch (err) {
    logger.warn({ err, key }, 'Failed to parse HITL pending context from Redis')
    return null
  }
}

/**
 * Get HITL rules formatted for injection into Phase 2 evaluator prompt.
 * Returns empty string if no rules or HITL disabled.
 */
export async function getEvaluatorRules(rulesStore: RulesStore): Promise<string> {
  try {
    return await rulesStore.getRulesForEvaluator()
  } catch (err) {
    logger.warn({ err }, 'Failed to load HITL rules for evaluator')
    return ''
  }
}

/**
 * Register the hitl:rules service for other modules (evaluator prompt builder) to consume.
 */
export function provideRulesService(registry: Registry, rulesStore: RulesStore): void {
  registry.provide('hitl:rules', {
    getRules: () => rulesStore.list(),
    getRulesForEvaluator: () => rulesStore.getRulesForEvaluator(),
  })
}

/**
 * Register the hitl:context service for Phase 1 to check pending tickets.
 */
export function provideContextService(registry: Registry, redis: Redis): void {
  registry.provide('hitl:context', {
    getPending: (channel: string, senderId: string) => getPendingContext(channel, senderId, redis),
  })
}
