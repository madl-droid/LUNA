// LUNA — Module: knowledge — Knowledge Item Manager
// Gestiona items de conocimiento basados en Google Sheets, Docs y Drive.
// Escaneo de tabs/columnas, carga de contenido, y generación de embeddings.

import pino from 'pino'
import type { Registry } from '../../kernel/registry.js'
import type { KnowledgePgStore } from './pg-store.js'
import type { KnowledgeCache } from './cache.js'
import type { KnowledgeManager } from './knowledge-manager.js'
import type { VectorizeWorker } from './vectorize-worker.js'
import { KNOWLEDGE_MEDIA_DIR } from './constants.js'
import { createHash } from 'node:crypto'
import { mkdir, writeFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  KnowledgeItem,
  KnowledgeItemTab,
  KnowledgeSourceType,
  KnowledgeConfig,
  SmartChunk,
  DriveFolderNode,
  FolderIndexEntry,
} from './types.js'
import {
  chunkDocs,
  chunkSheets,
  chunkPdf,
  chunkSlidesAsPdf,
  chunkYoutube,
  chunkWeb,
  chunkAudio,
  chunkVideo,
  linkChunks,
} from './extractors/smart-chunker.js'

import {
  parseYouTubeUrl,
  getVideoMeta,
  getTranscript,
  downloadThumbnail,
  downloadVideo,
  listPlaylistVideos,
  getChannelMeta,
} from '../../extractors/youtube-adapter.js'
import { parseYoutubeChapters } from '../../extractors/youtube.js'

const logger = pino({ name: 'knowledge:items' })

// Google resource ID extractors
const SHEETS_REGEX = /\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/
const DOCS_REGEX = /\/document\/d\/([a-zA-Z0-9_-]+)/
const SLIDES_REGEX = /\/presentation\/d\/([a-zA-Z0-9_-]+)/
const DRIVE_FOLDER_REGEX = /\/folders\/([a-zA-Z0-9_-]+)/
const DRIVE_FILE_REGEX = /\/file\/d\/([a-zA-Z0-9_-]+)/
const YOUTUBE_PLAYLIST_REGEX = /[?&]list=([a-zA-Z0-9_-]+)/
const YOUTUBE_CHANNEL_REGEX = /youtube\.com\/(?:@([a-zA-Z0-9_.-]+)|channel\/([a-zA-Z0-9_-]+))/
const DIRECT_PDF_REGEX = /^https?:\/\/.+\.pdf(\?.*)?$/i

/**
 * Extract resource ID and type from a URL.
 * Supports: Google Sheets, Docs, Slides, Drive folders/files, direct PDF links, YouTube.
 * Drive files are returned as 'drive' — caller should reclassify based on MIME type.
 */
export function extractGoogleId(url: string): { id: string; type: KnowledgeSourceType } | null {
  let m = SHEETS_REGEX.exec(url)
  if (m?.[1]) return { id: m[1], type: 'sheets' }

  m = DOCS_REGEX.exec(url)
  if (m?.[1]) return { id: m[1], type: 'docs' }

  m = SLIDES_REGEX.exec(url)
  if (m?.[1]) return { id: m[1], type: 'slides' }

  m = DRIVE_FOLDER_REGEX.exec(url)
  if (m?.[1]) return { id: m[1], type: 'drive' }

  m = DRIVE_FILE_REGEX.exec(url)
  if (m?.[1]) return { id: m[1], type: 'drive' } // reclassified on create based on MIME

  // YouTube playlist or channel
  m = YOUTUBE_PLAYLIST_REGEX.exec(url)
  if (m?.[1] && url.includes('youtube.com')) return { id: m[1], type: 'youtube' }
  m = YOUTUBE_CHANNEL_REGEX.exec(url)
  if (m?.[1] || m?.[2]) return { id: (m?.[1] ?? m?.[2])!, type: 'youtube' }

  // Direct PDF URL (any domain)
  if (DIRECT_PDF_REGEX.test(url)) return { id: url, type: 'pdf' }

  // Generic web URL (any http/https)
  if (/^https?:\/\/.+\..+/.test(url)) return { id: url, type: 'web' }

  return null
}

// Service type interfaces (from google-apps module via registry)
interface SheetsService {
  getSpreadsheet(spreadsheetId: string): Promise<{
    spreadsheetId: string
    title: string
    sheets: Array<{ sheetId: number; title: string; rowCount: number; columnCount: number }>
  }>
  readRange(spreadsheetId: string, range: string): Promise<{ values: string[][] }>
}

interface DocsService {
  getDocument(documentId: string): Promise<{
    documentId: string; title: string; body: string
    tabs?: Array<{ tabId: string; title: string; index: number }>
  }>
}

interface DriveService {
  listFiles(options: {
    folderId?: string; mimeType?: string; pageSize?: number
    pageToken?: string; orderBy?: string; fields?: string
  }): Promise<{
    files: Array<{ id: string; name: string; mimeType: string; webViewLink?: string; modifiedTime?: string }>
    nextPageToken?: string
  }>
  getFile(fileId: string): Promise<{ id: string; name: string; mimeType: string; modifiedTime?: string; webViewLink?: string }>
  downloadFile(fileId: string): Promise<Buffer>
  exportFile(fileId: string, exportMimeType: string): Promise<string | Buffer>
}

interface SlidesService {
  getSlideText(presentationId: string): Promise<string>
}

export class KnowledgeItemManager {
  private vectorizeWorker: VectorizeWorker | null = null

  constructor(
    private pgStore: KnowledgePgStore,
    private cache: KnowledgeCache,
    private config: KnowledgeConfig,
    private registry: Registry,
    _knowledgeManager: KnowledgeManager,  // kept for API compatibility
  ) {}

  setVectorizeWorker(worker: VectorizeWorker): void {
    this.vectorizeWorker = worker
  }

  // ─── Smart chunk persistence helper ─────────

  /**
   * Create a document record + insert smart linked chunks + enqueue vectorization.
   * Used by all v2 loaders instead of knowledgeManager.addDocument().
   */
  private async persistSmartChunks(
    item: KnowledgeItem,
    docTitle: string,
    mimeType: string,
    chunks: SmartChunk[],
    opts?: { buffer?: Buffer; description?: string; fileUrl?: string },
  ): Promise<number> {
    if (chunks.length === 0) return 0

    // Save file to disk if buffer provided (PDFs, etc.)
    let filePath: string | null = null
    let contentHash = ''
    if (opts?.buffer) {
      contentHash = createHash('sha256').update(opts.buffer).digest('hex')
      const knowledgeDir = KNOWLEDGE_MEDIA_DIR
      await mkdir(knowledgeDir, { recursive: true })
      const safeFileName = `${contentHash.substring(0, 12)}_${docTitle.replace(/[^a-zA-Z0-9._-]/g, '_').substring(0, 80)}`
      filePath = safeFileName
      await writeFile(join(knowledgeDir, safeFileName), opts.buffer)
    } else {
      contentHash = createHash('sha256').update(docTitle + (chunks[0]!.content ?? '').substring(0, 500)).digest('hex')
    }

    // Create document record — store fileUrl in metadata for shareable links
    const docId = await this.pgStore.insertDocument({
      title: docTitle,
      description: opts?.description ?? item.description ?? '',
      isCore: false,
      sourceType: 'drive',
      sourceRef: item.id,
      contentHash,
      filePath: filePath ?? '',
      mimeType,
      metadata: {
        chunkerVersion: 'smart-v2',
        chunkCount: chunks.length,
        ...(opts?.fileUrl ? { fileUrl: opts.fileUrl } : {}),
      },
    })

    // Link and insert chunks
    const linked = linkChunks(item.id, chunks)
    await this.pgStore.insertLinkedChunks(docId, linked)

    // Assign category
    if (item.categoryId) {
      await this.pgStore.assignDocumentCategory(docId, item.categoryId)
    }

    // Enqueue vectorization
    if (this.vectorizeWorker) {
      this.vectorizeWorker.enqueueDocument(docId).catch(err => {
        logger.warn({ err, docId }, 'Failed to enqueue vectorization')
      })
    }

    logger.info({
      docId, title: docTitle, chunkCount: linked.length,
      types: [...new Set(linked.map(c => c.contentType))],
    }, '[SMART-CHUNKS] Persisted')

    return linked.length
  }

  // ─── CRUD ───────────────────────────────────

