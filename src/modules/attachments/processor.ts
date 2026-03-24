// LUNA — Module: attachments — Processor
// Extracts text/summaries from attachments using pdf-parse, mammoth, xlsx, and LLM vision.
// Cross-channel: used by Gmail, WhatsApp, Google Chat.

import pino from 'pino'
import type { Registry } from '../../kernel/registry.js'
import type { AttachmentInput, ProcessedAttachment, AttachmentConfig, AttachmentProcessor } from './types.js'

const logger = pino({ name: 'attachments' })

const PDF_TYPES = new Set(['application/pdf'])
const DOC_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
])
const SHEET_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
])
const IMAGE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
])

export class AttachmentProcessorImpl implements AttachmentProcessor {
  constructor(
    private config: AttachmentConfig,
    private registry: Registry,
  ) {}

  isSupported(mimeType: string): boolean {
    if (PDF_TYPES.has(mimeType) && this.config.ATTACHMENT_PROCESS_PDFS) return true
    if (DOC_TYPES.has(mimeType) && this.config.ATTACHMENT_PROCESS_DOCUMENTS) return true
    if (SHEET_TYPES.has(mimeType) && this.config.ATTACHMENT_PROCESS_SPREADSHEETS) return true
    if (IMAGE_TYPES.has(mimeType) && this.config.ATTACHMENT_PROCESS_IMAGES) return true
    return false
  }

  async process(attachments: AttachmentInput[]): Promise<ProcessedAttachment[]> {
    const results: ProcessedAttachment[] = []
    const maxBytes = this.config.ATTACHMENT_MAX_SIZE_MB * 1024 * 1024

    for (const att of attachments) {
      // Size check
      if (att.size > maxBytes) {
        results.push({
          filename: att.filename,
          mimeType: att.mimeType,
          size: att.size,
          summary: `[Adjunto demasiado grande: ${att.filename} (${(att.size / 1024 / 1024).toFixed(1)} MB)]`,
          error: 'Exceeds max size',
        })
        continue
      }

      // Type check
      if (!this.isSupported(att.mimeType)) {
        results.push({
          filename: att.filename,
          mimeType: att.mimeType,
          size: att.size,
          summary: `[Adjunto: ${att.filename} (${att.mimeType})]`,
        })
        continue
      }

      try {
        const data = await att.getData()
        const processed = await this.processOne(att.filename, att.mimeType, att.size, data)
        results.push(processed)
      } catch (err) {
        logger.error({ filename: att.filename, mimeType: att.mimeType, err }, 'Failed to process attachment')
        results.push({
          filename: att.filename,
          mimeType: att.mimeType,
          size: att.size,
          summary: `[Error procesando adjunto: ${att.filename}]`,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    return results
  }

  private async processOne(
    filename: string,
    mimeType: string,
    size: number,
    data: Buffer,
  ): Promise<ProcessedAttachment> {
    let extractedText = ''

    if (PDF_TYPES.has(mimeType)) {
      extractedText = await this.extractPdf(data)
    } else if (DOC_TYPES.has(mimeType)) {
      extractedText = await this.extractDocx(data)
    } else if (SHEET_TYPES.has(mimeType)) {
      extractedText = await this.extractSpreadsheet(data, mimeType)
    } else if (IMAGE_TYPES.has(mimeType)) {
      const description = await this.describeImage(data, mimeType, filename)
      return { filename, mimeType, size, summary: description }
    }

    // Truncate extracted text for summary
    const maxLen = this.config.ATTACHMENT_SUMMARY_MAX_TOKENS * 4 // rough chars-to-tokens
    const summary = extractedText.length > maxLen
      ? extractedText.slice(0, maxLen) + '...'
      : extractedText

    return {
      filename,
      mimeType,
      size,
      summary: summary ? `[Contenido de ${filename}]: ${summary}` : `[Adjunto: ${filename}]`,
      extractedText: extractedText || undefined,
    }
  }

  private async extractPdf(data: Buffer): Promise<string> {
    const pdfParse = (await import('pdf-parse')).default
    const result = await pdfParse(data)
    return result.text?.trim() ?? ''
  }

  private async extractDocx(data: Buffer): Promise<string> {
    const mammoth = await import('mammoth')
    const result = await mammoth.extractRawText({ buffer: data })
    return result.value?.trim() ?? ''
  }

  private async extractSpreadsheet(data: Buffer, mimeType: string): Promise<string> {
    if (mimeType === 'text/csv') {
      return data.toString('utf-8').trim()
    }
    const XLSX = await import('xlsx')
    const workbook = XLSX.read(data, { type: 'buffer' })
    const lines: string[] = []
    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName]
      if (!sheet) continue
      const csv = XLSX.utils.sheet_to_csv(sheet)
      lines.push(`[Hoja: ${sheetName}]\n${csv}`)
    }
    return lines.join('\n\n').trim()
  }

  private async describeImage(_data: Buffer, _mimeType: string, filename: string): Promise<string> {
    // LLM hook only supports text content — image vision requires direct API integration.
    // For now, return a descriptive placeholder. Full vision support requires extending LLMChatPayload.
    const sizeMB = (_data.length / 1024 / 1024).toFixed(1)
    return `[Imagen: ${filename} (${_mimeType}, ${sizeMB} MB)]`
  }
}
