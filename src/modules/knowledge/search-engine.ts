// LUNA — Module: knowledge — Search Engine v2
// Búsqueda híbrida: pgvector cosine + FTS PostgreSQL + FAQ FTS.
// Elimina fuse.js. Degrada a solo FTS si embeddings no disponibles.

import pino from 'pino'
import type { Redis } from 'ioredis'
import type { KnowledgePgStore } from './pg-store.js'
import type { EmbeddingService } from './embedding-service.js'
import type { KnowledgeSearchResult, KnowledgeSearchOptions } from './types.js'

const logger = pino({ name: 'knowledge:search' })

// Weights for hybrid scoring
const VECTOR_WEIGHT = 0.6
const FTS_WEIGHT = 0.3
const FAQ_WEIGHT = 0.1

// Degraded mode (no embeddings available)
const FTS_WEIGHT_DEGRADED = 0.8
const FAQ_WEIGHT_DEGRADED = 0.2

// Category boost when searchHint matches
const CATEGORY_BOOST = 0.2

// Core document boost — applied after category boost
const CORE_BOOST = 0.15

// Query embedding cache TTL
const QUERY_CACHE_TTL_S = 600 // 10 min

// FIX: KN-3 — Search timeouts to prevent blocking on slow queries
const VECTOR_SEARCH_TIMEOUT_MS = 5000
const FTS_SEARCH_TIMEOUT_MS = 3000
const FAQ_SEARCH_TIMEOUT_MS = 2000

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms),
    ),
  ])
}

export class KnowledgeSearchEngine {
  constructor(
    private pgStore: KnowledgePgStore,
    private embeddingService: EmbeddingService | null,
    private redis: Redis,
  ) {}

