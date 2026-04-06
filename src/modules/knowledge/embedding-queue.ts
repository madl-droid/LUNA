// LUNA — Unified Embedding Queue
// PG is source of truth for embedding state. BullMQ is dispatch only.
// Handles both knowledge_chunks and session_memory_chunks.
// Circuit breaker: 3 distinct failures → pause → HITL → escalating wait.
// Retry: max 10, exponential backoff. HITL URGENTE at retry 5 and 10.

import { Queue, Worker } from 'bullmq'
import type { Job } from 'bullmq'
import type { Redis } from 'ioredis'
import type { Pool } from 'pg'
import pino from 'pino'
import type { EmbeddingService } from './embedding-service.js'

const logger = pino({ name: 'embedding-queue' })

// ═══════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════

const QUEUE_NAME = 'embedding-unified'
const BASE_BACKOFF_MS = 30_000  // 30s → 60s → 2m → 4m → 8m → 16m → 32m → 64m → ~2h → ~4h

// Circuit breaker: 3 distinct chunk failures → pause
const CB_FAILURE_THRESHOLD = 3
const CB_ESCALATING_WAITS_MS = [
  1 * 60_000,   // 1 min
  10 * 60_000,  // 10 min
  30 * 60_000,  // 30 min
  60 * 60_000,  // 60 min (loops here)
]

// Priority (BullMQ: lower number = higher priority)
const PRIORITY_KNOWLEDGE = 1
const PRIORITY_MEMORY = 2
const PRIORITY_REEMBED = 5

// HITL thresholds
const HITL_RETRY_WARNING = 5
const HITL_RETRY_CRITICAL = 10

// ═══════════════════════════════════════════
// Types
// ═══════════════════════════════════════════

export type EmbedSource = 'knowledge' | 'memory'

export interface EmbedJobData {
  chunkId: string
  source: EmbedSource
  /** For knowledge: document_id. For memory: session_id */
  parentId: string
  contentType: string
  isReembed?: boolean
}

interface ChunkToEmbed {
  id: string
  content: string | null
  contentType: string
  mimeType: string | null
  /** For knowledge: media_refs JSON. For memory: media_ref file path */
  mediaRef: string | null
  mediaRefs: Array<{ mimeType: string; data?: string; filePath?: string }> | null
  source: EmbedSource
  parentId: string
}

// ═══════════════════════════════════════════
// Registry interface
// ═══════════════════════════════════════════

interface RegistryLike {
  getOptional<T>(key: string): T | null
}

interface HitlManager {
  createTicket(input: {
    requesterContactId: string
    requesterChannel: string
    requesterSenderId: string
    requestType: 'escalation'
    requestSummary: string
    requestContext: Record<string, unknown>
    urgency: 'critical' | 'high'
    targetRole: string
  }): Promise<{ id: string }>
}

interface AlertManager {
  handleAlert(alert: {
    severity: string
    source: string
    message: string
    metadata: Record<string, unknown>
  }): Promise<void>
}

// ═══════════════════════════════════════════
// Unified Embedding Queue
// ═══════════════════════════════════════════

export class EmbeddingQueue {
  private readonly queue: Queue<EmbedJobData>
  private readonly worker: Worker<EmbedJobData>
  private readonly db: Pool
  private readonly embeddingService: EmbeddingService
  private readonly registry: RegistryLike

  // Circuit breaker state (in-memory, resets on restart)
  private cbDistinctFailures: Set<string> = new Set()
  private cbPausedUntil = 0
  private cbEscalationIndex = 0
  private cbHitlFired = false

  constructor(
    db: Pool,
    redis: Redis,
    embeddingService: EmbeddingService,
    registry: RegistryLike,
  ) {
    this.db = db
    this.embeddingService = embeddingService
    this.registry = registry

    const bullRedisOpts = {
      host: redis.options.host ?? 'localhost',
      port: redis.options.port ?? 6379,
      password: redis.options.password,
      db: redis.options.db ?? 0,
      maxRetriesPerRequest: null,
    }

    this.queue = new Queue<EmbedJobData>(QUEUE_NAME, {
      connection: bullRedisOpts,
    })

    this.worker = new Worker<EmbedJobData>(
      QUEUE_NAME,
      async (job: Job<EmbedJobData>) => this.processJob(job),
      {
        connection: bullRedisOpts,
        concurrency: 1,
      },
    )

    this.worker.on('failed', (job: Job<EmbedJobData> | undefined, err: Error) => {
      logger.error({ jobId: job?.id, data: job?.data, err }, 'Embedding job failed')
    })

    this.worker.on('completed', (job: Job<EmbedJobData>) => {
      logger.debug({ jobId: job.id, chunkId: job.data.chunkId, source: job.data.source }, 'Embedding job completed')
    })
  }

