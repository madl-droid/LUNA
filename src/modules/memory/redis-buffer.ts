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

  /**
   * Count turns (not raw messages) in the buffer.
   * A turn = user message(s) + assistant response. We count assistant messages.
   */
  async getTurnCount(sessionId: string): Promise<number> {
    const key = `session:${sessionId}:messages`
    const raw = await this.redis.lrange(key, 0, -1)
    let turns = 0
    for (const item of raw) {
      const msg = JSON.parse(item) as StoredMessage
      if (msg.role === 'assistant') turns++
    }
    return turns
  }

  /**
   * Get all messages belonging to the oldest N turns (for compression input).
   * A turn boundary is an assistant message. We collect messages until we've
   * seen `turnCount` assistant messages.
   */
  async getOldestTurnMessages(sessionId: string, turnCount: number): Promise<StoredMessage[]> {
    const key = `session:${sessionId}:messages`
    const raw = await this.redis.lrange(key, 0, -1)
    const result: StoredMessage[] = []
    let turns = 0
    for (const item of raw) {
      const msg = JSON.parse(item) as StoredMessage
      result.push(msg)
      if (msg.role === 'assistant') {
        turns++
        if (turns >= turnCount) break
      }
    }
    return result
  }

  /**
   * Trim buffer keeping only the last N complete turns.
   * Scans from the end to find the boundary of the Nth turn, then trims.
   */
  async trimKeepingTurns(sessionId: string, keepTurns: number): Promise<void> {
    const key = `session:${sessionId}:messages`
    const raw = await this.redis.lrange(key, 0, -1)
    if (raw.length === 0) return

    let turns = 0
    let cutIndex = 0 // default: keep everything (ltrim 0 -1 = no-op)

    for (let i = raw.length - 1; i >= 0; i--) {
      const msg = JSON.parse(raw[i]!) as StoredMessage
      if (msg.role !== 'assistant') continue

      turns++
      if (turns < keepTurns) continue

      // Oldest turn to keep found at position i.
      // Its start = first position after the previous assistant.
      let prevAssistantIdx = -1
      for (let j = i - 1; j >= 0; j--) {
        if ((JSON.parse(raw[j]!) as StoredMessage).role === 'assistant') {
          prevAssistantIdx = j
          break
        }
      }
      cutIndex = prevAssistantIdx + 1  // -1+1=0 if no prior assistant
      break
    }

    if (cutIndex <= 0) return
    await this.redis.ltrim(key, cutIndex, -1)
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
