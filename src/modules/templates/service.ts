// LUNA — Module: templates — Service
// Lógica de negocio para plantillas de documentos.

import pino from 'pino'
import type { Pool } from 'pg'
import type { Registry } from '../../kernel/registry.js'
import type { DriveService } from '../google-apps/drive-service.js'
import type { DocsService } from '../google-apps/docs-service.js'
import type { SlidesService } from '../google-apps/slides-service.js'
import type { SheetsService } from '../google-apps/sheets-service.js'
import type {
  DocTemplate,
  DocGenerated,
  CreateTemplateInput,
  UpdateTemplateInput,
  DocType,
  TemplateKey,
  MimeType,
  TemplatesConfig,
} from './types.js'
import * as repo from './repository.js'
import { FolderManager } from './folder-manager.js'

const logger = pino({ name: 'templates:service' })

const GOOGLE_MIME_MAP: Record<string, MimeType> = {
  'application/vnd.google-apps.document': 'document',
  'application/vnd.google-apps.spreadsheet': 'spreadsheet',
  'application/vnd.google-apps.presentation': 'presentation',
}

const KEY_REGEX = /\{([A-Z][A-Z0-9_]*)\}/g

export class TemplatesService {
  private folderManager: FolderManager | null = null

  constructor(
    private db: Pool,
    private registry: Registry,
    private config: TemplatesConfig,
  ) {}

  private getFolderManager(): FolderManager | null {
    if (!this.config.TEMPLATES_ROOT_FOLDER_ID) return null
    if (!this.folderManager) {
      const drive = this.registry.getOptional<DriveService>('google:drive')
      if (!drive) return null
      this.folderManager = new FolderManager(drive, this.config.TEMPLATES_ROOT_FOLDER_ID)
    }
    return this.folderManager
  }

  /** Call when root folder config changes to reset folder cache */
  invalidateFolderCache(): void {
    this.folderManager?.invalidateCache()
    this.folderManager = null
  }

  // ─── Template CRUD ───────────────────────────────────────────────────────

  async listTemplates(filters?: { docType?: DocType; enabled?: boolean }): Promise<DocTemplate[]> {
    return repo.listTemplates(this.db, filters)
  }

  async getTemplate(id: string): Promise<DocTemplate | null> {
    return repo.getTemplate(this.db, id)
  }

  async createTemplate(input: CreateTemplateInput): Promise<DocTemplate> {
    // Prevent duplicate Drive file registrations
    const existing = await repo.getTemplateByDriveId(this.db, input.driveFileId)
    if (existing) throw new Error(`Drive file ${input.driveFileId} is already registered as template "${existing.name}"`)
    return repo.createTemplate(this.db, input)
  }

  async updateTemplate(id: string, input: UpdateTemplateInput): Promise<DocTemplate | null> {
    return repo.updateTemplate(this.db, id, input)
  }

  async deleteTemplate(id: string): Promise<boolean> {
    return repo.deleteTemplate(this.db, id)
  }

  async getTemplatesByType(docType: DocType): Promise<DocTemplate[]> {
    return repo.getTemplatesByType(this.db, docType)
  }

  // ─── Key auto-detection ──────────────────────────────────────────────────

  /**
   * Reads a Google Drive file and extracts {KEY_NAME} placeholders.
   * Returns unique keys found (without descriptions — admin adds those later).
   * Also returns the detected mimeType for the file.
   */
  async scanKeysFromDrive(driveFileId: string): Promise<{ keys: TemplateKey[]; mimeType: MimeType }> {
    const driveService = this.registry.getOptional<DriveService>('google:drive')
    if (!driveService) throw new Error('Google Drive service not available')

    const file = await driveService.getFile(driveFileId)
    const mimeType = GOOGLE_MIME_MAP[file.mimeType]
    if (!mimeType) {
      throw new Error(
        `Unsupported file type: ${file.mimeType}. Must be a Google Doc, Sheet, or Presentation.`,
      )
    }

    const text = await this._extractFileText(driveFileId, mimeType)
    const keys = this._extractKeys(text)

    logger.info({ driveFileId, mimeType, keyCount: keys.length }, 'Scanned keys from Drive file')
    return { keys, mimeType }
  }

  private async _extractFileText(fileId: string, mimeType: MimeType): Promise<string> {
    switch (mimeType) {
      case 'document': {
        const docsService = this.registry.getOptional<DocsService>('google:docs')
        if (!docsService) throw new Error('Google Docs service not available')
        const doc = await docsService.getDocument(fileId)
        return doc.body
      }
      case 'presentation': {
        const slidesService = this.registry.getOptional<SlidesService>('google:slides')
        if (!slidesService) throw new Error('Google Slides service not available')
        return slidesService.getSlideText(fileId)
      }
      case 'spreadsheet': {
        const sheetsService = this.registry.getOptional<SheetsService>('google:sheets')
        if (!sheetsService) throw new Error('Google Sheets service not available')
        const range = await sheetsService.readRange(fileId, 'A1:Z1000')
        return range.values.map(row => row.join(' ')).join('\n')
      }
    }
  }

