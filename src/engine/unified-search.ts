// LUNA Engine — Unified Search
// Searches across knowledge chunks (company-wide) + session memory chunks (per-contact).
// Results merged by score, deduplicated by content similarity.

import pino from 'pino'

const logger = pino({ name: 'engine:unified-search' })

// ═══════════════════════════════════════════
// Interfaces
// ═══════════════════════════════════════════

interface KnowledgeSearchService {
  searchConsultable(query: string, limit?: number, hint?: string): Promise<KnowledgeResult[]>
}

export interface MemorySearchService {
  search(contactId: string, query: string, limit?: number): Promise<MemoryResult[]>
}

interface KnowledgeResult {
  content: string
  source: string
  score: number
  type: 'chunk' | 'faq'
  documentId?: string
  faqId?: string
  fileUrl?: string
}

interface MemoryResult {
  chunkId: string
  sessionId: string
  content: string | null
  score: number
  matchType: 'vector' | 'fts'
  sessionTitle: string | null
  sessionDescription: string | null
  sourceType: string
  extraMetadata: Record<string, unknown> | null
  adjacentChunks: Array<{ id: string; content: string | null; chunkIndex: number }>
}

export interface UnifiedSearchResult {
  content: string
  source: 'knowledge' | 'memory'
  sourceDetail: string
  score: number
  type: string
  metadata: Record<string, unknown>
}

// ═══════════════════════════════════════════
// Unified search
// ═══════════════════════════════════════════

export async function unifiedSearch(
  knowledgeSearch: KnowledgeSearchService | null,
  memorySearch: MemorySearchService | null,
  contactId: string,
  query: string,
  options?: { limit?: number; hint?: string },
): Promise<UnifiedSearchResult[]> {
  const limit = options?.limit ?? 8

  // Run both searches in parallel
  const [knowledgeResults, memoryResults] = await Promise.all([
    knowledgeSearch
      ? knowledgeSearch.searchConsultable(query, limit, options?.hint).catch(err => {
          logger.warn({ err }, 'Knowledge search failed in unified search')
          return [] as KnowledgeResult[]
        })
      : Promise.resolve([] as KnowledgeResult[]),
    memorySearch
      ? memorySearch.search(contactId, query, limit).catch(err => {
          logger.warn({ err }, 'Memory search failed in unified search')
          return [] as MemoryResult[]
        })
      : Promise.resolve([] as MemoryResult[]),
  ])

  // Convert to unified format
  const results: UnifiedSearchResult[] = []

  for (const kr of knowledgeResults) {
    results.push({
      content: kr.content,
      source: 'knowledge',
      sourceDetail: kr.source,
      score: kr.score,
      type: kr.type,
      metadata: {
        documentId: kr.documentId ?? null,
        faqId: kr.faqId ?? null,
        fileUrl: kr.fileUrl ?? null,
      },
    })
  }

  for (const mr of memoryResults) {
    if (!mr.content) continue
    results.push({
      content: mr.content,
      source: 'memory',
      sourceDetail: mr.sessionTitle ?? `Session ${mr.sessionId}`,
      score: mr.score,
      type: 'session_memory',
      metadata: {
        sessionId: mr.sessionId,
        sourceType: mr.sourceType,
        sessionDescription: mr.sessionDescription,
        extraMetadata: mr.extraMetadata,
      },
    })
  }

  // Deduplicate by content similarity (>80% word overlap)
  const deduped = deduplicateByContent(results)

  // Sort by score descending
  deduped.sort((a, b) => b.score - a.score)

  return deduped.slice(0, limit)
}

// ═══════════════════════════════════════════
// Content deduplication
// ═══════════════════════════════════════════

function deduplicateByContent(results: UnifiedSearchResult[]): UnifiedSearchResult[] {
  const kept: UnifiedSearchResult[] = []

  for (const result of results) {
    const words = new Set(result.content.toLowerCase().split(/\s+/).filter(w => w.length > 2))
    let isDupe = false

    for (const existing of kept) {
      const existingWords = new Set(existing.content.toLowerCase().split(/\s+/).filter(w => w.length > 2))
      const intersection = [...words].filter(w => existingWords.has(w)).length
      const union = new Set([...words, ...existingWords]).size
      const overlap = union > 0 ? intersection / union : 0

      if (overlap > 0.8) {
        // Keep the one with higher score
        if (result.score > existing.score) {
          const idx = kept.indexOf(existing)
          kept[idx] = result
        }
        isDupe = true
        break
      }
    }

    if (!isDupe) kept.push(result)
  }

  return kept
}
