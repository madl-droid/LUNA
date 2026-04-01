// LUNA — Memory Search (long-term)
// Searches session_memory_chunks via vector cosine + FTS for historical context.
// Enriches results with session_summaries_v2 titles/descriptions.

import type { Pool } from 'pg'
import pino from 'pino'

const logger = pino({ name: 'memory:search' })

export interface MemorySearchResult {
  chunkId: string
  sessionId: string
  sourceType: string
  contentType: string
  content: string | null
  mediaRef: string | null
  score: number
  matchType: 'vector' | 'fts'
  sessionTitle: string | null
  sessionDescription: string | null
  extraMetadata: Record<string, unknown> | null
  adjacentChunks: AdjacentChunk[]
}

interface AdjacentChunk {
  id: string
  content: string | null
  chunkIndex: number
}

interface EmbeddingService {
  generateEmbedding(text: string): Promise<number[] | null>
}

// ═══════════════════════════════════════════
// Search session memory chunks
// ═══════════════════════════════════════════

export async function searchSessionMemory(
  db: Pool,
  embeddingService: EmbeddingService | null,
  contactId: string,
  query: string,
  limit: number = 5,
): Promise<MemorySearchResult[]> {
  // Run FTS and vector search in parallel
  const [ftsResults, vectorResults] = await Promise.all([
    searchFTS(db, contactId, query, limit),
    embeddingService ? searchVector(db, embeddingService, contactId, query, limit) : Promise.resolve([]),
  ])

  // Deduplicate by chunkId, keeping highest score
  const seen = new Map<string, MemorySearchResult>()

  // Vector results first (tend to be more precise)
  for (const r of vectorResults) {
    seen.set(r.chunkId, r)
  }

  // FTS results with boost
  for (const r of ftsResults) {
    const existing = seen.get(r.chunkId)
    if (!existing || r.score > existing.score) {
      seen.set(r.chunkId, r)
    }
  }

  const merged = Array.from(seen.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)

  // Enrich with adjacent chunks and session summaries
  if (merged.length > 0) {
    await enrichWithAdjacent(db, merged)
    await enrichWithSummaries(db, merged)
  }

  logger.debug({ contactId, query: query.slice(0, 50), results: merged.length }, 'Memory search completed')
  return merged
}

// ═══════════════════════════════════════════
// FTS search
// ═══════════════════════════════════════════

async function searchFTS(
  db: Pool,
  contactId: string,
  query: string,
  limit: number,
): Promise<MemorySearchResult[]> {
  try {
    interface FTSRow {
      id: string; session_id: string; source_type: string; content_type: string
      content: string | null; media_ref: string | null; extra_metadata: Record<string, unknown> | null
      rank: number
    }

    const result = await db.query(
      `SELECT id, session_id, source_type, content_type, content, media_ref, extra_metadata,
              ts_rank(tsv, plainto_tsquery('spanish', $2)) AS rank
       FROM session_memory_chunks
       WHERE contact_id = $1
         AND tsv @@ plainto_tsquery('spanish', $2)
       ORDER BY rank DESC
       LIMIT $3`,
      [contactId, query, limit],
    )

    return result.rows.map((r: FTSRow) => ({
      chunkId: r.id,
      sessionId: r.session_id,
      sourceType: r.source_type,
      contentType: r.content_type,
      content: r.content,
      mediaRef: r.media_ref,
      score: r.rank,
      matchType: 'fts' as const,
      sessionTitle: null,
      sessionDescription: null,
      extraMetadata: r.extra_metadata,
      adjacentChunks: [],
    }))
  } catch (err) {
    logger.warn({ err, contactId }, 'FTS search failed')
    return []
  }
}

// ═══════════════════════════════════════════
// Vector search
// ═══════════════════════════════════════════

async function searchVector(
  db: Pool,
  embeddingService: EmbeddingService,
  contactId: string,
  query: string,
  limit: number,
): Promise<MemorySearchResult[]> {
  const embedding = await embeddingService.generateEmbedding(query)
  if (!embedding) return []

  try {
    const vectorStr = `[${embedding.join(',')}]`

    interface VectorRow {
      id: string; session_id: string; source_type: string; content_type: string
      content: string | null; media_ref: string | null; extra_metadata: Record<string, unknown> | null
      similarity: number
    }

    const result = await db.query(
      `SELECT id, session_id, source_type, content_type, content, media_ref, extra_metadata,
              1 - (embedding <=> $2::vector) AS similarity
       FROM session_memory_chunks
       WHERE contact_id = $1
         AND has_embedding = true
       ORDER BY embedding <=> $2::vector
       LIMIT $3`,
      [contactId, vectorStr, limit],
    )

    return result.rows.map((r: VectorRow) => ({
      chunkId: r.id,
      sessionId: r.session_id,
      sourceType: r.source_type,
      contentType: r.content_type,
      content: r.content,
      mediaRef: r.media_ref,
      score: r.similarity,
      matchType: 'vector' as const,
      sessionTitle: null,
      sessionDescription: null,
      extraMetadata: r.extra_metadata,
      adjacentChunks: [],
    }))
  } catch (err) {
    logger.warn({ err, contactId }, 'Vector search failed')
    return []
  }
}

// ═══════════════════════════════════════════
// Enrich with adjacent chunks
// ═══════════════════════════════════════════

async function enrichWithAdjacent(db: Pool, results: MemorySearchResult[]): Promise<void> {
  if (results.length === 0) return

  try {
    // For each result, load prev and next chunks
    for (const result of results) {
      const adjResult = await db.query(
        `SELECT id, content, chunk_index
         FROM session_memory_chunks
         WHERE id IN (
           SELECT prev_chunk_id FROM session_memory_chunks WHERE id = $1 AND prev_chunk_id IS NOT NULL
           UNION
           SELECT next_chunk_id FROM session_memory_chunks WHERE id = $1 AND next_chunk_id IS NOT NULL
         )
         ORDER BY chunk_index`,
        [result.chunkId],
      )

      result.adjacentChunks = adjResult.rows.map((r: { id: string; content: string | null; chunk_index: number }) => ({
        id: r.id,
        content: r.content,
        chunkIndex: r.chunk_index,
      }))
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to load adjacent chunks')
  }
}

// ═══════════════════════════════════════════
// Enrich with session summaries
// ═══════════════════════════════════════════

async function enrichWithSummaries(db: Pool, results: MemorySearchResult[]): Promise<void> {
  const sessionIds = [...new Set(results.map(r => r.sessionId))]
  if (sessionIds.length === 0) return

  try {
    interface SummaryRow { session_id: string; title: string; description: string }

    const result = await db.query(
      `SELECT session_id, title, description
       FROM session_summaries_v2
       WHERE session_id = ANY($1)`,
      [sessionIds],
    )

    const summaryMap = new Map<string, SummaryRow>(result.rows.map((r: SummaryRow) => [r.session_id, r]))

    for (const r of results) {
      const summary = summaryMap.get(r.sessionId)
      if (summary) {
        r.sessionTitle = summary.title
        r.sessionDescription = summary.description
      }
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to load session summaries for enrichment')
  }
}