  private _extractKeys(text: string): TemplateKey[] {
    const found = new Set<string>()
    let match: RegExpExecArray | null
    KEY_REGEX.lastIndex = 0
    while ((match = KEY_REGEX.exec(text)) !== null) {
      if (match[1]) found.add(match[1])
    }
    return Array.from(found).map(key => ({ key, description: '' }))
  }

  // ─── Config helpers ──────────────────────────────────────────────────────

  isStrictMode(): boolean {
    return this.config.TEMPLATES_STRICT_MODE
  }

  getNoTemplateAction(): string {
    return this.config.TEMPLATES_NO_TEMPLATE_ACTION
  }

  getRootFolderId(): string {
    return this.config.TEMPLATES_ROOT_FOLDER_ID
  }

  // ─── Generated doc queries ───────────────────────────────────────────────

  async searchGeneratedDocs(query?: {
    templateId?: string
    docType?: string
    tags?: Record<string, string>
    contactId?: string
    status?: string
    limit?: number
  }): Promise<DocGenerated[]> {
    return repo.searchGenerated(this.db, query)
  }

  async getGeneratedDoc(id: string): Promise<DocGenerated | null> {
    return repo.getGenerated(this.db, id)
  }

  // ─── Document creation ───────────────────────────────────────────────────

  /**
   * Crea un documento desde una plantilla.
   * Flow: copy template → fill keys → move to folder → share → track in DB
   */
  async createDocument(input: {
    templateId: string
    keyValues: Record<string, string>
    contactId?: string
    requesterSenderId?: string
    requesterChannel?: string
    docName: string
    tags?: Record<string, string>
  }): Promise<DocGenerated> {
    const template = await repo.getTemplate(this.db, input.templateId)
    if (!template) throw new Error(`Template ${input.templateId} not found`)
    if (!template.enabled) throw new Error(`Template "${template.name}" is disabled`)

    // Validate all required keys have values
    const missingKeys = template.keys.filter(k => !(k.key in input.keyValues))
    if (missingKeys.length > 0) {
      const missing = missingKeys.map(k => `${k.key} (${k.description || 'sin descripción'})`).join(', ')
      throw new Error(`Faltan valores para los siguientes campos: ${missing}`)
    }

    const drive = this.registry.getOptional<DriveService>('google:drive')
    if (!drive) throw new Error('Google Drive service not available')

    // Resolve destination folder
    let folderId: string | undefined
    const fm = this.getFolderManager()
    if (fm) {
      if (template.folderPattern) {
        folderId = await fm.resolveFolder(template.folderPattern, input.keyValues)
      } else {
        folderId = this.config.TEMPLATES_ROOT_FOLDER_ID
      }
    }

    // Copy template file
    const copied = await drive.copyFile(template.driveFileId, input.docName, folderId)
    const newFileId = copied.id

    // Fill keys via batch edit
    await this._fillKeys(newFileId, template.mimeType, template.keys.map(k => k.key), input.keyValues)

    // Share with anyone
    await drive.shareFileAnyone(newFileId, 'reader')

    // Get webViewLink
    const fileInfo = await drive.getFile(newFileId)
    const webViewLink = fileInfo.webViewLink ?? `https://drive.google.com/file/d/${newFileId}/view`

    // Persist in DB
    const generated = await repo.createGenerated(this.db, {
      templateId: input.templateId,
      contactId: input.contactId,
      requesterSenderId: input.requesterSenderId,
      requesterChannel: input.requesterChannel,
      keyValues: input.keyValues,
      docName: input.docName,
      tags: input.tags,
      driveFileId: newFileId,
      driveFolderId: folderId,
      webViewLink,
    })

    logger.info({ templateId: input.templateId, docName: input.docName, newFileId }, 'Document created from template')
    return generated
  }

