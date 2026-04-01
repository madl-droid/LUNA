// LUNA — Module: knowledge — VectorizeWorker
// BullMQ worker for generating embeddings on knowledge chunks.

import { Queue, Worker } from 'bullmq'
import type { Redis } from 'ioredis'
import type pino from 'pino'
import type { VectorizeJobData, EmbeddingStatus } from './types.js'
import type { KnowledgePgStore } from './pg-store.js'
import type { EmbeddingService } from './embedding-service.js'
import { generateDescription } from './description-generator.js'

const QUEUE_NAME = 'knowledge-vectorize'
const BULK_LOCK_KEY = 'knowledge:vectorize:bulk_lock'
const BULK_COOLDOWN_KEY = 'knowledge:vectorize:bulk_cooldown'
const BULK_LOCK_TTL_S = 30 * 60       // 30 minutes
const BULK_COOLDOWN_TTL_S = 3600      // 1 hour
const BATCH_SIZE = 50

interface RegistryLike {
  callHook(hook: 'llm:chat', payload: {
    task: string; system: string
    messages: Array<{ role: 'user'; content: string }>
    maxTokens: number; temperature: number
  }): Promise<{ text?: string } | null>
}

export class VectorizeWorker {
  private readonly queue: Queue<VectorizeJobData>
  private readonly worker: Worker<VectorizeJobData>
  private readonly redis: Redis
  private readonly pgStore: KnowledgePgStore
  private readonly embeddingService: EmbeddingService
  private readonly log: pino.Logger
  private readonly registry: RegistryLike | null

