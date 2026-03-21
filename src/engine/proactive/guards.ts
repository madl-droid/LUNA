// LUNA Engine — Proactive Guards
// 7 guardas de protección ejecutadas en orden antes de cada job proactivo.
// Orden: idempotencia → horario laboral → contact lock → outreach dedup → cooldown → rate limit → conversation guard

import type { Pool } from 'pg'
import type { Redis } from 'ioredis'
import pino from 'pino'
import type { ProactiveConfig, ProactiveCandidate } from '../types.js'

const logger = pino({ name: 'engine:proactive:guards' })

export interface GuardResult {
  passed: boolean
  blockedBy?: string
  requeue?: boolean  // true = re-encolar con delay, false = descartar
  requeueDelayMs?: number
}

const PASS: GuardResult = { passed: true }

/**
 * Run all 7 guards in order for a proactive candidate.
 * Returns first failure or PASS if all succeed.
 */
export async function runGuards(
  candidate: ProactiveCandidate,
  redis: Redis,
  db: Pool,
  config: ProactiveConfig,
): Promise<GuardResult> {
  const guards = [
    () => guardIdempotency(candidate, redis),
    () => guardBusinessHours(candidate, config),
    () => guardContactLock(candidate, redis),
    () => guardOutreachDedup(candidate, redis, db),
    () => guardCooldown(candidate, redis, config),
    () => guardRateLimit(candidate, redis, config),
    () => guardConversation(candidate, redis, config),
  ]

  for (const guard of guards) {
    const result = await guard()
    if (!result.passed) {
      logger.info({
        contactId: candidate.contactId,
        trigger: candidate.triggerType,
        blockedBy: result.blockedBy,
        requeue: result.requeue,
      }, 'Guard blocked proactive job')
      return result
    }
  }

  return PASS
}

// ─── 1. Idempotency ─────────────────────────

async function guardIdempotency(
  candidate: ProactiveCandidate,
  redis: Redis,
): Promise<GuardResult> {
  const date = new Date().toISOString().split('T')[0]!
  const key = `proactive:idem:${candidate.contactId}:${candidate.triggerType}:${candidate.triggerId ?? 'none'}:${date}`

  const set = await redis.set(key, '1', 'EX', 86400, 'NX')
  if (set === null) {
    return { passed: false, blockedBy: 'idempotency', requeue: false }
  }

  return PASS
}

// ─── 2. Business Hours ──────────────────────

async function guardBusinessHours(
  candidate: ProactiveCandidate,
  config: ProactiveConfig,
): Promise<GuardResult> {
  // Email bypasses business hours
  if (candidate.channel === 'email') return PASS

  const bh = config.business_hours
  const now = getNowInTimezone(bh.timezone)
  const hour = now.getHours()
  const day = now.getDay() // 0=Sun, 1=Mon...

  if (!bh.days.includes(day) || hour < bh.start || hour >= bh.end) {
    return { passed: false, blockedBy: 'business_hours', requeue: true, requeueDelayMs: msUntilNextWindow(bh) }
  }

  return PASS
}

// ─── 3. Contact Lock ────────────────────────

async function guardContactLock(
  candidate: ProactiveCandidate,
  redis: Redis,
): Promise<GuardResult> {
  const lockKey = `contact:active:${candidate.contactId}`
  const isActive = await redis.get(lockKey)

  if (isActive) {
    return { passed: false, blockedBy: 'contact_lock', requeue: true, requeueDelayMs: 5 * 60 * 1000 }
  }

  return PASS
}

// ─── 4. Outreach Dedup ──────────────────────

async function guardOutreachDedup(
  candidate: ProactiveCandidate,
  _redis: Redis,
  db: Pool,
): Promise<GuardResult> {
  // Overdue commitments bypass dedup
  if (candidate.isOverdue) return PASS

  try {
    const result = await db.query(
      `SELECT id FROM proactive_outreach_log
       WHERE contact_id = $1 AND trigger_type = $2 AND action_taken = 'sent'
         AND created_at > now() - interval '4 hours'
       LIMIT 1`,
      [candidate.contactId, candidate.triggerType],
    )
    if (result.rows.length > 0) {
      return { passed: false, blockedBy: 'outreach_dedup', requeue: false }
    }
  } catch {
    // Table might not exist yet — allow
  }

  return PASS
}

// ─── 5. Cooldown ────────────────────────────

