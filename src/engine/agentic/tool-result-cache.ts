// LUNA Engine — Tool Result Cache
// Generic per-contact Redis-backed cache that persists tool results across conversation turns.
// The LLM gets recent tool results injected into context so it knows what was already called.
// Lifecycle: per-contact, TTL 6h (session concept). Stores last N entries as a circular buffer.

import type { Redis } from 'ioredis'
import pino from 'pino'
import { createHash } from 'node:crypto'

const logger = pino({ name: 'engine:tool-result-cache' })

const DEFAULT_TTL_S = 60 * 60 * 6  // 6 hours
const MAX_ENTRIES = 10
const MAX_SUMMARY_LEN = 500
const REDIS_KEY_PREFIX = 'tool_cache:'

export interface ToolCacheEntry {
  /** Tool name */
  tool: string
  /** Short hash of the input to identify unique calls */
  inputHash: string
  /** Truncated summary of the result */
  summary: string
  /** Whether the tool call succeeded */
  success: boolean
  /** Unix timestamp (ms) */
  timestamp: number
}

/**
 * Generic per-contact tool result cache backed by Redis.
 * Stores the last N tool results so the LLM has context about previous tool calls
 * across conversation turns within the same session.
 *
 * Key format: `tool_cache:{contactId}` — single key per contact, stores JSON array.
 */
export class ToolResultCache {
  private readonly ttlS: number

  constructor(
    private readonly redis: Redis,
    ttlS: number = DEFAULT_TTL_S,
  ) {
    this.ttlS = ttlS
  }

  private key(contactId: string): string {
    return `${REDIS_KEY_PREFIX}${contactId}`
  }

  /**
   * Build a short hash of the tool input for dedup identification.
   */
  private hashInput(input: Record<string, unknown>): string {
    const raw = JSON.stringify(input)
    return createHash('sha256').update(raw).digest('hex').slice(0, 12)
  }

  /**
   * Build a truncated summary from the tool result.
   */
  private buildSummary(result: { success: boolean; data?: unknown; error?: string }): string {
    if (!result.success) {
      return `Error: ${(result.error ?? 'Unknown error').slice(0, MAX_SUMMARY_LEN)}`
    }
    if (result.data === undefined || result.data === null) {
      return '(sin datos)'
    }
    const raw = typeof result.data === 'string' ? result.data : JSON.stringify(result.data)
    return raw.length > MAX_SUMMARY_LEN ? raw.slice(0, MAX_SUMMARY_LEN) + '...' : raw
  }

  /**
   * Record a tool result in the persistent cache.
   * Maintains a circular buffer of MAX_ENTRIES per contact.
   *
   * This is fire-and-forget — errors are logged but never thrown.
   */
  async record(
    contactId: string,
    toolName: string,
    input: Record<string, unknown>,
    result: { success: boolean; data?: unknown; error?: string },
  ): Promise<void> {
    try {
      const redisKey = this.key(contactId)
      const entry: ToolCacheEntry = {
        tool: toolName,
        inputHash: this.hashInput(input),
        summary: this.buildSummary(result),
        success: result.success,
        timestamp: Date.now(),
      }

      // Read existing entries
      const raw = await this.redis.get(redisKey)
      let entries: ToolCacheEntry[] = []
      if (raw) {
        try { entries = JSON.parse(raw) as ToolCacheEntry[] } catch { entries = [] }
      }

      // Append new entry, drop oldest if over limit
      entries.push(entry)
      if (entries.length > MAX_ENTRIES) {
        entries = entries.slice(entries.length - MAX_ENTRIES)
      }

      await this.redis.set(redisKey, JSON.stringify(entries), 'EX', this.ttlS)
    } catch (err) {
      logger.warn({ contactId, toolName, err }, 'Failed to record tool result in cache — continuing')
    }
  }

  /**
   * Get recent tool results for a contact.
   * Returns empty array on any failure (graceful degradation).
   */
  async getRecent(contactId: string): Promise<ToolCacheEntry[]> {
    try {
      const raw = await this.redis.get(this.key(contactId))
      if (!raw) return []
      const entries = JSON.parse(raw) as ToolCacheEntry[]
      return Array.isArray(entries) ? entries : []
    } catch (err) {
      logger.warn({ contactId, err }, 'Failed to read tool result cache — returning empty')
      return []
    }
  }

  /**
   * Clear all cached tool results for a contact.
   */
  async clear(contactId: string): Promise<void> {
    try {
      await this.redis.del(this.key(contactId))
    } catch (err) {
      logger.warn({ contactId, err }, 'Failed to clear tool result cache — continuing')
    }
  }
}
