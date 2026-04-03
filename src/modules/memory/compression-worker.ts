// LUNA — Compression Worker
// BullMQ worker for session compression with checkpoints.
// Steps: archive → summarize → chunk+embed → cleanup → done.
// Retries with exponential backoff. Reflex alert on final failure.

import { Queue, Worker } from 'bullmq'
import type { Job } from 'bullmq'
import type { Redis } from 'ioredis'
import type { Pool } from 'pg'
import pino from 'pino'
import type { Registry } from '../../kernel/registry.js'
import type { StoredMessage, CompressionStatus } from './types.js'
import type { AttachmentExtraction } from './session-chunker.js'
import { archiveSessionLegal, generateSessionSummary } from './session-archiver.js'
import { chunkSession } from './session-chunker.js'
import { embedSessionChunks } from './session-embedder.js'

const logger = pino({ name: 'memory:compression-worker' })

const QUEUE_NAME = 'session-compress'

export interface CompressionJobData {
  sessionId: string
  contactId: string
  channel: string
  triggerType: 'reopen_expired' | 'nightly_batch'
}

interface EmbeddingService {
  generateBatchEmbeddings(texts: string[]): Promise<(number[] | null)[]>
  generateFileEmbedding(data: Buffer, mimeType: string): Promise<number[] | null>
  generateEmbedding(text: string): Promise<number[] | null>
}

const JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 30_000 },
  removeOnComplete: { age: 86400 },
  removeOnFail: { age: 604800 },
}

export class CompressionWorker {
  private readonly queue: Queue<CompressionJobData>
  private readonly worker: Worker<CompressionJobData>
  private readonly db: Pool
  private readonly registry: Registry

  constructor(db: Pool, redis: Redis, registry: Registry) {
    this.db = db
    this.registry = registry

    const bullRedisOpts = {
      host: redis.options.host ?? 'localhost',
      port: redis.options.port ?? 6379,
      password: redis.options.password,
      db: redis.options.db ?? 0,
      maxRetriesPerRequest: null,
    }

    this.queue = new Queue<CompressionJobData>(QUEUE_NAME, {
      connection: bullRedisOpts,
    })

    this.worker = new Worker<CompressionJobData>(
      QUEUE_NAME,
      async (job: Job<CompressionJobData>) => this.processJob(job),
      {
        connection: bullRedisOpts,
        concurrency: 2,
      },
    )

    this.worker.on('failed', (job: Job<CompressionJobData> | undefined, err: Error) => {
      const data = job?.data
      const attemptsMade = job?.attemptsMade ?? 0
      logger.error({ jobId: job?.id, sessionId: data?.sessionId, err, attemptsMade }, 'Compression job failed')

      // If all retries exhausted, fire reflex alert
      if (attemptsMade >= JOB_OPTIONS.attempts && data) {
        this.fireReflexAlert(data, err).catch((alertErr: unknown) => {
          logger.error({ alertErr }, 'Failed to fire reflex alert')
        })
      }
    })

    this.worker.on('completed', (job: Job<CompressionJobData>) => {
      logger.info({ jobId: job.id, sessionId: job.data.sessionId }, 'Compression job completed')
    })
  }

  // ═══════════════════════════════════════════
  // Public API
  // ═══════════════════════════════════════════

  async enqueue(data: CompressionJobData): Promise<void> {
    await this.updateStatus(data.sessionId, 'queued')
    await this.queue.add('compress', data, JOB_OPTIONS)
    logger.info({ sessionId: data.sessionId, triggerType: data.triggerType }, 'Session compression enqueued')
  }

  async stop(): Promise<void> {
    await this.worker.close()
    await this.queue.close()
    logger.info('Compression worker stopped')
  }

  // ═══════════════════════════════════════════
  // Job processing — checkpoint-based steps
  // ═══════════════════════════════════════════

