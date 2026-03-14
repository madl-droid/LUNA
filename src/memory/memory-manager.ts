// LUNA — Memory manager
// Orquesta Redis (buffer rápido) + PostgreSQL (persistencia).

import pino from 'pino'
import { config } from '../config.js'
import { RedisBuffer } from './redis-buffer.js'
import { PgStore } from './pg-store.js'
import type { StoredMessage, SessionMeta } from './types.js'

const logger = pino({ name: 'memory-manager', level: config.logLevel })

export class MemoryManager {
  private redis: RedisBuffer
  private pg: PgStore

  constructor() {
    this.redis = new RedisBuffer()
    this.pg = new PgStore()
  }

  async initialize(): Promise<void> {
    await this.redis.connect()
    await this.pg.connect()
    logger.info('Memory manager initialized (Redis + PostgreSQL)')
  }

  async shutdown(): Promise<void> {
    await this.redis.disconnect()
    await this.pg.disconnect()
    logger.info('Memory manager shut down')
  }

  /** Save message to Redis (sync) + PostgreSQL (async fire-and-forget) */
  async saveMessage(message: StoredMessage): Promise<void> {
    await this.redis.saveMessage(message)

    // Fire-and-forget write to PG
    this.pg.saveMessage(message).catch((err) => {
      logger.error({ err, messageId: message.id }, 'Async PG write failed')
    })
  }

  /** Get session messages: Redis first, fallback to PG */
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

  /** Check if session needs compression */
  async needsCompression(sessionId: string): Promise<boolean> {
    const count = await this.redis.getMessageCount(sessionId)
    return count >= config.instanceConfig.memory.compressionThreshold
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.redis.deleteSession(sessionId)
  }

  getRedisBuffer(): RedisBuffer {
    return this.redis
  }

  getPgStore(): PgStore {
    return this.pg
  }
}
