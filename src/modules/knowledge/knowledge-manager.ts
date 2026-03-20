// LUNA — Module: knowledge — Knowledge Manager
// Orquestador principal. Servicio expuesto como 'knowledge:manager'.

import { createHash } from 'node:crypto'
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import pino from 'pino'
import type { Registry } from '../../kernel/registry.js'
import type { KnowledgePgStore } from './pg-store.js'
import type { KnowledgeSearchEngine } from './search-engine.js'
import type { KnowledgeCache } from './cache.js'
import type {
  KnowledgeCategory,
  KnowledgeConfig,
  KnowledgeDocument,
  KnowledgeSearchResult,
  KnowledgeSearchOptions,
  KnowledgeStats,
  UpgradeSuggestion,
  DocumentMetadata,
  DocumentSourceType,
} from './types.js'
import { extractContent, resolveMimeType } from './extractors/index.js'
import { chunkSections } from './extractors/chunker.js'

const logger = pino({ name: 'knowledge:manager' })

export class KnowledgeManager {
  constructor(
    private pgStore: KnowledgePgStore,
    private searchEngine: KnowledgeSearchEngine,
    private cache: KnowledgeCache,
    private config: KnowledgeConfig,
    private registry: Registry,
  ) {}

  // ─── Document management ───────────────────

  /**
   * Add a document from a file buffer (upload or sync).
   */
  async addDocument(
    buffer: Buffer,
    fileName: string,
    category: KnowledgeCategory,
    options: {
      sourceType?: DocumentSourceType
      sourceRef?: string
      mimeType?: string
      metadata?: DocumentMetadata
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

    // Chunk the extracted content
    const chunks = chunkSections(extracted.sections)

    // Check core limit
    if (category === 'core') {
      const stats = await this.pgStore.getStats()
      if (stats.totalChunks + chunks.length > this.config.KNOWLEDGE_CORE_MAX_CHUNKS * 2) {
        logger.warn({ chunks: chunks.length }, 'Adding document may exceed core chunk guidance')
      }
    }

    // Persist document
    const title = extracted.metadata.originalName ?? fileName
    const docId = await this.pgStore.insertDocument({
      title,
      category,
      sourceType: options.sourceType ?? 'upload',
      sourceRef: options.sourceRef ?? null,
      contentHash,
      filePath: safeFileName,
      mimeType,
      metadata: { ...extracted.metadata, ...options.metadata },
    })

    // Persist chunks
    await this.pgStore.insertChunks(docId, chunks)

    // Rebuild search indices
    this.searchEngine.invalidate()

    logger.info({ id: docId, title, category, chunks: chunks.length }, 'Document added')
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

    // Invalidate indices
    if (doc.category === 'core') {
      this.searchEngine.invalidateCore()
    } else {
      this.searchEngine.invalidate()
    }

    logger.info({ id, title: doc.title }, 'Document removed')
  }

  /**
   * Change document category (core ↔ consultable).
   */
  async updateCategory(id: string, category: KnowledgeCategory): Promise<void> {
    const doc = await this.pgStore.getDocument(id)
    if (!doc) throw new Error(`Document "${id}" not found`)
    if (doc.category === category) return

    await this.pgStore.updateDocumentCategory(id, category)
    this.searchEngine.invalidate()
    await this.cache.invalidate()

    logger.info({ id, title: doc.title, from: doc.category, to: category }, 'Document category changed')
  }

  /**
   * Re-process a document (re-extract and re-chunk).
   */
  async reprocessDocument(id: string): Promise<void> {
    const doc = await this.pgStore.getDocument(id)
    if (!doc || !doc.filePath) throw new Error(`Document "${id}" not found or has no file`)

    const knowledgeDir = resolve(process.cwd(), this.config.KNOWLEDGE_DIR)
    const buffer = await readFile(join(knowledgeDir, doc.filePath))
    const extracted = await extractContent(buffer, doc.title, doc.mimeType, this.registry)
    const chunks = chunkSections(extracted.sections)

    const newHash = createHash('sha256').update(buffer).digest('hex')
    await this.pgStore.updateDocumentHash(id, newHash, chunks.length)
    await this.pgStore.insertChunks(id, chunks)

    this.searchEngine.invalidate()
    logger.info({ id, title: doc.title, chunks: chunks.length }, 'Document reprocessed')
  }

  // ─── Search ────────────────────────────────

  /**
   * Search core knowledge (for Phase 1 injection).
   */
  async searchCore(query: string, limit = 3): Promise<KnowledgeSearchResult[]> {
    const results = await this.searchEngine.searchCore(query, limit)
    // Track hits (fire-and-forget)
    this.trackHits(results)
    // Record gap if no results
    if (results.length === 0 && query.trim().length > 5) {
      this.pgStore.recordGap(query).catch(() => {})
    }
    return results
  }

  /**
   * Search consultable knowledge (for tool use).
   */
  async searchConsultable(query: string, limit = 5): Promise<KnowledgeSearchResult[]> {
    const results = await this.searchEngine.searchConsultable(query, limit)
    this.trackHits(results)
    if (results.length === 0 && query.trim().length > 5) {
      this.pgStore.recordGap(query).catch(() => {})
    }
    return results
  }

  // ─── Rebuild ───────────────────────────────

  async rebuildIndex(): Promise<void> {
    await this.searchEngine.rebuildIndices()
    logger.info('Full index rebuild completed')
  }

  // ─── Auto-downgrade ────────────────────────

  /**
   * Downgrade core documents that haven't been used in N days.
   * Called periodically by BullMQ job.
   */
  async runAutoDowngrade(): Promise<number> {
    const docs = await this.pgStore.getDocumentsForDowngrade(this.config.KNOWLEDGE_AUTO_DOWNGRADE_DAYS)

    for (const doc of docs) {
      await this.pgStore.updateDocumentCategory(doc.id, 'consultable')
      logger.info({ id: doc.id, title: doc.title, hitCount: doc.hitCount }, 'Auto-downgraded to consultable')
    }

    if (docs.length > 0) {
      this.searchEngine.invalidate()
      await this.cache.invalidate()
    }

    return docs.length
  }

  // ─── Stats and suggestions ─────────────────

  async getStats(): Promise<KnowledgeStats> {
    return this.pgStore.getStats()
  }

  async getUpgradeSuggestions(): Promise<UpgradeSuggestion[]> {
    // Suggest upgrade if consultable doc has >= 5 hits
    return this.pgStore.getUpgradeSuggestions(5)
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
