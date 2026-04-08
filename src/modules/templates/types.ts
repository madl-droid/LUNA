// LUNA — Module: templates — Types

export interface TemplateKey {
  key: string         // ej: "COMPANY_NAME"
  description: string // ej: "Nombre de la empresa cliente"
}

export type DocType = 'comparativo' | 'cotizacion' | 'presentacion' | 'otro'
export type MimeType = 'document' | 'spreadsheet' | 'presentation'
export type SharingMode = 'anyone_with_link' | 'requester_only'
export type DocStatus = 'created' | 'shared' | 'archived'
export type NoTemplateAction = 'warn' | 'block' | 'hitl'

export interface DocTemplate {
  id: string
  name: string
  description: string
  docType: DocType
  driveFileId: string
  mimeType: MimeType
  keys: TemplateKey[]
  folderPattern: string
  sharingMode: SharingMode
  enabled: boolean
  createdAt: Date
  updatedAt: Date
}

export interface DocGenerated {
  id: string
  templateId: string
  contactId: string | null
  requesterSenderId: string | null
  requesterChannel: string | null
  driveFileId: string
  driveFolderId: string | null
  webViewLink: string
  docName: string
  keyValues: Record<string, string>
  docType: DocType
  status: DocStatus
  tags: Record<string, string>
  version: number
  createdAt: Date
  updatedAt: Date
}

export interface CreateTemplateInput {
  name: string
  description?: string
  docType: DocType
  driveFileId: string
  mimeType: MimeType
  keys: TemplateKey[]
  folderPattern?: string
  sharingMode?: SharingMode
}

export interface UpdateTemplateInput {
  name?: string
  description?: string
  docType?: DocType
  keys?: TemplateKey[]
  folderPattern?: string
  sharingMode?: SharingMode
  enabled?: boolean
}

export interface CreateDocInput {
  templateId: string
  contactId?: string
  requesterSenderId?: string
  requesterChannel?: string
  keyValues: Record<string, string>
  tags?: Record<string, string>
  docName: string
}

export interface TemplatesConfig {
  TEMPLATES_STRICT_MODE: boolean
  TEMPLATES_NO_TEMPLATE_ACTION: string
  TEMPLATES_ROOT_FOLDER_ID: string
}
