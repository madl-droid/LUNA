// LUNA — Module: knowledge — Redis Cache v2
// Cache de KnowledgeInjection (Phase 1) + query embeddings.
// Invalida cuando cambian docs core, categorías o API connectors.

import type { Redis } from 'ioredis'
import pino from 'pino'
import type { KnowledgeInjection } from './types.js'
import { isCacheEnabled } from '../../kernel/cache-flag.js'

const logger = pino({ name: 'knowledge:cache' })

const KEY_INJECTION = 'knowledge:injection'
const KEY_CORE_HASH = 'knowledge:core:hash'

export class KnowledgeCache {
  private ttlSeconds: number

  constructor(
    private redis: Redis,
    ttlMinutes: number,
  ) {
    this.ttlSeconds = ttlMinutes * 60
  }

  /**
   * Cache the KnowledgeInjection object (Phase 1 consumes this).
   * TTL 5 min — short because core docs/categories/connectors rarely change.
   */
  async setInjection(injection: KnowledgeInjection): Promise<void> {
    if (!await isCacheEnabled()) return
    try {
      const INJECTION_TTL = 300 // 5 min
      await this.redis.set(KEY_INJECTION, JSON.stringify(injection), 'EX', INJECTION_TTL)
      logger.debug('Injection cache updated')
    } catch (err) {
      logger.warn({ err }, 'Failed to cache injection')
    }
  }

  /**
   * Get cached KnowledgeInjection or null if expired/missing.
   */
  async getInjection(): Promise<KnowledgeInjection | null> {
    if (!await isCacheEnabled()) return null
    try {
      const data = await this.redis.get(KEY_INJECTION)
      if (!data) return null
      return JSON.parse(data) as KnowledgeInjection
    } catch {
      return null
    }
  }

  /**
   * Set core content hash for staleness detection.
   */
  async setCoreHash(hash: string): Promise<void> {
    if (!await isCacheEnabled()) return
    try {
      await this.redis.set(KEY_CORE_HASH, hash, 'EX', this.ttlSeconds)
    } catch (err) {
      logger.warn({ err }, 'Failed to set core hash')
    }
  }

  /**
   * Check if core content is stale (hash missing or expired).
   */
  async isStale(): Promise<boolean> {
    if (!await isCacheEnabled()) return true
    try {
      const exists = await this.redis.exists(KEY_CORE_HASH)
      return exists === 0
    } catch {
      return true
    }
  }

  /**
   * Invalidate all cached knowledge data.
   * Called when core docs, categories, or API connectors change.
   */
  async invalidate(): Promise<void> {
    try {
      await this.redis.del(KEY_INJECTION, KEY_CORE_HASH)
      logger.debug('Knowledge cache invalidated')
    } catch (err) {
      logger.warn({ err }, 'Failed to invalidate cache')
    }
  }
}
