// LUNA — Session Embedder
// Generates embeddings for SessionMemoryChunk[] using knowledge embedding service.
// Text chunks → batch embedding. Multimodal chunks → individual file embedding.
// Fallback: if multimodal fails → embed as text content.

import { readFile } from 'node:fs/promises'
import type { Pool } from 'pg'
import pino from 'pino'
import type { SessionMemoryChunk } from './types.js'

const logger = pino({ name: 'memory:session-embedder' })

const TEXT_BATCH_SIZE = 100

interface EmbeddingService {
  generateBatchEmbeddings(texts: string[]): Promise<(number[] | null)[]>
  generateFileEmbedding(data: Buffer, mimeType: string): Promise<number[] | null>
  generateEmbedding(text: string): Promise<number[] | null>
}

const MULTIMODAL_CONTENT_TYPES = new Set([
  'pdf_pages', 'image', 'slide', 'video_frames',
])

// ═══════════════════════════════════════════
// Embed all session chunks
// ═══════════════════════════════════════════

export async function embedSessionChunks(
  db: Pool,
  embeddingService: EmbeddingService,
  chunks: SessionMemoryChunk[],
): Promise<{ embedded: number; failed: number }> {
  if (chunks.length === 0) return { embedded: 0, failed: 0 }

  // Separate text vs multimodal chunks
  const textChunks: SessionMemoryChunk[] = []
  const multimodalChunks: SessionMemoryChunk[] = []

  for (const chunk of chunks) {
    if (MULTIMODAL_CONTENT_TYPES.has(chunk.contentType) && chunk.mediaRef) {
      multimodalChunks.push(chunk)
    } else if (chunk.content) {
      textChunks.push(chunk)
    }
  }

  let embedded = 0
  let failed = 0

  // 1. Text chunks — batch embedding
  for (let i = 0; i < textChunks.length; i += TEXT_BATCH_SIZE) {
    const batch = textChunks.slice(i, i + TEXT_BATCH_SIZE)
    const texts = batch.map(c => c.content!)

    try {
      const embeddings = await embeddingService.generateBatchEmbeddings(texts)

      for (let j = 0; j < batch.length; j++) {
        const emb = embeddings[j]
        const chunk = batch[j]!
        if (emb) {
          chunk.embedding = emb
          chunk.hasEmbedding = true
          embedded++
        } else {
          failed++
        }
      }
    } catch (err) {
      logger.error({ err, batchSize: batch.length }, 'Batch text embedding failed')
      failed += batch.length
    }
  }

  // 2. Multimodal chunks — individual embedding
  for (const chunk of multimodalChunks) {
    try {
      const buffer = await readFile(chunk.mediaRef!)
      const emb = await embeddingService.generateFileEmbedding(buffer, chunk.mimeType ?? 'application/octet-stream')

      if (emb) {
        chunk.embedding = emb
        chunk.hasEmbedding = true
        embedded++
      } else if (chunk.content) {
        // Fallback: embed as text
        const textEmb = await embeddingService.generateEmbedding(chunk.content)
        if (textEmb) {
          chunk.embedding = textEmb
          chunk.hasEmbedding = true
          embedded++
        } else {
          failed++
        }
      } else {
        failed++
      }
    } catch (err) {
      logger.warn({ err, chunkId: chunk.id, mediaRef: chunk.mediaRef }, 'Multimodal embedding failed, trying text fallback')

      // Fallback: embed text content if available
      if (chunk.content) {
        try {
          const textEmb = await embeddingService.generateEmbedding(chunk.content)
          if (textEmb) {
            chunk.embedding = textEmb
            chunk.hasEmbedding = true
            embedded++
          } else {
            failed++
          }
        } catch {
          failed++
        }
      } else {
        failed++
      }
    }
  }

  // 3. Persist all chunks to DB
  await persistChunks(db, chunks)

  logger.info({
    total: chunks.length,
    textChunks: textChunks.length,
    multimodalChunks: multimodalChunks.length,
    embedded,
    failed,
  }, 'Session chunks embedded and persisted')

  return { embedded, failed }
}

// ═══════════════════════════════════════════
// Persist chunks to session_memory_chunks table
// ═══════════════════════════════════════════

async function persistChunks(db: Pool, chunks: SessionMemoryChunk[]): Promise<void> {
  if (chunks.length === 0) return

  // Batch insert using unnest for performance
  const BATCH = 50
  for (let i = 0; i < chunks.length; i += BATCH) {
    const batch = chunks.slice(i, i + BATCH)

    const values: unknown[] = []
    const placeholders: string[] = []
    let paramIdx = 1

    for (const chunk of batch) {
      const tsvContent = chunk.content?.slice(0, 5000) ?? ''
      placeholders.push(`($${paramIdx}, $${paramIdx + 1}, $${paramIdx + 2}, $${paramIdx + 3}, $${paramIdx + 4}, $${paramIdx + 5}, $${paramIdx + 6}, $${paramIdx + 7}, $${paramIdx + 8}, $${paramIdx + 9}, $${paramIdx + 10}, $${paramIdx + 11}, $${paramIdx + 12}, $${paramIdx + 13}, $${paramIdx + 14}, $${paramIdx + 15}::vector, to_tsvector('spanish', $${paramIdx + 16}))`)

      values.push(
        chunk.id,
        chunk.sessionId,
        chunk.contactId,
        chunk.sourceId,
        chunk.sourceType,
        chunk.contentType,
        chunk.chunkIndex,
        chunk.chunkTotal,
        chunk.prevChunkId,
        chunk.nextChunkId,
        chunk.content,
        chunk.mediaRef,
        chunk.mimeType,
        chunk.extraMetadata ? JSON.stringify(chunk.extraMetadata) : null,
        chunk.hasEmbedding,
        chunk.embedding ? `[${chunk.embedding.join(',')}]` : null,
        tsvContent,
      )
      paramIdx += 17
    }

    await db.query(
      `INSERT INTO session_memory_chunks
        (id, session_id, contact_id, source_id, source_type, content_type,
         chunk_index, chunk_total, prev_chunk_id, next_chunk_id,
         content, media_ref, mime_type, extra_metadata, has_embedding, embedding, tsv)
       VALUES ${placeholders.join(', ')}
       ON CONFLICT (id) DO NOTHING`,
      values,
    )
  }
}
