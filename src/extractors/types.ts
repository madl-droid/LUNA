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
  /** URL de origen — solo para imágenes web (no descargadas). data es Buffer vacío. */
  url?: string
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
  // Text metrics
  wordCount?: number
  lineCount?: number
  sectionCount?: number
  hasExplicitHeadings?: boolean
  // Image/visual metadata
  hasImages?: boolean
  imageCount?: number
  format?: string           // 'png', 'mp3', 'mp4', etc.
  width?: number
  height?: number
  md5?: string
  mimeType?: string
  // Audio/video metadata
  durationSeconds?: number
  hasAudio?: boolean
  wasConverted?: boolean
  // Web metadata
  domain?: string
  title?: string | null
  fetchedAt?: string
  imageUrls?: string[]
  // YouTube metadata
  videoId?: string
  duration?: number | null
  hasChapters?: boolean
  chapterCount?: number
  hasTranscript?: boolean
  hasThumbnail?: boolean
  // Sheets metadata
  sheetCount?: number
  totalRows?: number
  // Slides metadata
  slideCount?: number
  hasScreenshots?: boolean
  // Conversion flag
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
  /** CSV serializado para guardar como binario — generado por extractSheets() */
  csvBuffer?: Buffer
}

// ═══════════════════════════════════════════
// Resultado de extracción de slides
// ═══════════════════════════════════════════

export interface ExtractedSlide {
  index: number
  title: string | null
  text: string
  screenshotPng: Buffer | null
  /** Descripción LLM del screenshot — null si no procesado con vision */
  screenshotDescription?: string
}

export interface SlidesResult {
  kind: 'slides'
  fileName: string
  slides: ExtractedSlide[]
  /** Enriquecimiento LLM de screenshots — null si solo code-processed */
  llmEnrichment?: LLMEnrichment
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
  /** Descripción LLM del thumbnail — null si no procesado con vision */
  thumbnailDescription?: string
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
// Enriquecimiento LLM (segundo resultado)
// Generado por Gemini Vision/STT/Multimodal
// ═══════════════════════════════════════════

export interface LLMEnrichment {
  /** Descripción generada por LLM (vision para imágenes/video, STT para audio) */
  description: string
  /** Resumen en 1 línea — para metadata de chunks (dual description) */
  shortDescription?: string
  /** Transcripción de audio/video (STT) — solo si tiene audio */
  transcription?: string
  /** Provider que generó el enriquecimiento */
  provider: string
  /** Timestamp de generación */
  generatedAt: Date
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
  /** Descripción LLM (vision) — null si solo code-processed */
  llmEnrichment?: LLMEnrichment
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
  /** Transcripción LLM (STT) — null si solo code-processed */
  llmEnrichment?: LLMEnrichment
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
  /** Descripción + transcripción LLM (multimodal) — null si solo code-processed */
  llmEnrichment?: LLMEnrichment
  senderData?: { senderId: string; channel: string; receivedAt: Date }
  metadata: DocumentMetadata
}

// ═══════════════════════════════════════════
// Resultado de extracción de Google Drive
// ═══════════════════════════════════════════

export interface DriveFileEntry {
  id: string
  name: string
  mimeType: string
  driveType: 'document' | 'spreadsheet' | 'presentation' | 'folder' | 'file'
  suggestedTool: string
  isFolder?: boolean
  webViewLink?: string
}

export interface DriveResult {
  kind: 'drive'
  url: string
  fileId: string
  name: string
  mimeType: string
  driveType: 'document' | 'spreadsheet' | 'presentation' | 'folder' | 'file'
  suggestedTool: string
  hasAccess: boolean
  accountEmail: string | null
  folderContents?: DriveFileEntry[]
  modifiedTime?: string
  /** Content read from the file via API — null until enrichment */
  extractedContent: string | null
  /** LLM summary for large content */
  llmEnrichment?: LLMEnrichment
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
  | DriveResult

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
      const text = result.slides.map(s => {
        const parts = [`[Slide ${s.index + 1}] ${s.title ?? ''}`, s.text]
        if (s.screenshotDescription) parts.push(`[Descripción visual]: ${s.screenshotDescription}`)
        return parts.join('\n')
      }).join('\n\n')
      return {
        text,
        sections: result.slides.map(s => ({
          title: s.title ?? `Slide ${s.index + 1}`,
          content: s.screenshotDescription ? `${s.text}\n[Descripción visual]: ${s.screenshotDescription}` : s.text,
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

    case 'image': {
      // Prefer LLM description if available, fallback to accompanying text
      const imgText = result.llmEnrichment?.description ?? result.accompanyingText
      return {
        text: imgText,
        sections: [{ title: null, content: imgText }],
        metadata: result.metadata,
      }
    }

    case 'audio': {
      // Prefer LLM transcription if available
      const audioText = result.llmEnrichment?.transcription
        ?? result.llmEnrichment?.description
        ?? result.accompanyingText
        ?? `[Audio: ${result.format}, ${result.durationSeconds}s]`
      return {
        text: audioText,
        sections: [{ title: null, content: audioText }],
        metadata: result.metadata,
      }
    }

    case 'video': {
      // Combine LLM description + transcription if available
      const parts: string[] = []
      if (result.llmEnrichment?.description) parts.push(result.llmEnrichment.description)
      if (result.llmEnrichment?.transcription) parts.push(`[Transcripción]: ${result.llmEnrichment.transcription}`)
      const videoText = parts.length > 0
        ? parts.join('\n\n')
        : result.accompanyingText ?? `[Video: ${result.format}, ${result.durationSeconds}s]`
      return {
        text: videoText,
        sections: [{ title: null, content: videoText }],
        metadata: result.metadata,
      }
    }

    case 'drive': {
      // Use enriched content if available, otherwise metadata summary
      if (result.extractedContent) {
        const driveText = result.llmEnrichment?.description ?? result.extractedContent
        return {
          text: driveText,
          sections: [{ title: result.name, content: driveText }],
          metadata: result.metadata,
        }
      }
      // Metadata only (no content read yet)
      const folderInfo = result.folderContents
        ? `\nContenido: ${result.folderContents.map(f => f.name).join(', ')}`
        : ''
      const metaText = `[Drive: ${result.driveType}] ${result.name} (${result.mimeType})${folderInfo}`
      return {
        text: metaText,
        sections: [{ title: result.name, content: metaText }],
        metadata: result.metadata,
      }
    }
  }
}
