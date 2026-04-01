// hitl/responder-selector.ts — Select human responder + channel, supervisor chain

import type { Registry } from '../../kernel/registry.js'
import type { Responder } from './types.js'
import pino from 'pino'

const logger = pino({ name: 'hitl:selector' })

/** Minimal interface for users:db service (avoids direct import) */
interface UsersDb {
  listByType(listType: string, activeOnly?: boolean): Promise<Array<{
    id: string
    displayName: string | null
    contacts: Array<{ channel: string; senderId: string }>
  }>>
  findUserById(id: string): Promise<{
    id: string
    displayName: string | null
    metadata: Record<string, unknown>
    contacts: Array<{ channel: string; senderId: string }>
  } | null>
}

// Channel priority for reaching humans (instant preferred)
const CHANNEL_PRIORITY: Record<string, number> = {
  whatsapp: 1,
  'google-chat': 2,
  email: 3,
  gmail: 3,
}

/**
 * Select the best responder for a HITL ticket.
 * Strategy: pick from target role, prefer channel with best priority,
 * distribute load via recent ticket count (round-robin approximation).
 */
export async function selectResponder(
  targetRole: string,
  preferredChannel: string,
  registry: Registry,
): Promise<Responder | null> {
  const usersDb = registry.getOptional<UsersDb>('users:db')
  if (!usersDb) {
    logger.warn('users:db not available, cannot select responder')
    return null
  }

  // Get active users of target role
  let candidates = await usersDb.listByType(targetRole, true)

  // If no candidates in target role, try the other role
  if (candidates.length === 0) {
    const fallbackRole = targetRole === 'admin' ? 'coworker' : 'admin'
    candidates = await usersDb.listByType(fallbackRole, true)
    if (candidates.length === 0) {
      logger.warn({ targetRole }, 'No active users found for HITL')
      return null
    }
  }

  // Flatten to responder candidates with channel info
  const responders: Array<Responder & { priority: number }> = []
  for (const user of candidates) {
    for (const contact of user.contacts) {
      const priority = preferredChannel !== 'auto' && contact.channel === preferredChannel
        ? 0 // Preferred channel gets top priority
        : (CHANNEL_PRIORITY[contact.channel] ?? 99)
      responders.push({
        userId: user.id,
        displayName: user.displayName,
        senderId: contact.senderId,
        channel: contact.channel,
        priority,
      })
    }
  }

  if (responders.length === 0) {
    logger.warn({ targetRole }, 'Users found but none have contacts')
    return null
  }

  // Sort by priority (lower = better)
  responders.sort((a, b) => a.priority - b.priority)

  // Return best match (first by channel priority)
  // Future: add round-robin based on recent ticket counts
  const best = responders[0]!
  return {
    userId: best.userId,
    displayName: best.displayName,
    senderId: best.senderId,
    channel: best.channel,
  }
}

/**
 * Walk the supervisor chain for a user.
 * Returns ordered list of user IDs from immediate supervisor up to admin.
 * Max depth 10 to prevent cycles.
 */
export async function getSupervisorChain(
  userId: string,
  registry: Registry,
): Promise<Responder[]> {
  const db = registry.getDb()
  const chain: Responder[] = []
  const visited = new Set<string>()
  let currentId: string | null = userId

  for (let depth = 0; depth < 10 && currentId; depth++) {
    // Get supervisor_id for current user
    const { rows } = await db.query(
      `SELECT u.id, u.display_name, u.supervisor_id,
              uc.channel, uc.sender_id
       FROM users u
       LEFT JOIN user_contacts uc ON u.id = uc.user_id
       WHERE u.id = $1 AND u.is_active = true`,
      [currentId],
    )

    if (rows.length === 0) break

    const supervisorId = rows[0]?.supervisor_id as string | null
    if (!supervisorId || visited.has(supervisorId)) break

    visited.add(supervisorId)

    // Resolve the supervisor's contacts
    const { rows: supRows } = await db.query(
      `SELECT u.id, u.display_name, uc.channel, uc.sender_id
       FROM users u
       LEFT JOIN user_contacts uc ON u.id = uc.user_id
       WHERE u.id = $1 AND u.is_active = true
       ORDER BY uc.is_primary DESC`,
      [supervisorId],
    )

    if (supRows.length > 0) {
      // Pick best channel for supervisor
      const bestContact = supRows.reduce((best, row) => {
        const prio = CHANNEL_PRIORITY[row.channel as string] ?? 99
        const bestPrio = CHANNEL_PRIORITY[best.channel as string] ?? 99
        return prio < bestPrio ? row : best
      }, supRows[0]!)

      chain.push({
        userId: bestContact.id as string,
        displayName: bestContact.display_name as string | null,
        senderId: bestContact.sender_id as string,
        channel: bestContact.channel as string,
      })
    }

    currentId = supervisorId
  }

  return chain
}

/**
 * Find the next supervisor in chain that hasn't been tried yet.
 */
export function findNextInChain(
  chain: Responder[],
  triedUserIds: string[],
): Responder | null {
  const tried = new Set(triedUserIds)
  return chain.find(r => !tried.has(r.userId)) ?? null
}