  async create(data: {
    title: string
    description: string
    categoryId: string | null
    sourceUrl: string
  }): Promise<KnowledgeItem> {
    const extracted = extractGoogleId(data.sourceUrl)
    if (!extracted) throw new Error('URL no válida. Debe ser una URL de Google Sheets, Docs, Drive, PDF o YouTube.')

    // Reclassify Drive files based on actual MIME type (sheets/docs/pdf shared via drive.google.com/file/d/)
    if (extracted.type === 'drive' && DRIVE_FILE_REGEX.test(data.sourceUrl)) {
      const drive = this.registry.getOptional<DriveService>('google:drive')
      if (drive) {
        try {
          const meta = await drive.getFile(extracted.id)
          const mime = meta.mimeType
          if (mime === 'application/vnd.google-apps.spreadsheet') extracted.type = 'sheets'
          else if (mime === 'application/vnd.google-apps.document') extracted.type = 'docs'
          else if (mime === 'application/vnd.google-apps.presentation') extracted.type = 'slides'
          else if (mime === 'application/pdf') extracted.type = 'pdf'
          // Other files stay as 'drive' (single file mode)
          logger.info({ fileId: extracted.id, mime, resolvedType: extracted.type }, 'Drive file reclassified')
        } catch (err) {
          logger.warn({ err, fileId: extracted.id }, 'Could not resolve Drive file type, using generic drive')
        }
      }
    }

    // Check for existing item with same Google resource ID to prevent duplicates
    const existing = await this.pgStore.findItemBySourceId(extracted.id)
    if (existing) {
      // Update existing item instead of creating a duplicate
      await this.pgStore.updateItem(existing.id, {
        title: data.title,
        description: data.description,
        categoryId: data.categoryId,
      })
      logger.info({ id: existing.id, title: data.title }, 'Knowledge item already exists, updated instead')
      return (await this.pgStore.getItem(existing.id))!
    }

    // Auto-enable live query for Google API source types — access control is
    // handled by the Google resource's own sharing permissions
    const LIVE_QUERY_TYPES: KnowledgeSourceType[] = ['sheets', 'docs', 'slides', 'drive']
    const liveQueryEnabled = LIVE_QUERY_TYPES.includes(extracted.type)

    const id = await this.pgStore.insertItem({
      title: data.title,
      description: data.description,
      categoryId: data.categoryId,
      sourceType: extracted.type,
      sourceUrl: data.sourceUrl,
      sourceId: extracted.id,
      liveQueryEnabled,
    })

    // Invalidate injection cache so evaluator sees the new item
    await this.cache.invalidate()

    logger.info({ id, title: data.title, sourceType: extracted.type }, 'Knowledge item created')
    return (await this.pgStore.getItem(id))!
  }

  async list(): Promise<KnowledgeItem[]> {
    return this.pgStore.listItems()
  }

  async get(id: string): Promise<KnowledgeItem | null> {
    return this.pgStore.getItem(id)
  }

  async update(id: string, updates: {
    title?: string
    description?: string
    categoryId?: string | null
  }): Promise<void> {
    await this.pgStore.updateItem(id, updates)
    // Invalidate injection cache so evaluator sees updated title/description
    await this.cache.invalidate()
  }

  async toggleActive(id: string, active: boolean): Promise<void> {
    await this.pgStore.updateItem(id, { active })
    // Toggle searchability of this item's chunks
    await this.pgStore.setItemChunksSearchable(id, active)
    // Always invalidate: active items are now part of injection catalog
    await this.cache.invalidate()
    logger.info({ id, active }, 'Item active toggled')
  }

  async toggleCore(id: string, isCore: boolean): Promise<void> {
    if (isCore) {
      const coreCount = await this.pgStore.countCoreItems()
      const coreDocCount = await this.pgStore.getCoreDocumentCount()
      const totalCore = coreCount + coreDocCount
      if (totalCore >= this.config.KNOWLEDGE_MAX_CORE_DOCS) {
        throw new Error(`Límite de core alcanzado (max ${this.config.KNOWLEDGE_MAX_CORE_DOCS})`)
      }
    }
    await this.pgStore.updateItem(id, { isCore })
    await this.cache.invalidate()
    logger.info({ id, isCore }, 'Item core toggled')
  }

  async remove(id: string): Promise<void> {
    const item = await this.pgStore.getItem(id)
    if (!item) throw new Error('Item no encontrado')
    if (item.active) throw new Error('Debe desactivar el item antes de eliminarlo')

    // Delete files from disk before removing DB records
    try {
      const docs = await this.pgStore.getPool().query<{ file_path: string | null }>(
        `SELECT file_path FROM knowledge_documents WHERE source_ref = $1 AND file_path IS NOT NULL AND file_path != ''`,
        [id],
      )
      for (const doc of docs.rows) {
        if (doc.file_path) {
          await unlink(join(KNOWLEDGE_MEDIA_DIR, doc.file_path)).catch(() => {})
        }
      }
    } catch (err) {
      logger.warn({ err, id }, 'Failed to clean up files from disk (non-fatal)')
    }

    // Clean up associated chunks/documents from DB
    await this.pgStore.deleteItemChunks(id)
    await this.pgStore.deleteItem(id)

    await this.cache.invalidate()
    logger.info({ id, title: item.title }, 'Item removed (DB + disk)')
  }

  // ─── Scan Tabs ──────────────────────────────

  async scanTabs(id: string): Promise<KnowledgeItemTab[]> {
    const item = await this.pgStore.getItem(id)
    if (!item) throw new Error('Item no encontrado')
    logger.info({ id, sourceType: item.sourceType, sourceId: item.sourceId }, 'scanTabs starting')

    let tabNames: string[] = []

    if (item.sourceType === 'sheets') {
      const sheets = this.registry.getOptional<SheetsService>('google:sheets')
      logger.info({ hasOAuth: !!sheets }, 'Sheets service check')
      if (sheets) {
        try {
          const info = await sheets.getSpreadsheet(item.sourceId)
          tabNames = info.sheets.map(s => s.title)
          logger.info({ tabCount: tabNames.length, tabs: tabNames }, 'OAuth scan success')
        } catch (oauthErr) {
          logger.warn({ err: oauthErr }, 'OAuth Sheets scan failed, trying public API fallback')
          tabNames = await this.scanSheetsPublic(item.sourceId)
        }
      } else {
        // Fallback: use Google Sheets API v4 with API key (public sheets only)
        tabNames = await this.scanSheetsPublic(item.sourceId)
      }
    } else if (item.sourceType === 'docs') {
      const docs = this.registry.getOptional<DocsService>('google:docs')
      if (docs) {
        const doc = await docs.getDocument(item.sourceId)
        if (doc.tabs && doc.tabs.length > 0) {
          tabNames = doc.tabs.map(t => t.title || 'Sin título')
          logger.info({ tabCount: tabNames.length, tabs: tabNames }, 'Docs tabs scanned via OAuth')
        } else {
          // Fallback: document has no tabs or single default tab
          tabNames = [doc.title || 'Documento']
        }
      } else {
        tabNames = ['Documento']
      }
    } else if (item.sourceType === 'drive') {
      const drive = this.registry.getOptional<DriveService>('google:drive')
      if (drive) {
        const result = await drive.listFiles({ folderId: item.sourceId, pageSize: 100 })
        tabNames = result.files.map(f => f.name)
        logger.info({ fileCount: tabNames.length, files: tabNames.slice(0, 10) }, 'Drive folder files scanned')
      } else {
        throw new Error('Servicio Google Drive no disponible — requiere OAuth')
      }
    } else if (item.sourceType === 'slides') {
      // Google Slides → single tab (all slides as one document)
      tabNames = ['Presentación']
    } else if (item.sourceType === 'web') {
      tabNames = await this.scanWebTabs(item.sourceUrl)
    } else if (item.sourceType === 'pdf') {
      // Single PDF → one tab
      tabNames = ['PDF']
    } else if (item.sourceType === 'youtube') {
      const apiKey = this.config.KNOWLEDGE_GOOGLE_AI_API_KEY
      const parsed = parseYouTubeUrl(item.sourceUrl)
      if (parsed.type === 'playlist' && parsed.id) {
        const videos = await listPlaylistVideos(parsed.id, apiKey)
        tabNames = videos.map(v => v.title)
      } else if (parsed.type === 'channel' && parsed.id && apiKey) {
        try {
          const channelMeta = await getChannelMeta(parsed.id, apiKey)
          tabNames = channelMeta.playlists.map(p => p.title)
          if (tabNames.length === 0) tabNames = ['Uploads']
        } catch {
          tabNames = ['Videos']
        }
      } else {
        tabNames = ['Videos']
      }
    }

    // Preserve existing descriptions where tab names match
    const existingTabs = item.tabs ?? []
    const existingByName = new Map(existingTabs.map(t => [t.tabName, t]))

    const newTabs = tabNames.map((name, i) => ({
      tabName: name,
      description: existingByName.get(name)?.description ?? '',
      ignored: existingByName.get(name)?.ignored ?? false,
      position: i,
    }))

    await this.pgStore.replaceItemTabs(id, newTabs)

    logger.info({ id, tabCount: newTabs.length }, 'Tabs scanned')
    return (await this.pgStore.getItemTabs(id))
  }

  // ─── Scan Columns ───────────────────────────

  async scanColumns(tabId: string): Promise<void> {
    // Get tab info
    const tabRows = await this.pgStore.getTabColumns(tabId)
    // We need the item to know the source
    const tabRes = await this.pgStore.getPool().query<{ item_id: string; tab_name: string }>(
      `SELECT item_id, tab_name FROM knowledge_item_tabs WHERE id = $1`, [tabId],
    )
    const tabRow = tabRes.rows[0]
    if (!tabRow) throw new Error('Tab no encontrado')

    const item = await this.pgStore.getItem(tabRow.item_id)
    if (!item) throw new Error('Item no encontrado')

    let columnNames: string[] = []

    if (item.sourceType === 'sheets') {
      const sheets = this.registry.getOptional<SheetsService>('google:sheets')
      if (sheets) {
        const range = `'${tabRow.tab_name}'!1:1`
        const data = await sheets.readRange(item.sourceId, range)
        if (data.values?.[0]) {
          columnNames = data.values[0].filter(v => v.trim() !== '')
        }
      } else {
        // Fallback: use Google Sheets API v4 with API key (public sheets only)
        columnNames = await this.scanColumnsPublic(item.sourceId, tabRow.tab_name)
      }
    } else if (item.sourceType === 'docs') {
      // Docs don't have columns in the traditional sense
      columnNames = ['Contenido']
    } else if (item.sourceType === 'drive') {
      // For drive files, we can't scan columns without opening each file
      columnNames = ['Archivo']
    }

    // Preserve existing descriptions
    const existingByName = new Map((tabRows ?? []).map(c => [c.columnName, c]))

    const newCols = columnNames.map((name, i) => ({
      columnName: name,
      description: existingByName.get(name)?.description ?? '',
      ignored: existingByName.get(name)?.ignored ?? false,
      position: i,
    }))

    await this.pgStore.replaceTabColumns(tabId, newCols)
    logger.info({ tabId, columnCount: newCols.length }, 'Columns scanned')
  }