  // ═══════════════════════════════════════════
  // Public API
  // ═══════════════════════════════════════════

  /**
   * Enqueue a single chunk for embedding.
   */
  async enqueue(data: EmbedJobData): Promise<void> {
    const priority = data.isReembed
      ? PRIORITY_REEMBED
      : data.source === 'knowledge' ? PRIORITY_KNOWLEDGE : PRIORITY_MEMORY

    // Mark as queued in PG (source of truth)
    await this.updateChunkStatus(data.chunkId, data.source, 'queued')

    await this.queue.add('embed', data, {
      priority,
      removeOnComplete: 200,
      removeOnFail: 100,
      jobId: `embed-${data.source}-${data.chunkId}`, // Dedup by chunk
    })
  }

  /**
   * Enqueue multiple knowledge chunks for a document.
   */
  async enqueueDocument(documentId: string): Promise<number> {
    const chunks = await this.db.query<{ id: string; content_type: string }>(
      `SELECT id, COALESCE(content_type, 'text') AS content_type
       FROM knowledge_chunks
       WHERE document_id = $1 AND embedding_status IN ('pending', 'failed')
       ORDER BY chunk_index`,
      [documentId],
    )

    for (const row of chunks.rows) {
      await this.enqueue({
        chunkId: row.id,
        source: 'knowledge',
        parentId: documentId,
        contentType: row.content_type,
      })
    }

    logger.info({ documentId, count: chunks.rowCount }, '[EMBED-Q] Document chunks enqueued')
    return chunks.rowCount ?? 0
  }

  /**
   * Enqueue session memory chunks that need embedding.
   */
  async enqueueSessionChunks(sessionId: string): Promise<number> {
    const chunks = await this.db.query<{ id: string; content_type: string }>(
      `SELECT id, content_type
       FROM session_memory_chunks
       WHERE session_id = $1 AND embedding_status IN ('pending', 'failed')
       ORDER BY chunk_index`,
      [sessionId],
    )

    for (const row of chunks.rows) {
      await this.enqueue({
        chunkId: row.id,
        source: 'memory',
        parentId: sessionId,
        contentType: row.content_type,
      })
    }

    logger.info({ sessionId, count: chunks.rowCount }, '[EMBED-Q] Session chunks enqueued')
    return chunks.rowCount ?? 0
  }

  /**
   * Startup recovery: scan PG for chunks stuck in non-terminal states.
   * Re-enqueue them. Call this on init().
   */
  async recoverPending(): Promise<{ knowledge: number; memory: number }> {
    let knowledge = 0
    let memory = 0

    // Knowledge chunks stuck in pending/queued/processing
    const kcResult = await this.db.query<{ id: string; document_id: string; content_type: string }>(
      `SELECT id, document_id, COALESCE(content_type, 'text') AS content_type
       FROM knowledge_chunks
       WHERE embedding_status IN ('pending', 'queued', 'processing')
       ORDER BY document_id, chunk_index
       LIMIT 500`,
    )

    for (const row of kcResult.rows) {
      await this.enqueue({
        chunkId: row.id,
        source: 'knowledge',
        parentId: row.document_id,
        contentType: row.content_type,
      })
      knowledge++
    }

    // Session memory chunks stuck in pending/queued/processing
    const smcResult = await this.db.query<{ id: string; session_id: string; content_type: string }>(
      `SELECT id, session_id, content_type
       FROM session_memory_chunks
       WHERE embedding_status IN ('pending', 'queued', 'processing')
       ORDER BY session_id, chunk_index
       LIMIT 500`,
    )

    for (const row of smcResult.rows) {
      await this.enqueue({
        chunkId: row.id,
        source: 'memory',
        parentId: row.session_id,
        contentType: row.content_type,
      })
      memory++
    }

    if (knowledge > 0 || memory > 0) {
      logger.info({ knowledge, memory }, '[EMBED-Q] Recovered pending chunks on startup')
    }

    return { knowledge, memory }
  }