  /**
   * Search all knowledge (consultable — not core docs).
   * Uses vector + FTS hybrid, with optional category boost via searchHint.
   */
  async search(query: string, opts: KnowledgeSearchOptions = {}): Promise<KnowledgeSearchResult[]> {
    if (!query.trim()) return []

    const limit = opts.limit ?? 5
    const searchHint = opts.searchHint ?? null

    // Determine if embeddings are available
    const embeddingsAvailable = this.embeddingService?.isAvailable() ?? false

    // Get query embedding (with cache)
    let queryEmbedding: number[] | null = null
    if (embeddingsAvailable && this.embeddingService) {
      queryEmbedding = await this.getCachedQueryEmbedding(query)
    }

    // FIX: KN-3 — Run searches in parallel with individual timeouts
    const [vectorSettled, ftsSettled, faqSettled] = await Promise.allSettled([
      queryEmbedding
        ? withTimeout(this.pgStore.searchChunksVector(queryEmbedding, limit * 2), VECTOR_SEARCH_TIMEOUT_MS, 'vector search')
        : Promise.resolve([]),
      withTimeout(this.pgStore.searchChunksFTS(query, limit * 2), FTS_SEARCH_TIMEOUT_MS, 'FTS search'),
      withTimeout(this.pgStore.searchFaqsFTS(query, limit), FAQ_SEARCH_TIMEOUT_MS, 'FAQ search'),
    ])

    const vectorResults = vectorSettled.status === 'fulfilled' ? vectorSettled.value : []
    const ftsResults = ftsSettled.status === 'fulfilled' ? ftsSettled.value : []
    const faqResults = faqSettled.status === 'fulfilled' ? faqSettled.value : []

    if (vectorSettled.status === 'rejected') logger.warn({ err: vectorSettled.reason }, 'Vector search failed/timed out')
    if (ftsSettled.status === 'rejected') logger.warn({ err: ftsSettled.reason }, 'FTS search failed/timed out')
    if (faqSettled.status === 'rejected') logger.warn({ err: faqSettled.reason }, 'FAQ search failed/timed out')

    // Choose weights based on availability
    const useVector = queryEmbedding !== null && vectorResults.length > 0
    const wVector = useVector ? VECTOR_WEIGHT : 0
    const wFts = useVector ? FTS_WEIGHT : FTS_WEIGHT_DEGRADED
    const wFaq = useVector ? FAQ_WEIGHT : FAQ_WEIGHT_DEGRADED

    // Merge and score chunks
    type ScoredEntry = KnowledgeSearchResult & { combinedScore: number; categoryIds: string[]; isCore: boolean }
    const scored = new Map<string, ScoredEntry>()

    // Add vector results
    for (const r of vectorResults) {
      scored.set(r.chunkId, {
        content: r.content,
        source: r.documentTitle,
        score: 0,
        type: 'chunk',
        documentId: r.documentId,
        fileUrl: r.fileUrl ?? undefined,
        chunkIndex: r.chunkIndex,
        chunkTotal: r.chunkTotal ?? undefined,
        sourceType: r.sourceType,
        isCore: r.isCore,
        combinedScore: r.similarity * wVector,
        categoryIds: r.categoryIds ?? [],
      })
    }

    // Add/merge FTS results
    for (const r of ftsResults) {
      const existing = scored.get(r.chunkId)
      if (existing) {
        existing.combinedScore += r.rank * wFts
        existing.isCore ||= r.isCore
      } else {
        scored.set(r.chunkId, {
          content: r.content,
          source: r.documentTitle,
          score: 0,
          type: 'chunk',
          documentId: r.documentId,
          fileUrl: r.fileUrl ?? undefined,
          chunkIndex: r.chunkIndex,
          chunkTotal: r.chunkTotal ?? undefined,
          sourceType: r.sourceType,
          isCore: r.isCore,
          combinedScore: r.rank * wFts,
          categoryIds: r.categoryIds ?? [],
        })
      }
    }

    // Add FAQ results
    for (const r of faqResults) {
      scored.set(`faq:${r.faqId}`, {
        content: `P: ${r.question}\nR: ${r.answer}`,
        source: 'FAQ',
        score: 0,
        type: 'faq',
        faqId: r.faqId,
        isCore: false,
        combinedScore: r.rank * wFaq,
        categoryIds: [],
      })
    }

    // Apply category boost if searchHint is provided
    if (searchHint) {
      const matchedCategory = await this.pgStore.findCategoryByTitle(searchHint)
      if (matchedCategory) {
        for (const entry of scored.values()) {
          if (entry.categoryIds.includes(matchedCategory.id)) {
            entry.combinedScore += CATEGORY_BOOST
          }
        }
      }
    }

    // Apply core boost
    for (const entry of scored.values()) {
      if (entry.isCore) entry.combinedScore += CORE_BOOST
    }

    // Sort by combined score, normalize, and take top N
    const sorted = [...scored.values()]
      .sort((a, b) => b.combinedScore - a.combinedScore)
      .slice(0, limit)

    // Normalize scores to 0-1
    const maxScore = sorted[0]?.combinedScore ?? 1
    return sorted.map(({ combinedScore, categoryIds: _cats, isCore: _ic, ...rest }) => ({
      ...rest,
      score: maxScore > 0 ? combinedScore / maxScore : 0,
    }))
  }

  /**
   * Invalidate query embedding cache.
   */
  async invalidateQueryCache(): Promise<void> {
    try {
      const keys = await this.redis.keys('knowledge:qemb:*')
      if (keys.length > 0) {
        await this.redis.del(...keys)
      }
    } catch {
      // Non-critical
    }
  }

  // ─── Internal ──────────────────────────────

  private async getCachedQueryEmbedding(query: string): Promise<number[] | null> {
    const cacheKey = `knowledge:qemb:${this.hashQuery(query)}`

    // Try cache first
    try {
      const cached = await this.redis.get(cacheKey)
      if (cached) return JSON.parse(cached) as number[]
    } catch {
      // Cache miss or error — generate fresh
    }

    // Generate embedding
    const embedding = await this.embeddingService!.generateEmbedding(query)
    if (!embedding) return null

    // Cache it
    try {
      await this.redis.set(cacheKey, JSON.stringify(embedding), 'EX', QUERY_CACHE_TTL_S)
    } catch {
      // Non-critical
    }

    return embedding
  }

  private hashQuery(query: string): string {
    // Simple hash for cache key — not cryptographic, just for dedup
    let hash = 0
    for (let i = 0; i < query.length; i++) {
      const char = query.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash |= 0 // Convert to 32bit integer
    }
    return Math.abs(hash).toString(36)
  }
}