  private async processJob(job: Job<CompressionJobData>): Promise<void> {
    const { sessionId, contactId, channel } = job.data

    // Load current status to resume from checkpoint
    const currentStatus = await this.getStatus(sessionId)
    logger.info({ sessionId, currentStatus, attempt: job.attemptsMade }, 'Processing compression job')

    // Load session data
    const { messages, attachments, startedAt, closedAt } = await this.loadSessionData(sessionId)
    if (messages.length === 0) {
      logger.warn({ sessionId }, 'No messages found for session, marking done')
      await this.updateStatus(sessionId, 'done')
      return
    }

    // Step 1: Archive (idempotent — check if already archived)
    if (!currentStatus || currentStatus === 'queued') {
      await this.updateStatus(sessionId, 'archiving')

      const existingArchive = await this.db.query(
        `SELECT id FROM session_archives WHERE session_id = $1 LIMIT 1`,
        [sessionId],
      )
      if (existingArchive.rows.length === 0) {
        await archiveSessionLegal(
          this.db, sessionId, contactId, channel,
          startedAt, closedAt, messages, attachments,
        )
      } else {
        logger.info({ sessionId }, 'Archive already exists, skipping')
      }
    }

    // Step 2: Summarize
    if (!currentStatus || currentStatus === 'queued' || currentStatus === 'archiving') {
      await this.updateStatus(sessionId, 'summarizing')
      const summary = await generateSessionSummary(
        this.db, this.registry, sessionId, contactId, messages, attachments,
      )
      if (!summary) {
        logger.warn({ sessionId }, 'Summary generation returned null, continuing without summary')
      }
    }

    // Step 3: Chunk + Embed
    if (!currentStatus || ['queued', 'archiving', 'summarizing'].includes(currentStatus)) {
      await this.updateStatus(sessionId, 'embedding')

      // Check if chunks already exist (idempotency for retries)
      const existingChunks = await this.db.query(
        `SELECT COUNT(*)::int AS cnt FROM session_memory_chunks WHERE session_id = $1`,
        [sessionId],
      )
      const alreadyChunked = (existingChunks.rows[0]?.cnt ?? 0) > 0

      if (!alreadyChunked) {
        const interactionTitle = await this.getInteractionTitle(sessionId)
        const chunks = chunkSession(sessionId, contactId, messages, attachments, interactionTitle)

        if (chunks.length > 0) {
          const embeddingService = this.registry.getOptional<EmbeddingService>('knowledge:embedding-service')
          if (embeddingService) {
            const result = await embedSessionChunks(this.db, embeddingService, chunks)
            logger.info({ sessionId, ...result }, 'Session chunks embedded')
          } else {
            // Persist chunks without embeddings — nightly batch will catch them
            await this.persistChunksWithoutEmbeddings(chunks)
            logger.warn({ sessionId, chunks: chunks.length }, 'Embedding service unavailable, chunks persisted without embeddings')
          }
        }
      } else {
        logger.info({ sessionId }, 'Chunks already exist, skipping re-chunking')
      }
    }

    // Step 4: Cleanup
    if (!currentStatus || ['queued', 'archiving', 'summarizing', 'embedding'].includes(currentStatus)) {
      await this.updateStatus(sessionId, 'cleaning')

      // Delete raw messages from PG
      await this.db.query(
        `DELETE FROM messages WHERE session_id = $1`,
        [sessionId],
      )

      // Delete attachment extractions for this session
      await this.db.query(
        `DELETE FROM attachment_extractions WHERE session_id = $1`,
        [sessionId],
      )

      // Delete Redis buffer
      const redisBuffer = this.registry.getOptional<{ deleteSession(id: string): Promise<void> }>('memory:manager')
      if (redisBuffer) {
        await redisBuffer.deleteSession(sessionId)
      }

      logger.info({ sessionId }, 'Session data cleaned up')
    }

    // Step 5: Done
    await this.db.query(
      `UPDATE sessions SET compression_status = 'done', compression_error = NULL, compressed_at = NOW()
       WHERE id = $1`,
      [sessionId],
    )

    logger.info({ sessionId }, 'Session compression complete')
  }

  // ═══════════════════════════════════════════
  // Helpers
  // ═══════════════════════════════════════════

  private async loadSessionData(sessionId: string): Promise<{
    messages: StoredMessage[]
    attachments: AttachmentExtraction[]
    startedAt: Date
    closedAt: Date
  }> {
    const [msgResult, attResult, sessionResult] = await Promise.all([
      this.db.query(
        `SELECT id, session_id, agent_id, role, content_text, content_type, created_at,
                media_path, media_mime, media_analysis, intent, emotion,
                tokens_used, latency_ms, model_used, token_count, metadata
         FROM messages WHERE session_id = $1 ORDER BY created_at ASC`,
        [sessionId],
      ),
      this.db.query(
        `SELECT id, session_id, filename, mime_type, category, category_label,
                extracted_text, llm_text, file_path, metadata
         FROM attachment_extractions WHERE session_id = $1`,
        [sessionId],
      ),
      this.db.query(
        `SELECT started_at, last_activity_at FROM sessions WHERE id = $1`,
        [sessionId],
      ),
    ])

    const sessionRow = sessionResult.rows[0]
    const startedAt = sessionRow?.started_at ? new Date(sessionRow.started_at) : new Date()
    const closedAt = sessionRow?.last_activity_at ? new Date(sessionRow.last_activity_at) : new Date()

    const messages: StoredMessage[] = msgResult.rows.map((r: Record<string, unknown>) => ({
      id: r.id as string,
      sessionId: r.session_id as string,
      channelName: '',
      senderType: (r.role === 'assistant' ? 'agent' : 'user') as 'user' | 'agent',
      senderId: '',
      content: { type: 'text', text: r.content_text as string },
      role: r.role as 'user' | 'assistant' | 'system',
      contentText: (r.content_text as string) || '',
      contentType: (r.content_type as 'text') || 'text',
      mediaPath: r.media_path as string | null,
      mediaMime: r.media_mime as string | null,
      mediaAnalysis: r.media_analysis as string | null,
      intent: r.intent as string | null,
      emotion: r.emotion as string | null,
      tokensUsed: r.tokens_used as number | null,
      latencyMs: r.latency_ms as number | null,
      modelUsed: r.model_used as string | null,
      tokenCount: r.token_count as number | null,
      metadata: r.metadata as Record<string, unknown> | undefined,
      createdAt: new Date(r.created_at as string),
    }))

    const attachments: AttachmentExtraction[] = attResult.rows.map((r: Record<string, unknown>) => ({
      id: r.id as string,
      sessionId: r.session_id as string,
      filename: (r.filename as string) || '',
      mimeType: (r.mime_type as string) || '',
      category: (r.category as string) || '',
      categoryLabel: (r.category_label as string) || '',
      extractedText: r.extracted_text as string | null,
      llmText: r.llm_text as string | null,
      filePath: r.file_path as string | null,
      metadata: r.metadata as Record<string, unknown> | null,
    }))

    return { messages, attachments, startedAt, closedAt }
  }