  /**
   * Get queue status for monitoring.
   */
  async getStatus(): Promise<{
    waiting: number
    active: number
    completed: number
    failed: number
    circuitBreakerOpen: boolean
    cbPausedUntilMs: number
  }> {
    const [waiting, active, completed, failed] = await Promise.all([
      this.queue.getWaitingCount(),
      this.queue.getActiveCount(),
      this.queue.getCompletedCount(),
      this.queue.getFailedCount(),
    ])
    return {
      waiting, active, completed, failed,
      circuitBreakerOpen: Date.now() < this.cbPausedUntil,
      cbPausedUntilMs: Math.max(0, this.cbPausedUntil - Date.now()),
    }
  }

  async stop(): Promise<void> {
    await this.worker.close()
    await this.queue.close()
    logger.info('Embedding queue stopped')
  }

  // ═══════════════════════════════════════════
  // Job processing
  // ═══════════════════════════════════════════

  private async processJob(job: Job<EmbedJobData>): Promise<void> {
    const { chunkId, source, parentId } = job.data

    // Circuit breaker check
    if (Date.now() < this.cbPausedUntil) {
      const remainMs = this.cbPausedUntil - Date.now()
      logger.warn({ chunkId, remainMs }, '[EMBED-Q] Circuit breaker open, re-queuing')
      // Re-enqueue with delay
      await this.enqueue(job.data)
      return
    }

    // Check if embedding service is available
    if (!this.embeddingService.isAvailable()) {
      logger.warn({ chunkId }, '[EMBED-Q] Embedding service unavailable, re-queuing')
      await this.updateChunkStatus(chunkId, source, 'pending')
      // Re-enqueue with small delay
      await new Promise(resolve => setTimeout(resolve, 5000))
      await this.enqueue(job.data)
      return
    }

    // Load chunk data from PG
    const chunk = await this.loadChunk(chunkId, source, parentId)
    if (!chunk) {
      logger.warn({ chunkId, source }, '[EMBED-Q] Chunk not found, skipping')
      return
    }

    // Mark processing in PG
    await this.updateChunkStatus(chunkId, source, 'processing')

    try {
      const embedding = await this.generateEmbedding(chunk)

      if (!embedding) {
        throw new Error(`Embedding returned null for chunk ${chunkId} (${chunk.contentType})`)
      }

      // Success: persist embedding + update status
      await this.persistEmbedding(chunkId, source, embedding)
      this.cbOnSuccess()

      logger.info({ chunkId, source, parentId, dims: embedding.length }, '[EMBED-Q] Chunk embedded')

      // Check if all sibling chunks are now embedded → reconcile parent status
      if (source === 'knowledge') {
        await this.reconcileDocumentStatus(parentId)
      }
    } catch (err) {
      await this.handleFailure(chunkId, source, parentId, err)
    }
  }

  // ═══════════════════════════════════════════
  // Embedding generation
  // ═══════════════════════════════════════════

  private async generateEmbedding(chunk: ChunkToEmbed): Promise<number[] | null> {
    // Determine if multimodal
    const isMultimodal = this.isMultimodalChunk(chunk)

    if (isMultimodal) {
      return this.generateMultimodalEmbedding(chunk)
    }

    // Text embedding
    if (!chunk.content) return null
    return this.embeddingService.generateEmbedding(chunk.content)
  }

  private isMultimodalChunk(chunk: ChunkToEmbed): boolean {
    const MULTIMODAL_TYPES = new Set(['pdf_pages', 'image', 'slide', 'video_frames', 'audio_segment'])
    if (!MULTIMODAL_TYPES.has(chunk.contentType)) return false

    // Knowledge chunks use mediaRefs array, memory chunks use mediaRef path
    if (chunk.source === 'knowledge') {
      return !!chunk.mediaRefs && chunk.mediaRefs.length > 0
    }
    return !!chunk.mediaRef
  }

