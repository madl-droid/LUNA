// LUNA — Redis buffer for session messages
// Almacena mensajes recientes en Redis para acceso rápido.

import { Redis } from 'ioredis'
import pino from 'pino'
import { config } from '../config.js'
import type { StoredMessage, SessionMeta } from './types.js'

const logger = pino({ name: 'redis-buffer', level: config.logLevel })

export class RedisBuffer {
  private redis: Redis

  constructor() {
    this.redis = new Redis({
      host: config.redis.host,
      port: config.redis.port,
      password: config.redis.password || undefined,
      db: config.redis.db,
      maxRetriesPerRequest: config.redis.maxRetries,
      lazyConnect: true,
    })
  }

  async connect(): Promise<void> {
    await this.redis.connect()
    logger.info('Redis buffer connected')
  }

  async disconnect(): Promise<void> {
    await this.redis.quit()
    logger.info('Redis buffer disconnected')
  }

  async saveMessage(message: StoredMessage): Promise<void> {
    const key = `session:${message.sessionId}:messages`
    const ttlSeconds = config.instanceConfig.memory.sessionMaxTTLHours * 3600

    await this.redis.rpush(key, JSON.stringify(message))
    await this.redis.expire(key, ttlSeconds)

    // Trim to buffer size
    const bufferSize = config.instanceConfig.memory.bufferMessageCount
    const len = await this.redis.llen(key)
    if (len > bufferSize) {
      await this.redis.ltrim(key, len - bufferSize, -1)
    }
  }

  async getSessionMessages(sessionId: string): Promise<StoredMessage[]> {
    const key = `session:${sessionId}:messages`
    const raw = await this.redis.lrange(key, 0, -1)
    return raw.map((item: string) => JSON.parse(item) as StoredMessage)
  }

  async getSessionMeta(sessionId: string): Promise<SessionMeta | null> {
    const key = `session:${sessionId}:meta`
    const data = await this.redis.hgetall(key)
    const sid = data.sessionId
    if (!data || !sid) return null

    return {
      sessionId: sid,
      contactId: data.contactId ?? '',
      channelName: data.channelName ?? '',
      startedAt: new Date(data.startedAt ?? 0),
      lastActivityAt: new Date(data.lastActivityAt ?? 0),
      messageCount: parseInt(data.messageCount ?? '0', 10),
      compressed: data.compressed === 'true',
    }
  }

  async updateSessionMeta(meta: SessionMeta): Promise<void> {
    const key = `session:${meta.sessionId}:meta`
    const ttlSeconds = config.instanceConfig.memory.sessionMaxTTLHours * 3600

    await this.redis.hset(key, {
      sessionId: meta.sessionId,
      contactId: meta.contactId,
      channelName: meta.channelName,
      startedAt: meta.startedAt.toISOString(),
      lastActivityAt: meta.lastActivityAt.toISOString(),
      messageCount: String(meta.messageCount),
      compressed: String(meta.compressed),
    })
    await this.redis.expire(key, ttlSeconds)
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.redis.del(
      `session:${sessionId}:messages`,
      `session:${sessionId}:meta`,
    )
  }

  async getMessageCount(sessionId: string): Promise<number> {
    return await this.redis.llen(`session:${sessionId}:messages`)
  }

  getClient(): Redis {
    return this.redis
  }
}