  /**
   * Re-edita un documento existente (in-place, mismo link).
   * Flow: replaceText para cada key cambiada → update DB → increment version
   */
  async reeditDocument(input: {
    generatedDocId: string
    updatedKeyValues: Record<string, string>
  }): Promise<DocGenerated> {
    const doc = await repo.getGenerated(this.db, input.generatedDocId)
    if (!doc) throw new Error(`Generated document ${input.generatedDocId} not found`)

    const template = await repo.getTemplate(this.db, doc.templateId)
    if (!template) throw new Error(`Template ${doc.templateId} not found`)

    // Calculate diff — only keys that actually changed
    const changedKeys = Object.entries(input.updatedKeyValues).filter(
      ([k, v]) => doc.keyValues[k] !== v,
    )

    if (changedKeys.length === 0) {
      // No changes
      return doc
    }

    const drive = this.registry.getOptional<DriveService>('google:drive')
    if (!drive) throw new Error('Google Drive service not available')

    // Conflict check: do any two changed keys share the same current value?
    const oldValues = changedKeys.map(([k]) => doc.keyValues[k]).filter(Boolean)
    const hasConflict = new Set(oldValues).size !== oldValues.length

    if (!hasConflict) {
      // Normal path: replace each old value with new value in the document
      await this._replaceKeys(doc.driveFileId, template.mimeType, changedKeys.map(([k, v]) => ({
        key: k,
        oldValue: doc.keyValues[k] ?? `{${k}}`,
        newValue: v,
      })))
    } else {
      // Conflict: two different changed keys share the same current value in the document.
      // In-place replaceText would be ambiguous, and Office export/re-upload corrupts Google Workspace files.
      // Best approach: fail fast with descriptive error — let the agent create a new document instead.
      const conflictingKeys = changedKeys.map(([k]) => k).join(', ')
      logger.warn({ docId: input.generatedDocId, conflictingKeys }, 'Key conflict detected — cannot re-edit in-place')
      throw new Error(
        `No se puede re-editar este documento en su lugar: los campos [${conflictingKeys}] comparten el mismo valor actual en el documento. ` +
        `Crea un documento nuevo con create-from-template usando los valores actualizados.`,
      )
    }

    // Merge key values
    const mergedKeyValues = { ...doc.keyValues, ...input.updatedKeyValues }

    // Update DB
    const updated = await repo.updateGenerated(this.db, input.generatedDocId, {
      keyValues: mergedKeyValues,
      version: doc.version + 1,
    })

    logger.info({ docId: input.generatedDocId, version: doc.version + 1, updatedKeys: changedKeys.map(([k]) => k) }, 'Document re-edited')
    return updated!
  }

  /**
   * Busca documentos generados existentes.
   */
  async findExistingDocument(query: {
    docType?: DocType
    tags?: Record<string, string>
    contactId?: string
    docNameQuery?: string
  }): Promise<DocGenerated[]> {
    const results = await repo.searchGenerated(this.db, {
      docType: query.docType,
      tags: query.tags,
      contactId: query.contactId,
    })

    if (query.docNameQuery) {
      const q = query.docNameQuery.toLowerCase()
      return results.filter(d => d.docName.toLowerCase().includes(q))
    }

    return results
  }

  // ─── Prompt catalog ──────────────────────────────────────────────────────

  /**
   * Retorna texto formateado con el catálogo de plantillas activas para inyectar en el prompt.
   */
  async getCatalogForPrompt(): Promise<string> {
    const templates = await repo.listTemplates(this.db, { enabled: true })
    if (templates.length === 0) return ''

    const lines = templates.map(t => {
      const keyList = t.keys.length > 0
        ? t.keys.map(k => `${k.key}${k.description ? ': ' + k.description : ''}`).join(', ')
        : 'sin campos'
      return `- ${t.name} (tipo: ${t.docType}, formato: ${t.mimeType}): campos=[${keyList}]`
    })

    const strictNote = this.config.TEMPLATES_STRICT_MODE
      ? '\nREGLA: Solo puedes crear documentos usando las plantillas registradas. NO crees documentos sin plantilla.'
      : '\nPREFERENCIA: Cuando necesites crear un documento, verifica primero si hay una plantilla disponible.'

    return `## Plantillas de documentos disponibles\n${lines.join('\n')}\n\nUsa la herramienta create-from-template para crear documentos. SIEMPRE busca documentos existentes antes de crear uno nuevo (search-generated-documents).${strictNote}`
  }

  // ─── Internal helpers ────────────────────────────────────────────────────

  private async _fillKeys(
    fileId: string,
    mimeType: MimeType,
    keys: string[],
    keyValues: Record<string, string>,
  ): Promise<void> {
    const ops = keys.map(k => ({ key: k, oldValue: `{${k}}`, newValue: keyValues[k] ?? '' }))
    await this._replaceKeys(fileId, mimeType, ops)
  }

  private async _replaceKeys(
    fileId: string,
    mimeType: MimeType,
    replacements: Array<{ key: string; oldValue: string; newValue: string }>,
  ): Promise<void> {
    switch (mimeType) {
      case 'document': {
        const docsService = this.registry.getOptional<DocsService>('google:docs')
        if (!docsService) throw new Error('Google Docs service not available')
        await docsService.batchEdit(fileId, replacements.map(r => ({
          type: 'replace' as const,
          searchText: r.oldValue,
          text: r.newValue,
        })))
        break
      }
      case 'presentation': {
        const slidesService = this.registry.getOptional<SlidesService>('google:slides')
        if (!slidesService) throw new Error('Google Slides service not available')
        await slidesService.batchEdit(fileId, replacements.map(r => ({
          type: 'replace_text' as const,
          searchText: r.oldValue,
          replaceText: r.newValue,
        })))
        break
      }
      case 'spreadsheet': {
        const sheetsService = this.registry.getOptional<SheetsService>('google:sheets')
        if (!sheetsService) throw new Error('Google Sheets service not available')
        await sheetsService.batchEdit(fileId, replacements.map(r => ({
          type: 'find_replace' as const,
          find: r.oldValue,
          replacement: r.newValue,
          matchCase: true,
        })))
        break
      }
    }
  }

}