  private async generateMultimodalEmbedding(chunk: ChunkToEmbed): Promise<number[] | null> {
    try {
      let buffer: Buffer | null = null
      let mimeType = chunk.mimeType ?? 'application/octet-stream'

      if (chunk.source === 'memory' && chunk.mediaRef) {
        // Memory: mediaRef is a file path
        const { readFile } = await import('node:fs/promises')
        buffer = await readFile(chunk.mediaRef)
      } else if (chunk.source === 'knowledge' && chunk.mediaRefs?.[0]) {
        const firstMedia = chunk.mediaRefs[0]
        mimeType = firstMedia.mimeType

        if (firstMedia.filePath) {
          const { resolve, join } = await import('node:path')
          const { readFile } = await import('node:fs/promises')
          const knowledgeDir = resolve(process.cwd(), 'instance/knowledge/media')
          buffer = await readFile(join(knowledgeDir, firstMedia.filePath))
        } else if (firstMedia.data) {
          buffer = Buffer.from(firstMedia.data, 'base64')
        }
      }

      if (buffer) {
        const embedding = await this.embeddingService.generateFileEmbedding(buffer, mimeType)
        if (embedding) return embedding
      }

      // No multimodal fallback — text-only NOT allowed per design
      // If multimodal failed and content is available, retry as text is NOT done here.
      // The retry mechanism will retry the multimodal embedding.
      logger.warn({ chunkId: chunk.id, contentType: chunk.contentType }, '[EMBED-Q] Multimodal embedding failed, will retry')
      return null
    } catch (err) {
      logger.warn({ err, chunkId: chunk.id }, '[EMBED-Q] Multimodal embedding error')
      return null
    }
  }

  // ═══════════════════════════════════════════
  // Chunk loading from PG
  // ═══════════════════════════════════════════

  private async loadChunk(chunkId: string, source: EmbedSource, _parentId: string): Promise<ChunkToEmbed | null> {
    if (source === 'knowledge') {
      const res = await this.db.query<{
        id: string; content: string | null; content_type: string; mime_type: string | null
        media_refs: unknown; document_id: string
      }>(
        `SELECT id, content, COALESCE(content_type, 'text') AS content_type, mime_type, media_refs, document_id
         FROM knowledge_chunks WHERE id = $1`,
        [chunkId],
      )
      const row = res.rows[0]
      if (!row) return null
      return {
        id: row.id,
        content: row.content,
        contentType: row.content_type,
        mimeType: row.mime_type,
        mediaRef: null,
        mediaRefs: (row.media_refs as ChunkToEmbed['mediaRefs']) ?? null,
        source: 'knowledge',
        parentId: row.document_id,
      }
    }

    // Memory
    const res = await this.db.query<{
      id: string; content: string | null; content_type: string; mime_type: string | null
      media_ref: string | null; session_id: string
    }>(
      `SELECT id, content, content_type, mime_type, media_ref, session_id
       FROM session_memory_chunks WHERE id = $1`,
      [chunkId],
    )
    const row = res.rows[0]
    if (!row) return null
    return {
      id: row.id,
      content: row.content,
      contentType: row.content_type,
      mimeType: row.mime_type,
      mediaRef: row.media_ref,
      mediaRefs: null,
      source: 'memory',
      parentId: row.session_id,
    }
  }

  // ═══════════════════════════════════════════
  // Persistence
  // ═══════════════════════════════════════════

  private async persistEmbedding(chunkId: string, source: EmbedSource, embedding: number[]): Promise<void> {
    const embStr = `[${embedding.join(',')}]`
    const table = source === 'knowledge' ? 'knowledge_chunks' : 'session_memory_chunks'

    await this.db.query(
      `UPDATE ${table} SET
        embedding = $1::vector,
        has_embedding = true,
        embedding_status = 'embedded',
        retry_count = 0,
        last_error = NULL,
        last_attempt_at = NOW()
       WHERE id = $2`,
      [embStr, chunkId],
    )
  }

  private async updateChunkStatus(
    chunkId: string,
    source: EmbedSource,
    status: string,
    error?: string,
  ): Promise<void> {
    const table = source === 'knowledge' ? 'knowledge_chunks' : 'session_memory_chunks'

    if (error) {
      await this.db.query(
        `UPDATE ${table} SET embedding_status = $1, last_error = $2, last_attempt_at = NOW() WHERE id = $3`,
        [status, error, chunkId],
      )
    } else {
      await this.db.query(
        `UPDATE ${table} SET embedding_status = $1 WHERE id = $2`,
        [status, chunkId],
      )
    }
  }