  // ─── Load Content & Embed ───────────────────

  async loadContent(id: string): Promise<{ chunks: number }> {
    const item = await this.pgStore.getItem(id)
    if (!item) throw new Error('Item no encontrado')

    // Clean previous chunks
    await this.pgStore.deleteItemChunks(id)

    let totalChunks = 0

    if (item.sourceType === 'sheets') {
      totalChunks = await this.loadSheetsContent(item)
    } else if (item.sourceType === 'docs') {
      totalChunks = await this.loadDocsContent(item)
    } else if (item.sourceType === 'slides') {
      totalChunks = await this.loadSlidesContent(item)
    } else if (item.sourceType === 'drive') {
      totalChunks = await this.loadDriveContent(item)
    } else if (item.sourceType === 'web') {
      totalChunks = await this.loadWebContent(item)
    } else if (item.sourceType === 'pdf') {
      totalChunks = await this.loadPdfContent(item)
    } else if (item.sourceType === 'youtube') {
      totalChunks = await this.loadYoutubeContent(item)
    }

    await this.pgStore.updateItem(id, {
      contentLoaded: true,
      embeddingStatus: 'pending',
      chunkCount: totalChunks,
    })

    // Trigger vectorization
    if (this.vectorizeWorker) {
      // Get all documents created for this item and enqueue each
      const docs = await this.pgStore.getPool().query<{ id: string }>(
        `SELECT id FROM knowledge_documents WHERE source_ref = $1`, [id],
      )
      for (const doc of docs.rows) {
        this.vectorizeWorker.enqueueDocument(doc.id).catch(err => {
          logger.warn({ err, docId: doc.id }, 'Failed to enqueue vectorization')
        })
      }
    }

    logger.info({ id, title: item.title, chunks: totalChunks }, 'Content loaded')
    return { chunks: totalChunks }
  }

  // ─── Private content loaders ────────────────

  private async loadSheetsContent(item: KnowledgeItem): Promise<number> {
    const sheets = this.registry.getOptional<SheetsService>('google:sheets')
    if (!sheets) throw new Error('Servicio Google Sheets no disponible')

    const allTabs = item.tabs ?? await this.pgStore.getItemTabs(item.id)
    const tabs = allTabs.filter(t => !t.ignored)
    let totalChunks = 0

    for (const tab of tabs) {
      const range = `'${tab.tabName}'!A:ZZ`
      const data = await sheets.readRange(item.sourceId, range)
      if (!data.values || data.values.length < 2) continue

      const rawHeaders = data.values[0]!
      const rawRows = data.values.slice(1)

      // Filter ignored columns
      const tabColumns = tab.columns ?? await this.pgStore.getTabColumns(tab.id)
      const ignoredColNames = new Set(tabColumns.filter(c => c.ignored).map(c => c.columnName.trim()))
      const colIndices = rawHeaders.map((h, i) => ({ h: h?.trim() ?? '', i })).filter(c => c.h && !ignoredColNames.has(c.h))
      const headers = colIndices.map(c => c.h)
      const rows = rawRows.map(row => colIndices.map(c => row[c.i]?.trim() ?? '')).filter(r => r.some(v => v))

      if (rows.length === 0) continue

      // Smart chunk: CSV with repeated headers
      const chunks = chunkSheets(headers, rows)
      const docTitle = `${item.title} — ${tab.tabName}`
      totalChunks += await this.persistSmartChunks(item, docTitle, 'text/csv', chunks, {
        description: tab.description || `Tab ${tab.tabName} de ${item.title}`,
        fileUrl: item.sourceUrl,
      })
    }

    return totalChunks
  }

  private async loadDocsContent(item: KnowledgeItem): Promise<number> {
    const docs = this.registry.getOptional<DocsService>('google:docs')
    if (!docs) throw new Error('Servicio Google Docs no disponible')

    const doc = await docs.getDocument(item.sourceId)
    if (!doc.body.trim()) return 0

    // Smart chunk: split by headings with word overlap
    const chunks = chunkDocs(doc.body)
    return this.persistSmartChunks(item, doc.title || item.title, 'text/plain', chunks, {
      fileUrl: item.sourceUrl,
    })
  }

  private async loadSlidesContent(item: KnowledgeItem): Promise<number> {
    const drive = this.registry.getOptional<DriveService>('google:drive')
    if (!drive) throw new Error('Servicio Google Drive no disponible para exportar Slides')

    // Exportar Google Slides como PDF via Drive API
    // drive.exportFile con 'application/pdf' retorna Buffer (según DriveService)
    let pdfBuffer: Buffer
    try {
      const exported = await drive.exportFile(item.sourceId, 'application/pdf')
      pdfBuffer = Buffer.isBuffer(exported) ? exported : Buffer.from(exported as string, 'binary')
      if (pdfBuffer.length < 100) throw new Error('PDF export empty')
    } catch (err) {
      logger.warn({ err, itemId: item.id }, '[SLIDES] PDF export failed, falling back to text-only')
      // Fallback: obtener texto via Slides API
      const slidesService = this.registry.getOptional<SlidesService>('google:slides')
      const slideText = slidesService ? await slidesService.getSlideText(item.sourceId) : ''
      if (!slideText.trim()) return 0
      const chunks = chunkDocs(slideText, { sourceFile: item.title, sourceType: 'slides' })
      return this.persistSmartChunks(item, item.title, 'text/plain', chunks, {
        fileUrl: item.sourceUrl,
      })
    }

    // Extraer texto por página para FTS
    const { extractPDF } = await import('../../extractors/pdf.js')
    const pdfResult = await extractPDF(pdfBuffer, `${item.title}.pdf`, this.registry)
    const pageTexts = pdfResult.sections.map(s => s.content)
    const totalPages = pageTexts.length || 1

    // Guardar PDF en media dir
    const contentHash = createHash('sha256').update(pdfBuffer).digest('hex')
    const knowledgeDir = KNOWLEDGE_MEDIA_DIR
    await mkdir(knowledgeDir, { recursive: true })
    const pdfName = `${contentHash.substring(0, 12)}_${item.title.replace(/[^a-zA-Z0-9._-]/g, '_').substring(0, 60)}.pdf`
    await writeFile(join(knowledgeDir, pdfName), pdfBuffer)

    // Chunk visual (pipeline PDF) — sin speaker notes (Google Slides API no las expone fácilmente)
    const chunks = chunkSlidesAsPdf(pageTexts, pdfName, totalPages, [], {
      sourceFile: item.title,
    })

    logger.info({ itemId: item.id, totalPages, chunkCount: chunks.length }, '[SLIDES] Visual pipeline via PDF export')

    return this.persistSmartChunks(item, item.title, 'application/vnd.google-apps.presentation', chunks, {
      buffer: pdfBuffer,
      description: item.description,
      fileUrl: item.sourceUrl,
    })
  }

  private async loadDriveContent(item: KnowledgeItem): Promise<number> {
    const drive = this.registry.getOptional<DriveService>('google:drive')
    if (!drive) throw new Error('Servicio Google Drive no disponible')

    const allTabs = item.tabs ?? []
    const ignoredNames = new Set(allTabs.filter(t => t.ignored).map(t => t.tabName))

    // ═══ Fase 1: Crawl completo (solo metadata — rápido) ═══
    const allNodes = await this.crawlDriveFolder(drive, item.sourceId, '', null, 0)

    // Filter ignored files
    const filteredNodes = allNodes.filter(n => !n.isFolder && !ignoredNames.has(n.name))
    const folderNodes = allNodes.filter(n => n.isFolder)

    logger.info({
      itemId: item.id, fileCount: filteredNodes.length, folderCount: folderNodes.length,
    }, '[DRIVE] Folder structure scanned')

    // Persist folder index (all nodes including folders)
    await this.pgStore.replaceFolderIndex(item.id, allNodes)

    // ═══ Fase 2: Procesar archivos nivel por nivel ═══
    const byDepth = new Map<number, DriveFolderNode[]>()
    for (const file of filteredNodes) {
      const depth = file.path.split('/').length - 1
      const list = byDepth.get(depth) ?? []
      list.push(file)
      byDepth.set(depth, list)
    }

    let totalChunks = 0
    const sortedDepths = [...byDepth.keys()].sort((a, b) => a - b)

    for (const depth of sortedDepths) {
      const levelFiles = byDepth.get(depth)!
      logger.info({ depth, fileCount: levelFiles.length }, '[DRIVE] Processing level')

      for (const node of levelFiles) {
        try {
          const fileObj = {
            id: node.id,
            name: node.name,
            mimeType: node.mimeType,
            webViewLink: node.webViewLink,
          }
          const chunks = await this.loadDriveFile(fileObj, item)
          totalChunks += chunks
          await this.pgStore.updateFolderIndexEntry(item.id, node.id, { status: 'processed' })
        } catch (err) {
          await this.pgStore.updateFolderIndexEntry(item.id, node.id, {
            status: 'error',
            errorMessage: (err as Error).message,
          })
          logger.warn({ err, fileId: node.id, name: node.name, path: node.path }, '[DRIVE] File failed')
        }
      }

      logger.info({ depth, totalChunks }, '[DRIVE] Level complete')
    }

    return totalChunks
  }

