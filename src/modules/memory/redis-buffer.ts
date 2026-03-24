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
      agentId: data.agentId ?? '',
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
      agentId: meta.agentId,
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
    )
  }

  async getMessageCount(sessionId: string): Promise<number> {
    return await this.redis.llen(`session:${sessionId}:messages`)
  }

  // ═══════════════════════════════════════════
  // Lead status cache (NEW — v3)
  // key: lead_status:{contactId}:{agentId}
  // ═══════════════════════════════════════════

  async getLeadStatus(contactId: string, agentId: string): Promise<string | null> {
    try {
      return await this.redis.get(`lead_status:${contactId}:${agentId}`)
    } catch {
      return null
    }
  }

  async setLeadStatus(contactId: string, agentId: string, status: string): Promise<void> {
    try {
      await this.redis.set(`lead_status:${contactId}:${agentId}`, status, 'EX', 43200) // 12h
    } catch (err) {
      logger.warn({ err, contactId, agentId }, 'Failed to cache lead status')
    }
  }

  async invalidateLeadStatus(contactId: string, agentId: string): Promise<void> {
    try {
      await this.redis.del(`lead_status:${contactId}:${agentId}`)
    } catch {
      // ignore
    }
  }

  // ═══════════════════════════════════════════
  // Context bundle cache (NEW — v3)
  // key: context:{contactId}:{agentId}
  // Short TTL (5min) — invalidated on new message
  // ═══════════════════════════════════════════

  async getCachedContext(contactId: string, agentId: string): Promise<string | null> {
    try {
      return await this.redis.get(`context:${contactId}:${agentId}`)
    } catch {
      return null
    }
  }

  async setCachedContext(contactId: string, agentId: string, contextJson: string): Promise<void> {
    try {
      await this.redis.set(`context:${contactId}:${agentId}`, contextJson, 'EX', 300) // 5min
    } catch (err) {
      logger.warn({ err, contactId, agentId }, 'Failed to cache context')
    }
  }

  async invalidateContext(contactId: string, agentId: string): Promise<void> {
    try {
      await this.redis.del(`context:${contactId}:${agentId}`)
    } catch {
      // ignore
    }
  }
}
