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

      const startMs = Date.now()
      await this.embedChunks(chunks)

      // Multimodal: if document is PDF or image, also embed the raw file
      await this.tryMultimodalEmbedding(documentId, chunks)

      const durationMs = Date.now() - startMs
      await this.pgStore.updateDocumentEmbeddingStatus(documentId, 'done')
      this.log.info({ documentId, chunksProcessed: chunks.length, durationMs, avgMsPerChunk: Math.round(durationMs / chunks.length) }, '[EMBED] Document embeddings complete')
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

  /**
   * For PDF and image documents, send the raw file to Gemini Embedding 2 multimodal.
   * Creates an additional chunk with the file-level vector — captures visual content
   * that text extraction misses (charts, diagrams, scanned text, etc.)
   */
  private async tryMultimodalEmbedding(
    documentId: string,
    _existingChunks: Array<{ id: string; content: string; documentId: string }>,
  ): Promise<void> {
    try {
      const doc = await this.pgStore.getDocument(documentId)
      if (!doc) return

      const MULTIMODAL_MIMES = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/gif']
      if (!MULTIMODAL_MIMES.includes(doc.mimeType)) return
      if (!doc.filePath) return

      // Read the original file
      const { resolve, join } = await import('node:path')
      const { readFile } = await import('node:fs/promises')
      const knowledgeDir = resolve(process.cwd(), 'instance/knowledge/media')
      const filePath = join(knowledgeDir, doc.filePath)

      let fileBuffer: Buffer
      try {
        fileBuffer = await readFile(filePath)
      } catch {
        this.log.warn({ documentId, filePath: doc.filePath }, '[EMBED] Could not read file for multimodal embedding')
        return
      }

      // 20MB limit for embedding API request
      if (fileBuffer.length > 20 * 1024 * 1024) {
        this.log.warn({ documentId, sizeBytes: fileBuffer.length }, '[EMBED] File too large for multimodal embedding (>20MB)')
        return
      }

      this.log.info({ documentId, mimeType: doc.mimeType, sizeBytes: fileBuffer.length, title: doc.title }, '[EMBED] Generating multimodal file embedding')

      const embedding = await this.embeddingService.generateFileEmbedding(fileBuffer, doc.mimeType)
      if (!embedding) {
        this.log.warn({ documentId }, '[EMBED] Multimodal embedding returned null')
        return
      }

      // Store as an additional chunk with the file-level vector
      const multimodalContent = `[Contenido visual completo: ${doc.title}]`
      const chunkId = await this.pgStore.insertMultimodalChunk(documentId, multimodalContent, embedding)

      this.log.info({ documentId, chunkId, dims: embedding.length, title: doc.title }, '[EMBED] Multimodal file embedding stored as chunk')
    } catch (err) {
      this.log.warn({ err, documentId }, '[EMBED] Multimodal embedding failed (non-fatal)')
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
