// LUNA — Module: knowledge — Knowledge Manager v2
// Orquestador principal. Servicio expuesto como 'knowledge:manager'.
// v2: categorías como tabla, embeddings async, KnowledgeInjection, API connectors.

import { createHash } from 'node:crypto'
import { writeFile, mkdir, unlink } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import pino from 'pino'
import type { Registry } from '../../kernel/registry.js'
import type { KnowledgePgStore } from './pg-store.js'
import type { KnowledgeSearchEngine } from './search-engine.js'
import type { KnowledgeCache } from './cache.js'
import type { VectorizeWorker } from './vectorize-worker.js'
import type {
  KnowledgeConfig,
  KnowledgeDocument,
  KnowledgeSearchResult,
  KnowledgeInjection,
  KnowledgeInjectionItem,
  KnowledgeStats,
  UpgradeSuggestion,
  DocumentMetadata,
  DocumentSourceType,
} from './types.js'
import { extractContent, resolveMimeType } from './extractors/index.js'
import { chunkDocs, linkChunks } from './extractors/smart-chunker.js'

const logger = pino({ name: 'knowledge:manager' })

export class KnowledgeManager {
  private vectorizeWorker: VectorizeWorker | null = null

  constructor(
    private pgStore: KnowledgePgStore,
    private searchEngine: KnowledgeSearchEngine,
    private cache: KnowledgeCache,
    private config: KnowledgeConfig,
    private registry: Registry,
  ) {}

  setVectorizeWorker(worker: VectorizeWorker): void {
    this.vectorizeWorker = worker
  }

  // ─── Document management ───────────────────

  /**
   * Add a document from a file buffer (upload or sync).
   * v2: accepts categoryIds[] instead of single category string.
   */
  async addDocument(
    buffer: Buffer,
    fileName: string,
    options: {
      isCore?: boolean
      categoryIds?: string[]
      sourceType?: DocumentSourceType
      sourceRef?: string
      mimeType?: string
      metadata?: DocumentMetadata
      description?: string
    } = {},
  ): Promise<KnowledgeDocument> {
    // Check file size
    const sizeMB = buffer.length / (1024 * 1024)
    if (sizeMB > this.config.KNOWLEDGE_MAX_FILE_SIZE_MB) {
      throw new Error(`File too large: ${sizeMB.toFixed(1)}MB exceeds limit of ${this.config.KNOWLEDGE_MAX_FILE_SIZE_MB}MB`)
    }

    // Compute content hash
    const contentHash = createHash('sha256').update(buffer).digest('hex')

    // Check if already exists (by hash)
    const existing = await this.pgStore.getDocumentByHash(contentHash)
    if (existing) {
      logger.info({ id: existing.id, title: existing.title }, 'Document already exists with same content')
      return existing
    }

    // Validate core limit
    if (options.isCore) {
      const coreCount = await this.pgStore.getCoreDocumentCount()
      if (coreCount >= this.config.KNOWLEDGE_MAX_CORE_DOCS) {
        throw new Error(`Core document limit reached (max ${this.config.KNOWLEDGE_MAX_CORE_DOCS}). Remove a core doc first.`)
      }
    }

    // Ensure at least one category (default)
    let categoryIds = options.categoryIds ?? []
    if (categoryIds.length === 0) {
      const defaultCat = await this.pgStore.getDefaultCategory()
      if (defaultCat) categoryIds = [defaultCat.id]
    }

    // Resolve MIME type
    const mimeType = resolveMimeType(fileName, options.mimeType)

    // Extract content
    const extracted = await extractContent(buffer, fileName, mimeType, this.registry)

    // Save file to disk
    const knowledgeDir = resolve(process.cwd(), this.config.KNOWLEDGE_DIR)
    await mkdir(knowledgeDir, { recursive: true })
    const safeFileName = `${contentHash.substring(0, 12)}_${sanitizeFileName(fileName)}`
    const filePath = join(knowledgeDir, safeFileName)
    await writeFile(filePath, buffer)

    // Smart chunk: split by headings with proper overlap
    const fullText = extracted.sections.map(s => {
      const heading = s.title ? `## ${s.title}\n` : ''
      return heading + s.content
    }).join('\n\n')

    const smartChunks = chunkDocs(fullText)
    const sourceId = options.sourceRef ?? contentHash

    logger.info({
      fileName, mimeType,
      sections: extracted.sections.length,
      totalChunks: smartChunks.length,
      sourceType: options.sourceType,
    }, '[CHUNKS] Document smart-chunked')

    // Persist document
    const title = extracted.metadata.originalName ?? fileName
    const docId = await this.pgStore.insertDocument({
      title,
      description: options.description ?? '',
      isCore: options.isCore ?? false,
      sourceType: options.sourceType ?? 'upload',
      sourceRef: options.sourceRef ?? null,
      contentHash,
      filePath: safeFileName,
      mimeType,
      metadata: { ...extracted.metadata, ...options.metadata },
    })

    // Link and persist smart chunks
    const linked = linkChunks(sourceId, smartChunks)
    await this.pgStore.insertLinkedChunks(docId, linked)
    logger.info({ docId, chunkCount: linked.length, title }, '[CHUNKS] Smart chunks persisted')

    // Assign categories
    for (const catId of categoryIds) {
      await this.pgStore.assignDocumentCategory(docId, catId)
    }

    // Enqueue vectorization (async — doesn't block)
    if (this.vectorizeWorker) {
      this.vectorizeWorker.enqueueDocument(docId).catch(err => {
        logger.warn({ err, docId }, 'Failed to enqueue vectorization')
      })
    }

    // Invalidate caches
    if (options.isCore) await this.cache.invalidate()

    logger.info({ id: docId, title, isCore: options.isCore, chunks: linked.length }, 'Document added')
    return (await this.pgStore.getDocument(docId))!
  }