  /**
   * Crawl recursivo de una carpeta de Drive (solo metadata, sin descargar archivos).
   * Retorna todos los nodos (carpetas + archivos) con path relativo desde la raíz.
   */
  private async crawlDriveFolder(
    drive: DriveService,
    folderId: string,
    parentPath: string,
    parentId: string | null,
    depth: number,
  ): Promise<DriveFolderNode[]> {
    if (depth > 10) {
      logger.warn({ folderId, depth }, '[DRIVE] Max depth reached, stopping recursion')
      return []
    }

    const nodes: DriveFolderNode[] = []
    let pageToken: string | undefined

    do {
      const result = await drive.listFiles({
        folderId,
        pageSize: 100,
        pageToken,
        orderBy: 'folder,name',
        fields: 'nextPageToken, files(id, name, mimeType, modifiedTime, webViewLink, md5Checksum)',
      })

      for (const file of result.files) {
        const isFolder = file.mimeType === 'application/vnd.google-apps.folder'
        const path = parentPath ? `${parentPath}/${file.name}` : file.name

        nodes.push({
          id: file.id,
          name: file.name,
          mimeType: file.mimeType,
          path,
          parentId,
          isFolder,
          modifiedTime: file.modifiedTime,
          webViewLink: file.webViewLink,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          contentHash: (file as any).md5Checksum ?? undefined,
          status: 'pending',
        })

        // Recursión en subcarpetas
        if (isFolder) {
          const children = await this.crawlDriveFolder(drive, file.id, path, file.id, depth + 1)
          nodes.push(...children)
        }
      }

      pageToken = result.nextPageToken
    } while (pageToken)

    return nodes
  }

  /**
   * Sync incremental de carpeta: re-crawl + comparación con índice existente.
   * Retorna conteo de archivos añadidos, actualizados y eliminados.
   */
  async syncDriveFolder(item: KnowledgeItem): Promise<{ added: number; updated: number; deleted: number; chunks: number }> {
    const drive = this.registry.getOptional<DriveService>('google:drive')
    if (!drive) throw new Error('Servicio Google Drive no disponible')

    // 1. Re-crawl (solo metadata — rápido)
    const freshNodes = await this.crawlDriveFolder(drive, item.sourceId, '', null, 0)
    const freshFiles = freshNodes.filter(n => !n.isFolder)
    const freshMap = new Map(freshFiles.map(n => [n.id, n]))

    // 2. Cargar índice existente
    const existingEntries = await this.pgStore.getFolderIndex(item.id)
    const existingFiles = existingEntries.filter(e => !e.isFolder)
    const existingMap = new Map(existingFiles.map(e => [e.fileId, e]))

    let added = 0, updated = 0, deleted = 0, totalChunks = 0

    // Detectar archivos ignorados
    const allTabs = item.tabs ?? []
    const ignoredNames = new Set(allTabs.filter(t => t.ignored).map(t => t.tabName))

    // 3a. Nuevos y modificados
    for (const [fileId, freshNode] of freshMap) {
      if (ignoredNames.has(freshNode.name)) {
        freshNode.status = 'skipped'
        continue
      }

      const existing = existingMap.get(fileId)

      if (!existing) {
        freshNode.status = 'pending'
        added++
      } else if (hasFileChanged(existing, freshNode)) {
        // Archivo modificado — limpiar documento viejo si existe
        if (existing.documentId) {
          await this.pgStore.getPool().query(
            `DELETE FROM knowledge_chunks WHERE document_id = $1`, [existing.documentId],
          )
          await this.pgStore.getPool().query(
            `DELETE FROM knowledge_documents WHERE id = $1`, [existing.documentId],
          )
        }
        freshNode.status = 'pending'
        updated++
      } else {
        // Sin cambios — mantener estado existente
        freshNode.status = existing.status as DriveFolderNode['status']
        freshNode.documentId = existing.documentId
      }
    }

    // 3b. Detectar eliminados
    for (const [fileId, existing] of existingMap) {
      if (!freshMap.has(fileId)) {
        if (existing.documentId) {
          await this.pgStore.getPool().query(
            `DELETE FROM knowledge_chunks WHERE document_id = $1`, [existing.documentId],
          )
          await this.pgStore.getPool().query(
            `DELETE FROM knowledge_documents WHERE id = $1`, [existing.documentId],
          )
        }
        deleted++
      }
    }

    // 4. Reemplazar índice completo
    await this.pgStore.replaceFolderIndex(item.id, freshNodes)

    // 5. Procesar pendientes
    const pending = freshFiles.filter(n => n.status === 'pending')
    logger.info({
      itemId: item.id, added, updated, deleted, pending: pending.length,
    }, '[DRIVE] Sync diff computed')

    for (const node of pending) {
      try {
        const fileObj = {
          id: node.id,
          name: node.name,
          mimeType: node.mimeType,
          webViewLink: node.webViewLink,
        }
        const chunks = await this.loadDriveFile(fileObj, item)
        totalChunks += chunks
        await this.pgStore.updateFolderIndexEntry(item.id, node.id, { status: 'processed' })
      } catch (err) {
        await this.pgStore.updateFolderIndexEntry(item.id, node.id, {
          status: 'error',
          errorMessage: (err as Error).message,
        })
        logger.warn({ err, fileId: node.id, name: node.name }, '[DRIVE] Sync file failed')
      }
    }

    return { added, updated, deleted, chunks: totalChunks }
  }

