// LUNA — Module: knowledge — Extractor Registry
// Maps MIME types to extraction functions.

import type { Registry } from '../../../kernel/registry.js'
import type { ExtractedContent, ExtractorFn } from '../types.js'
import { extractMarkdown, extractPlainText, extractJSON } from './markdown.js'
import { extractPDF } from './pdf.js'
import { extractDocx } from './docx.js'
import { extractXlsx } from './xlsx.js'
import { extractImage } from './image.js'
import pino from 'pino'

const logger = pino({ name: 'knowledge:extractors' })

// ─── MIME type → extractor mapping ───────────

const BASIC_EXTRACTORS: Record<string, ExtractorFn> = {
  // Markdown
  'text/markdown': extractMarkdown,
  // Plain text
  'text/plain': extractPlainText,
  // JSON
  'application/json': extractJSON,
  // PDF
  'application/pdf': extractPDF,
  // Word documents
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': extractDocx,
  // Excel / CSV
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': extractXlsx,
  'application/vnd.ms-excel': extractXlsx,
  'text/csv': extractXlsx,
}

// Image types that require LLM vision
const IMAGE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
])

// Google Docs native types (for Drive sync)
export const GOOGLE_NATIVE_TYPES: Record<string, string> = {
  'application/vnd.google-apps.document': 'text/plain',     // export as text
  'application/vnd.google-apps.spreadsheet': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.google-apps.presentation': 'slides',     // special handling
}

// ─── Extension → MIME type fallback ──────────

const EXT_TO_MIME: Record<string, string> = {
  '.md': 'text/markdown',
  '.txt': 'text/plain',
  '.json': 'application/json',
  '.pdf': 'application/pdf',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.doc': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel',
  '.csv': 'text/csv',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}

/**
 * Resolve MIME type from file extension if not provided.
 */
export function resolveMimeType(fileName: string, providedMime?: string): string {
  if (providedMime && providedMime !== 'application/octet-stream') return providedMime
  const ext = fileName.substring(fileName.lastIndexOf('.')).toLowerCase()
  return EXT_TO_MIME[ext] ?? 'application/octet-stream'
}

/**
 * Check if a MIME type is supported for extraction.
 */
export function isSupportedMimeType(mimeType: string): boolean {
  return mimeType in BASIC_EXTRACTORS
    || IMAGE_TYPES.has(mimeType)
    || mimeType in GOOGLE_NATIVE_TYPES
}

/**
 * Get list of supported file extensions.
 */
export function getSupportedExtensions(): string[] {
  return Object.keys(EXT_TO_MIME)
}

/**
 * Extract content from a file buffer.
 * For images, requires registry for LLM vision access.
 */
export async function extractContent(
  input: Buffer,
  fileName: string,
  mimeType: string,
  registry?: Registry,
): Promise<ExtractedContent> {
  // Basic extractors (no external service needed)
  const basicExtractor = BASIC_EXTRACTORS[mimeType]
  if (basicExtractor) {
    try {
      return await basicExtractor(input, fileName)
    } catch (err) {
      logger.error({ fileName, mimeType, err }, 'Extraction failed, falling back to plain text')
      return extractPlainText(input, fileName)
    }
  }

  // Image types (need LLM vision)
  if (IMAGE_TYPES.has(mimeType)) {
    if (!registry) {
      logger.warn({ fileName }, 'Registry not available for image extraction')
      return {
        text: `[Imagen: ${fileName}]`,
        sections: [{ title: fileName, content: `[Imagen sin procesar: ${fileName}]` }],
        metadata: { sizeBytes: input.length, originalName: fileName, extractorUsed: 'none' },
      }
    }
    return extractImage(input, fileName, registry)
  }

  // Unsupported type — try plain text as last resort
  logger.warn({ fileName, mimeType }, 'Unsupported MIME type, attempting plain text extraction')
  return extractPlainText(input, fileName)
}