  private async incrementRetry(chunkId: string, source: EmbedSource, error: string): Promise<number> {
    const table = source === 'knowledge' ? 'knowledge_chunks' : 'session_memory_chunks'

    const res = await this.db.query<{ retry_count: number }>(
      `UPDATE ${table} SET
        embedding_status = 'failed',
        retry_count = retry_count + 1,
        last_error = $1,
        last_attempt_at = NOW()
       WHERE id = $2
       RETURNING retry_count`,
      [error.slice(0, 500), chunkId],
    )

    return res.rows[0]?.retry_count ?? 1
  }

  // ═══════════════════════════════════════════
  // Document status reconciliation
  // ═══════════════════════════════════════════

  /**
   * After embedding a knowledge chunk, check if ALL chunks for the parent document
   * are now embedded. If so, mark the document (and its parent knowledge_item) as done.
   */
  private async reconcileDocumentStatus(documentId: string): Promise<void> {
    try {
      const res = await this.db.query<{ total: number; embedded: number; failed: number }>(
        `SELECT
           COUNT(*)::int AS total,
           COUNT(*) FILTER (WHERE embedding_status = 'embedded')::int AS embedded,
           COUNT(*) FILTER (WHERE embedding_status = 'failed' AND retry_count >= 10)::int AS failed
         FROM knowledge_chunks
         WHERE document_id = $1`,
        [documentId],
      )

      const row = res.rows[0]
      if (!row || row.total === 0) return

      if (row.embedded + row.failed >= row.total) {
        // All chunks have a terminal state
        const docStatus = row.failed > 0 ? 'failed' : 'done'
        await this.db.query(
          `UPDATE knowledge_documents SET embedding_status = $1, updated_at = NOW() WHERE id = $2`,
          [docStatus, documentId],
        )

        // Propagate to parent knowledge_item
        const docResult = await this.db.query<{ source_ref: string | null }>(
          `SELECT source_ref FROM knowledge_documents WHERE id = $1`,
          [documentId],
        )
        const sourceRef = docResult.rows[0]?.source_ref
        if (sourceRef) {
          await this.db.query(
            `UPDATE knowledge_items SET embedding_status = $1, updated_at = NOW() WHERE id = $2`,
            [docStatus, sourceRef],
          )
        }

        logger.info({ documentId, sourceRef, status: docStatus, total: row.total, embedded: row.embedded, failed: row.failed },
          '[EMBED-Q] Document status reconciled')
      }
    } catch (err) {
      logger.warn({ err, documentId }, '[EMBED-Q] Document reconciliation failed (non-fatal)')
    }
  }

  // ═══════════════════════════════════════════
  // Failure handling + Circuit breaker + HITL
  // ═══════════════════════════════════════════

  private async handleFailure(
    chunkId: string,
    source: EmbedSource,
    parentId: string,
    err: unknown,
  ): Promise<void> {
    const errorMsg = err instanceof Error ? err.message : String(err)
    const retryCount = await this.incrementRetry(chunkId, source, errorMsg)

    logger.warn({ chunkId, source, parentId, retryCount, error: errorMsg }, '[EMBED-Q] Chunk embedding failed')

    // Circuit breaker: track distinct chunk failures
    this.cbDistinctFailures.add(chunkId)
    if (this.cbDistinctFailures.size >= CB_FAILURE_THRESHOLD) {
      await this.triggerCircuitBreaker()
    }

    // HITL escalation at retry thresholds
    if (retryCount === HITL_RETRY_WARNING) {
      await this.fireHitl(chunkId, source, parentId, retryCount, 'high', errorMsg)
    } else if (retryCount >= HITL_RETRY_CRITICAL) {
      await this.fireHitl(chunkId, source, parentId, retryCount, 'critical', errorMsg)
      // Don't re-enqueue after max retries
      logger.error({ chunkId, source, retryCount }, '[EMBED-Q] Max retries reached, chunk abandoned')
      return
    }

    // Re-enqueue with exponential backoff
    const delayMs = Math.min(BASE_BACKOFF_MS * Math.pow(2, retryCount - 1), 4 * 60 * 60_000) // cap at 4h
    logger.info({ chunkId, retryCount, delayMs }, '[EMBED-Q] Re-enqueueing with backoff')

    await this.queue.add('embed', {
      chunkId,
      source,
      parentId,
      contentType: '', // will be re-loaded from PG
      isReembed: true,
    }, {
      priority: PRIORITY_REEMBED, // retries get lower priority
      delay: delayMs,
      removeOnComplete: 200,
      removeOnFail: 100,
      jobId: `embed-retry-${source}-${chunkId}-${retryCount}`,
    })
  }