  /**
   * Remove a document and its chunks.
   */
  async removeDocument(id: string): Promise<void> {
    const doc = await this.pgStore.getDocument(id)
    if (!doc) throw new Error(`Document "${id}" not found`)

    // Remove file from disk
    if (doc.filePath) {
      const knowledgeDir = resolve(process.cwd(), this.config.KNOWLEDGE_DIR)
      try {
        await unlink(join(knowledgeDir, doc.filePath))
      } catch {
        logger.warn({ filePath: doc.filePath }, 'Failed to delete file from disk')
      }
    }

    await this.pgStore.deleteDocument(id)

    if (doc.isCore) await this.cache.invalidate()

    logger.info({ id, title: doc.title }, 'Document removed')
  }

  /**
   * Set core flag on a document.
   */
  async setCore(id: string, isCore: boolean): Promise<void> {
    const doc = await this.pgStore.getDocument(id)
    if (!doc) throw new Error(`Document "${id}" not found`)
    if (doc.isCore === isCore) return

    if (isCore) {
      const coreCount = await this.pgStore.getCoreDocumentCount()
      if (coreCount >= this.config.KNOWLEDGE_MAX_CORE_DOCS) {
        throw new Error(`Core document limit reached (max ${this.config.KNOWLEDGE_MAX_CORE_DOCS})`)
      }
    }

    await this.pgStore.updateDocumentCore(id, isCore)
    await this.cache.invalidate()

    logger.info({ id, title: doc.title, isCore }, 'Document core flag changed')
  }

  // ─── Search ────────────────────────────────

  /**
   * Search consultable knowledge (for tool use in Phase 3).
   * Accepts searchHint for category boost.
   */
  async searchConsultable(query: string, limit = 5, searchHint?: string): Promise<KnowledgeSearchResult[]> {
    const results = await this.searchEngine.search(query, { limit, searchHint })
    this.trackHits(results)
    if (results.length === 0 && query.trim().length > 5) {
      this.pgStore.recordGap(query).catch(() => {})
    }
    return results
  }

