// LUNA — Users module: Redis cache for user type resolution
// Key pattern: user_type:{senderId}:{channel}
// Value: JSON { userType, listName }

import type { Redis } from 'ioredis'
import pino from 'pino'

const logger = pino({ name: 'users:cache' })

const KEY_PREFIX = 'user_type'

interface CachedResolution {
  userType: string
  listName: string
  userId?: string
}

export class UserCache {
  constructor(
    private redis: Redis,
    private ttlSeconds: number,
  ) {}

  private key(senderId: string, channel: string): string {
    return `${KEY_PREFIX}:${senderId}:${channel}`
  }

  async get(senderId: string, channel: string): Promise<CachedResolution | null> {
    const raw = await this.redis.get(this.key(senderId, channel))
    if (!raw) return null

    try {
      return JSON.parse(raw) as CachedResolution
    } catch {
      logger.warn({ senderId, channel }, 'Corrupt cache entry, ignoring')
      return null
    }
  }

  async set(senderId: string, channel: string, resolution: CachedResolution): Promise<void> {
    await this.redis.set(
      this.key(senderId, channel),
      JSON.stringify(resolution),
      'EX',
      this.ttlSeconds,
    )
  }

  async invalidate(contactId: string): Promise<void> {
    // contactId can be a senderId — scan all channels
    const pattern = `${KEY_PREFIX}:${contactId}:*`
    let cursor = '0'
    let deleted = 0

    do {
      const [nextCursor, keys] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100)
      cursor = nextCursor
      if (keys.length > 0) {
        await this.redis.del(...keys)
        deleted += keys.length
      }
    } while (cursor !== '0')

    if (deleted > 0) {
      logger.debug({ contactId, deleted }, 'User cache invalidated')
    }
  }

  async invalidateAll(): Promise<void> {
    const pattern = `${KEY_PREFIX}:*`
    let cursor = '0'
    let deleted = 0

    do {
      const [nextCursor, keys] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 100)
      cursor = nextCursor
      if (keys.length > 0) {
        await this.redis.del(...keys)
        deleted += keys.length
      }
    } while (cursor !== '0')

    logger.info({ deleted }, 'All user cache entries invalidated')
  }
}
