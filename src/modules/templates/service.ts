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

const logger = pino({ name: 'templates:service' })

const GOOGLE_MIME_MAP: Record<string, MimeType> = {
  'application/vnd.google-apps.document': 'document',
  'application/vnd.google-apps.spreadsheet': 'spreadsheet',
  'application/vnd.google-apps.presentation': 'presentation',
}

const KEY_REGEX = /\{([A-Z][A-Z0-9_]*)\}/g

export class TemplatesService {
  constructor(
    private db: Pool,
    private registry: Registry,
    private config: TemplatesConfig,
  ) {}

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

  async searchGeneratedDocs(query: {
    docType?: string
    tags?: Record<string, string>
    contactId?: string
    limit?: number
  }): Promise<DocGenerated[]> {
    return repo.searchGenerated(this.db, query)
  }

  async getGeneratedDoc(id: string): Promise<DocGenerated | null> {
    return repo.getGenerated(this.db, id)
  }

  async listGeneratedDocs(filters?: {
    templateId?: string
    contactId?: string
    docType?: string
    status?: string
    tags?: Record<string, string>
  }): Promise<DocGenerated[]> {
    return repo.listGenerated(this.db, filters)
  }
}
