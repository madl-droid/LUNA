// LUNA — Users module: User type resolution
// Algoritmo: cache Redis → DB lookup (user_contacts JOIN users) → lead/unregistered fallback

import pino from 'pino'
import type { Registry } from '../../kernel/registry.js'
import type { UserResolution, UnregisteredBehavior } from './types.js'
import type { UserCache } from './cache.js'
import type { UsersDb } from './db.js'
import { isCacheEnabled } from '../../kernel/cache-flag.js'

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
 * 3. If no match: check lead config unregisteredBehavior:
 *    - ignore: return _unregistered:ignore (no registration, no response)
 *    - silence: auto-register as lead (source='engine'), return _unregistered:silence (no response)
 *    - attend: auto-register as lead (source='inbound'), return 'lead' (full pipeline)
 * 4. Cache result in Redis with configured TTL
 */
export async function resolveUserType(senderId: string, channel: string, fallbackSenderId?: string, senderName?: string): Promise<UserResolution> {
  if (!_cache || !_db || !_registry) {
    throw new Error('Users module not initialized')
  }

  // 1. Cache hit? (skip if DEBUG_CACHE_ENABLED=false)
  const cacheEnabled = await isCacheEnabled()
  if (cacheEnabled) {
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

    // Update displayName from channel profile if user has none (e.g. WhatsApp pushName)
    if (senderName && dbResult.userId) {
      _db.updateDisplayNameIfEmpty(dbResult.userId, senderName).catch(err =>
        logger.debug({ err, userId: dbResult.userId }, 'Failed to update displayName from senderName'),
      )
    }
  } else {
    // Not in any user — check lead config for unregisteredBehavior
    const leadConfig = await _db.getListConfig('lead')
    // Map legacy values to new behavior
    const rawBehavior = leadConfig?.unregisteredBehavior ?? 'ignore'
    const behavior: UnregisteredBehavior = mapLegacyBehavior(rawBehavior)

    if (behavior === 'ignore') {
      // Do nothing — Luna doesn't activate
      resolution = {
        userType: '_unregistered:ignore',
        listName: '_unregistered',
        contactId: senderId,
        fromCache: false,
      }
      logger.debug({ senderId, channel, behavior }, 'Unregistered contact — ignoring')
    } else {
      // silence, message, attend — all auto-register the contact as lead
      const source = behavior === 'attend' ? 'inbound' : 'engine'
      try {
        const newUser = await _db.createUser({
          listType: 'lead',
          displayName: senderName || undefined,
          contacts: [{ channel, senderId }],
          source,
        })
        logger.info({ userId: newUser.id, senderId, channel, behavior, source, senderName }, 'Auto-registered lead')

        if (behavior === 'attend') {
          resolution = {
            userType: 'lead',
            listName: leadConfig?.displayName ?? 'Leads',
            userId: newUser.id,
            contactId: senderId,
            fromCache: false,
          }
        } else {
          // silence or message — registered, no full pipeline
          resolution = {
            userType: `_unregistered:${behavior}`,
            listName: '_unregistered',
            userId: newUser.id,
            contactId: senderId,
            fromCache: false,
          }
        }
      } catch (err) {
        logger.warn({ err: (err as Error).message, senderId, channel, behavior }, 'Failed to auto-register lead')
        resolution = behavior === 'attend'
          ? { userType: 'lead', listName: leadConfig?.displayName ?? 'Leads', contactId: senderId, fromCache: false }
          : { userType: `_unregistered:${behavior}`, listName: '_unregistered', contactId: senderId, fromCache: false }
      }
    }
  }

  // 3. Admin override: if admin has "test as" override active, swap userType
  if (resolution.userType === 'admin') {
    try {
      const overrideResult = await _registry!.getDb().query(
        `SELECT value FROM config_store WHERE key = 'ADMIN_OVERRIDE_TYPE'`,
      )
      const overrideType = overrideResult.rows[0]?.value
      if (overrideType && overrideType !== 'admin' && overrideType !== '') {
        logger.info({ senderId, channel, originalType: 'admin', overrideType }, 'Admin override active — resolving as different type')
        resolution = {
          ...resolution,
          userType: overrideType,
          listName: overrideType === 'lead' ? 'Leads' : overrideType,
        }
      }
    } catch (err) {
      logger.debug({ err }, 'Failed to check admin override — proceeding as admin')
    }
  }

  // 4. Cache the result (skip if cache disabled)
  if (cacheEnabled) {
    await _cache.set(senderId, channel, {
      userType: resolution.userType,
      listName: resolution.listName,
      userId: resolution.userId,
    })
  }

  // 5. Fire hook
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

/**
 * Map legacy unregisteredBehavior values to the new 3-option model.
 * Old: silence | generic_message | register_only | leads
 * New: ignore | silence | attend
 */
function mapLegacyBehavior(raw: string): UnregisteredBehavior {
  switch (raw) {
    case 'ignore': return 'ignore'
    case 'silence': return 'silence'
    case 'message': return 'message'
    case 'attend': return 'attend'
    // Legacy mappings
    case 'leads': return 'attend'
    case 'register_only': return 'silence'
    case 'generic_message': return 'message'
    default: return 'ignore'
  }
}

/** Check if debug cache is enabled (default true). Reads from config_store via registry DB. */
