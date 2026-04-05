// LUNA Engine — Proactive Guards
// 8 guardas de protección ejecutadas en orden antes de cada job proactivo.
// Orden: idempotencia → horario laboral → contact lock → outreach dedup → cooldown → rate limit → conversation guard → goodbye suppressor

import type { Pool } from 'pg'
import type { Redis } from 'ioredis'
import pino from 'pino'
import type { Registry } from '../../kernel/registry.js'
import type { ProactiveConfig, ProactiveCandidate } from '../types.js'
import { shouldSuppressProactive } from './conversation-guard.js'

interface BusinessHoursConfig {
  start: number
  end: number
  days: number[]
  agentTimezone: string
}

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
  registry?: Registry,
): Promise<GuardResult> {
  const guards = [
    () => guardIdempotency(candidate, redis),
    () => guardBusinessHours(candidate, config, db, registry),
    () => guardContactLock(candidate, redis),
    () => guardOutreachDedup(candidate, redis, db),
    () => guardCooldown(candidate, redis, config),
    () => guardRateLimit(candidate, redis, config),
    () => guardConversation(candidate, redis, config),
    () => guardGoodbyeSuppressor(candidate, db, redis, config),
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
  db: Pool,
  registry?: Registry,
): Promise<GuardResult> {
  // Email bypasses business hours
  if (candidate.channel === 'email') return PASS

  // Prefer engine:business-hours service (configurable from console), fallback to proactive.json
  const bhSvc = registry?.getOptional<{ get(): BusinessHoursConfig }>('engine:business-hours')
  const bhConfig = bhSvc?.get()
  const start = bhConfig?.start ?? config.business_hours.start
  const end = bhConfig?.end ?? config.business_hours.end
  const days = bhConfig?.days ?? config.business_hours.days
  const agentTimezone = bhConfig?.agentTimezone ?? config.business_hours.timezone

  // Resolve contact timezone: prefer contact's own timezone, then phone-based country, then agent default
  const contactTimezone = await resolveContactTimezone(db, candidate.contactId, agentTimezone)

  const bh = { start, end, days, timezone: contactTimezone }
  const now = getNowInTimezone(contactTimezone)
  const hour = now.getHours()
  const day = now.getDay() // 0=Sun, 1=Mon...

  if (!days.includes(day) || hour < start || hour >= end) {
    return { passed: false, blockedBy: 'business_hours', requeue: true, requeueDelayMs: msUntilNextWindow(bh) }
  }

  return PASS
}

/** Resolve the best timezone for a contact: contact.timezone > phone country > agent default */
async function resolveContactTimezone(db: Pool, contactId: string, agentTimezone: string): Promise<string> {
  try {
    const { rows } = await db.query(
      `SELECT timezone, phone FROM contacts WHERE id = $1`,
      [contactId],
    )
    const row = rows[0] as { timezone?: string; phone?: string } | undefined
    if (!row) return agentTimezone

    // 1. Contact has explicit timezone
    if (row.timezone) return row.timezone

    // 2. Derive from phone country code
    if (row.phone) {
      const tz = timezoneFromPhone(row.phone)
      if (tz) return tz
    }
  } catch {
    // DB error — fall through to default
  }

  return agentTimezone
}

/** Map common phone country codes to their primary timezone */
const PHONE_TZ: Record<string, string> = {
  '1': 'America/New_York',       // USA/Canada (default Eastern)
  '44': 'Europe/London',         // UK
  '34': 'Europe/Madrid',         // Spain
  '49': 'Europe/Berlin',         // Germany
  '33': 'Europe/Paris',          // France
  '39': 'Europe/Rome',           // Italy
  '55': 'America/Sao_Paulo',     // Brazil
  '52': 'America/Mexico_City',   // Mexico
  '54': 'America/Argentina/Buenos_Aires', // Argentina
  '56': 'America/Santiago',      // Chile
  '57': 'America/Bogota',        // Colombia
  '58': 'America/Caracas',       // Venezuela
  '51': 'America/Lima',          // Peru
  '593': 'America/Guayaquil',    // Ecuador
  '591': 'America/La_Paz',       // Bolivia
  '595': 'America/Asuncion',     // Paraguay
  '598': 'America/Montevideo',   // Uruguay
  '506': 'America/Costa_Rica',   // Costa Rica
  '507': 'America/Panama',       // Panama
  '503': 'America/El_Salvador',  // El Salvador
  '502': 'America/Guatemala',    // Guatemala
  '504': 'America/Tegucigalpa',  // Honduras
  '505': 'America/Managua',      // Nicaragua
  '809': 'America/Santo_Domingo', // Dominican Republic
  '1787': 'America/Puerto_Rico', // Puerto Rico
  '81': 'Asia/Tokyo',            // Japan
  '82': 'Asia/Seoul',            // South Korea
  '86': 'Asia/Shanghai',         // China
  '91': 'Asia/Kolkata',          // India
  '61': 'Australia/Sydney',      // Australia
  '971': 'Asia/Dubai',           // UAE
  '972': 'Asia/Jerusalem',       // Israel
  '966': 'Asia/Riyadh',          // Saudi Arabia
  '27': 'Africa/Johannesburg',   // South Africa
}

function timezoneFromPhone(phone: string): string | null {
  // Normalize: remove +, spaces, dashes
  const digits = phone.replace(/[^0-9]/g, '')
  if (!digits) return null

  // Try 4-digit, 3-digit, 2-digit, 1-digit prefix (longer match wins)
  for (const len of [4, 3, 2, 1]) {
    const prefix = digits.substring(0, len)
    if (PHONE_TZ[prefix]) return PHONE_TZ[prefix]!
  }

  return null
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
  _config: ProactiveConfig,
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
 * Mark that a conversation ended with a farewell (called from delivery when intent is farewell).
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

// ─── 8. Goodbye Suppressor ──────────────────
// Pattern-based: checks recent message content for goodbye signals.
// Complements guard #7 (farewell flag) which relies on engine marking.
// Skipped for commitment follow-ups (skip_for_commitments=true).

async function guardGoodbyeSuppressor(
  candidate: ProactiveCandidate,
  db: Pool,
  redis: Redis,
  config: ProactiveConfig,
): Promise<GuardResult> {
  const guardConfig = config.conversation_guard
  if (guardConfig?.enabled === false) return PASS

  // Skip for commitment follow-ups when configured
  const skipForCommitments = guardConfig?.skip_for_commitments ?? true
  if (skipForCommitments && candidate.triggerType === 'commitment') return PASS
  if (candidate.isOverdue) return PASS

  const cacheTtlHours = guardConfig?.cache_ttl_hours ?? 6

  const result = await shouldSuppressProactive(
    db,
    redis,
    candidate.contactId,
    candidate.channel,
    cacheTtlHours,
  )

  if (result.suppress) {
    const requeueDelayMs = cacheTtlHours * 60 * 60 * 1000
    return {
      passed: false,
      blockedBy: 'goodbye_suppressor',
      requeue: true,
      requeueDelayMs,
    }
  }

  return PASS
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

function msUntilNextWindow(bh: { start: number; end: number; days: number[]; timezone: string }): number {
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
