// LUNA — Global Extractors — Types
// Tipos unificados para extracción de contenido de cualquier formato.
// Usado por: knowledge, engine/attachments, subagents, tools.

import type { Registry } from '../kernel/registry.js'

// ═══════════════════════════════════════════
// Imagen extraída (embebida en docs, PDF, web)
// ═══════════════════════════════════════════

export interface ExtractedImage {
  data: Buffer
  mimeType: string
  width?: number
  height?: number
  md5: string
  altText?: string
}

// ═══════════════════════════════════════════
// Sección extraída (genérica con imágenes opcionales)
// ═══════════════════════════════════════════

export interface ExtractedSection {
  title: string | null
  content: string
  page?: number
  images?: ExtractedImage[]
}

// ═══════════════════════════════════════════
// Metadata del documento
// ═══════════════════════════════════════════

export interface DocumentMetadata {
  pages?: number
  author?: string
  sizeBytes?: number
  driveModifiedTime?: string
  originalName?: string
  extractorUsed?: string
  isScanned?: boolean
  imagePages?: number[]
  [key: string]: unknown
}

// ═══════════════════════════════════════════
// Resultado principal de extracción de texto
// (docs, PDF, MD, TXT, JSON, web)
// ═══════════════════════════════════════════

export interface ExtractedContent {
  text: string
  sections: ExtractedSection[]
  metadata: DocumentMetadata
}

// ═══════════════════════════════════════════
// Resultado de extracción de hojas de cálculo
// ═══════════════════════════════════════════

export interface ExtractedSheet {
  name: string
  position: number
  headers: string[]
  rows: string[][]
}

export interface SheetsResult {
  kind: 'sheets'
  parentId: string
  fileName: string
  sheets: ExtractedSheet[]
  metadata: DocumentMetadata
}

// ═══════════════════════════════════════════
// Resultado de extracción de slides
// ═══════════════════════════════════════════

export interface ExtractedSlide {
  index: number
  title: string | null
  text: string
  screenshotPng: Buffer | null
}

export interface SlidesResult {
  kind: 'slides'
  fileName: string
  slides: ExtractedSlide[]
  metadata: DocumentMetadata
}

// ═══════════════════════════════════════════
// Resultado de extracción web
// ═══════════════════════════════════════════

export interface WebResult {
  kind: 'web'
  url: string
  title: string | null
  sections: ExtractedSection[]
  metadata: DocumentMetadata
}

// ═══════════════════════════════════════════
// Resultado de extracción YouTube
// ═══════════════════════════════════════════

export interface YouTubeHeader {
  title: string
  description: string
  tags: string[]
  publishedAt: string | null
  duration: number | null
  thumbnail: Buffer | null
  thumbnailMimeType?: string
}

export interface YouTubeTranscriptSection {
  title: string | null
  text: string
  startSeconds: number
  endSeconds: number
}

export interface YouTubeResult {
  kind: 'youtube'
  videoId: string
  header: YouTubeHeader
  sections: YouTubeTranscriptSection[]
  metadata: DocumentMetadata
}

// ═══════════════════════════════════════════
// Resultado de extracción de imagen
// ═══════════════════════════════════════════

export interface ImageResult {
  kind: 'image'
  buffer: Buffer
  mimeType: string
  width: number
  height: number
  md5: string
  accompanyingText: string
  position?: number
  totalInMessage?: number
  metadata: DocumentMetadata
}

// ═══════════════════════════════════════════
// Resultado de extracción de audio
// ═══════════════════════════════════════════

export interface AudioResult {
  kind: 'audio'
  buffer: Buffer
  format: string
  mimeType: string
  durationSeconds: number
  accompanyingText: string | null
  senderData?: { senderId: string; channel: string; receivedAt: Date }
  metadata: DocumentMetadata
}

// ═══════════════════════════════════════════
// Resultado de extracción de video
// ═══════════════════════════════════════════

export interface VideoResult {
  kind: 'video'
  buffer: Buffer
  format: string
  mimeType: string
  durationSeconds: number
  hasAudio: boolean
  accompanyingText: string | null
  senderData?: { senderId: string; channel: string; receivedAt: Date }
  metadata: DocumentMetadata
}

// ═══════════════════════════════════════════
// Unión discriminada de todos los resultados
// ═══════════════════════════════════════════

export type ExtractorResult =
  | (ExtractedContent & { kind: 'document' })
  | SheetsResult
  | SlidesResult
  | WebResult
  | YouTubeResult
  | ImageResult
  | AudioResult
  | VideoResult

// ═══════════════════════════════════════════
// Firma de función extractora
// ═══════════════════════════════════════════

export type ExtractorFn = (
  input: Buffer,
  fileName: string,
  registry?: Registry,
) => Promise<ExtractedContent>

// ═══════════════════════════════════════════
// Helper: convertir ExtractorResult → ExtractedContent
// Para backward compatibility con consumers existentes
// ═══════════════════════════════════════════

export function toExtractedContent(result: ExtractorResult): ExtractedContent {
  switch (result.kind) {
    case 'document':
      return { text: result.text, sections: result.sections, metadata: result.metadata }

    case 'sheets': {
      const lines: string[] = []
      for (const sheet of result.sheets) {
        lines.push(`[${sheet.name}]`)
        const headerLine = sheet.headers.join(' | ')
        lines.push(headerLine)
        for (const row of sheet.rows) {
          lines.push(row.join(' | '))
        }
        lines.push('')
      }
      const text = lines.join('\n')
      return {
        text,
        sections: result.sheets.map(s => ({
          title: s.name,
          content: [s.headers.join(' | '), ...s.rows.map(r => r.join(' | '))].join('\n'),
        })),
        metadata: result.metadata,
      }
    }

    case 'slides': {
      const text = result.slides.map(s => `[Slide ${s.index + 1}] ${s.title ?? ''}\n${s.text}`).join('\n\n')
      return {
        text,
        sections: result.slides.map(s => ({
          title: s.title ?? `Slide ${s.index + 1}`,
          content: s.text,
          page: s.index + 1,
        })),
        metadata: result.metadata,
      }
    }

    case 'web':
      return {
        text: result.sections.map(s => s.content).join('\n\n'),
        sections: result.sections,
        metadata: result.metadata,
      }

    case 'youtube': {
      const text = [
        `${result.header.title}\n${result.header.description}`,
        ...result.sections.map(s => s.text),
      ].join('\n\n')
      return {
        text,
        sections: result.sections.map(s => ({
          title: s.title,
          content: s.text,
        })),
        metadata: result.metadata,
      }
    }

    case 'image':
      return {
        text: result.accompanyingText,
        sections: [{ title: null, content: result.accompanyingText }],
        metadata: result.metadata,
      }

    case 'audio':
      return {
        text: result.accompanyingText ?? `[Audio: ${result.format}, ${result.durationSeconds}s]`,
        sections: [{ title: null, content: result.accompanyingText ?? '' }],
        metadata: result.metadata,
      }

    case 'video':
      return {
        text: result.accompanyingText ?? `[Video: ${result.format}, ${result.durationSeconds}s]`,
        sections: [{ title: null, content: result.accompanyingText ?? '' }],
        metadata: result.metadata,
      }
  }
}
