// LUNA — Memory manager
// Orquesta Redis (buffer rápido) + PostgreSQL (persistencia).

import type { Pool } from 'pg'
import type { Redis } from 'ioredis'
import pino from 'pino'
import { RedisBuffer } from './redis-buffer.js'
import { PgStore } from './pg-store.js'
import type { StoredMessage, SessionMeta } from './types.js'

const logger = pino({ name: 'memory:manager' })

export interface MemoryConfig {
  MEMORY_BUFFER_MESSAGE_COUNT: number
  MEMORY_SESSION_MAX_TTL_HOURS: number
  MEMORY_COMPRESSION_THRESHOLD: number
  MEMORY_COMPRESSION_KEEP_RECENT: number
}

export class MemoryManager {
  private redis: RedisBuffer
  private pg: PgStore

  constructor(db: Pool, redisClient: Redis, config: MemoryConfig) {
    this.redis = new RedisBuffer(redisClient, config)
    this.pg = new PgStore(db)
  }

  async initialize(): Promise<void> {
    await this.pg.ensureTable()
    logger.info('Memory manager initialized (Redis + PostgreSQL)')
  }

  async shutdown(): Promise<void> {
    logger.info('Memory manager shut down')
  }

  async saveMessage(message: StoredMessage): Promise<void> {
    await this.redis.saveMessage(message)

    // Fire-and-forget write to PG
    this.pg.saveMessage(message).catch((err) => {
      logger.error({ err, messageId: message.id }, 'Async PG write failed')
    })
  }

  async getSessionMessages(sessionId: string): Promise<StoredMessage[]> {
    const redisMessages = await this.redis.getSessionMessages(sessionId)
    if (redisMessages.length > 0) {
      return redisMessages
    }

    logger.debug({ sessionId }, 'Redis empty, falling back to PostgreSQL')
    return await this.pg.getSessionMessages(sessionId)
  }

  async getSessionMeta(sessionId: string): Promise<SessionMeta | null> {
    return await this.redis.getSessionMeta(sessionId)
  }

  async updateSessionMeta(meta: SessionMeta): Promise<void> {
    await this.redis.updateSessionMeta(meta)
  }

  async needsCompression(sessionId: string): Promise<boolean> {
    const count = await this.redis.getMessageCount(sessionId)
    return count >= this.redis.getConfig().MEMORY_COMPRESSION_THRESHOLD
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.redis.deleteSession(sessionId)
  }
}
