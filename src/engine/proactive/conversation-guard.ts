// LUNA Engine — Conversation Guard
// Detects when a contact has said goodbye and suppresses proactive outreach.
// Complements guards.ts #7 (farewell flag) with pattern-based detection
// on recent message history. Results are cached in Redis (6h TTL).

import type { Pool } from 'pg'
import type { Redis } from 'ioredis'
import pino from 'pino'

const logger = pino({ name: 'engine:proactive:conversation-guard' })

// Redis key: suppress:{contactId}:{channel}
const KEY_PREFIX = 'suppress'

// Goodbye patterns (case-insensitive, Spanish + English)
const FAREWELL_PATTERNS = [
  /\bgracias\b/i,
  /\bbye\b/i,
  /\badios\b/i,
  /\badiós\b/i,
  /\bhasta luego\b/i,
  /\bhasta pronto\b/i,
  /\bhasta mañana\b/i,
  /\bperfecto gracias\b/i,
  /\blisto gracias\b/i,
  /\bok gracias\b/i,
  /\bchao\b/i,
  /\bchau\b/i,
  /\bbuenas noches\b/i,
  /\bno gracias\b/i,
  /\bthank you\b/i,
  /\bthanks\b/i,
  /\bgoodbye\b/i,
  /\bsee you\b/i,
  /\bthat.?s all\b/i,
]

export interface SuppressResult {
  suppress: boolean
  reason?: string
}

/**
 * Check whether proactive outreach should be suppressed for this contact+channel.
 *
 * Strategy:
 * 1. Check Redis cache first (suppress:{contactId}:{channel}) — fast path
 * 2. If not cached, look at last 3 messages for goodbye patterns
 * 3. Cache result in Redis with configurable TTL (default 6h)
 *
 * Returns { suppress: true } if the contact said goodbye and should be left alone.
 */
export async function shouldSuppressProactive(
  db: Pool,
  redis: Redis,
  contactId: string,
  channel: string,
  cacheTtlHours = 6,
): Promise<SuppressResult> {
  const cacheKey = `${KEY_PREFIX}:${contactId}:${channel}`

  // 1. Fast path: check Redis cache
  const cached = await redis.get(cacheKey)
  if (cached !== null) {
    const suppress = cached === '1'
    return suppress
      ? { suppress: true, reason: 'contact_said_goodbye_cached' }
      : { suppress: false }
  }

  // 2. Slow path: query last 3 messages for the contact's most recent session
  try {
    const result = await db.query<{
      sender_type: string
      text_content: string | null
    }>(
      `
      SELECT m.sender_type,
             m.content->>'text' AS text_content
      FROM messages m
      JOIN sessions s ON m.session_id = s.id
      WHERE s.contact_id = $1
        AND s.channel_name = $2
      ORDER BY m.created_at DESC
      LIMIT 3
      `,
      [contactId, channel],
    )

    const messages = result.rows as Array<{ sender_type: string; text_content: string | null }>

    // Determine if the last user message is a farewell
    const lastUserMsg = messages.find((m) => m.sender_type === 'user')
    const lastAgentMsg = messages.find((m) => m.sender_type === 'agent')

    const userSaidGoodbye = lastUserMsg?.text_content
      ? FAREWELL_PATTERNS.some((p) => p.test(lastUserMsg.text_content!))
      : false

    // Only suppress when both: user said goodbye AND agent replied (conversation closed naturally)
    const suppress = userSaidGoodbye && lastAgentMsg !== undefined

    // Cache result
    const ttlSeconds = cacheTtlHours * 60 * 60
    await redis.set(cacheKey, suppress ? '1' : '0', 'EX', ttlSeconds)

    if (suppress) {
      logger.debug({ contactId, channel }, 'Conversation guard: suppressing proactive (goodbye detected)')
      return { suppress: true, reason: 'contact_said_goodbye' }
    }

    return { suppress: false }
  } catch (err) {
    logger.warn({ err, contactId, channel }, 'Conversation guard DB query failed — allowing outreach')
    return { suppress: false }
  }
}

/**
 * Clear the cached suppress flag (e.g., when contact messages again).
 * Called from Phase 5 when a new user message arrives.
 */
export async function clearSuppressCache(
  redis: Redis,
  contactId: string,
  channel: string,
): Promise<void> {
  await redis.del(`${KEY_PREFIX}:${contactId}:${channel}`)
}
