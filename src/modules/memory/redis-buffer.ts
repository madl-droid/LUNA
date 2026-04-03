// LUNA — Redis buffer for session messages (v3)
// Adds new cache keys for lead_status, context bundle.

import type { Redis } from 'ioredis'
import pino from 'pino'
import type { StoredMessage, SessionMeta } from './types.js'
import type { MemoryConfig } from './memory-manager.js'

const logger = pino({ name: 'memory:redis-buffer' })

export class RedisBuffer {
  constructor(
    private redis: Redis,
    private config: MemoryConfig,
  ) {}

  getConfig(): MemoryConfig {
    return this.config
  }

  // ═══════════════════════════════════════════
  // Session messages (hot tier)
  // ═══════════════════════════════════════════

  async saveMessage(message: StoredMessage): Promise<void> {
    const key = `session:${message.sessionId}:messages`
    const ttlSeconds = this.config.MEMORY_SESSION_MAX_TTL_HOURS * 3600

    await this.redis.rpush(key, JSON.stringify(message))
    await this.redis.expire(key, ttlSeconds)

    const bufferSize = this.config.MEMORY_BUFFER_MESSAGE_COUNT
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

  // ═══════════════════════════════════════════
  // Session metadata
  // ═══════════════════════════════════════════

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
      status: (data.status as SessionMeta['status']) ?? 'active',
    }
  }

  async updateSessionMeta(meta: SessionMeta): Promise<void> {
    const key = `session:${meta.sessionId}:meta`
    const ttlSeconds = this.config.MEMORY_SESSION_MAX_TTL_HOURS * 3600

    await this.redis.hset(key, {
      sessionId: meta.sessionId,
      contactId: meta.contactId,
      channelName: meta.channelName,
      startedAt: meta.startedAt.toISOString(),
      lastActivityAt: meta.lastActivityAt.toISOString(),
      messageCount: String(meta.messageCount),
      compressed: String(meta.compressed),
      status: meta.status,
    })
    await this.redis.expire(key, ttlSeconds)
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.redis.del(
      `session:${sessionId}:messages`,
      `session:${sessionId}:meta`,
      `session:${sessionId}:buffer_summary`,
    )
  }

  async getMessageCount(sessionId: string): Promise<number> {
    return await this.redis.llen(`session:${sessionId}:messages`)
  }

  // ═══════════════════════════════════════════
  // Buffer summary (inline compression — Phase 3)
  // key: session:{sessionId}:buffer_summary
  // Running summary of compressed older messages. PG messages are never touched.
  // ═══════════════════════════════════════════

  async getBufferSummary(sessionId: string): Promise<string | null> {
    try {
      return await this.redis.get(`session:${sessionId}:buffer_summary`)
    } catch {
      return null
    }
  }

  async setBufferSummary(sessionId: string, summary: string): Promise<void> {
    const ttlSeconds = this.config.MEMORY_SESSION_MAX_TTL_HOURS * 3600
    await this.redis.set(`session:${sessionId}:buffer_summary`, summary, 'EX', ttlSeconds)
  }

  /** Get the oldest `count` messages from the buffer (for compression input) */
  async getOldestMessages(sessionId: string, count: number): Promise<StoredMessage[]> {
    const key = `session:${sessionId}:messages`
    const raw = await this.redis.lrange(key, 0, count - 1)
    return raw.map((item: string) => JSON.parse(item) as StoredMessage)
  }

  /** Trim buffer to keep only the last `keepCount` messages (removes oldest) */
  async trimOldestMessages(sessionId: string, keepCount: number): Promise<void> {
    await this.redis.ltrim(`session:${sessionId}:messages`, -keepCount, -1)
  }

  // ═══════════════════════════════════════════
  // Lead status cache (NEW — v3)
  // key: lead_status:{contactId}
  // ═══════════════════════════════════════════

  async getLeadStatus(contactId: string): Promise<string | null> {
    try {
      return await this.redis.get(`lead_status:${contactId}`)
    } catch {
      return null
    }
  }

  async setLeadStatus(contactId: string, status: string): Promise<void> {
    try {
      await this.redis.set(`lead_status:${contactId}`, status, 'EX', 43200) // 12h
    } catch (err) {
      logger.warn({ err, contactId }, 'Failed to cache lead status')
    }
  }

  async invalidateLeadStatus(contactId: string): Promise<void> {
    try {
      await this.redis.del(`lead_status:${contactId}`)
    } catch {
      // ignore
    }
  }

  // ═══════════════════════════════════════════
  // Context bundle cache (NEW — v3)
  // key: context:{contactId}
  // Short TTL (5min) — invalidated on new message
  // ═══════════════════════════════════════════

  async getCachedContext(contactId: string): Promise<string | null> {
    try {
      return await this.redis.get(`context:${contactId}`)
    } catch {
      return null
    }
  }

  async setCachedContext(contactId: string, contextJson: string): Promise<void> {
    try {
      await this.redis.set(`context:${contactId}`, contextJson, 'EX', 300) // 5min
    } catch (err) {
      logger.warn({ err, contactId }, 'Failed to cache context')
    }
  }

  async invalidateContext(contactId: string): Promise<void> {
    try {
      await this.redis.del(`context:${contactId}`)
    } catch {
      // ignore
    }
  }
}