async function guardCooldown(
  candidate: ProactiveCandidate,
  redis: Redis,
  config: ProactiveConfig,
): Promise<GuardResult> {
  const cooldownKey = `proactive:cooldown:${candidate.contactId}`
  const cooldownUntil = await redis.get(cooldownKey)

  if (cooldownUntil) {
    const remaining = parseInt(cooldownUntil) - Date.now()
    if (remaining > 0) {
      return { passed: false, blockedBy: 'cooldown', requeue: true, requeueDelayMs: remaining }
    }
  }

  return PASS
}

/**
 * Set cooldown after a proactive message is sent.
 */
export async function setCooldown(
  contactId: string,
  redis: Redis,
  config: ProactiveConfig,
): Promise<void> {
  const cooldownMs = config.guards.cooldown_minutes * 60 * 1000
  const expiresAt = Date.now() + cooldownMs
  await redis.set(`proactive:cooldown:${contactId}`, String(expiresAt), 'PX', cooldownMs)
}

// ─── 6. Rate Limit ──────────────────────────

async function guardRateLimit(
  candidate: ProactiveCandidate,
  redis: Redis,
  config: ProactiveConfig,
): Promise<GuardResult> {
  const key = `proactive:rate:${candidate.contactId}:${new Date().toISOString().split('T')[0]!}`
  const countStr = await redis.get(key)
  const count = countStr ? parseInt(countStr) : 0

  if (count >= config.guards.max_proactive_per_day_per_contact) {
    return { passed: false, blockedBy: 'rate_limit', requeue: false }
  }

  return PASS
}

/**
 * Increment daily proactive count after sending.
 */
export async function incrementProactiveCount(
  contactId: string,
  redis: Redis,
): Promise<void> {
  const key = `proactive:rate:${contactId}:${new Date().toISOString().split('T')[0]!}`
  const pipeline = redis.pipeline()
  pipeline.incr(key)
  pipeline.expire(key, 86400)
  await pipeline.exec()
}

// ─── 7. Conversation Guard ──────────────────

async function guardConversation(
  candidate: ProactiveCandidate,
  redis: Redis,
  config: ProactiveConfig,
): Promise<GuardResult> {
  // Overdue commitments bypass conversation guard
  if (candidate.isOverdue) return PASS

  const key = `conversation:farewell:${candidate.contactId}`
  const farewellAt = await redis.get(key)

  if (farewellAt) {
    const elapsedMs = Date.now() - parseInt(farewellAt)
    const guardMs = config.guards.conversation_guard_hours * 60 * 60 * 1000
    if (elapsedMs < guardMs) {
      return { passed: false, blockedBy: 'conversation_guard', requeue: true, requeueDelayMs: guardMs - elapsedMs }
    }
  }

  return PASS
}

/**
 * Mark that a conversation ended with a farewell (called from phase5 when intent is farewell).
 */
export async function markFarewell(contactId: string, redis: Redis): Promise<void> {
  const ttl = 24 * 60 * 60 // 24h
  await redis.set(`conversation:farewell:${contactId}`, String(Date.now()), 'EX', ttl)
}

/**
 * Set contact lock when a reactive conversation is active.
 * Called at start of reactive pipeline, cleared after inactivity.
 */
export async function setContactLock(contactId: string, redis: Redis, ttlMs: number): Promise<void> {
  await redis.set(`contact:active:${contactId}`, '1', 'PX', ttlMs)
}

/**
 * Clear contact lock (e.g., after session closes).
 */
export async function clearContactLock(contactId: string, redis: Redis): Promise<void> {
  await redis.del(`contact:active:${contactId}`)
}

// ─── Helpers ────────────────────────────────

function getNowInTimezone(timezone: string): Date {
  try {
    const dateStr = new Date().toLocaleString('en-US', { timeZone: timezone })
    return new Date(dateStr)
  } catch {
    return new Date()
  }
}

function msUntilNextWindow(bh: ProactiveConfig['business_hours']): number {
  const now = getNowInTimezone(bh.timezone)
  const hour = now.getHours()
  const day = now.getDay()

  // If before business hours today
  if (bh.days.includes(day) && hour < bh.start) {
    return (bh.start - hour) * 60 * 60 * 1000
  }

  // Find next business day
  for (let offset = 1; offset <= 7; offset++) {
    const nextDay = (day + offset) % 7
    if (bh.days.includes(nextDay)) {
      const hoursUntilMidnight = 24 - hour
      const hoursAdditional = (offset - 1) * 24 + bh.start
      return (hoursUntilMidnight + hoursAdditional) * 60 * 60 * 1000
    }
  }

  // Fallback: 12 hours
  return 12 * 60 * 60 * 1000
}
