// LUNA — Users module: User type resolution
// Algoritmo: cache Redis → DB lookup (user_contacts JOIN users) → lead/unregistered fallback

import pino from 'pino'
import type { Registry } from '../../kernel/registry.js'
import type { UserResolution, UnregisteredBehavior } from './types.js'
import type { UserCache } from './cache.js'
import type { UsersDb } from './db.js'

const logger = pino({ name: 'users:resolver' })

let _registry: Registry | null = null
let _cache: UserCache | null = null
let _db: UsersDb | null = null

export function initResolver(registry: Registry, cache: UserCache, db: UsersDb): void {
  _registry = registry
  _cache = cache
  _db = db
}

/**
 * Resolve what type of user a sender is.
 *
 * 1. Check Redis cache (fast path, <1ms)
 * 2. Query DB: user_contacts JOIN users (admin → coworker → custom, first match)
 *    - For WhatsApp LID: tries LID first, then falls back to phone number
 *    - Auto-migrates sender_id from phone to LID on first match
 * 3. If no match: lead (if enabled) or unregistered behavior
 * 4. Cache result in Redis with configured TTL
 */
export async function resolveUserType(senderId: string, channel: string, fallbackSenderId?: string): Promise<UserResolution> {
  if (!_cache || !_db || !_registry) {
    throw new Error('Users module not initialized')
  }

  // 1. Cache hit?
  const cached = await _cache.get(senderId, channel)
  if (cached) {
    logger.debug({ senderId, channel, userType: cached.userType }, 'User resolved from cache')
    return {
      userType: cached.userType,
      listName: cached.listName,
      userId: cached.userId,
      contactId: senderId,
      fromCache: true,
    }
  }

  // 2. DB lookup via user_contacts → users (with phone fallback for LID migration)
  const dbResult = await _db.resolveByContact(senderId, channel, fallbackSenderId)

  let resolution: UserResolution

  if (dbResult) {
    resolution = {
      userType: dbResult.listType,
      listName: dbResult.listName,
      userId: dbResult.userId,
      contactId: senderId,
      fromCache: false,
    }
  } else {
    // Not in any user — check lead config
    const leadConfig = await _db.getListConfig('lead')

    if (leadConfig?.isEnabled) {
      resolution = {
        userType: 'lead',
        listName: leadConfig.displayName,
        contactId: senderId,
        fromCache: false,
      }
    } else {
      const behavior: UnregisteredBehavior = leadConfig?.unregisteredBehavior ?? 'silence'
      resolution = {
        userType: `_unregistered:${behavior}`,
        listName: '_unregistered',
        contactId: senderId,
        fromCache: false,
      }

      logger.debug({ senderId, channel, behavior }, 'Unregistered contact')
    }
  }

  // 3. Cache the result
  await _cache.set(senderId, channel, {
    userType: resolution.userType,
    listName: resolution.listName,
    userId: resolution.userId,
  })

  // 4. Fire hook
  try {
    await _registry.runHook('user:resolved', {
      senderId,
      channel,
      userType: resolution.userType,
      listName: resolution.listName,
    })
  } catch (err) {
    logger.warn({ err }, 'Error in user:resolved hook')
  }

  logger.debug({ senderId, channel, userType: resolution.userType }, 'User resolved from DB')
  return resolution
}

/**
 * Invalidate cached user type for a contact (all channels).
 * Call after adding/removing a user from a list.
 */
export async function invalidateUserCache(contactId: string): Promise<void> {
  if (!_cache) throw new Error('Users module not initialized')
  await _cache.invalidate(contactId)
}

/**
 * Invalidate cache for all contacts of a user.
 * Call after merge or user-level changes.
 */
export async function invalidateUserCacheForUser(userId: string): Promise<void> {
  if (!_cache || !_db) throw new Error('Users module not initialized')
  const contacts = await _db.getContactsForUser(userId)
  for (const c of contacts) {
    await _cache.invalidate(c.senderId)
  }
}