  // ─── Injection (Phase 1) ───────────────────

  /**
   * Get KnowledgeInjection for Phase 1 context.
   * Returns cached version if available.
   */
  async getInjection(): Promise<KnowledgeInjection> {
    // Try cache first
    const cached = await this.cache.getInjection()
    if (cached) return cached

    // Build fresh
    const [coreDocs, categories, connectors, activeItems] = await Promise.all([
      this.pgStore.getCoreDocuments(),
      this.pgStore.listCategories(),
      this.pgStore.listApiConnectors(),
      this.pgStore.listActiveItemsForInjection(),
    ])

    // Build category title lookup
    const catTitleById = new Map(categories.map(c => [c.id, c.title]))

    // Map items to injection format (include shareable URL and live query info if flagged)
    const injectionItems: KnowledgeInjectionItem[] = activeItems.map(item => ({
      id: item.id,
      title: item.title,
      description: item.description,
      categoryId: item.categoryId,
      categoryTitle: item.categoryId ? catTitleById.get(item.categoryId) : undefined,
      shareable: item.shareable ?? false,
      sourceUrl: item.shareable ? item.sourceUrl : undefined,
      liveQueryEnabled: item.liveQueryEnabled ?? false,
      sourceId: item.liveQueryEnabled ? item.sourceId : undefined,
      sourceType: item.liveQueryEnabled ? item.sourceType : undefined,
    }))

    const injection: KnowledgeInjection = {
      coreDocuments: coreDocs.map(d => ({ title: d.title, description: d.description })),
      categories: categories.map(c => ({ id: c.id, title: c.title, description: c.description })),
      apiConnectors: connectors
        .filter(c => c.active)
        .map(c => ({ title: c.title, description: c.description })),
      items: injectionItems,
    }

    // Cache it
    await this.cache.setInjection(injection)

    return injection
  }

  // ─── Vectorization ─────────────────────────

  /**
   * Trigger bulk vectorization (manual button in console).
   * Respects 1hr cooldown.
   */
  async triggerBulkVectorization(): Promise<{ enqueued: boolean; reason?: string }> {
    if (!this.vectorizeWorker) {
      return { enqueued: false, reason: 'Vectorize worker not available' }
    }
    return this.vectorizeWorker.enqueueBulk()
  }

  // ─── Auto-downgrade ────────────────────────

  /**
   * Downgrade core documents that haven't been used in N days.
   */
  async runAutoDowngrade(): Promise<number> {
    const docs = await this.pgStore.getDocumentsForDowngrade(this.config.KNOWLEDGE_AUTO_DOWNGRADE_DAYS)

    for (const doc of docs) {
      await this.pgStore.updateDocumentCore(doc.id, false)
      logger.info({ id: doc.id, title: doc.title, hitCount: doc.hitCount }, 'Auto-downgraded from core')
    }

    if (docs.length > 0) {
      await this.cache.invalidate()
    }

    return docs.length
  }

  // ─── Stats and suggestions ─────────────────

  async getStats(): Promise<KnowledgeStats> {
    return this.pgStore.getStats()
  }

  async getUpgradeSuggestions(): Promise<UpgradeSuggestion[]> {
    return this.pgStore.getUpgradeSuggestions(5)
  }

  // ─── Rebuild ───────────────────────────────

  async rebuildIndex(): Promise<void> {
    await this.searchEngine.invalidateQueryCache()
    await this.cache.invalidate()
    logger.info('Index and cache invalidated')
  }

  // ─── Private ───────────────────────────────

  private trackHits(results: KnowledgeSearchResult[]): void {
    for (const r of results) {
      if (r.documentId) {
        this.pgStore.incrementHitCount(r.documentId).catch(() => {})
      }
      if (r.faqId) {
        this.pgStore.incrementFAQHitCount(r.faqId).catch(() => {})
      }
    }
  }
}

function sanitizeFileName(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .replace(/__+/g, '_')
    .substring(0, 100)
}
