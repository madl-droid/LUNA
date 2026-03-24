// LUNA — Module: attachments — Types
// Interfaces for cross-channel attachment processing.

export interface AttachmentInput {
  filename: string
  mimeType: string
  size: number
  /** Lazy loader — fetches the actual data on demand */
  getData: () => Promise<Buffer>
}

export interface ProcessedAttachment {
  filename: string
  mimeType: string
  size: number
  /** Human-readable summary of the attachment content */
  summary: string
  /** Full extracted text (for PDFs, docs, spreadsheets) */
  extractedText?: string
  /** Error message if processing failed */
  error?: string
}

export interface AttachmentProcessor {
  process(attachments: AttachmentInput[]): Promise<ProcessedAttachment[]>
  isSupported(mimeType: string): boolean
}

export interface AttachmentConfig {
  ATTACHMENT_MAX_SIZE_MB: number
  ATTACHMENT_PROCESS_IMAGES: boolean
  ATTACHMENT_PROCESS_PDFS: boolean
  ATTACHMENT_PROCESS_DOCUMENTS: boolean
  ATTACHMENT_PROCESS_SPREADSHEETS: boolean
  ATTACHMENT_SUMMARY_MAX_TOKENS: number
}