  /** Load a single file from Drive, dispatching by MIME type */
  private async loadDriveFile(
    file: { id: string; name: string; mimeType: string; webViewLink?: string },
    item: KnowledgeItem,
  ): Promise<number> {
    const drive = this.registry.getOptional<DriveService>('google:drive')!
    const sheetsService = this.registry.getOptional<SheetsService>('google:sheets')
    const docsService = this.registry.getOptional<DocsService>('google:docs')
    const slidesService = this.registry.getOptional<SlidesService>('google:slides')

    const mime = file.mimeType
    let text = ''
    let fileName = file.name

    // ── Google Workspace native formats (use APIs) ──
    if (mime === 'application/vnd.google-apps.spreadsheet' && sheetsService) {
      const info = await sheetsService.getSpreadsheet(file.id)
      let totalChunks = 0
      for (const sheet of info.sheets) {
        const data = await sheetsService.readRange(file.id, `'${sheet.title}'!A:ZZ`)
        if (!data.values || data.values.length < 2) continue
        const headers = data.values[0]!
        const textParts: string[] = []
        for (const row of data.values.slice(1)) {
          const parts: string[] = []
          for (let i = 0; i < headers.length; i++) {
            const header = headers[i]?.trim()
            const value = row[i]?.trim()
            if (header && value) parts.push(`${header}: ${value}`)
          }
          if (parts.length > 0) textParts.push(parts.join(' | '))
        }
        if (textParts.length === 0) continue
        const chunks = chunkSheets(headers, data.values.slice(1).map(row =>
          headers.map((_, i) => row[i]?.trim() ?? ''),
        ).filter(r => r.some(v => v)))
        totalChunks += await this.persistSmartChunks(item, `${file.name} — ${sheet.title}`, 'text/csv', chunks, {
          description: `${file.name} — ${sheet.title}`,
          fileUrl: file.webViewLink,
        })
      }
      return totalChunks

    } else if (mime === 'application/vnd.google-apps.document' && docsService) {
      const doc = await docsService.getDocument(file.id)
      text = doc.body
      fileName = doc.title

    } else if (mime === 'application/vnd.google-apps.presentation' && slidesService) {
      text = await slidesService.getSlideText(file.id)

    } else if (mime === 'application/vnd.google-apps.spreadsheet') {
      // No Sheets service — export as CSV
      text = await drive.exportFile(file.id, 'text/csv') as string

    } else if (mime === 'application/vnd.google-apps.document') {
      text = await drive.exportFile(file.id, 'text/plain') as string

    } else if (mime === 'application/vnd.google-apps.presentation') {
      text = await drive.exportFile(file.id, 'text/plain') as string

    // ── Office formats uploaded to Drive (binaries + smart router) ──
    } else if (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      || mime === 'application/msword') {
      // DOCX: descargar binario → extractDocxSmart → visual o text
      const docxBuffer = await drive.downloadFile(file.id)
      const { extractDocxSmart } = await import('../../extractors/docx.js')
      const docxResult = await extractDocxSmart(docxBuffer, file.name)

      if (docxResult.pdfBuffer) {
        // VISUAL pipeline: DOCX con imágenes → PDF
        return this.persistVisualPdf(item, file, docxResult.pdfBuffer, mime)
      }
      // TEXT pipeline: DOCX sin imágenes
      text = docxResult.sections.map(s => {
        const heading = s.title ? `## ${s.title}\n` : ''
        return heading + s.content
      }).join('\n\n')
      if (!text.trim()) return 0
      const chunks = chunkDocs(text, { sourceFile: file.name, sourceType: 'docx', sourceMimeType: mime })
      return this.persistSmartChunks(item, fileName, mime, chunks, {
        description: fileName,
        fileUrl: file.webViewLink,
      })

    } else if (mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      || mime === 'application/vnd.ms-excel') {
      text = await drive.exportFile(file.id, 'text/csv') as string

    } else if (mime === 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
      || mime === 'application/vnd.ms-powerpoint') {
      // PPTX: descargar binario → extractPptx → visual o text
      const pptxBuffer = await drive.downloadFile(file.id)
      const { extractPptx } = await import('../../extractors/slides.js')
      const pptxResult = await extractPptx(pptxBuffer, file.name)

      if (pptxResult.pdfBuffer) {
        // VISUAL pipeline con speaker notes
        return this.persistVisualSlides(item, file, pptxResult.pdfBuffer, pptxResult.speakerNotes ?? [], mime)
      }
      // TEXT fallback
      text = pptxResult.slides.map(s => s.text).join('\n\n')
      if (!text.trim()) return 0
      const chunks = chunkDocs(text, { sourceFile: file.name, sourceType: 'slides', sourceMimeType: mime })
      return this.persistSmartChunks(item, fileName, mime, chunks, {
        description: fileName,
        fileUrl: file.webViewLink,
      })

    // ── PDF ──
    } else if (mime === 'application/pdf') {
      // PDF: descargar binario → chunkPdf (visual pipeline)
      const pdfBuffer = await drive.downloadFile(file.id)
      return this.persistVisualPdf(item, file, pdfBuffer, mime)

    // ── Plain text / Markdown ──
    } else if (mime === 'text/plain' || mime === 'text/markdown' || mime === 'text/csv'
      || file.name.endsWith('.md') || file.name.endsWith('.txt') || file.name.endsWith('.csv')) {
      const buffer = await drive.downloadFile(file.id)
      text = buffer.toString('utf-8')

    // ── Audio ──
    } else if (mime.startsWith('audio/')) {
      const audioBuffer = await drive.downloadFile(file.id)
      const contentHash = createHash('sha256').update(audioBuffer).digest('hex')
      const hashPrefix = contentHash.substring(0, 12)
      const knowledgeDir = KNOWLEDGE_MEDIA_DIR
      await mkdir(knowledgeDir, { recursive: true })

      const { extractAudio, transcribeAudioContent } = await import('../../extractors/audio.js')
      const { splitMediaFile, AUDIO_SPLIT_CONFIG } = await import('./extractors/temporal-splitter.js')

      const audioResult = await extractAudio(audioBuffer, file.name, mime)
      const duration = audioResult.durationSeconds ?? 0
      const enriched = await transcribeAudioContent(audioResult, this.registry)
      const transcription = enriched.llmEnrichment?.transcription ?? enriched.llmEnrichment?.description ?? null

      let audioChunks: import('./embedding-limits.js').EmbeddableChunk[]

      if (duration <= 60) {
        const audioFileName = `${hashPrefix}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
        await writeFile(join(knowledgeDir, audioFileName), audioBuffer)
        audioChunks = chunkAudio({ transcription, durationSeconds: duration, mimeType: mime, sourceFile: file.name, filePath: audioFileName })
      } else {
        const segs = await splitMediaFile(audioBuffer, mime, duration, AUDIO_SPLIT_CONFIG)
        const ext = mime.includes('mpeg') ? 'mp3' : mime.includes('ogg') ? 'ogg' : mime.includes('wav') ? 'wav' : 'mp3'
        const persistedSegs: Array<{ startSeconds: number; endSeconds: number; segmentPath: string }> = []
        for (let i = 0; i < segs.length; i++) {
          const seg = segs[i]!
          const segFile = `${hashPrefix}_aseg${i}.${ext}`
          const segBuf = await (await import('node:fs/promises')).readFile(seg.segmentPath)
          await writeFile(join(knowledgeDir, segFile), segBuf)
          await unlink(seg.segmentPath).catch(() => {})
          persistedSegs.push({ startSeconds: seg.startSeconds, endSeconds: seg.endSeconds, segmentPath: segFile })
        }
        audioChunks = chunkAudio({ transcription, durationSeconds: duration, mimeType: mime, sourceFile: file.name, segments: persistedSegs })
      }

      return this.persistSmartChunks(item, file.name, mime, audioChunks, {
        description: `Audio from Drive: ${file.name}`,
        fileUrl: file.webViewLink,
      })

    // ── Video ──
    } else if (mime.startsWith('video/')) {
      const videoBuffer = await drive.downloadFile(file.id)
      const contentHash = createHash('sha256').update(videoBuffer).digest('hex')
      const hashPrefix = contentHash.substring(0, 12)
      const knowledgeDir = KNOWLEDGE_MEDIA_DIR
      await mkdir(knowledgeDir, { recursive: true })

      const { extractVideo, describeVideo } = await import('../../extractors/video.js')
      const { splitMediaFile, VIDEO_SPLIT_CONFIG } = await import('./extractors/temporal-splitter.js')

      const videoResult = await extractVideo(videoBuffer, file.name, mime)
      const duration = videoResult.durationSeconds ?? 0
      const enriched = await describeVideo(videoResult, this.registry)
      const description = enriched.llmEnrichment?.description ?? null

      let videoChunks: import('./embedding-limits.js').EmbeddableChunk[]

      if (duration <= 50) {
        const videoFile = `${hashPrefix}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`
        await writeFile(join(knowledgeDir, videoFile), videoBuffer)
        videoChunks = chunkVideo({ description, transcription: null, durationSeconds: duration, mimeType: mime, sourceFile: file.name, sourceUrl: file.webViewLink, filePath: videoFile })
      } else {
        const segs = await splitMediaFile(videoBuffer, mime, duration, VIDEO_SPLIT_CONFIG)
        const persistedSegs: Array<{ startSeconds: number; endSeconds: number; segmentPath: string }> = []
        for (let i = 0; i < segs.length; i++) {
          const seg = segs[i]!
          const segFile = `${hashPrefix}_vseg${i}.mp4`
          const segBuf = await (await import('node:fs/promises')).readFile(seg.segmentPath)
          await writeFile(join(knowledgeDir, segFile), segBuf)
          await unlink(seg.segmentPath).catch(() => {})
          persistedSegs.push({ startSeconds: seg.startSeconds, endSeconds: seg.endSeconds, segmentPath: segFile })
        }
        videoChunks = chunkVideo({ description, transcription: null, durationSeconds: duration, mimeType: mime, sourceFile: file.name, sourceUrl: file.webViewLink, segments: persistedSegs })
      }

      return this.persistSmartChunks(item, file.name, mime, videoChunks, {
        description: `Video from Drive: ${file.name}`,
        fileUrl: file.webViewLink,
      })

    // ── Unsupported format ──
    } else {
      logger.debug({ mime, name: file.name }, 'Unsupported MIME type in Drive, skipping')
      return 0
    }

    if (!text.trim()) return 0

    // Use smart chunker for Drive files (text-only path)
    const chunks = chunkDocs(text, { sourceFile: file.name, sourceMimeType: mime })
    return this.persistSmartChunks(item, fileName, 'text/plain', chunks, {
      description: fileName,
      fileUrl: file.webViewLink,
    })
  }

  /** Load a PDF: extract per-page text (for FTS) + send raw PDF blocks (for multimodal embedding) */
  private async loadPdfContent(item: KnowledgeItem): Promise<number> {
    let pdfBuffer: Buffer

    if (item.sourceUrl.startsWith('http') && !item.sourceUrl.includes('drive.google.com')) {
      const res = await fetch(item.sourceUrl, { signal: AbortSignal.timeout(30000) })
      if (!res.ok) throw new Error(`Failed to fetch PDF: ${res.status}`)
      pdfBuffer = Buffer.from(await res.arrayBuffer())
    } else {
      const drive = this.registry.getOptional<DriveService>('google:drive')
      if (!drive) throw new Error('Servicio Google Drive no disponible para descargar PDF')
      pdfBuffer = await drive.downloadFile(item.sourceId)
    }

    // Extract per-page text for FTS content in each chunk
    const { PDFParse } = await import('pdf-parse')
    const parser = new PDFParse({ data: new Uint8Array(pdfBuffer) })
    const textResult = await parser.getText()
    const pageTexts = (textResult.pages ?? []).map(p => p.text ?? '')
    const totalPages = pageTexts.length || 1
    await parser.destroy().catch(() => {})

    // Save PDF to disk so vectorize worker can read it for multimodal embedding
    const contentHash = createHash('sha256').update(pdfBuffer).digest('hex')
    const knowledgeDir = KNOWLEDGE_MEDIA_DIR
    await mkdir(knowledgeDir, { recursive: true })
    const safeFileName = `${contentHash.substring(0, 12)}_${item.title.replace(/[^a-zA-Z0-9._-]/g, '_').substring(0, 60)}.pdf`
    await writeFile(join(knowledgeDir, safeFileName), pdfBuffer)

    // Smart chunk: 6-page blocks with 1-page overlap, ref to PDF file
    const chunks = chunkPdf(pageTexts, safeFileName, totalPages)
    logger.info({ itemId: item.id, totalPages, chunkCount: chunks.length }, '[PDF] Smart chunked')

    return this.persistSmartChunks(item, item.title, 'application/pdf', chunks, {
      buffer: pdfBuffer,
      description: item.description,
    })
  }

  // ─── Visual pipeline helpers (Drive files) ───

  /**
   * Persiste un PDF (de DOCX convertido o PDF descargado de Drive) via pipeline visual.
   * Extrae texto por página, guarda PDF en media dir, usa chunkPdf.
   */
  private async persistVisualPdf(
    item: KnowledgeItem,
    file: { id: string; name: string; mimeType: string; webViewLink?: string },
    pdfBuffer: Buffer,
    originalMime: string,
  ): Promise<number> {
    const { extractPDF } = await import('../../extractors/pdf.js')
    const pdfResult = await extractPDF(pdfBuffer, file.name, this.registry)
    const pageTexts = pdfResult.sections.map(s => s.content)
    const totalPages = pageTexts.length || 1

    const contentHash = createHash('sha256').update(pdfBuffer).digest('hex')
    const knowledgeDir = KNOWLEDGE_MEDIA_DIR
    await mkdir(knowledgeDir, { recursive: true })
    const pdfName = `${contentHash.substring(0, 12)}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_').substring(0, 60)}.pdf`
    await writeFile(join(knowledgeDir, pdfName), pdfBuffer)

    const chunks = chunkPdf(pageTexts, pdfName, totalPages, {
      sourceFile: file.name,
    })
    logger.info({ fileId: file.id, totalPages, chunkCount: chunks.length }, '[DRIVE-PDF] Visual pipeline')

    return this.persistSmartChunks(item, file.name, originalMime, chunks, {
      buffer: pdfBuffer,
      description: file.name,
      fileUrl: file.webViewLink,
    })
  }

  /**
   * Persiste slides PPTX de Drive (exportado a PDF) via pipeline visual con speaker notes.
   */
  private async persistVisualSlides(
    item: KnowledgeItem,
    file: { id: string; name: string; mimeType: string; webViewLink?: string },
    pdfBuffer: Buffer,
    speakerNotes: Array<{ slideIndex: number; text: string }>,
    originalMime: string,
  ): Promise<number> {
    const { extractPDF } = await import('../../extractors/pdf.js')
    const pdfResult = await extractPDF(pdfBuffer, file.name, this.registry)
    const pageTexts = pdfResult.sections.map(s => s.content)
    const totalPages = pageTexts.length || 1

    const contentHash = createHash('sha256').update(pdfBuffer).digest('hex')
    const knowledgeDir = KNOWLEDGE_MEDIA_DIR
    await mkdir(knowledgeDir, { recursive: true })
    const pdfName = `${contentHash.substring(0, 12)}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_').substring(0, 60)}.pdf`
    await writeFile(join(knowledgeDir, pdfName), pdfBuffer)

    const chunks = chunkSlidesAsPdf(pageTexts, pdfName, totalPages, speakerNotes, {
      sourceFile: file.name,
    })
    logger.info({ fileId: file.id, totalPages, speakerNotes: speakerNotes.length, chunkCount: chunks.length }, '[DRIVE-PPTX] Visual pipeline')

    return this.persistSmartChunks(item, file.name, originalMime, chunks, {
      buffer: pdfBuffer,
      description: file.name,
      fileUrl: file.webViewLink,
    })
  }

  // ─── Web URL helpers ─────────────────────────

  /**
   * Scan a web URL for "tabs":
   * - Root domain (no path or just /): fetch page, extract same-domain internal links → each = tab
   * - Specific page: single tab with page title
   */
  private async scanWebTabs(sourceUrl: string): Promise<string[]> {
    try {
      const parsed = new URL(sourceUrl)
      const isRoot = parsed.pathname === '/' || parsed.pathname === ''

      if (!isRoot) {
        // Specific page — one tab with page title
        const title = await this.fetchPageTitle(sourceUrl)
        return [title || parsed.pathname]
      }

      // Root domain — crawl first-level internal links
      const res = await fetch(sourceUrl, {
        signal: AbortSignal.timeout(15000),
        headers: { 'User-Agent': 'LUNA-KnowledgeBot/1.0' },
      })
      if (!res.ok) return [parsed.hostname]

      const html = await res.text()
      const { JSDOM } = await import('jsdom')
      const dom = new JSDOM(html, { url: sourceUrl })
      const doc = dom.window.document

      const links = new Set<string>()
      const anchors = doc.querySelectorAll('a[href]')
      for (const a of anchors) {
        try {
          const href = new URL(a.getAttribute('href')!, sourceUrl)
          // Same domain only, first-level paths (1 directory deep max)
          if (href.hostname !== parsed.hostname) continue
          if (href.pathname === '/' || href.pathname === '') continue
          const segments = href.pathname.split('/').filter(Boolean)
          if (segments.length > 2) continue // skip deep paths
          const clean = href.origin + href.pathname
          if (!links.has(clean)) links.add(clean)
        } catch { /* skip invalid URLs */ }
      }

      if (links.size === 0) return [parsed.hostname]
      const tabNames = Array.from(links).slice(0, 50) // max 50 tabs
      logger.info({ sourceUrl, linkCount: tabNames.length }, '[WEB] Root domain scanned')
      return tabNames
    } catch (err) {
      logger.warn({ err, sourceUrl }, '[WEB] Scan failed')
      return ['Página web']
    }
  }

  private async fetchPageTitle(url: string): Promise<string | null> {
    try {
      const res = await fetch(url, {
        signal: AbortSignal.timeout(10000),
        headers: { 'User-Agent': 'LUNA-KnowledgeBot/1.0' },
      })
      if (!res.ok) return null
      const html = await res.text()
      const match = /<title[^>]*>([^<]+)<\/title>/i.exec(html)
      return match?.[1]?.trim() ?? null
    } catch { return null }
  }

  /** Load web content — extract semantic blocks with associated images */
  private async loadWebContent(item: KnowledgeItem): Promise<number> {
    const allTabs = item.tabs ?? []
    const ignoredNames = new Set(allTabs.filter(t => t.ignored).map(t => t.tabName))

    const parsed = new URL(item.sourceUrl)
    const isRoot = parsed.pathname === '/' || parsed.pathname === ''

    let urls: string[]
    if (isRoot && allTabs.length > 0) {
      urls = allTabs.filter(t => !t.ignored).map(t => t.tabName)
      urls.unshift(item.sourceUrl)
    } else {
      urls = [item.sourceUrl]
    }

    let totalChunks = 0
    for (const url of urls) {
      if (ignoredNames.has(url)) continue
      try {
        const blocks = await this.extractWebBlocks(url)
        if (blocks.length === 0) continue

        const chunks = chunkWeb(blocks)
        const pageTitle = new URL(url).pathname || url
        totalChunks += await this.persistSmartChunks(item, pageTitle, 'text/html', chunks, {
          description: `Web: ${url}`,
        })
        logger.info({ url, blocks: blocks.length, chunks: chunks.length }, '[WEB] Page smart chunked')
      } catch (err) {
        logger.warn({ err, url }, '[WEB] Failed to extract page')
      }
    }

    return totalChunks
  }

  /** Extract semantic blocks (heading + content + images) from a web page */
  private async extractWebBlocks(url: string): Promise<import('./extractors/smart-chunker.js').WebBlock[]> {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(15000),
      headers: { 'User-Agent': 'LUNA-KnowledgeBot/1.0' },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)

    const html = await res.text()
    const { JSDOM } = await import('jsdom')
    const dom = new JSDOM(html, { url })
    const doc = dom.window.document

    // Remove scripts, styles, nav, footer, sidebar
    for (const tag of ['script', 'style', 'nav', 'footer', 'aside', 'header']) {
      doc.querySelectorAll(tag).forEach(el => el.remove())
    }

    const blocks: import('./extractors/smart-chunker.js').WebBlock[] = []
    const body = doc.body
    if (!body) return blocks

    // Split by headings (H1-H3) — each heading starts a new block
    let currentHeading: string | null = null
    let currentText = ''
    let currentImages: Array<{ data: string; mimeType: string }> = []

    const flushBlock = () => {
      if (currentText.trim()) {
        blocks.push({ text: currentText.trim(), heading: currentHeading, images: currentImages })
      }
      currentText = ''
      currentImages = []
    }

    const walkNode = (node: Node) => {
      if (node.nodeType === 1) { // Element
        const el = node as Element
        const tag = el.tagName.toLowerCase()

        if (['h1', 'h2', 'h3'].includes(tag)) {
          flushBlock()
          currentHeading = el.textContent?.trim() ?? null
          return
        }

        if (tag === 'img') {
          const src = el.getAttribute('src')
          const alt = el.getAttribute('alt') ?? ''
          const width = parseInt(el.getAttribute('width') ?? '0', 10)
          const height = parseInt(el.getAttribute('height') ?? '0', 10)

          // Filter decorative images
          if (!src) return
          if (alt === '') return
          if (/icon|logo|banner|avatar|spacer|pixel/i.test(src)) return
          if (width > 0 && width < 100 && height > 0 && height < 100) return

          // Include alt text as description (downloading images inline is too expensive for scanning)
          if (currentImages.length < 6) {
            try {
              new URL(src, url) // validate URL
              currentText += `\n[Imagen: ${alt}]\n`
            } catch { /* invalid URL */ }
          }
          return
        }

        if (['p', 'li', 'td', 'div', 'span', 'blockquote', 'pre', 'code'].includes(tag)) {
          const text = el.textContent?.trim()
          if (text) currentText += text + '\n'
          return
        }
      }

      // Walk children
      for (const child of Array.from(node.childNodes)) {
        walkNode(child)
      }
    }

    walkNode(body)
    flushBlock()

    // If no headings found, treat entire page as one block
    if (blocks.length === 0) {
      const text = body.textContent?.trim()
      if (text) blocks.push({ text, heading: null, images: [] })
    }

    return blocks
  }

  /**
   * YouTube: router unificado.
   * Detecta tipo (video / playlist / channel) y delega al sub-loader correspondiente.
   */
  private async loadYoutubeContent(item: KnowledgeItem): Promise<number> {
    const parsed = parseYouTubeUrl(item.sourceUrl)

    if (parsed.type === 'video' && parsed.id) {
      return this.loadYoutubeVideo(item, parsed.id)
    }

    if (parsed.type === 'playlist' && parsed.id) {
      return this.loadYoutubePlaylist(item, parsed.id)
    }

    if (parsed.type === 'channel' && parsed.id) {
      return this.loadYoutubeChannel(item, parsed.id)
    }

    logger.warn({ itemId: item.id, url: item.sourceUrl, type: parsed.type }, '[YT] Unknown YouTube URL type')
    return 0
  }

  /**
   * WP4: Escenario 2 — Video individual con transcript preciso + descarga mp4.
   */
  private async loadYoutubeVideo(item: KnowledgeItem, videoId: string): Promise<number> {
    const apiKey = this.config.KNOWLEDGE_GOOGLE_AI_API_KEY
    const mediaDir = KNOWLEDGE_MEDIA_DIR

    // 1. Metadata del video
    let meta: import('../../extractors/youtube-adapter.js').YouTubeVideoMeta | null = null
    if (apiKey) {
      try {
        meta = await getVideoMeta(videoId, apiKey)
      } catch (err) {
        logger.warn({ err, videoId }, '[YT-VIDEO] getVideoMeta failed, continuing')
      }
    }

    const title = meta?.title ?? `Video ${videoId}`
    const description = meta?.description ?? ''
    const videoUrl = meta?.url ?? `https://www.youtube.com/watch?v=${videoId}`

    // 2. Transcript
    const transcriptResult = await getTranscript(videoId, this.registry, { fallbackSTT: true })
    const segments = transcriptResult?.segments ?? []

    // 3. Descargar video mp4
    let videoBuffer: Buffer | null = null
    let videoMimeType = 'video/mp4'
    let downloadedPath: string | null = null

    try {
      const dl = await downloadVideo(videoId, mediaDir)
      const { readFile } = await import('node:fs/promises')
      videoBuffer = await readFile(dl.filePath)
      videoMimeType = dl.mimeType
      downloadedPath = dl.filePath
      logger.info({ videoId, sizeBytes: dl.sizeBytes }, '[YT-VIDEO] Downloaded mp4')
    } catch (err) {
      logger.warn({ err, videoId }, '[YT-VIDEO] yt-dlp download failed, falling back to text-only')
    }

    let totalChunks = 0

    if (videoBuffer) {
      // 4a. Pipeline video: extractVideo + describeVideo + temporal split + chunkVideo
      try {
        const { extractVideo, describeVideo } = await import('../../extractors/video.js')
        const videoResult = await extractVideo(videoBuffer, `${videoId}.mp4`, videoMimeType)
        const enriched = await describeVideo(videoResult, this.registry)
        const llmDescription = enriched.llmEnrichment?.description ?? null
        const duration = videoResult.durationSeconds ?? (meta?.duration ?? 0)

        const contentHash = createHash('sha256').update(videoBuffer).digest('hex')
        const hashPrefix = contentHash.substring(0, 12)

        // routeVideo from knowledge-manager handles temporal splitting
        // We replicate the logic here using KnowledgeManager's routeVideo indirectly
        // via the internal split + chunkVideo approach
        const { splitMediaFile, VIDEO_SPLIT_CONFIG } = await import('./extractors/temporal-splitter.js')
        const { chunkVideo: _chunkVideo } = await import('./extractors/smart-chunker.js')

        let videoChunks: import('./embedding-limits.js').EmbeddableChunk[]

        if (duration > 50) {
          const splitSegs = await splitMediaFile(videoBuffer, videoMimeType, duration, VIDEO_SPLIT_CONFIG)
          const persistedSegs: Array<{ startSeconds: number; endSeconds: number; segmentPath: string }> = []

          await mkdir(mediaDir, { recursive: true })
          for (let i = 0; i < splitSegs.length; i++) {
            const seg = splitSegs[i]!
            const segFile = `${hashPrefix}_vseg${i}.mp4`
            const segBuf = await (await import('node:fs/promises')).readFile(seg.segmentPath)
            await writeFile(join(mediaDir, segFile), segBuf)
            await unlink(seg.segmentPath).catch(() => {})
            persistedSegs.push({ startSeconds: seg.startSeconds, endSeconds: seg.endSeconds, segmentPath: segFile })
          }

          videoChunks = _chunkVideo({
            description: llmDescription,
            transcription: segments.length > 0 ? segments.map(s => s.text).join(' ') : null,
            transcriptSegments: segments.length > 0 ? segments : undefined,
            durationSeconds: duration,
            mimeType: videoMimeType,
            sourceFile: title,
            sourceUrl: videoUrl,
            segments: persistedSegs,
          })
        } else {
          // Video corto: 1 solo chunk
          const videoFile = `${hashPrefix}_${videoId}.mp4`
          await mkdir(mediaDir, { recursive: true })
          await writeFile(join(mediaDir, videoFile), videoBuffer)

          videoChunks = _chunkVideo({
            description: llmDescription,
            transcription: segments.length > 0 ? segments.map(s => s.text).join(' ') : null,
            transcriptSegments: segments.length > 0 ? segments : undefined,
            durationSeconds: duration,
            mimeType: videoMimeType,
            sourceFile: title,
            sourceUrl: videoUrl,
            filePath: videoFile,
          })
        }

        // Enriquecer metadata YouTube
        for (const chunk of videoChunks) {
          chunk.metadata = {
            ...chunk.metadata,
            sourceType: 'video',
            sourceUrl: videoUrl,
            videoId,
            channelTitle: meta?.channelTitle ?? null,
            publishedAt: meta?.publishedAt ?? null,
            tags: meta?.tags ?? [],
            topicCategories: meta?.topicCategories ?? [],
          }
        }

        totalChunks += await this.persistSmartChunks(item, title, videoMimeType, videoChunks, {
          description: `YouTube video: ${title}`,
        })

        // Limpiar binario descargado (ya fue partido en segmentos o persistido)
        if (downloadedPath) {
          await unlink(downloadedPath).catch(() => {})
        }
      } catch (err) {
        logger.warn({ err, videoId }, '[YT-VIDEO] Video pipeline failed, falling back to text')
        if (downloadedPath) await unlink(downloadedPath).catch(() => {})
        videoBuffer = null
      }
    }

    // 4b. Fallback text-only: chunkYoutube con transcript
    if (!videoBuffer) {
      if (segments.length === 0 && !description.trim()) {
        logger.warn({ videoId, title }, '[YT-VIDEO] No transcript + no description + no video, skipping')
        return 0
      }

      let thumbnailBase64: string | undefined
      if (meta?.thumbnailUrl) {
        const thumb = await downloadThumbnail(meta.thumbnailUrl)
        if (thumb) thumbnailBase64 = thumb.buffer.toString('base64')
      }

      const chapters = description ? parseYoutubeChapters(description) : null
      const chunks = chunkYoutube(
        { title, description, thumbnailBase64, url: videoUrl },
        segments,
        chapters,
      )

      // Enriquecer metadata
      for (const chunk of chunks) {
        chunk.metadata = {
          ...chunk.metadata,
          videoId,
          channelTitle: meta?.channelTitle ?? null,
          publishedAt: meta?.publishedAt ?? null,
          tags: meta?.tags ?? [],
          topicCategories: meta?.topicCategories ?? [],
          transcriptSource: transcriptResult?.source ?? null,
        }
      }

      totalChunks += await this.persistSmartChunks(item, title, 'text/plain', chunks, {
        description: `YouTube video: ${title}`,
      })
    }

    logger.info({ videoId, title, totalChunks }, '[YT-VIDEO] Video loaded')
    return totalChunks
  }

  /**
   * WP5: Escenario 3 — Playlist: preview 60s + transcript por cada video.
   */
  private async loadYoutubePlaylist(item: KnowledgeItem, playlistId: string): Promise<number> {
    const apiKey = this.config.KNOWLEDGE_GOOGLE_AI_API_KEY
    const mediaDir = KNOWLEDGE_MEDIA_DIR

    const allTabs = item.tabs ?? []
    const ignoredNames = new Set(allTabs.filter(t => t.ignored).map(t => t.tabName))

    const videos = await listPlaylistVideos(playlistId, apiKey)
    logger.info({ itemId: item.id, playlistId, videoCount: videos.length }, '[YT-PLAYLIST] Videos found')

    let totalChunks = 0

    for (const video of videos) {
      if (ignoredNames.has(video.title)) continue

      try {
        // 1. Transcript
        const transcriptResult = await getTranscript(video.videoId, this.registry, { fallbackSTT: true })
        const segments = transcriptResult?.segments ?? []

        if (segments.length === 0 && !video.description.trim()) {
          logger.warn({ videoId: video.videoId, title: video.title }, '[YT-PLAYLIST] No transcript + no description, skipping')
          continue
        }

        // 2. Thumbnail
        let thumbnailBase64: string | undefined
        if (video.thumbnailUrl) {
          const thumb = await downloadThumbnail(video.thumbnailUrl)
          if (thumb) thumbnailBase64 = thumb.buffer.toString('base64')
        }

        // 3. Chapters
        const chapters = video.description ? parseYoutubeChapters(video.description) : null

        // 4. Transcript chunks (audio contentType)
        const transcriptChunks = chunkYoutube(
          { title: video.title, description: video.description, thumbnailBase64, url: video.url },
          segments,
          chapters,
        )

        // Enriquecer metadata
        const playlistUrl = `https://www.youtube.com/playlist?list=${playlistId}`
        for (const chunk of transcriptChunks) {
          chunk.metadata = {
            ...chunk.metadata,
            videoId: video.videoId,
            channelTitle: video.channelTitle,
            publishedAt: video.publishedAt,
            tags: video.tags,
            playlistId,
            playlistUrl,
            transcriptSource: transcriptResult?.source ?? null,
          }
        }

        // 5. Preview video: descargar primeros 60s y agregar como chunk video_frames
        const videoChunks: import('./embedding-limits.js').EmbeddableChunk[] = []
        try {
          const dl = await downloadVideo(video.videoId, mediaDir)
          const { readFile: readFileFn } = await import('node:fs/promises')
          const videoBuf = await readFileFn(dl.filePath)

          const { extractVideo } = await import('../../extractors/video.js')
          const videoResult = await extractVideo(videoBuf, `${video.videoId}.mp4`, 'video/mp4')
          const duration = videoResult.durationSeconds ?? (video.duration ?? 0)

          // Solo primer segmento de 60s
          const { splitMediaFile: splitFn } = await import('./extractors/temporal-splitter.js')
          const previewConfig = { firstChunkSeconds: 60, subsequentSeconds: 0, overlapSeconds: 0 }
          const splitSegs = await splitFn(videoBuf, 'video/mp4', Math.min(duration, 60), previewConfig)

          const contentHash = createHash('sha256').update(videoBuf).digest('hex')
          const hashPrefix = contentHash.substring(0, 12)

          if (splitSegs.length > 0) {
            const seg = splitSegs[0]!
            const previewFile = `${hashPrefix}_preview.mp4`
            await mkdir(mediaDir, { recursive: true })
            const segBuf = await (await import('node:fs/promises')).readFile(seg.segmentPath)
            await writeFile(join(mediaDir, previewFile), segBuf)
            await unlink(seg.segmentPath).catch(() => {})

            videoChunks.push({
              content: `[Preview video 60s] ${video.title}`,
              contentType: 'video_frames',
              mediaRefs: [{ mimeType: 'video/mp4', filePath: previewFile }],
              chunkIndex: 0, chunkTotal: 0, prevChunkId: null, nextChunkId: null,
              metadata: {
                sourceType: 'video',
                sourceFile: video.title,
                sourceMimeType: 'video/mp4',
                sourceUrl: video.url,
                videoId: video.videoId,
                playlistId,
                playlistUrl,
                timestampStart: 0,
                timestampEnd: Math.min(duration, 60),
              },
            })
          }

          // Limpiar binario completo
          await unlink(dl.filePath).catch(() => {})
        } catch (err) {
          logger.debug({ err, videoId: video.videoId }, '[YT-PLAYLIST] Preview download failed (non-fatal)')
        }

        const allChunks = [...transcriptChunks, ...videoChunks]
        totalChunks += await this.persistSmartChunks(item, video.title, 'text/plain', allChunks, {
          description: `YouTube playlist video: ${video.title}`,
        })

        logger.info({
          videoId: video.videoId, title: video.title,
          transcriptChunks: transcriptChunks.length, videoChunks: videoChunks.length,
        }, '[YT-PLAYLIST] Video processed')
      } catch (err) {
        logger.warn({ err, videoId: video.videoId, title: video.title }, '[YT-PLAYLIST] Failed to process video')
      }
    }

    return totalChunks
  }

  /**
   * WP6: Escenario 4 — Canal: solo metadata + índice jerárquico de playlists.
   */
  private async loadYoutubeChannel(item: KnowledgeItem, handleOrId: string): Promise<number> {
    const apiKey = this.config.KNOWLEDGE_GOOGLE_AI_API_KEY

    let channelMeta: import('../../extractors/youtube-adapter.js').YouTubeChannelMeta | null = null
    try {
      channelMeta = await getChannelMeta(handleOrId, apiKey)
    } catch (err) {
      logger.warn({ err, handleOrId }, '[YT-CHANNEL] getChannelMeta failed')
      return 0
    }

    // Chunk 1: Header del canal
    const headerChunks: import('./embedding-limits.js').EmbeddableChunk[] = [{
      content: [
        `# Canal YouTube: ${channelMeta.title}`,
        channelMeta.description ? `\n${channelMeta.description}` : '',
        `\nURL: ${channelMeta.url}`,
        `\nPlaylists públicas: ${channelMeta.playlists.length}`,
      ].join('').trim(),
      contentType: 'text',
      mediaRefs: null,
      chunkIndex: 0, chunkTotal: 0, prevChunkId: null, nextChunkId: null,
      metadata: {
        sourceType: 'youtube',
        sourceUrl: channelMeta.url,
        sectionTitle: channelMeta.title,
        channelId: channelMeta.channelId,
        playlistCount: channelMeta.playlists.length,
      },
    }]

    // Chunks por playlist
    const playlistChunks: import('./embedding-limits.js').EmbeddableChunk[] = channelMeta.playlists.map(pl => ({
      content: [
        `## Playlist: ${pl.title}`,
        pl.description ? `\n${pl.description}` : '',
        `\nVideos: ${pl.videoCount}`,
        `\nURL: ${pl.url}`,
      ].join('').trim(),
      contentType: 'text' as const,
      mediaRefs: null,
      chunkIndex: 0, chunkTotal: 0, prevChunkId: null, nextChunkId: null,
      metadata: {
        sourceType: 'youtube',
        sourceUrl: pl.url,
        sectionTitle: pl.title,
        channelId: channelMeta!.channelId,
        playlistId: pl.playlistId,
        videoCount: pl.videoCount,
      },
    }))

    const allChunks = [...headerChunks, ...playlistChunks]
    const totalChunks = await this.persistSmartChunks(item, channelMeta.title, 'text/plain', allChunks, {
      description: `YouTube canal: ${channelMeta.title}`,
    })

    logger.info({
      channelId: channelMeta.channelId,
      title: channelMeta.title,
      playlists: channelMeta.playlists.length,
      totalChunks,
    }, '[YT-CHANNEL] Channel indexed')

    return totalChunks
  }

  // ─── Public API fallbacks (no OAuth needed) ──

  /** Scan sheet tabs using Google Sheets API v4 with API key (public sheets only) */
  private async scanSheetsPublic(spreadsheetId: string): Promise<string[]> {
    const apiKey = this.config.KNOWLEDGE_GOOGLE_AI_API_KEY
    if (!apiKey) throw new Error('No hay API key de Google configurada (KNOWLEDGE_GOOGLE_AI_API_KEY)')

    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}?fields=sheets.properties.title&key=${encodeURIComponent(apiKey)}`
    logger.info({ spreadsheetId }, 'Scanning sheets via public API (no OAuth)')

    const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      logger.warn({ status: res.status, body: body.substring(0, 200) }, 'Public Sheets API failed')
      if (res.status === 403 || res.status === 404) {
        throw new Error('No se puede acceder al documento. Verifica que este compartido como "Cualquier persona con el enlace".')
      }
      throw new Error(`Error al consultar Google Sheets API (${res.status})`)
    }

    const data = await res.json() as { sheets?: Array<{ properties?: { title?: string } }> }
    const names = (data.sheets ?? []).map(s => s.properties?.title ?? '').filter(Boolean)
    if (names.length === 0) throw new Error('No se encontraron hojas en el documento')

    logger.info({ spreadsheetId, count: names.length }, 'Sheets scanned via public API')
    return names
  }

  // ─── Drive folder index helpers ─────────────

  /**
   * Build a text tree view from folder index entries for the console/injection.
   */
  async buildFolderTreeText(itemId: string): Promise<string> {
    const entries = await this.pgStore.getFolderIndex(itemId)
    const sorted = entries.sort((a, b) => {
      if (a.isFolder !== b.isFolder) return a.isFolder ? -1 : 1
      return a.path.localeCompare(b.path)
    })

    const lines: string[] = []
    for (const entry of sorted) {
      const depth = entry.path.split('/').length - 1
      const indent = '  '.repeat(depth)
      const icon = entry.isFolder ? '📁' : '📄'
      const status = entry.isFolder
        ? ''
        : entry.status === 'processed'
          ? ' ✅'
          : entry.status === 'error'
            ? ' ❌'
            : ' ⏳'
      lines.push(`${indent}${icon} ${entry.name}${status}`)
    }
    return lines.join('\n')
  }

  /** Scan column headers using Google Sheets API v4 with API key (public sheets only) */
  private async scanColumnsPublic(spreadsheetId: string, tabName: string): Promise<string[]> {
    const apiKey = this.config.KNOWLEDGE_GOOGLE_AI_API_KEY
    if (!apiKey) throw new Error('No hay API key de Google configurada (KNOWLEDGE_GOOGLE_AI_API_KEY)')

    const range = encodeURIComponent(`'${tabName}'!1:1`)
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values/${range}?key=${encodeURIComponent(apiKey)}`
    logger.info({ spreadsheetId, tabName }, 'Scanning columns via public API (no OAuth)')

    const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      logger.warn({ status: res.status, body: body.substring(0, 200) }, 'Public Sheets API columns failed')
      throw new Error(`Error al leer columnas (${res.status})`)
    }

    const data = await res.json() as { values?: string[][] }
    const headers = (data.values?.[0] ?? []).filter(v => v.trim() !== '')
    logger.info({ spreadsheetId, tabName, count: headers.length }, 'Columns scanned via public API')
    return headers
  }
}

// ─── Module-level helpers ─────────────────────

/**
 * Detect if a Drive file has changed since the last crawl.
 * Uses md5Checksum for binary files, modifiedTime for Google-native formats.
 */
function hasFileChanged(existing: FolderIndexEntry, fresh: DriveFolderNode): boolean {
  if (fresh.contentHash && existing.contentHash) {
    return fresh.contentHash !== existing.contentHash
  }
  if (fresh.modifiedTime && existing.modifiedTime) {
    return new Date(fresh.modifiedTime).getTime() > new Date(existing.modifiedTime).getTime()
  }
  return true   // sin data para comparar → asumir que cambió (re-procesar es seguro)
}