  constructor(
    redis: Redis,
    pgStore: KnowledgePgStore,
    embeddingService: EmbeddingService,
    logger: pino.Logger,
    registry?: RegistryLike,
  ) {
    this.redis = redis
    this.pgStore = pgStore
    this.embeddingService = embeddingService
    this.registry = registry ?? null
    this.log = logger.child({ component: 'vectorize-worker' })

    // BullMQ requires dedicated Redis connections with maxRetriesPerRequest: null
    const bullRedisOpts = {
      host: redis.options.host ?? 'localhost',
      port: redis.options.port ?? 6379,
      password: redis.options.password,
      db: redis.options.db ?? 0,
      maxRetriesPerRequest: null,
    }

    this.queue = new Queue<VectorizeJobData>(QUEUE_NAME, {
      connection: bullRedisOpts,
    })

    this.worker = new Worker<VectorizeJobData>(
      QUEUE_NAME,
      async (job) => this.processJob(job.data),
      {
        connection: bullRedisOpts,
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
    this.log.info({ documentId }, '[EMBED] Starting document embedding')

    await this.pgStore.updateDocumentEmbeddingStatus(documentId, 'processing')

    try {
      const chunks = await this.pgStore.getChunksWithoutEmbedding(documentId)
      this.log.info({
        documentId,
        chunkCount: chunks.length,
        chunkIds: chunks.map(c => c.id),
        contentLengths: chunks.map(c => c.content.length),
      }, '[EMBED] Chunks loaded for embedding')

      if (chunks.length === 0) {
        this.log.info({ documentId }, '[EMBED] No chunks without embedding, marking done')
        await this.pgStore.updateDocumentEmbeddingStatus(documentId, 'done')
        return
      }

      // Generate LLM description (before embedding, using chunk content)
      await this.generateDocumentDescription(documentId)

      const startMs = Date.now()
      await this.embedChunks(chunks)

      const durationMs = Date.now() - startMs
      await this.pgStore.updateDocumentEmbeddingStatus(documentId, 'done')
      // Propagate status to parent knowledge_item (via source_ref)
      await this.updateParentItemStatus(documentId, 'done')
      this.log.info({ documentId, chunksProcessed: chunks.length, durationMs, avgMsPerChunk: Math.round(durationMs / chunks.length) }, '[EMBED] Document embeddings complete')
    } catch (err) {
      this.log.error({ documentId, err }, 'failed to process document embeddings')
      await this.pgStore.updateDocumentEmbeddingStatus(documentId, 'failed')
      await this.updateParentItemStatus(documentId, 'failed')
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
    chunks: Array<{ id: string; content: string; documentId: string; contentType: string; mediaRefs: Array<{ mimeType: string; data?: string; filePath?: string }> | null; extraMetadata: Record<string, unknown> | null }>,
  ): Promise<void> {
    // Separate text-only chunks (can batch) from multimodal chunks (must embed individually)
    const textChunks = chunks.filter(c => !c.mediaRefs || c.mediaRefs.length === 0 || c.contentType === 'text' || c.contentType === 'csv')
    const multimodalChunks = chunks.filter(c => c.mediaRefs && c.mediaRefs.length > 0 && c.contentType !== 'text' && c.contentType !== 'csv')

    let successCount = 0
    let nullCount = 0

    // Batch embed text-only chunks (efficient)
    if (textChunks.length > 0) {
      const texts = textChunks.map(c => c.content)
      this.log.info({ batchSize: texts.length, types: textChunks.map(c => c.contentType) }, '[EMBED] Batch text embedding')
      const embeddings = await this.embeddingService.generateBatchEmbeddings(texts)

      for (let i = 0; i < textChunks.length; i++) {
        const chunk = textChunks[i]!
        const embedding = embeddings[i] ?? null
        if (embedding) {
          await this.pgStore.updateChunkEmbedding(chunk.id, embedding)
          successCount++
        } else {
          nullCount++
          this.log.warn({ chunkId: chunk.id, contentType: chunk.contentType }, '[EMBED] Text embedding null')
        }
      }
    }

    // Embed multimodal chunks individually (pdf_pages, slide, image_text, yt_header)
    for (const chunk of multimodalChunks) {
      try {
        let embedding: number[] | null = null

        if (chunk.contentType === 'pdf_pages' && chunk.mediaRefs?.[0]?.filePath) {
          // PDF: read the file and send raw PDF to embedding
          const { resolve, join } = await import('node:path')
          const { readFile } = await import('node:fs/promises')
          const knowledgeDir = resolve(process.cwd(), 'instance/knowledge/media')
          const buffer = await readFile(join(knowledgeDir, chunk.mediaRefs[0].filePath))
          if (buffer.length <= 20 * 1024 * 1024) {
            embedding = await this.embeddingService.generateFileEmbedding(buffer, 'application/pdf')
          }
        } else if (chunk.mediaRefs && chunk.mediaRefs.length > 0) {
          // Slides, web images, YT thumbnails: build multimodal parts
          const firstMedia = chunk.mediaRefs[0]!
          if (firstMedia.data) {
            // Send image + text together via generateFileEmbedding for single media
            // For multiple images, we need a new method — for now send text + first image
            const imgBuffer = Buffer.from(firstMedia.data, 'base64')
            embedding = await this.embeddingService.generateFileEmbedding(imgBuffer, firstMedia.mimeType)
          }
        }

        // Fallback: if multimodal failed, embed as text
        if (!embedding) {
          embedding = await this.embeddingService.generateEmbedding(chunk.content)
        }

        if (embedding) {
          await this.pgStore.updateChunkEmbedding(chunk.id, embedding)
          successCount++
          this.log.info({ chunkId: chunk.id, contentType: chunk.contentType, dims: embedding.length }, '[EMBED] Multimodal chunk embedded')
        } else {
          nullCount++
          this.log.warn({ chunkId: chunk.id, contentType: chunk.contentType }, '[EMBED] Multimodal embedding null')
        }
      } catch (err) {
        nullCount++
        this.log.warn({ err, chunkId: chunk.id, contentType: chunk.contentType }, '[EMBED] Multimodal chunk failed')
      }
    }

    this.log.info({ total: chunks.length, text: textChunks.length, multimodal: multimodalChunks.length, success: successCount, null: nullCount }, '[EMBED] Batch complete')
  }

  /** Update the parent knowledge_item embedding status when its document finishes */
  private async updateParentItemStatus(documentId: string, status: 'done' | 'failed'): Promise<void> {
    try {
      const doc = await this.pgStore.getDocument(documentId)
      if (!doc?.sourceRef) return
      // Update the knowledge_item's embedding_status
      await this.pgStore.getPool().query(
        `UPDATE knowledge_items SET embedding_status = $1, updated_at = now() WHERE id = $2`,
        [status, doc.sourceRef],
      )
      this.log.info({ documentId, itemId: doc.sourceRef, status }, '[EMBED] Parent item status updated')
    } catch (err) {
      this.log.warn({ err, documentId }, '[EMBED] Failed to update parent item status (non-fatal)')
    }
  }

  // ─── LLM description generation ────────────────────────

  /**
   * Generate an LLM description for a document using its chunk content.
   * Runs after chunking, before embedding. Non-fatal: if it fails, embedding continues.
   */
  private async generateDocumentDescription(documentId: string): Promise<void> {
    if (!this.registry) {
      this.log.debug({ documentId }, '[DESC-GEN] No registry available, skipping description generation')
      return
    }

    try {
      const doc = await this.pgStore.getDocument(documentId)
      if (!doc) return

      // Get full chunk data with section + index for sample selection
      const chunkSamples = await this.pgStore.getDocumentChunkSamples(documentId)
      if (chunkSamples.length === 0) return

      const result = await generateDescription(
        doc.title,
        doc.description,
        chunkSamples,
        this.registry,
        this.log,
      )

      if (result) {
        // Update document with LLM description + keywords
        await this.pgStore.updateDocumentLlmDescription(documentId, result.description, result.keywords)

        // Also update parent knowledge_item if exists
        if (doc.sourceRef) {
          await this.pgStore.updateItemLlmDescription(doc.sourceRef, result.description, result.keywords)
        }

        this.log.info({
          documentId,
          title: doc.title,
          llmDescLength: result.description.length,
          keywords: result.keywords.length,
        }, '[DESC-GEN] Document description updated')
      }
    } catch (err) {
      // Non-fatal: description generation failure should not block embedding
      this.log.warn({ err, documentId }, '[DESC-GEN] Failed to generate description (non-fatal)')
    }
  }

  // ─── Public API ────────────────────────────────────────

  async enqueueDocument(documentId: string): Promise<void> {
    await this.queue.add('vectorize-document', { type: 'document', documentId }, {
      removeOnComplete: 100,
      removeOnFail: 50,
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    })
    this.log.info({ documentId }, '[EMBED] Enqueued document for vectorization')
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
      attempts: 2,
      backoff: { type: 'exponential', delay: 10000 },
    })

    this.log.info('[EMBED] Enqueued bulk vectorization')
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
