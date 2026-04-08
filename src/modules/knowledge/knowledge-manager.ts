// LUNA — Module: knowledge — Knowledge Manager v2
// Orquestador principal. Servicio expuesto como 'knowledge:manager'.
// v2: categorías como tabla, embeddings async, KnowledgeInjection, API connectors.

import { createHash } from 'node:crypto'
import { writeFile, mkdir, unlink, readFile } from 'node:fs/promises'
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
import type { EmbeddableChunk } from './embedding-limits.js'
import { KNOWLEDGE_MEDIA_DIR } from './constants.js'
import { extractContent, resolveMimeType } from './extractors/index.js'
import {
  chunkDocs,
  chunkPdf,
  chunkImage,
  chunkAudio,
  chunkVideo,
  chunkSheets,
  chunkSlidesAsPdf,
  linkChunks,
} from './extractors/smart-chunker.js'
import { splitMediaFile, AUDIO_SPLIT_CONFIG, VIDEO_SPLIT_CONFIG } from './extractors/temporal-splitter.js'

const logger = pino({ name: 'knowledge:manager' })

// Umbrales para temporal splitting
const AUDIO_THRESHOLD_SECONDS = 60
const VIDEO_THRESHOLD_SECONDS = 50

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
   * Router dual: TEXT pipeline (chunkDocs) vs VISUAL pipeline (chunkPdf) según tipo.
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

    // Extract content (generic — for metadata + text fallback)
    const extracted = await extractContent(buffer, fileName, mimeType, this.registry)

    // Prepare dirs
    const knowledgeDir = resolve(process.cwd(), this.config.KNOWLEDGE_DIR)
    const mediaDir = KNOWLEDGE_MEDIA_DIR
    await mkdir(knowledgeDir, { recursive: true })
    await mkdir(mediaDir, { recursive: true })

    const hashPrefix = contentHash.substring(0, 12)
    const safeFileName = `${hashPrefix}_${sanitizeFileName(fileName)}`
    const filePath = join(knowledgeDir, safeFileName)

    // Full text from extractContent (used for TEXT pipeline fallback)
    const fullText = extracted.sections.map(s => {
      const heading = s.title ? `## ${s.title}\n` : ''
      return heading + s.content
    }).join('\n\n')

    // ─── Smart router ───────────────────────────
    let smartChunks: EmbeddableChunk[]
    let docFilePath = safeFileName  // relative path stored in knowledge_documents.file_path

    if (mimeType === 'application/pdf') {
      // VISUAL pipeline: PDF → chunkPdf (multimodal embedding)
      const { extractPDF } = await import('../../extractors/pdf.js')
      const pdfResult = await extractPDF(buffer, fileName, this.registry)
      const pageTexts = pdfResult.sections.map(s => s.content)
      const totalPages = pageTexts.length || 1

      // Save PDF to mediaDir for embedding-queue to read
      const mediaFileName = safeFileName
      await writeFile(join(mediaDir, mediaFileName), buffer)
      docFilePath = safeFileName  // document.filePath → knowledgeDir (also saved there below)

      smartChunks = chunkPdf(pageTexts, mediaFileName, totalPages, {
        sourceFile: fileName,
        docMeta: pdfResult.metadata as Record<string, unknown>,
      })
      logger.info({ fileName, pages: totalPages, chunks: smartChunks.length }, '[ROUTER] PDF → visual pipeline')

    } else if (
      mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      || mimeType === 'application/msword'
    ) {
      // DOCX: smart router (TEXT si sin imágenes, VISUAL si tiene imágenes + LibreOffice)
      const { extractDocxSmart } = await import('../../extractors/docx.js')
      const docxResult = await extractDocxSmart(buffer, fileName)

      if (docxResult.pdfBuffer) {
        // VISUAL pipeline: DOCX con imágenes → PDF convertido
        const { extractPDF } = await import('../../extractors/pdf.js')
        const pdfFileName = `${hashPrefix}_${sanitizeFileName(fileName.replace(/\.docx?$/i, '.pdf'))}`
        await writeFile(join(mediaDir, pdfFileName), docxResult.pdfBuffer)

        const pdfResult = await extractPDF(docxResult.pdfBuffer, pdfFileName, this.registry)
        const pageTexts = pdfResult.sections.map(s => s.content)
        const totalPages = pageTexts.length || 1

        smartChunks = chunkPdf(pageTexts, pdfFileName, totalPages, {
          sourceFile: fileName,
          docMeta: docxResult.metadata as Record<string, unknown>,
        })
        logger.info({ fileName, pages: totalPages, chunks: smartChunks.length }, '[ROUTER] DOCX+imgs → visual pipeline (PDF)')
      } else {
        // TEXT pipeline: DOCX sin imágenes
        smartChunks = chunkDocs(fullText, {
          sourceFile: fileName,
          sourceType: 'docx',
          sourceMimeType: mimeType,
          docMeta: extracted.metadata as Record<string, unknown>,
        })
        logger.info({ fileName, chunks: smartChunks.length }, '[ROUTER] DOCX → text pipeline')
      }

    } else if (
      mimeType === 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
      || mimeType === 'application/vnd.ms-powerpoint'
    ) {
      // PPTX: siempre VISUAL pipeline
      const { extractPptx } = await import('../../extractors/slides.js')
      const pptxResult = await extractPptx(buffer, fileName)

      if (pptxResult.pdfBuffer) {
        const { extractPDF } = await import('../../extractors/pdf.js')
        const pdfFileName = `${hashPrefix}_${sanitizeFileName(fileName.replace(/\.pptx?$/i, '.pdf'))}`
        await writeFile(join(mediaDir, pdfFileName), pptxResult.pdfBuffer)

        const pdfResult = await extractPDF(pptxResult.pdfBuffer, pdfFileName, this.registry)
        const pageTexts = pdfResult.sections.map(s => s.content)
        const totalPages = pageTexts.length || 1
        const speakerNotes = pptxResult.speakerNotes ?? []

        smartChunks = chunkSlidesAsPdf(pageTexts, pdfFileName, totalPages, speakerNotes, {
          sourceFile: fileName,
          docMeta: pptxResult.metadata as Record<string, unknown>,
        })
        logger.info({ fileName, pages: totalPages, notes: speakerNotes.length, chunks: smartChunks.length }, '[ROUTER] PPTX → visual pipeline (PDF+notes)')
      } else {
        // Fallback: texto del XML
        const slidesText = pptxResult.slides.map(s => s.text).join('\n\n')
        smartChunks = chunkDocs(slidesText || fullText, {
          sourceFile: fileName,
          sourceType: 'slides',
          sourceMimeType: mimeType,
          docMeta: extracted.metadata as Record<string, unknown>,
        })
        logger.info({ fileName, chunks: smartChunks.length }, '[ROUTER] PPTX (no LibreOffice) → text pipeline')
      }

    } else if (mimeType.startsWith('image/')) {
      // Imagen: 1 chunk con mediaRef
      const { extractImage, describeImage } = await import('../../extractors/image.js')
      const imageResult = await extractImage(buffer, fileName, mimeType)
      const enriched = await describeImage(imageResult, this.registry)
      const description = enriched.llmEnrichment?.description || null

      // Save image to mediaDir for embedding
      await writeFile(join(mediaDir, safeFileName), buffer)

      smartChunks = chunkImage({
        description,
        shortDescription: fileName,
        mimeType,
        sourceFile: fileName,
        filePath: safeFileName,
        docMeta: imageResult.metadata as Record<string, unknown>,
      })
      logger.info({ fileName, hasDescription: !!description, chunks: smartChunks.length }, '[ROUTER] Image → image pipeline')

    } else if (mimeType.startsWith('audio/')) {
      // Audio: STT transcription + temporal splitting si > threshold
      smartChunks = await this.routeAudio(buffer, fileName, mimeType, hashPrefix, mediaDir)
      logger.info({ fileName, chunks: smartChunks.length }, '[ROUTER] Audio → audio pipeline')

    } else if (mimeType.startsWith('video/')) {
      // Video: Gemini multimodal + temporal splitting si > threshold
      smartChunks = await this.routeVideo(buffer, fileName, mimeType, hashPrefix, mediaDir)
      logger.info({ fileName, chunks: smartChunks.length }, '[ROUTER] Video → video pipeline')

    } else if (
      mimeType.includes('spreadsheet')
      || mimeType === 'text/csv'
      || mimeType === 'application/vnd.ms-excel'
    ) {
      // Sheets: CSV rows → chunkSheets (usa extractSheets que retorna SheetsResult con .sheets)
      const { extractSheets } = await import('../../extractors/sheets.js')
      try {
        const sheetsResult = await extractSheets(buffer, fileName)
        const allChunks: EmbeddableChunk[] = []
        for (const sheet of sheetsResult.sheets) {
          const sheetChunks = chunkSheets(sheet.headers, sheet.rows, {
            sourceFile: fileName,
            sourceMimeType: mimeType,
            sheetName: sheet.name,
            docMeta: sheetsResult.metadata as Record<string, unknown>,
          })
          allChunks.push(...sheetChunks)
        }
        smartChunks = allChunks
        logger.info({ fileName, sheets: sheetsResult.sheets.length, chunks: smartChunks.length }, '[ROUTER] Sheets → sheets pipeline')
      } catch {
        smartChunks = chunkDocs(fullText, { sourceFile: fileName, sourceMimeType: mimeType, docMeta: extracted.metadata as Record<string, unknown> })
        logger.warn({ fileName }, '[ROUTER] Sheets extraction failed → text fallback')
      }

    } else {
      // TEXT pipeline default (.txt, .md, .json, docs sin imágenes, etc.)
      smartChunks = chunkDocs(fullText, {
        sourceFile: fileName,
        sourceMimeType: mimeType,
        docMeta: extracted.metadata as Record<string, unknown>,
      })
      logger.info({ fileName, mimeType, chunks: smartChunks.length }, '[ROUTER] Default → text pipeline')
    }

    // Save original file to knowledgeDir (for document tracking + removeDocument)
    await writeFile(filePath, buffer)

    const sourceId = options.sourceRef ?? contentHash

    logger.info({
      fileName, mimeType,
      sections: extracted.sections.length,
      totalChunks: smartChunks.length,
      sourceType: options.sourceType,
    }, '[CHUNKS] Document routed and smart-chunked')

    // Persist document
    const title = extracted.metadata.originalName ?? fileName
    const docId = await this.pgStore.insertDocument({
      title,
      description: options.description ?? '',
      isCore: options.isCore ?? false,
      sourceType: options.sourceType ?? 'upload',
      sourceRef: options.sourceRef ?? null,
      contentHash,
      filePath: docFilePath,
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

    // Remove file from disk (check both knowledgeDir and mediaDir)
    if (doc.filePath) {
      const knowledgeDir = resolve(process.cwd(), this.config.KNOWLEDGE_DIR)
      const mediaDir = KNOWLEDGE_MEDIA_DIR
      const inKnowledge = join(knowledgeDir, doc.filePath)
      const inMedia = join(mediaDir, doc.filePath)
      try {
        await unlink(inKnowledge)
      } catch {
        // Try media dir
        await unlink(inMedia).catch(() => {
          logger.warn({ filePath: doc.filePath }, 'Failed to delete file from disk (checked both dirs)')
        })
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

  // ─── Expand Knowledge ──────────────────────

  /**
   * Expand a document found via search_knowledge — returns full content of the document.
   * Uses Redis cache (TTL 15 min) to avoid re-fetching on repeated expand calls.
   */
  async expandKnowledge(documentId: string): Promise<{
    success: boolean
    data?: {
      title: string
      description: string
      content: string
      totalChunks: number
      sourceType: string
      fileUrl?: string
      liveQueryHint?: string
    }
    error?: string
  }> {
    // Try Redis cache first
    const redis = this.registry.getRedis()
    const cacheKey = `expand:${documentId}`
    try {
      const cached = await redis.get(cacheKey)
      if (cached) return JSON.parse(cached) as ReturnType<typeof this.expandKnowledge> extends Promise<infer T> ? T : never
    } catch {
      // Cache miss or error — generate fresh
    }

    const doc = await this.pgStore.getDocument(documentId)
    if (!doc) return { success: false, error: 'Documento no encontrado' }

    const chunks = await this.pgStore.getChunksByDocumentId(documentId)

    let content: string
    if (chunks.length <= 15) {
      content = chunks.map(c => c.content).filter(Boolean).join('\n\n---\n\n')
    } else {
      const first5 = chunks.slice(0, 5).map(c => c.content).filter(Boolean).join('\n\n')
      const last3 = chunks.slice(-3).map(c => c.content).filter(Boolean).join('\n\n')
      content = `[Documento con ${chunks.length} fragmentos. Mostrando primeros 5 y últimos 3:]\n\n${first5}\n\n[...${chunks.length - 8} fragmentos intermedios...]\n\n${last3}`
    }

    // Live query hint if item supports it
    let liveQueryHint: string | undefined
    if (doc.sourceRef) {
      const item = await this.pgStore.getItem(doc.sourceRef)
      if (item?.liveQueryEnabled && item.sourceId && item.sourceType) {
        const toolMap: Record<string, string> = {
          sheets: 'sheets-read',
          docs: 'docs-read',
          slides: 'slides-read',
          drive: 'drive-list-files',
        }
        liveQueryHint = `Puedes consultar este recurso en vivo: ${toolMap[item.sourceType] ?? item.sourceType}(id: ${item.sourceId})`
      }
    }

    const fileUrl = (doc.metadata as Record<string, unknown>)?.fileUrl as string | undefined

    const result = {
      success: true,
      data: {
        title: doc.title,
        description: doc.description,
        content,
        totalChunks: chunks.length,
        sourceType: doc.sourceType,
        fileUrl: fileUrl || undefined,
        liveQueryHint,
      },
    }

    // Cache result (TTL 15 min)
    try {
      await redis.set(cacheKey, JSON.stringify(result), 'EX', 900)
    } catch {
      // Non-critical
    }

    return result
  }

  /**
   * Invalidate expand_knowledge cache for a document.
   * Called when document is re-trained.
   */
  async invalidateExpandCache(documentId: string): Promise<void> {
    try {
      const redis = this.registry.getRedis()
      await redis.del(`expand:${documentId}`)
    } catch {
      // Non-critical
    }
  }

  // ─── Search ────────────────────────────────

  /**
   * Search consultable knowledge (for tool use in Phase 3).
   * Accepts searchHint for category boost.
   */
  async searchConsultable(query: string, limit = 5, searchHint?: string, allowedCategoryIds?: string[]): Promise<KnowledgeSearchResult[]> {
    const results = await this.searchEngine.search(query, { limit, searchHint, allowedCategoryIds })
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

  // ─── Private helpers (audio/video routing) ─

  /**
   * Route audio: STT transcription + temporal splitting para knowledge embedding.
   * Si duración > AUDIO_THRESHOLD_SECONDS → split + chunkAudio con contentType='audio'.
   * Si ≤ threshold → 1 chunk (contentType='text' o 'audio' según mediaRef).
   */
  private async routeAudio(
    buffer: Buffer,
    fileName: string,
    mimeType: string,
    hashPrefix: string,
    mediaDir: string,
  ): Promise<EmbeddableChunk[]> {
    const { extractAudio, transcribeAudioContent } = await import('../../extractors/audio.js')

    const audioResult = await extractAudio(buffer, fileName, mimeType)
    const duration = audioResult.durationSeconds ?? 0
    const resolvedMime = audioResult.mimeType

    // STT transcription
    const enriched = await transcribeAudioContent(audioResult, this.registry)
    const transcription = enriched.llmEnrichment?.transcription ?? enriched.llmEnrichment?.description ?? null

    if (duration <= AUDIO_THRESHOLD_SECONDS) {
      // Single chunk — save original to mediaDir
      const audioFileName = `${hashPrefix}_${sanitizeFileName(fileName)}`
      await writeFile(join(mediaDir, audioFileName), buffer)
      return chunkAudio({
        transcription,
        durationSeconds: duration,
        mimeType: resolvedMime,
        sourceFile: fileName,
        filePath: audioFileName,
        docMeta: audioResult.metadata as Record<string, unknown>,
      })
    }

    // Temporal split — save segments to mediaDir
    const segments = await splitMediaFile(buffer, resolvedMime, duration, AUDIO_SPLIT_CONFIG)
    if (segments.length === 0) {
      // splitMediaFile returned no segments (single segment case) — fallback to simple chunk
      const audioFileName = `${hashPrefix}_${sanitizeFileName(fileName)}`
      await writeFile(join(mediaDir, audioFileName), buffer)
      return chunkAudio({
        transcription,
        durationSeconds: duration,
        mimeType: resolvedMime,
        sourceFile: fileName,
        filePath: audioFileName,
        docMeta: audioResult.metadata as Record<string, unknown>,
      })
    }

    // Persist segments to mediaDir (temporal-splitter writes to tmpdir)
    const ext = resolvedMime === 'audio/mpeg' ? 'mp3'
      : resolvedMime === 'audio/ogg' ? 'ogg'
      : resolvedMime === 'audio/wav' ? 'wav'
      : resolvedMime === 'audio/aac' ? 'aac'
      : resolvedMime === 'audio/flac' ? 'flac'
      : 'mp3'

    const persistedSegments: Array<{ startSeconds: number; endSeconds: number; segmentPath: string }> = []
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]!
      const segFileName = `${hashPrefix}_seg${i}.${ext}`
      const segBuffer = await readFile(seg.segmentPath)
      await writeFile(join(mediaDir, segFileName), segBuffer)
      // Cleanup tmpdir segment
      await unlink(seg.segmentPath).catch(() => {})
      persistedSegments.push({
        startSeconds: seg.startSeconds,
        endSeconds: seg.endSeconds,
        segmentPath: segFileName,  // relative to mediaDir (embedding-queue resolves from there)
      })
    }

    logger.info({ fileName, segments: persistedSegments.length, duration }, '[AUDIO] Temporal split complete')

    return chunkAudio({
      transcription,
      durationSeconds: duration,
      mimeType: resolvedMime,
      sourceFile: fileName,
      segments: persistedSegments,
      docMeta: audioResult.metadata as Record<string, unknown>,
    })
  }

  /**
   * Route video: Gemini multimodal description + temporal splitting para knowledge embedding.
   * Si duración > VIDEO_THRESHOLD_SECONDS → split + chunkVideo con contentType='video_frames'.
   * Si ≤ threshold → 1 chunk.
   */
  private async routeVideo(
    buffer: Buffer,
    fileName: string,
    mimeType: string,
    hashPrefix: string,
    mediaDir: string,
    opts?: {
      transcription?: string
      transcriptSegments?: Array<{ text: string; offset: number; duration?: number }>
    },
  ): Promise<EmbeddableChunk[]> {
    const { extractVideo, describeVideo } = await import('../../extractors/video.js')

    const videoResult = await extractVideo(buffer, fileName, mimeType)
    const duration = videoResult.durationSeconds ?? 0
    const resolvedMime = videoResult.mimeType

    // Gemini multimodal description
    const enriched = await describeVideo(videoResult, this.registry)
    const description = enriched.llmEnrichment?.description ?? null

    const transcription = opts?.transcription ?? null
    const transcriptSegments = opts?.transcriptSegments

    if (duration <= VIDEO_THRESHOLD_SECONDS) {
      // Single chunk — save original to mediaDir
      const videoFileName = `${hashPrefix}_${sanitizeFileName(fileName)}`
      await writeFile(join(mediaDir, videoFileName), buffer)
      return chunkVideo({
        description,
        transcription,
        transcriptSegments,
        durationSeconds: duration,
        mimeType: resolvedMime,
        sourceFile: fileName,
        filePath: videoFileName,
        docMeta: videoResult.metadata as Record<string, unknown>,
      })
    }

    // Temporal split — save segments to mediaDir
    const segments = await splitMediaFile(buffer, resolvedMime, duration, VIDEO_SPLIT_CONFIG)
    if (segments.length === 0) {
      const videoFileName = `${hashPrefix}_${sanitizeFileName(fileName)}`
      await writeFile(join(mediaDir, videoFileName), buffer)
      return chunkVideo({
        description,
        transcription,
        transcriptSegments,
        durationSeconds: duration,
        mimeType: resolvedMime,
        sourceFile: fileName,
        filePath: videoFileName,
        docMeta: videoResult.metadata as Record<string, unknown>,
      })
    }

    // Persist segments to mediaDir
    const ext = resolvedMime === 'video/mp4' ? 'mp4'
      : resolvedMime === 'video/webm' ? 'webm'
      : resolvedMime === 'video/quicktime' ? 'mov'
      : 'mp4'

    const persistedSegments: Array<{ startSeconds: number; endSeconds: number; segmentPath: string }> = []
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]!
      const segFileName = `${hashPrefix}_vseg${i}.${ext}`
      const segBuffer = await readFile(seg.segmentPath)
      await writeFile(join(mediaDir, segFileName), segBuffer)
      await unlink(seg.segmentPath).catch(() => {})
      persistedSegments.push({
        startSeconds: seg.startSeconds,
        endSeconds: seg.endSeconds,
        segmentPath: segFileName,
      })
    }

    logger.info({ fileName, segments: persistedSegments.length, duration }, '[VIDEO] Temporal split complete')

    return chunkVideo({
      description,
      transcription,
      transcriptSegments,
      durationSeconds: duration,
      mimeType: resolvedMime,
      sourceFile: fileName,
      segments: persistedSegments,
      docMeta: videoResult.metadata as Record<string, unknown>,
    })
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
