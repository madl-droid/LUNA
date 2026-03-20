// LUNA — Module: knowledge — Search Engine
// Búsqueda híbrida: FTS PostgreSQL + fuse.js fuzzy + FAQ match.

import Fuse from 'fuse.js'
import pino from 'pino'
import type { KnowledgePgStore } from './pg-store.js'
import type { KnowledgeCache } from './cache.js'
import type {
  KnowledgeCategory,
  KnowledgeSearchResult,
  KnowledgeSearchOptions,
  KnowledgeFAQ,
} from './types.js'

const logger = pino({ name: 'knowledge:search' })

interface FuseEntry {
  content: string
  source: string
  documentId: string
  section: string | null
}

interface FuseFAQEntry {
  text: string
  faqId: string
  answer: string
}

// Weights for hybrid scoring
const FTS_WEIGHT = 0.4
const FUZZY_WEIGHT = 0.4
const FAQ_WEIGHT = 0.2

export class KnowledgeSearchEngine {
  private coreIndex: Fuse<FuseEntry> | null = null
  private consultableIndex: Fuse<FuseEntry> | null = null
  private faqIndex: Fuse<FuseFAQEntry> | null = null

  constructor(
    private pgStore: KnowledgePgStore,
    private cache: KnowledgeCache,
  ) {}

  /**
   * Build in-memory fuse.js indices from database.
   */
  async rebuildIndices(): Promise<void> {
    const [coreChunks, consultableChunks, faqs] = await Promise.all([
      this.pgStore.getAllChunksByCategory('core'),
      this.pgStore.getAllChunksByCategory('consultable'),
      this.pgStore.getActiveFAQs(),
    ])

    this.coreIndex = this.buildFuseIndex(coreChunks)
    this.consultableIndex = this.buildFuseIndex(consultableChunks)
    this.faqIndex = this.buildFAQIndex(faqs)

    // Cache core data in Redis
    await this.cache.setCoreIndex(coreChunks, faqs)

    logger.info({
      coreChunks: coreChunks.length,
      consultableChunks: consultableChunks.length,
      faqs: faqs.length,
    }, 'Search indices rebuilt')
  }

  /**
   * Search core knowledge (always injected in Phase 1).
   */
  async searchCore(query: string, limit = 5): Promise<KnowledgeSearchResult[]> {
    return this.hybridSearch(query, 'core', limit)
  }

  /**
   * Search consultable knowledge (on-demand via tool).
   */
  async searchConsultable(query: string, limit = 5): Promise<KnowledgeSearchResult[]> {
    return this.hybridSearch(query, 'consultable', limit)
  }

  /**
   * Invalidate indices (called when docs change).
   */
  invalidate(): void {
    this.coreIndex = null
    this.consultableIndex = null
    this.faqIndex = null
  }

  /**
   * Invalidate only core index.
   */
  invalidateCore(): void {
    this.coreIndex = null
    this.faqIndex = null
    this.cache.invalidate().catch(() => {})
  }

  // ─── Internal ──────────────────────────────

  private async hybridSearch(
    query: string,
    category: KnowledgeCategory,
    limit: number,
  ): Promise<KnowledgeSearchResult[]> {
    if (!query.trim()) return []

    // Ensure indices are loaded
    await this.ensureIndices()

    // Run FTS + fuzzy in parallel
    const [ftsResults, fuseResults, faqResults] = await Promise.all([
      this.pgStore.searchChunksFTS(query, category, limit * 2),
      this.fuseSearch(query, category, limit * 2),
      category === 'core' ? this.faqSearch(query, limit) : Promise.resolve([]),
    ])

    // Merge and score
    const scored = new Map<string, KnowledgeSearchResult & { combinedScore: number }>()

    // Add FTS results
    for (const r of ftsResults) {
      const key = `chunk:${r.chunkId}`
      scored.set(key, {
        content: r.content,
        source: r.documentTitle,
        score: 0,
        type: 'chunk',
        documentId: r.documentId,
        combinedScore: r.score * FTS_WEIGHT,
      })
    }

    // Add/merge fuzzy results
    for (const r of fuseResults) {
      const key = `chunk:${r.documentId}:${r.content.substring(0, 50)}`
      const existing = scored.get(key)
      if (existing) {
        existing.combinedScore += r.score * FUZZY_WEIGHT
      } else {
        scored.set(key, {
          content: r.content,
          source: r.source,
          score: 0,
          type: 'chunk',
          documentId: r.documentId,
          combinedScore: r.score * FUZZY_WEIGHT,
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
        combinedScore: r.score * FAQ_WEIGHT,
      })
    }

    // Sort by combined score, normalize, and take top N
    const sorted = [...scored.values()]
      .sort((a, b) => b.combinedScore - a.combinedScore)
      .slice(0, limit)

    // Normalize scores to 0-1
    const maxScore = sorted[0]?.combinedScore ?? 1
    return sorted.map(({ combinedScore, ...rest }) => ({
      ...rest,
      score: maxScore > 0 ? combinedScore / maxScore : 0,
    }))
  }

  private async ensureIndices(): Promise<void> {
    if (this.coreIndex && this.consultableIndex && this.faqIndex) return
    await this.rebuildIndices()
  }

  private fuseSearch(
    query: string,
    category: KnowledgeCategory,
    limit: number,
  ): Promise<Array<{ content: string; source: string; documentId: string; score: number }>> {
    const index = category === 'core' ? this.coreIndex : this.consultableIndex
    if (!index) return Promise.resolve([])

    const results = index.search(query, { limit })
    return Promise.resolve(
      results.map(r => ({
        content: r.item.content,
        source: r.item.source,
        documentId: r.item.documentId,
        score: 1 - (r.score ?? 0),  // fuse.js: 0=perfect match, invert
      })),
    )
  }

  private faqSearch(
    query: string,
    limit: number,
  ): Promise<Array<{ question: string; answer: string; faqId: string; score: number }>> {
    if (!this.faqIndex) return Promise.resolve([])

    const results = this.faqIndex.search(query, { limit })
    return Promise.resolve(
      results.map(r => ({
        question: r.item.text,
        answer: r.item.answer,
        faqId: r.item.faqId,
        score: 1 - (r.score ?? 0),
      })),
    )
  }

  private buildFuseIndex(chunks: Array<{
    content: string; source: string; documentId: string; section: string | null
  }>): Fuse<FuseEntry> {
    return new Fuse(chunks, {
      keys: ['content'],
      threshold: 0.4,
      includeScore: true,
      minMatchCharLength: 3,
      ignoreLocation: true,
    })
  }

  private buildFAQIndex(faqs: KnowledgeFAQ[]): Fuse<FuseFAQEntry> {
    // Index both question and its variants
    const entries: FuseFAQEntry[] = []
    for (const faq of faqs) {
      entries.push({ text: faq.question, faqId: faq.id, answer: faq.answer })
      for (const variant of faq.variants) {
        entries.push({ text: variant, faqId: faq.id, answer: faq.answer })
      }
    }

    return new Fuse(entries, {
      keys: ['text'],
      threshold: 0.35,  // slightly stricter for FAQ matching
      includeScore: true,
      minMatchCharLength: 3,
      ignoreLocation: true,
    })
  }
}
