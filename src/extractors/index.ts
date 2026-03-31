// LUNA — Global Extractors — Registry
// Punto de entrada único para extracción de contenido.
// Cualquier módulo, agente o proceso que necesite extraer info usa este archivo.

import type { Registry } from '../kernel/registry.js'
import type { ExtractedContent } from './types.js'
import { resolveMimeType, GOOGLE_NATIVE_TYPES } from './utils.js'
import pino from 'pino'

const logger = pino({ name: 'extractors' })

// Re-export público
export { resolveMimeType, getSupportedExtensions, GOOGLE_NATIVE_TYPES } from './utils.js'
export type {
  ExtractedContent,
  ExtractedSection,
  ExtractorFn,
  ExtractorResult,
  ExtractedImage,
  ExtractedSheet,
  SheetsResult,
  ExtractedSlide,
  SlidesResult,
  WebResult,
  YouTubeResult,
  YouTubeHeader,
  YouTubeTranscriptSection,
  ImageResult,
  AudioResult,
  VideoResult,
  DocumentMetadata,
} from './types.js'
export { toExtractedContent } from './types.js'
export { extractSheets } from './sheets.js'
export { extractGoogleSlides, extractSlidesAsContent, isSlidesAvailable } from './slides.js'
export { extractImage, extractImageWithVision } from './image.js'
export { extractWeb, extractWebAsContent } from './web.js'
export { extractYouTube, parseYoutubeChapters, formatTimestamp } from './youtube.js'
export { extractVideo } from './video.js'
export { extractAudio } from './audio.js'

// ─── Extractores migrados ───────────────────
import { extractMarkdown, extractPlainText, extractJSON } from './text.js'
import { extractDocx } from './docx.js'
import { extractXlsx } from './sheets.js'
import { extractPDF } from './pdf.js'
import { extractImageWithVision } from './image.js'

// ─── Legacy fallback para extractores aún no migrados ────
async function legacyExtract(input: Buffer, fileName: string, mimeType: string, registry?: Registry): Promise<ExtractedContent> {
  const { extractContent: legacyExtractContent } = await import('../modules/knowledge/extractors/index.js')
  return legacyExtractContent(input, fileName, mimeType, registry)
}

// Mapa de extractores migrados por MIME type
const MIGRATED_EXTRACTORS: Record<string, (input: Buffer, fileName: string, registry?: Registry) => Promise<ExtractedContent>> = {
  'text/markdown': extractMarkdown,
  'text/plain': extractPlainText,
  'application/json': extractJSON,
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': extractDocx,
  'application/msword': extractDocx,
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': extractXlsx,
  'application/vnd.ms-excel': extractXlsx,
  'text/csv': extractXlsx,
  'application/vnd.oasis.opendocument.spreadsheet': extractXlsx,
  'application/pdf': extractPDF,
}

// ─── MIME types soportados ──────────────────

const TEXT_TYPES = new Set([
  'text/markdown',
  'text/plain',
  'application/json',
])

const DOCUMENT_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
])

const SHEET_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
  'application/vnd.oasis.opendocument.spreadsheet',
])

const PRESENTATION_TYPES = new Set([
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-powerpoint',
  'application/vnd.oasis.opendocument.presentation',
])

const IMAGE_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
])

const AUDIO_TYPES = new Set([
  'audio/mpeg',
  'audio/wav',
  'audio/aiff',
  'audio/aac',
  'audio/ogg',
  'audio/flac',
  'audio/opus',
  'audio/mp4',
  'audio/webm',
  'audio/ogg; codecs=opus',
])

const VIDEO_TYPES = new Set([
  'video/mp4',
  'video/quicktime',
  'video/x-msvideo',
  'video/webm',
  'video/x-ms-wmv',
  'video/3gpp',
  'video/mpeg',
  'video/x-flv',
])

/**
 * Verifica si un MIME type es soportado para extracción.
 */
export function isSupportedMimeType(mimeType: string): boolean {
  return TEXT_TYPES.has(mimeType)
    || DOCUMENT_TYPES.has(mimeType)
    || SHEET_TYPES.has(mimeType)
    || PRESENTATION_TYPES.has(mimeType)
    || IMAGE_TYPES.has(mimeType)
    || AUDIO_TYPES.has(mimeType)
    || VIDEO_TYPES.has(mimeType)
    || mimeType in GOOGLE_NATIVE_TYPES
}

/**
 * Clasifica un MIME type en su categoría.
 */
export function classifyMimeType(mimeType: string): 'text' | 'document' | 'sheets' | 'presentation' | 'image' | 'audio' | 'video' | 'unknown' {
  if (TEXT_TYPES.has(mimeType)) return 'text'
  if (DOCUMENT_TYPES.has(mimeType)) return 'document'
  if (SHEET_TYPES.has(mimeType)) return 'sheets'
  if (PRESENTATION_TYPES.has(mimeType)) return 'presentation'
  if (IMAGE_TYPES.has(mimeType)) return 'image'
  if (AUDIO_TYPES.has(mimeType)) return 'audio'
  if (VIDEO_TYPES.has(mimeType)) return 'video'
  return 'unknown'
}

// ═══════════════════════════════════════════
// Función principal de extracción
// ═══════════════════════════════════════════

/**
 * Extrae contenido de un archivo.
 * Punto de entrada global — usa esta función siempre.
 *
 * @param input - Buffer con el archivo
 * @param fileName - Nombre del archivo (para resolver MIME si no se provee)
 * @param mimeType - MIME type (opcional, se resuelve del nombre)
 * @param registry - Registry del kernel (necesario para LLM vision en imágenes/PDF)
 */
export async function extractContent(
  input: Buffer,
  fileName: string,
  mimeType?: string,
  registry?: Registry,
): Promise<ExtractedContent> {
  const resolvedMime = mimeType ?? resolveMimeType(fileName)

  try {
    // Imágenes: extractor especial (vision con LLM si hay registry)
    if (IMAGE_TYPES.has(resolvedMime)) {
      if (!registry) {
        return {
          text: `[Imagen: ${fileName}]`,
          sections: [{ title: fileName, content: `[Imagen sin procesar: ${fileName}]` }],
          metadata: { sizeBytes: input.length, originalName: fileName, extractorUsed: 'none' },
        }
      }
      return await extractImageWithVision(input, fileName, registry)
    }

    // Usar extractor migrado si existe, sino legacy
    const migrated = MIGRATED_EXTRACTORS[resolvedMime]
    if (migrated) {
      return await migrated(input, fileName, registry)
    }
    return await legacyExtract(input, fileName, resolvedMime, registry)
  } catch (err) {
    logger.error({ fileName, mimeType: resolvedMime, err }, 'Extraction failed, falling back to plain text')
    const text = input.toString('utf-8')
    return {
      text,
      sections: [{ title: null, content: text }],
      metadata: { sizeBytes: input.length, originalName: fileName, extractorUsed: 'fallback-plaintext' },
    }
  }
}
