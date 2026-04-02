// LUNA Engine — Smart Cooldown
// Adaptive per-contact+trigger cooldown stored in Redis.
// Replaces fixed-interval scheduling with outcome-driven backoff.

import type { Redis } from 'ioredis'
import type { ProactiveConfig } from '../types.js'

// Redis key: cooldown:{contactId}:{triggerType}
// TTL: 7 days
const KEY_PREFIX = 'cooldown'
const TTL_SECONDS = 7 * 24 * 60 * 60 // 7 days

export interface CooldownState {
  contactId: string
  triggerType: string
  lastAction: 'sent' | 'no_action' | 'error' | 'blocked'
  lastActionAt: Date
  nextCheckAt: Date
  consecutiveNoActions: number
}

// ─── Defaults ───────────────────────────────

const DEFAULT_AFTER_SENT_MINUTES = 30
const DEFAULT_AFTER_NO_ACTION_MINUTES = 60
const DEFAULT_AFTER_ERROR_MINUTES = 10
const DEFAULT_MAX_BACKOFF_HOURS = 24

// ─── Helpers ────────────────────────────────

function redisKey(contactId: string, triggerType: string): string {
  return `${KEY_PREFIX}:${contactId}:${triggerType}`
}

function resolveConfig(config: ProactiveConfig): {
  afterSentMs: number
  afterNoActionMs: number
  afterErrorMs: number
  maxBackoffMs: number
} {
  const sc = config.smart_cooldown
  return {
    afterSentMs: (sc?.after_sent_minutes ?? DEFAULT_AFTER_SENT_MINUTES) * 60 * 1000,
    afterNoActionMs: (sc?.after_no_action_minutes ?? DEFAULT_AFTER_NO_ACTION_MINUTES) * 60 * 1000,
    afterErrorMs: (sc?.after_error_minutes ?? DEFAULT_AFTER_ERROR_MINUTES) * 60 * 1000,
    maxBackoffMs: (sc?.max_backoff_hours ?? DEFAULT_MAX_BACKOFF_HOURS) * 60 * 60 * 1000,
  }
}

// ─── Public API ─────────────────────────────

/**
 * Retrieve the current cooldown state for a contact+trigger pair.
 * Returns null if no state exists (first run or expired TTL).
 */
export async function getCooldownState(
  redis: Redis,
  contactId: string,
  triggerType: string,
): Promise<CooldownState | null> {
  const raw = await redis.get(redisKey(contactId, triggerType))
  if (!raw) return null

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    return {
      contactId: String(parsed.contactId ?? contactId),
      triggerType: String(parsed.triggerType ?? triggerType),
      lastAction: parsed.lastAction as CooldownState['lastAction'],
      lastActionAt: new Date(String(parsed.lastActionAt)),
      nextCheckAt: new Date(String(parsed.nextCheckAt)),
      consecutiveNoActions: Number(parsed.consecutiveNoActions ?? 0),
    }
  } catch {
    return null
  }
}

/**
 * Calculate when the next check should happen based on the outcome.
 * Applies adaptive backoff:
 * - sent       → afterSentMs (default 30m)
 * - no_action  → afterNoActionMs × backoff (default 60m, 120m after 2+ consecutive)
 * - error      → afterErrorMs (default 10m)
 * - blocked    → 4h (hard backoff — guard won't clear soon)
 */
export function calculateNextCheck(
  lastAction: CooldownState['lastAction'],
  consecutiveNoActions: number,
  config: ProactiveConfig,
): Date {
  const { afterSentMs, afterNoActionMs, afterErrorMs, maxBackoffMs } = resolveConfig(config)

  let delayMs: number
  switch (lastAction) {
    case 'sent':
      delayMs = afterSentMs
      break
    case 'no_action':
      // Exponential backoff after 2+ consecutive no-ops
      delayMs = consecutiveNoActions >= 2
        ? Math.min(afterNoActionMs * 2, maxBackoffMs)
        : afterNoActionMs
      break
    case 'error':
      delayMs = afterErrorMs
      break
    case 'blocked':
      delayMs = Math.min(4 * 60 * 60 * 1000, maxBackoffMs) // 4h hard backoff
      break
  }

  return new Date(Date.now() + delayMs)
}

/**
 * Persist updated cooldown state in Redis after a job outcome.
 * Should be called by the proactive runner after each job completes.
 */
export async function updateCooldownState(
  redis: Redis,
  contactId: string,
  triggerType: string,
  action: CooldownState['lastAction'],
  config: ProactiveConfig,
): Promise<void> {
  // Load existing state to carry forward consecutiveNoActions
  const existing = await getCooldownState(redis, contactId, triggerType)
  const prevNoActions = existing?.consecutiveNoActions ?? 0

  const consecutiveNoActions = action === 'no_action' ? prevNoActions + 1 : 0
  const nextCheckAt = calculateNextCheck(action, consecutiveNoActions, config)

  const state: CooldownState = {
    contactId,
    triggerType,
    lastAction: action,
    lastActionAt: new Date(),
    nextCheckAt,
    consecutiveNoActions,
  }

  await redis.set(
    redisKey(contactId, triggerType),
    JSON.stringify({
      ...state,
      lastActionAt: state.lastActionAt.toISOString(),
      nextCheckAt: state.nextCheckAt.toISOString(),
    }),
    'EX',
    TTL_SECONDS,
  )
}

/**
 * Check if a contact+trigger is still in cooldown.
 * Returns true if nextCheckAt is in the future (skip this run).
 */
export async function isInCooldown(
  redis: Redis,
  contactId: string,
  triggerType: string,
): Promise<boolean> {
  const state = await getCooldownState(redis, contactId, triggerType)
  if (!state) return false
  return state.nextCheckAt > new Date()
}