  private async getStatus(sessionId: string): Promise<CompressionStatus | null> {
    const result = await this.db.query<{ compression_status: CompressionStatus | null }>(
      `SELECT compression_status FROM sessions WHERE id = $1`,
      [sessionId],
    )
    return result.rows[0]?.compression_status ?? null
  }

  private async updateStatus(sessionId: string, status: CompressionStatus, error?: string): Promise<void> {
    await this.db.query(
      `UPDATE sessions SET compression_status = $2, compression_error = $3 WHERE id = $1`,
      [sessionId, status, error ?? null],
    )
  }

  private async getInteractionTitle(sessionId: string): Promise<string> {
    const result = await this.db.query<{ title: string }>(
      `SELECT title FROM session_summaries_v2 WHERE session_id = $1`,
      [sessionId],
    )
    return result.rows[0]?.title ?? `Session ${sessionId}`
  }

  private async persistChunksWithoutEmbeddings(chunks: import('./types.js').SessionMemoryChunk[]): Promise<void> {
    // Import embedder's persist function indirectly by doing raw SQL
    const BATCH = 50
    for (let i = 0; i < chunks.length; i += BATCH) {
      const batch = chunks.slice(i, i + BATCH)
      const values: unknown[] = []
      const placeholders: string[] = []
      let paramIdx = 1

      for (const chunk of batch) {
        const tsvContent = chunk.content?.slice(0, 5000) ?? ''
        placeholders.push(`($${paramIdx}, $${paramIdx + 1}, $${paramIdx + 2}, $${paramIdx + 3}, $${paramIdx + 4}, $${paramIdx + 5}, $${paramIdx + 6}, $${paramIdx + 7}, $${paramIdx + 8}, $${paramIdx + 9}, $${paramIdx + 10}, $${paramIdx + 11}, $${paramIdx + 12}, $${paramIdx + 13}, false, NULL, to_tsvector('spanish', $${paramIdx + 14}))`)

        values.push(
          chunk.id, chunk.sessionId, chunk.contactId, chunk.sourceId,
          chunk.sourceType, chunk.contentType, chunk.chunkIndex, chunk.chunkTotal,
          chunk.prevChunkId, chunk.nextChunkId, chunk.content, chunk.mediaRef,
          chunk.mimeType, chunk.extraMetadata ? JSON.stringify(chunk.extraMetadata) : null,
          tsvContent,
        )
        paramIdx += 15
      }

      await this.db.query(
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

  private async fireReflexAlert(data: CompressionJobData, err: unknown): Promise<void> {
    const status = await this.getStatus(data.sessionId)
    await this.updateStatus(data.sessionId, 'failed', String(err))

    // Alert via cortex reflex if available (not in HookMap — use service directly)
    try {
      const alertManager = this.registry.getOptional<{
        handleAlert(alert: { severity: string; source: string; message: string; metadata: Record<string, unknown> }): Promise<void>
      }>('cortex:alert-manager')

      if (alertManager) {
        await alertManager.handleAlert({
          severity: 'high',
          source: 'session-compression',
          message: `Session compression failed after 3 retries: ${data.sessionId}`,
          metadata: {
            sessionId: data.sessionId,
            contactId: data.contactId,
            step: status,
            error: String(err),
          },
        })
      } else {
        logger.error({
          sessionId: data.sessionId,
          contactId: data.contactId,
          step: status,
          error: String(err),
        }, 'Session compression failed after 3 retries (no alert manager available)')
      }
    } catch {
      // Alert is best-effort
    }
  }
}
