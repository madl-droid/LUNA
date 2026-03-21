// LUNA — Module: knowledge — VectorizeWorker
// BullMQ worker for generating embeddings on knowledge chunks.

import { Queue, Worker } from 'bullmq'
import type { Redis } from 'ioredis'
import type pino from 'pino'
import type { VectorizeJobData, EmbeddingStatus } from './types.js'
import type { KnowledgePgStore } from './pg-store.js'
import type { EmbeddingService } from './embedding-service.js'

const QUEUE_NAME = 'knowledge:vectorize'
const BULK_LOCK_KEY = 'knowledge:vectorize:bulk_lock'
const BULK_COOLDOWN_KEY = 'knowledge:vectorize:bulk_cooldown'
const BULK_LOCK_TTL_S = 30 * 60       // 30 minutes
const BULK_COOLDOWN_TTL_S = 3600      // 1 hour
const BATCH_SIZE = 50

export class VectorizeWorker {
  private readonly queue: Queue<VectorizeJobData>
  private readonly worker: Worker<VectorizeJobData>
  private readonly redis: Redis
  private readonly pgStore: KnowledgePgStore
  private readonly embeddingService: EmbeddingService
  private readonly log: pino.Logger

  constructor(
    redis: Redis,
    pgStore: KnowledgePgStore,
    embeddingService: EmbeddingService,
    logger: pino.Logger,
  ) {
    this.redis = redis
    this.pgStore = pgStore
    this.embeddingService = embeddingService
    this.log = logger.child({ component: 'vectorize-worker' })

    this.queue = new Queue<VectorizeJobData>(QUEUE_NAME, {
      connection: redis as never,
    })

    this.worker = new Worker<VectorizeJobData>(
      QUEUE_NAME,
      async (job) => this.processJob(job.data),
      {
        connection: redis as never,
        concurrency: 1,
      },
    )

    this.worker.on('failed', (job, err) => {
      this.log.error({ jobId: job?.id, jobData: job?.data, err }, 'vectorize job failed')
    })

    this.worker.on('completed', (job) => {
      this.log.info({ jobId: job.id, jobData: job.data }, 'vectorize job completed')
    })
  }

  // ─── Job processing ───────────────────────────────────

  private async processJob(data: VectorizeJobData): Promise<void> {
    if (data.type === 'document') {
      await this.processDocument(data.documentId!)
    } else if (data.type === 'bulk') {
      await this.processBulk()
    }
  }

  private async processDocument(documentId: string): Promise<void> {
    this.log.info({ documentId }, 'processing document embeddings')

    await this.pgStore.updateDocumentEmbeddingStatus(documentId, 'processing')

    try {
      const chunks = await this.pgStore.getChunksWithoutEmbedding(documentId)
      if (chunks.length === 0) {
        this.log.info({ documentId }, 'no chunks without embedding, marking done')
        await this.pgStore.updateDocumentEmbeddingStatus(documentId, 'done')
        return
      }

      await this.embedChunks(chunks)
      await this.pgStore.updateDocumentEmbeddingStatus(documentId, 'done')
      this.log.info({ documentId, chunksProcessed: chunks.length }, 'document embeddings complete')
    } catch (err) {
      this.log.error({ documentId, err }, 'failed to process document embeddings')
      await this.pgStore.updateDocumentEmbeddingStatus(documentId, 'failed')
      throw err
    }
  }

  private async processBulk(): Promise<void> {
    // Acquire mutex to prevent parallel bulk runs
    const acquired = await this.redis.set(BULK_LOCK_KEY, '1', 'EX', BULK_LOCK_TTL_S, 'NX')
    if (!acquired) {
      this.log.warn('bulk vectorize already running, skipping')
      return
    }

    try {
      const allChunks = await this.pgStore.getChunksWithoutEmbedding()
      if (allChunks.length === 0) {
        this.log.info('bulk vectorize: no chunks without embedding')
        return
      }

      this.log.info({ totalChunks: allChunks.length }, 'bulk vectorize started')

      // Track affected documents for status updates
      const documentIds = new Set(allChunks.map((c) => c.documentId))
      for (const docId of documentIds) {
        await this.pgStore.updateDocumentEmbeddingStatus(docId, 'processing')
      }

      // Process in batches
      const failedDocIds = new Set<string>()

      for (let i = 0; i < allChunks.length; i += BATCH_SIZE) {
        const batch = allChunks.slice(i, i + BATCH_SIZE)
        try {
          await this.embedChunks(batch)
        } catch (err) {
          this.log.error({ batchOffset: i, err }, 'batch embedding failed')
          for (const chunk of batch) {
            failedDocIds.add(chunk.documentId)
          }
        }
      }

      // Update document statuses
      for (const docId of documentIds) {
        const status: EmbeddingStatus = failedDocIds.has(docId) ? 'failed' : 'done'
        await this.pgStore.updateDocumentEmbeddingStatus(docId, status)
      }

      this.log.info(
        { totalChunks: allChunks.length, failedDocs: failedDocIds.size },
        'bulk vectorize finished',
      )
    } finally {
      await this.redis.del(BULK_LOCK_KEY)
    }
  }

  // ─── Embedding helper ─────────────────────────────────

  private async embedChunks(
    chunks: Array<{ id: string; content: string; documentId: string }>,
  ): Promise<void> {
    const texts = chunks.map((c) => c.content)
    const embeddings = await this.embeddingService.generateBatchEmbeddings(texts)

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]!
      const embedding = embeddings[i] ?? null
      if (embedding) {
        await this.pgStore.updateChunkEmbedding(chunk.id, embedding)
      } else {
        this.log.warn({ chunkId: chunk.id }, 'embedding returned null, skipping chunk')
      }
    }
  }

  // ─── Public API ────────────────────────────────────────

  async enqueueDocument(documentId: string): Promise<void> {
    await this.queue.add('vectorize-document', { type: 'document', documentId }, {
      removeOnComplete: 100,
      removeOnFail: 50,
    })
    this.log.info({ documentId }, 'enqueued document for vectorization')
  }

  async enqueueBulk(): Promise<{ enqueued: boolean; reason?: string }> {
    // Check cooldown
    const cooldown = await this.redis.get(BULK_COOLDOWN_KEY)
    if (cooldown) {
      return { enqueued: false, reason: 'bulk vectorize on cooldown (1hr between runs)' }
    }

    // Check if embedding service is available
    if (!this.embeddingService.isAvailable()) {
      return { enqueued: false, reason: 'embedding service not available' }
    }

    // Set cooldown
    await this.redis.set(BULK_COOLDOWN_KEY, '1', 'EX', BULK_COOLDOWN_TTL_S)

    await this.queue.add('vectorize-bulk', { type: 'bulk' }, {
      removeOnComplete: 20,
      removeOnFail: 10,
    })

    this.log.info('enqueued bulk vectorization')
    return { enqueued: true }
  }

  async getStatus(): Promise<{
    waiting: number
    active: number
    completed: number
    failed: number
  }> {
    const [waiting, active, completed, failed] = await Promise.all([
      this.queue.getWaitingCount(),
      this.queue.getActiveCount(),
      this.queue.getCompletedCount(),
      this.queue.getFailedCount(),
    ])
    return { waiting, active, completed, failed }
  }

  async stop(): Promise<void> {
    this.log.info('stopping vectorize worker')
    await this.worker.close()
    await this.queue.close()
  }
}