  private async triggerCircuitBreaker(): Promise<void> {
    const waitMs = CB_ESCALATING_WAITS_MS[
      Math.min(this.cbEscalationIndex, CB_ESCALATING_WAITS_MS.length - 1)
    ]!

    this.cbPausedUntil = Date.now() + waitMs
    this.cbEscalationIndex++

    logger.error({
      distinctFailures: this.cbDistinctFailures.size,
      pauseMs: waitMs,
      escalationLevel: this.cbEscalationIndex,
    }, '[EMBED-Q] Circuit breaker OPEN — embedding paused')

    // Clear distinct failures for next window
    this.cbDistinctFailures.clear()

    // Fire HITL on first circuit breaker trip
    if (!this.cbHitlFired) {
      this.cbHitlFired = true
      await this.fireCircuitBreakerHitl(waitMs)
    }

    // Fire cortex alert
    const alertManager = this.registry.getOptional<AlertManager>('cortex:alert-manager')
    if (alertManager) {
      await alertManager.handleAlert({
        severity: 'critical',
        source: 'embedding-queue',
        message: `Embedding circuit breaker opened (level ${this.cbEscalationIndex}). Paused for ${Math.round(waitMs / 60_000)}min.`,
        metadata: { escalationLevel: this.cbEscalationIndex, pauseMs: waitMs },
      }).catch(() => {})
    }
  }

  private cbOnSuccess(): void {
    // Reset circuit breaker on success
    if (this.cbDistinctFailures.size > 0) {
      this.cbDistinctFailures.clear()
    }
    if (this.cbEscalationIndex > 0 && Date.now() >= this.cbPausedUntil) {
      // After pause expires and we get a success, reset escalation
      this.cbEscalationIndex = 0
      this.cbHitlFired = false
      logger.info('[EMBED-Q] Circuit breaker reset after successful embedding')
    }
  }

  // ═══════════════════════════════════════════
  // HITL integration
  // ═══════════════════════════════════════════

  private async fireHitl(
    chunkId: string,
    source: EmbedSource,
    parentId: string,
    retryCount: number,
    urgency: 'high' | 'critical',
    error: string,
  ): Promise<void> {
    const hitl = this.registry.getOptional<HitlManager>('hitl:manager')
    if (!hitl) {
      logger.warn({ chunkId, retryCount }, '[EMBED-Q] HITL not available for embedding failure escalation')
      return
    }

    try {
      const summary = retryCount >= HITL_RETRY_CRITICAL
        ? `[URGENTE] Embedding falló ${retryCount} veces consecutivas. Chunk ${chunkId} (${source}) no se puede embeber. Requiere intervención manual.`
        : `Embedding falló ${retryCount} veces para chunk ${chunkId} (${source}). Error: ${error.slice(0, 200)}`

      await hitl.createTicket({
        requesterContactId: 'system',
        requesterChannel: 'system',
        requesterSenderId: 'embedding-queue',
        requestType: 'escalation',
        requestSummary: summary,
        requestContext: {
          chunkId,
          source,
          parentId,
          retryCount,
          error: error.slice(0, 500),
          type: 'embedding_failure',
        },
        urgency,
        targetRole: 'admin',
      })

      logger.info({ chunkId, retryCount, urgency }, '[EMBED-Q] HITL ticket created for embedding failure')
    } catch (err) {
      logger.error({ err, chunkId }, '[EMBED-Q] Failed to create HITL ticket')
    }
  }

  private async fireCircuitBreakerHitl(pauseMs: number): Promise<void> {
    const hitl = this.registry.getOptional<HitlManager>('hitl:manager')
    if (!hitl) return

    try {
      await hitl.createTicket({
        requesterContactId: 'system',
        requesterChannel: 'system',
        requesterSenderId: 'embedding-queue',
        requestType: 'escalation',
        requestSummary: `[URGENTE] Circuit breaker de embeddings activado. 3+ chunks distintos fallaron. Sistema pausado por ${Math.round(pauseMs / 60_000)} minutos.`,
        requestContext: {
          type: 'embedding_circuit_breaker',
          pauseMs,
          escalationLevel: this.cbEscalationIndex,
        },
        urgency: 'critical',
        targetRole: 'admin',
      })
    } catch (err) {
      logger.error({ err }, '[EMBED-Q] Failed to create circuit breaker HITL ticket')
    }
  }
}
