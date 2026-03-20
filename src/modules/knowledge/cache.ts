// LUNA — Module: knowledge — Redis Cache
// Cache de conocimiento core para no re-buscar en cada mensaje.

import type { Redis } from 'ioredis'
import pino from 'pino'
import type { KnowledgeFAQ } from './types.js'

const logger = pino({ name: 'knowledge:cache' })

const KEY_CORE_INDEX = 'knowledge:core:index'
const KEY_CORE_FAQS = 'knowledge:core:faqs'
const KEY_CORE_HASH = 'knowledge:core:hash'

export class KnowledgeCache {
  private ttlSeconds: number

  constructor(
    private redis: Redis,
    ttlMinutes: number,
  ) {
    this.ttlSeconds = ttlMinutes * 60
  }

  async setCoreIndex(
    chunks: Array<{ content: string; source: string; documentId: string; section: string | null }>,
    faqs: KnowledgeFAQ[],
  ): Promise<void> {
    try {
      const hash = this.computeHash(chunks, faqs)
      const pipeline = this.redis.pipeline()

      pipeline.set(KEY_CORE_INDEX, JSON.stringify(chunks), 'EX', this.ttlSeconds)
      pipeline.set(KEY_CORE_FAQS, JSON.stringify(faqs), 'EX', this.ttlSeconds)
      pipeline.set(KEY_CORE_HASH, hash, 'EX', this.ttlSeconds)

      await pipeline.exec()
      logger.debug({ chunks: chunks.length, faqs: faqs.length }, 'Core cache updated')
    } catch (err) {
      logger.warn({ err }, 'Failed to update core cache')
    }
  }

  async getCoreIndex(): Promise<Array<{
    content: string; source: string; documentId: string; section: string | null
  }> | null> {
    try {
      const data = await this.redis.get(KEY_CORE_INDEX)
      if (!data) return null
      return JSON.parse(data) as Array<{
        content: string; source: string; documentId: string; section: string | null
      }>
    } catch {
      return null
    }
  }

  async getCoreFAQs(): Promise<KnowledgeFAQ[] | null> {
    try {
      const data = await this.redis.get(KEY_CORE_FAQS)
      if (!data) return null
      return JSON.parse(data) as KnowledgeFAQ[]
    } catch {
      return null
    }
  }

  async invalidate(): Promise<void> {
    try {
      await this.redis.del(KEY_CORE_INDEX, KEY_CORE_FAQS, KEY_CORE_HASH)
      logger.debug('Core cache invalidated')
    } catch (err) {
      logger.warn({ err }, 'Failed to invalidate core cache')
    }
  }

  async isStale(): Promise<boolean> {
    try {
      const exists = await this.redis.exists(KEY_CORE_HASH)
      return exists === 0
    } catch {
      return true
    }
  }

  private computeHash(
    chunks: Array<{ content: string; documentId: string }>,
    faqs: KnowledgeFAQ[],
  ): string {
    // Simple hash: count + first/last IDs
    const chunkSig = `${chunks.length}:${chunks[0]?.documentId ?? ''}:${chunks[chunks.length - 1]?.documentId ?? ''}`
    const faqSig = `${faqs.length}:${faqs[0]?.id ?? ''}:${faqs[faqs.length - 1]?.id ?? ''}`
    return `${chunkSig}|${faqSig}`
  }
}
