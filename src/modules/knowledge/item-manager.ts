// LUNA — Module: knowledge — Knowledge Item Manager
// Gestiona items de conocimiento basados en Google Sheets, Docs y Drive.
// Escaneo de tabs/columnas, carga de contenido, y generación de embeddings.

import pino from 'pino'
import type { Registry } from '../../kernel/registry.js'
import type { KnowledgePgStore } from './pg-store.js'
import type { KnowledgeCache } from './cache.js'
import type { KnowledgeManager } from './knowledge-manager.js'
import type { VectorizeWorker } from './vectorize-worker.js'
import type {
  KnowledgeItem,
  KnowledgeItemTab,
  KnowledgeSourceType,
  KnowledgeConfig,
} from './types.js'

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
  listFiles(options: { folderId?: string; mimeType?: string; pageSize?: number }): Promise<{
    files: Array<{ id: string; name: string; mimeType: string; webViewLink?: string }>
  }>
  getFile(fileId: string): Promise<{ id: string; name: string; mimeType: string; modifiedTime?: string; webViewLink?: string }>
  downloadFile(fileId: string): Promise<Buffer>
  exportFile(fileId: string, exportMimeType: string): Promise<string>
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
    private knowledgeManager: KnowledgeManager,
  ) {}

  setVectorizeWorker(worker: VectorizeWorker): void {
    this.vectorizeWorker = worker
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

    const id = await this.pgStore.insertItem({
      title: data.title,
      description: data.description,
      categoryId: data.categoryId,
      sourceType: extracted.type,
      sourceUrl: data.sourceUrl,
      sourceId: extracted.id,
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

    // Clean up associated chunks/documents
    await this.pgStore.deleteItemChunks(id)
    await this.pgStore.deleteItem(id)

    if (item.isCore) await this.cache.invalidate()
    logger.info({ id, title: item.title }, 'Item removed')
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
    } else if (item.sourceType === 'pdf') {
      // Single PDF → one tab
      tabNames = ['PDF']
    } else if (item.sourceType === 'youtube') {
      const apiKey = this.config.KNOWLEDGE_GOOGLE_AI_API_KEY
      const playlistMatch = YOUTUBE_PLAYLIST_REGEX.exec(item.sourceUrl)
      if (playlistMatch?.[1]) {
        // Direct playlist → list videos as tabs
        const videos = await this.listPlaylistVideos(playlistMatch[1], apiKey)
        tabNames = videos.map(v => v.title)
      } else {
        // Channel → list playlists as tabs (or uploads)
        const channelMatch = YOUTUBE_CHANNEL_REGEX.exec(item.sourceUrl)
        if (channelMatch && apiKey) {
          const handle = channelMatch[1] ?? channelMatch[2]!
          const playlists = await this.listChannelPlaylists(handle, apiKey)
          tabNames = playlists.map(p => p.title)
          if (tabNames.length === 0) tabNames = ['Uploads']
        } else {
          tabNames = ['Videos']
        }
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
    // Skip ignored tabs
    const tabs = allTabs.filter(t => !t.ignored)
    let totalChunks = 0

    for (const tab of tabs) {
      const range = `'${tab.tabName}'!A:ZZ`
      const data = await sheets.readRange(item.sourceId, range)

      if (!data.values || data.values.length < 2) continue

      const headers = data.values[0]!
      const rows = data.values.slice(1)

      // Determine which column indices to include (skip ignored columns)
      const tabColumns = tab.columns ?? await this.pgStore.getTabColumns(tab.id)
      const ignoredColNames = new Set(tabColumns.filter(c => c.ignored).map(c => c.columnName.trim()))

      // Build text content from rows
      const textParts: string[] = []
      for (const row of rows) {
        const parts: string[] = []
        for (let i = 0; i < headers.length; i++) {
          const header = headers[i]?.trim()
          const value = row[i]?.trim()
          if (header && value && !ignoredColNames.has(header)) {
            parts.push(`${header}: ${value}`)
          }
        }
        if (parts.length > 0) textParts.push(parts.join(' | '))
      }

      if (textParts.length === 0) continue

      // Create a document for this tab
      const content = textParts.join('\n')
      const buffer = Buffer.from(content, 'utf-8')
      const docTitle = `${item.title} — ${tab.tabName}`

      const doc = await this.knowledgeManager.addDocument(buffer, `${docTitle}.txt`, {
        sourceType: 'drive',
        sourceRef: item.id,
        description: tab.description || `Tab ${tab.tabName} de ${item.title}`,
        categoryIds: item.categoryId ? [item.categoryId] : [],
      })

      totalChunks += doc.chunkCount
    }

    return totalChunks
  }

  private async loadDocsContent(item: KnowledgeItem): Promise<number> {
    const docs = this.registry.getOptional<DocsService>('google:docs')
    if (!docs) throw new Error('Servicio Google Docs no disponible')

    const doc = await docs.getDocument(item.sourceId)
    if (!doc.body.trim()) return 0

    const buffer = Buffer.from(doc.body, 'utf-8')
    const result = await this.knowledgeManager.addDocument(buffer, `${doc.title}.txt`, {
      sourceType: 'drive',
      sourceRef: item.id,
      description: item.description || doc.title,
      categoryIds: item.categoryId ? [item.categoryId] : [],
    })

    return result.chunkCount
  }

  private async loadSlidesContent(item: KnowledgeItem): Promise<number> {
    const slides = this.registry.getOptional<SlidesService>('google:slides')
    if (!slides) throw new Error('Servicio Google Slides no disponible')

    const text = await slides.getSlideText(item.sourceId)
    if (!text.trim()) return 0

    const buffer = Buffer.from(text, 'utf-8')
    const result = await this.knowledgeManager.addDocument(buffer, `${item.title}.txt`, {
      sourceType: 'drive',
      sourceRef: item.id,
      description: item.description || item.title,
      categoryIds: item.categoryId ? [item.categoryId] : [],
    })
    logger.info({ itemId: item.id, title: item.title, chunks: result.chunkCount }, 'Slides content loaded')
    return result.chunkCount
  }

  private async loadDriveContent(item: KnowledgeItem): Promise<number> {
    const drive = this.registry.getOptional<DriveService>('google:drive')
    if (!drive) throw new Error('Servicio Google Drive no disponible')

    const allTabs = item.tabs ?? []
    const ignoredNames = new Set(allTabs.filter(t => t.ignored).map(t => t.tabName))

    const result = await drive.listFiles({ folderId: item.sourceId, pageSize: 100 })
    let totalChunks = 0

    for (const file of result.files) {
      if (ignoredNames.has(file.name)) {
        logger.debug({ name: file.name }, 'Drive file ignored')
        continue
      }

      try {
        const chunks = await this.loadDriveFile(file, item)
        totalChunks += chunks
      } catch (err) {
        logger.warn({ err, fileId: file.id, name: file.name }, 'Failed to load drive file, skipping')
      }
    }

    return totalChunks
  }

  /** Load a single file from Drive, dispatching by MIME type */
  private async loadDriveFile(
    file: { id: string; name: string; mimeType: string },
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
        const buf = Buffer.from(textParts.join('\n'), 'utf-8')
        const doc = await this.knowledgeManager.addDocument(buf, `${file.name} — ${sheet.title}.txt`, {
          sourceType: 'drive', sourceRef: item.id,
          description: `${file.name} — ${sheet.title}`,
          categoryIds: item.categoryId ? [item.categoryId] : [],
        })
        totalChunks += doc.chunkCount
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
      text = await drive.exportFile(file.id, 'text/csv')

    } else if (mime === 'application/vnd.google-apps.document') {
      text = await drive.exportFile(file.id, 'text/plain')

    } else if (mime === 'application/vnd.google-apps.presentation') {
      text = await drive.exportFile(file.id, 'text/plain')

    // ── Office formats uploaded to Drive (export via Drive API) ──
    } else if (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      || mime === 'application/msword') {
      text = await drive.exportFile(file.id, 'text/plain')

    } else if (mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      || mime === 'application/vnd.ms-excel') {
      text = await drive.exportFile(file.id, 'text/csv')

    } else if (mime === 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
      || mime === 'application/vnd.ms-powerpoint') {
      text = await drive.exportFile(file.id, 'text/plain')

    // ── PDF ──
    } else if (mime === 'application/pdf') {
      const buffer = await drive.downloadFile(file.id)
      text = await extractTextFromPdf(buffer)
      if (!text.trim()) {
        logger.warn({ fileId: file.id, name: file.name }, 'PDF has no extractable text (possibly scanned image)')
      }

    // ── Plain text / Markdown ──
    } else if (mime === 'text/plain' || mime === 'text/markdown' || mime === 'text/csv'
      || file.name.endsWith('.md') || file.name.endsWith('.txt') || file.name.endsWith('.csv')) {
      const buffer = await drive.downloadFile(file.id)
      text = buffer.toString('utf-8')

    // ── Unsupported format ──
    } else {
      logger.debug({ mime, name: file.name }, 'Unsupported MIME type in Drive, skipping')
      return 0
    }

    if (!text.trim()) return 0

    const buf = Buffer.from(text, 'utf-8')
    const doc = await this.knowledgeManager.addDocument(buf, `${fileName}.txt`, {
      sourceType: 'drive', sourceRef: item.id,
      description: fileName,
      categoryIds: item.categoryId ? [item.categoryId] : [],
    })
    return doc.chunkCount
  }

  /** Load a PDF from a direct URL or Drive file */
  private async loadPdfContent(item: KnowledgeItem): Promise<number> {
    let pdfBuffer: Buffer

    if (item.sourceUrl.startsWith('http') && !item.sourceUrl.includes('drive.google.com')) {
      // Direct PDF URL
      const res = await fetch(item.sourceUrl, { signal: AbortSignal.timeout(30000) })
      if (!res.ok) throw new Error(`Failed to fetch PDF: ${res.status}`)
      pdfBuffer = Buffer.from(await res.arrayBuffer())
    } else {
      // Drive file
      const drive = this.registry.getOptional<DriveService>('google:drive')
      if (!drive) throw new Error('Servicio Google Drive no disponible para descargar PDF')
      pdfBuffer = await drive.downloadFile(item.sourceId)
    }

    const text = await extractTextFromPdf(pdfBuffer)
    if (!text.trim()) {
      logger.warn({ itemId: item.id, title: item.title }, 'PDF has no extractable text')
      // Still create a document with a notice
      const notice = `[PDF sin texto extraíble — posiblemente escaneado como imagen: ${item.title}]`
      const buf = Buffer.from(notice, 'utf-8')
      const doc = await this.knowledgeManager.addDocument(buf, `${item.title}.txt`, {
        sourceType: 'drive', sourceRef: item.id,
        description: item.description,
        categoryIds: item.categoryId ? [item.categoryId] : [],
      })
      return doc.chunkCount
    }

    const buf = Buffer.from(text, 'utf-8')
    const doc = await this.knowledgeManager.addDocument(buf, `${item.title}.txt`, {
      sourceType: 'drive', sourceRef: item.id,
      description: item.description,
      categoryIds: item.categoryId ? [item.categoryId] : [],
    })
    return doc.chunkCount
  }

  /** YouTube: load transcripts for playlist or channel videos */
  private async loadYoutubeContent(item: KnowledgeItem): Promise<number> {
    const apiKey = this.config.KNOWLEDGE_GOOGLE_AI_API_KEY
    let videoIds: Array<{ id: string; title: string }> = []

    const allTabs = item.tabs ?? []
    const ignoredNames = new Set(allTabs.filter(t => t.ignored).map(t => t.tabName))

    // Determine if this is a playlist or channel
    const playlistMatch = YOUTUBE_PLAYLIST_REGEX.exec(item.sourceUrl)
    if (playlistMatch?.[1]) {
      // Direct playlist
      videoIds = await this.listPlaylistVideos(playlistMatch[1], apiKey)
    } else {
      // Channel — try to get uploads playlist
      const channelMatch = YOUTUBE_CHANNEL_REGEX.exec(item.sourceUrl)
      if (channelMatch) {
        const handle = channelMatch[1] ?? channelMatch[2]!
        const uploadsPlaylistId = await this.getChannelUploadsPlaylist(handle, apiKey)
        if (uploadsPlaylistId) {
          videoIds = await this.listPlaylistVideos(uploadsPlaylistId, apiKey)
        }
      }
    }

    logger.info({ itemId: item.id, videoCount: videoIds.length }, '[YT] Videos found')

    let totalChunks = 0
    for (const video of videoIds) {
      if (ignoredNames.has(video.title)) {
        logger.debug({ videoTitle: video.title }, '[YT] Video ignored')
        continue
      }
      try {
        const { fetchTranscript } = await import('youtube-transcript')
        const segments = await fetchTranscript(video.id, { lang: 'es' }).catch(() =>
          fetchTranscript(video.id).catch(() => []),
        )
        if (segments.length === 0) {
          logger.warn({ videoId: video.id, title: video.title }, '[YT] No transcript available')
          continue
        }
        const text = segments.map(s => s.text).join(' ')
        if (!text.trim()) continue

        const buf = Buffer.from(`${video.title}\n\n${text}`, 'utf-8')
        const doc = await this.knowledgeManager.addDocument(buf, `${video.title}.txt`, {
          sourceType: 'drive', sourceRef: item.id,
          description: `YouTube: ${video.title}`,
          categoryIds: item.categoryId ? [item.categoryId] : [],
        })
        totalChunks += doc.chunkCount
        logger.info({ videoId: video.id, title: video.title, chunks: doc.chunkCount }, '[YT] Video transcript embedded')
      } catch (err) {
        logger.warn({ err, videoId: video.id, title: video.title }, '[YT] Failed to get transcript')
      }
    }

    return totalChunks
  }

  /** List videos in a YouTube playlist via Data API v3 */
  private async listPlaylistVideos(playlistId: string, apiKey: string): Promise<Array<{ id: string; title: string }>> {
    if (!apiKey) { logger.warn('No Google API key for YouTube Data API'); return [] }
    const videos: Array<{ id: string; title: string }> = []
    let pageToken = ''
    for (let page = 0; page < 5; page++) {
      const url = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=50&playlistId=${encodeURIComponent(playlistId)}&key=${encodeURIComponent(apiKey)}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
      if (!res.ok) { logger.warn({ status: res.status }, '[YT] Playlist API error'); break }
      const data = await res.json() as { items?: Array<{ snippet?: { resourceId?: { videoId?: string }; title?: string } }>; nextPageToken?: string }
      for (const item of data.items ?? []) {
        const vid = item.snippet?.resourceId?.videoId
        const title = item.snippet?.title ?? 'Sin título'
        if (vid) videos.push({ id: vid, title })
      }
      if (!data.nextPageToken) break
      pageToken = data.nextPageToken
    }
    return videos
  }

  /** List playlists for a YouTube channel */
  private async listChannelPlaylists(handle: string, apiKey: string): Promise<Array<{ id: string; title: string }>> {
    if (!apiKey) return []
    // Get channel ID first
    const isHandle = !handle.startsWith('UC')
    const param = isHandle ? `forHandle=${encodeURIComponent(handle)}` : `id=${encodeURIComponent(handle)}`
    const chUrl = `https://www.googleapis.com/youtube/v3/channels?part=id&${param}&key=${encodeURIComponent(apiKey)}`
    const chRes = await fetch(chUrl, { signal: AbortSignal.timeout(10000) })
    if (!chRes.ok) return []
    const chData = await chRes.json() as { items?: Array<{ id?: string }> }
    const channelId = chData.items?.[0]?.id
    if (!channelId) return []

    const plUrl = `https://www.googleapis.com/youtube/v3/playlists?part=snippet&channelId=${encodeURIComponent(channelId)}&maxResults=50&key=${encodeURIComponent(apiKey)}`
    const plRes = await fetch(plUrl, { signal: AbortSignal.timeout(10000) })
    if (!plRes.ok) return []
    const plData = await plRes.json() as { items?: Array<{ id?: string; snippet?: { title?: string } }> }
    return (plData.items ?? []).map(p => ({ id: p.id ?? '', title: p.snippet?.title ?? '' })).filter(p => p.id)
  }

  /** Get the "uploads" playlist ID for a YouTube channel */
  private async getChannelUploadsPlaylist(handle: string, apiKey: string): Promise<string | null> {
    if (!apiKey) return null
    // Try by handle first, then by channel ID
    const isHandle = !handle.startsWith('UC')
    const param = isHandle ? `forHandle=${encodeURIComponent(handle)}` : `id=${encodeURIComponent(handle)}`
    const url = `https://www.googleapis.com/youtube/v3/channels?part=contentDetails&${param}&key=${encodeURIComponent(apiKey)}`
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) })
    if (!res.ok) { logger.warn({ status: res.status }, '[YT] Channel API error'); return null }
    const data = await res.json() as { items?: Array<{ contentDetails?: { relatedPlaylists?: { uploads?: string } } }> }
    return data.items?.[0]?.contentDetails?.relatedPlaylists?.uploads ?? null
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

// ═══════════════════════════════════════════
// PDF text extraction helper
// ═══════════════════════════════════════════

async function extractTextFromPdf(buffer: Buffer): Promise<string> {
  try {
    const { PDFParse } = await import('pdf-parse')
    const parser = new PDFParse({ data: new Uint8Array(buffer) })
    const result = await parser.getText()
    return result.text ?? ''
  } catch (err) {
    logger.warn({ err }, 'pdf-parse failed')
    return ''
  }
}
