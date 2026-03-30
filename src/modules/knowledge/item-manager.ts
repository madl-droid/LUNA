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
const DRIVE_FOLDER_REGEX = /\/folders\/([a-zA-Z0-9_-]+)/
const DRIVE_FILE_REGEX = /\/file\/d\/([a-zA-Z0-9_-]+)/

export function extractGoogleId(url: string): { id: string; type: KnowledgeSourceType } | null {
  let m = SHEETS_REGEX.exec(url)
  if (m?.[1]) return { id: m[1], type: 'sheets' }

  m = DOCS_REGEX.exec(url)
  if (m?.[1]) return { id: m[1], type: 'docs' }

  m = DRIVE_FOLDER_REGEX.exec(url)
  if (m?.[1]) return { id: m[1], type: 'drive' }

  m = DRIVE_FILE_REGEX.exec(url)
  if (m?.[1]) return { id: m[1], type: 'drive' }

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
  listFiles(options: { folderId?: string; pageSize?: number }): Promise<{
    files: Array<{ id: string; name: string; mimeType: string }>
  }>
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
    if (!extracted) throw new Error('URL no válida. Debe ser una URL de Google Sheets, Docs o Drive.')

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
        const result = await drive.listFiles({ folderId: item.sourceId, pageSize: 50 })
        tabNames = result.files.map(f => f.name)
      } else {
        throw new Error('Servicio Google Drive no disponible — requiere OAuth')
      }
    }

    // Preserve existing descriptions where tab names match
    const existingTabs = item.tabs ?? []
    const existingByName = new Map(existingTabs.map(t => [t.tabName, t]))

    const newTabs = tabNames.map((name, i) => ({
      tabName: name,
      description: existingByName.get(name)?.description ?? '',
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
    } else if (item.sourceType === 'drive') {
      totalChunks = await this.loadDriveContent(item)
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

  private async loadDriveContent(item: KnowledgeItem): Promise<number> {
    const drive = this.registry.getOptional<DriveService>('google:drive')
    if (!drive) throw new Error('Servicio Google Drive no disponible')

    const sheetsService = this.registry.getOptional<SheetsService>('google:sheets')
    const docsService = this.registry.getOptional<DocsService>('google:docs')

    const result = await drive.listFiles({ folderId: item.sourceId, pageSize: 50 })
    let totalChunks = 0

    for (const file of result.files) {
      if (file.mimeType === 'application/vnd.google-apps.spreadsheet' && sheetsService) {
        // Google Sheet — read all tabs
        const info = await sheetsService.getSpreadsheet(file.id)
        for (const sheet of info.sheets) {
          const range = `'${sheet.title}'!A:ZZ`
          const data = await sheetsService.readRange(file.id, range)

          if (!data.values || data.values.length < 2) continue

          const headers = data.values[0]!
          const rows = data.values.slice(1)
          const textParts: string[] = []
          for (const row of rows) {
            const parts: string[] = []
            for (let i = 0; i < headers.length; i++) {
              const header = headers[i]?.trim()
              const value = row[i]?.trim()
              if (header && value) parts.push(`${header}: ${value}`)
            }
            if (parts.length > 0) textParts.push(parts.join(' | '))
          }

          if (textParts.length === 0) continue

          const content = textParts.join('\n')
          const buffer = Buffer.from(content, 'utf-8')
          const doc = await this.knowledgeManager.addDocument(buffer, `${file.name} — ${sheet.title}.txt`, {
            sourceType: 'drive',
            sourceRef: item.id,
            description: `${file.name} — ${sheet.title}`,
            categoryIds: item.categoryId ? [item.categoryId] : [],
          })
          totalChunks += doc.chunkCount
        }
      } else if (file.mimeType === 'application/vnd.google-apps.document' && docsService) {
        // Google Doc
        const doc = await docsService.getDocument(file.id)
        if (!doc.body.trim()) continue
        const buffer = Buffer.from(doc.body, 'utf-8')
        const result = await this.knowledgeManager.addDocument(buffer, `${doc.title}.txt`, {
          sourceType: 'drive',
          sourceRef: item.id,
          description: doc.title,
          categoryIds: item.categoryId ? [item.categoryId] : [],
        })
        totalChunks += result.chunkCount
      }
    }

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
