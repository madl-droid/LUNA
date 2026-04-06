// LUNA — Module: knowledge — Smart Chunker v3
// Type-specific chunking strategies for Gemini Embedding 2.
// Produces EmbeddableChunk format (unified with memory chunker).
// Universal linking applied after all chunking.

import { randomUUID } from 'node:crypto'
import type { EmbeddableChunk, LinkedEmbeddableChunk, MediaRef } from '../embedding-limits.js'
import {
  MAX_TEXT_WORDS as MAX_WORDS,
  TEXT_OVERLAP_WORDS as WORD_OVERLAP,
  MIN_CHUNK_WORDS,
  MAX_IMAGES_PER_REQUEST,
  MAX_PDF_PAGES_PER_REQUEST,
} from '../embedding-limits.js'

// Re-export for backward compat (callers importing SmartChunk/LinkedChunk)
export type { EmbeddableChunk as SmartChunk, LinkedEmbeddableChunk as LinkedChunk }

// ═══════════════════════════════════════════
// 1. DOCS / WORD → text by headings
// ═══════════════════════════════════════════

export function chunkDocs(text: string, opts?: { sourceFile?: string; sourceMimeType?: string; sourceType?: string }): EmbeddableChunk[] {
  const chunks: EmbeddableChunk[] = []

  // Split by H1/H2 headings first
  const sections = text.split(/(?=^#{1,2}\s)/m)

  for (const section of sections) {
    const trimmed = section.trim()
    if (!trimmed) continue

    // Extract heading
    const headingMatch = trimmed.match(/^(#{1,2})\s+(.+?)$/m)
    const sectionTitle = headingMatch?.[2]?.trim() ?? undefined

    const words = trimmed.split(/\s+/)
    if (words.length < MIN_CHUNK_WORDS) continue

    if (words.length <= MAX_WORDS) {
      chunks.push({
        content: trimmed,
        contentType: 'text',
        mediaRefs: null,
        chunkIndex: 0, chunkTotal: 0, prevChunkId: null, nextChunkId: null,
        metadata: {
          sourceType: opts?.sourceType ?? 'text',
          sourceFile: opts?.sourceFile,
          sourceMimeType: opts?.sourceMimeType,
          sectionTitle,
        },
      })
    } else {
      // Split into sub-chunks with word overlap
      const subTotal = Math.ceil((words.length - WORD_OVERLAP) / (MAX_WORDS - WORD_OVERLAP))
      let start = 0
      let subIndex = 0
      while (start < words.length) {
        const end = Math.min(start + MAX_WORDS, words.length)
        const slice = words.slice(start, end).join(' ')

        if (slice.split(/\s+/).length >= MIN_CHUNK_WORDS) {
          chunks.push({
            content: slice,
            contentType: 'text',
            mediaRefs: null,
            chunkIndex: 0, chunkTotal: 0, prevChunkId: null, nextChunkId: null,
            metadata: {
              sourceType: 'docx',
              sourceFile: opts?.sourceFile,
              sourceMimeType: opts?.sourceMimeType,
              sectionTitle: sectionTitle ? `${sectionTitle} (${subIndex + 1})` : undefined,
              subChunkIndex: subIndex,
              subChunkTotal: subTotal,
            },
          })
          subIndex++
        }

        if (end >= words.length) break
        start = end - WORD_OVERLAP
      }
    }
  }

  // Fallback: if no headings found, split by paragraphs
  if (chunks.length === 0) {
    const paragraphs = text.split(/\n\s*\n/).filter(p => p.trim().length > 0)
    let accumulated = ''
    for (const para of paragraphs) {
      if ((accumulated + '\n\n' + para).split(/\s+/).length > MAX_WORDS) {
        if (accumulated.trim()) {
          chunks.push({
            content: accumulated.trim(),
            contentType: 'text',
            mediaRefs: null,
            chunkIndex: 0, chunkTotal: 0, prevChunkId: null, nextChunkId: null,
            metadata: {
              sourceType: 'docx',
              sourceFile: opts?.sourceFile,
              sourceMimeType: opts?.sourceMimeType,
            },
          })
        }
        accumulated = para
      } else {
        accumulated = accumulated ? accumulated + '\n\n' + para : para
      }
    }
    if (accumulated.trim() && accumulated.split(/\s+/).length >= MIN_CHUNK_WORDS) {
      chunks.push({
        content: accumulated.trim(),
        contentType: 'text',
        mediaRefs: null,
        chunkIndex: 0, chunkTotal: 0, prevChunkId: null, nextChunkId: null,
        metadata: {
          sourceType: opts?.sourceType ?? 'text',
          sourceFile: opts?.sourceFile,
          sourceMimeType: opts?.sourceMimeType,
        },
      })
    }
  }

  return chunks
}

// ═══════════════════════════════════════════
// 2. SHEETS → CSV with repeated headers
// ═══════════════════════════════════════════

export function chunkSheets(headers: string[], rows: string[][], opts?: { sourceFile?: string; sourceMimeType?: string; sheetName?: string }): EmbeddableChunk[] {
  const chunks: EmbeddableChunk[] = []
  const headerLine = headers.join(',')

  // 1 row = 1 chunk, with header prepended for context
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!
    const content = headerLine + '\n' + row.join(',')
    if (content.trim().length < 20) continue

    chunks.push({
      content,
      contentType: 'csv',
      mediaRefs: null,
      chunkIndex: 0, chunkTotal: 0, prevChunkId: null, nextChunkId: null,
      metadata: {
        sourceType: 'sheets',
        sourceFile: opts?.sourceFile,
        sourceMimeType: opts?.sourceMimeType ?? 'text/csv',
        sectionTitle: opts?.sheetName,
        row_index: i + 2,  // +2 because row 1 is header
        headers,
        row_count: 1,
      },
    })
  }

  return chunks
}

// ═══════════════════════════════════════════
// 3. SLIDES → 1 image + text per slide
// ═══════════════════════════════════════════

export function chunkSlides(slides: Array<{ text: string; imageBase64?: string; title?: string }>, opts?: { sourceFile?: string }): EmbeddableChunk[] {
  return slides.map((slide, i) => {
    const mediaRefs: MediaRef[] = []
    if (slide.imageBase64) {
      mediaRefs.push({ mimeType: 'image/png', data: slide.imageBase64 })
    }

    // Truncate text if over limit — image has priority
    const words = slide.text.split(/\s+/)
    const text = words.length > MAX_WORDS ? words.slice(0, MAX_WORDS).join(' ') : slide.text

    return {
      content: text || `[Slide ${i + 1}]`,
      contentType: 'slide' as const,
      mediaRefs: mediaRefs.length > 0 ? mediaRefs : null,
      chunkIndex: 0, chunkTotal: 0, prevChunkId: null, nextChunkId: null,
      metadata: {
        sourceType: 'slides',
        sourceFile: opts?.sourceFile,
        sourceMimeType: 'application/vnd.google-apps.presentation',
        sectionTitle: slide.title ?? `Slide ${i + 1}`,
        pageRange: String(i + 1),
      },
    }
  })
}

// ═══════════════════════════════════════════
// 4. PDF → blocks of max 6 pages
// ═══════════════════════════════════════════

export function chunkPdf(
  pageTexts: string[],
  pdfFilePath: string,
  totalPages: number,
  opts?: { sourceFile?: string },
): EmbeddableChunk[] {
  const chunks: EmbeddableChunk[] = []
  let pageStart = 0

  while (pageStart < totalPages) {
    const pageEnd = Math.min(pageStart + MAX_PDF_PAGES_PER_REQUEST, totalPages)
    const textForFts = pageTexts.slice(pageStart, pageEnd).join('\n\n')

    chunks.push({
      content: textForFts || `[PDF páginas ${pageStart + 1}-${pageEnd}]`,
      contentType: 'pdf_pages',
      mediaRefs: [{
        mimeType: 'application/pdf',
        filePath: pdfFilePath,
      }],
      chunkIndex: 0, chunkTotal: 0, prevChunkId: null, nextChunkId: null,
      metadata: {
        sourceType: 'pdf',
        sourceFile: opts?.sourceFile,
        sourceMimeType: 'application/pdf',
        sectionTitle: `Páginas ${pageStart + 1}-${pageEnd}`,
        pageRange: `${pageStart + 1}-${pageEnd}`,
        page_start: pageStart + 1,
        page_end: pageEnd,
        page_total: totalPages,
      },
    })

    if (pageEnd >= totalPages) break
    // 1-page overlap
    pageStart = pageEnd - 1
  }

  return chunks
}

// ═══════════════════════════════════════════
// 5. WEB → semantic blocks + associated images
// ═══════════════════════════════════════════

export interface WebBlock {
  text: string
  heading: string | null
  images: Array<{ data: string; mimeType: string }>  // base64
}

export function chunkWeb(blocks: WebBlock[], opts?: { sourceUrl?: string; sourceFile?: string }): EmbeddableChunk[] {
  const chunks: EmbeddableChunk[] = []

  for (const block of blocks) {
    if (!block.text.trim()) continue

    const words = block.text.split(/\s+/)
    const images = block.images.slice(0, MAX_IMAGES_PER_REQUEST)

    if (words.length <= MAX_WORDS) {
      const mediaRefs: MediaRef[] = images.map(img => ({
        mimeType: img.mimeType,
        data: img.data,
      }))

      chunks.push({
        content: block.text,
        contentType: images.length > 0 ? 'image' : 'web',
        mediaRefs: mediaRefs.length > 0 ? mediaRefs : null,
        chunkIndex: 0, chunkTotal: 0, prevChunkId: null, nextChunkId: null,
        metadata: {
          sourceType: 'web',
          sourceFile: opts?.sourceFile,
          sourceUrl: opts?.sourceUrl,
          sectionTitle: block.heading ?? undefined,
          image_count: images.length,
        },
      })
    } else {
      // Split text, only first sub-chunk gets images
      const subTotal = Math.ceil((words.length - WORD_OVERLAP) / (MAX_WORDS - WORD_OVERLAP))
      let start = 0
      let subIndex = 0
      while (start < words.length) {
        const end = Math.min(start + MAX_WORDS, words.length)
        const slice = words.slice(start, end).join(' ')

        const isFirst = subIndex === 0
        const mediaRefs: MediaRef[] = isFirst
          ? images.map(img => ({ mimeType: img.mimeType, data: img.data }))
          : []

        chunks.push({
          content: slice,
          contentType: isFirst && images.length > 0 ? 'image' : 'web',
          mediaRefs: mediaRefs.length > 0 ? mediaRefs : null,
          chunkIndex: 0, chunkTotal: 0, prevChunkId: null, nextChunkId: null,
          metadata: {
            sourceType: 'web',
            sourceUrl: opts?.sourceUrl,
            sectionTitle: block.heading ? `${block.heading} (${subIndex + 1})` : undefined,
            subChunkIndex: subIndex,
            subChunkTotal: subTotal,
            image_count: isFirst ? images.length : 0,
          },
        })

        subIndex++
        if (end >= words.length) break
        start = end - WORD_OVERLAP
      }
    }
  }

  return chunks
}

// ═══════════════════════════════════════════
// 6. YOUTUBE → header chunk + transcript chunks
// ═══════════════════════════════════════════

export interface YouTubeChapter {
  title: string
  startSeconds: number
  endSeconds: number
  text: string
}

/**
 * Parse YouTube chapters from video description.
 * Chapters appear as "0:00 Intro", "3:45 Demo", etc.
 */
export function parseYoutubeChapters(description: string): Array<{ title: string; startSeconds: number }> | null {
  const lines = description.split('\n')
  const chapters: Array<{ title: string; startSeconds: number }> = []

  for (const line of lines) {
    const match = line.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s+(.+)$/)
    if (match) {
      const hours = match[3] ? parseInt(match[1]!, 10) : 0
      const minutes = match[3] ? parseInt(match[2]!, 10) : parseInt(match[1]!, 10)
      const seconds = match[3] ? parseInt(match[3], 10) : parseInt(match[2]!, 10)
      const totalSeconds = hours * 3600 + minutes * 60 + seconds
      chapters.push({ title: match[4]!.trim(), startSeconds: totalSeconds })
    }
  }

  return chapters.length >= 2 ? chapters : null  // need at least 2 to be real chapters
}

function formatTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  return h > 0
    ? `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

const YT_SEGMENT_SECONDS = 300  // 5 minutes
const YT_OVERLAP_SECONDS = 30

export function chunkYoutube(
  metadata: { title: string; description: string; thumbnailBase64?: string; url?: string },
  transcriptSegments: Array<{ text: string; offset: number; duration?: number }>,
  chapters?: Array<{ title: string; startSeconds: number }> | null,
): EmbeddableChunk[] {
  const chunks: EmbeddableChunk[] = []

  // ── Chunk 0: header (thumbnail + title + description) ──
  const headerText = `${metadata.title}\n\n${metadata.description}`.trim()
  const headerMedia: MediaRef[] = metadata.thumbnailBase64
    ? [{ mimeType: 'image/jpeg', data: metadata.thumbnailBase64 }]
    : []

  chunks.push({
    content: headerText || metadata.title,
    contentType: 'youtube',
    mediaRefs: headerMedia.length > 0 ? headerMedia : null,
    chunkIndex: 0, chunkTotal: 0, prevChunkId: null, nextChunkId: null,
    metadata: {
      sourceType: 'youtube',
      sourceUrl: metadata.url,
      sectionTitle: metadata.title,
      has_thumbnail: !!metadata.thumbnailBase64,
    },
  })

  // ── Chunks 1..N: transcript sections ──
  if (transcriptSegments.length === 0) return chunks

  if (chapters && chapters.length >= 2) {
    // Split by chapters
    for (let i = 0; i < chapters.length; i++) {
      const chapter = chapters[i]!
      const nextStart = chapters[i + 1]?.startSeconds ?? Infinity

      const chapterText = transcriptSegments
        .filter(s => s.offset >= chapter.startSeconds && s.offset < nextStart)
        .map(s => s.text)
        .join(' ')

      if (!chapterText.trim()) continue

      const endSeconds = i + 1 < chapters.length ? chapters[i + 1]!.startSeconds : (transcriptSegments.at(-1)?.offset ?? chapter.startSeconds) + 30

      chunks.push({
        content: `${chapter.title}\n\n${chapterText}`,
        contentType: 'youtube',
        mediaRefs: null,
        chunkIndex: 0, chunkTotal: 0, prevChunkId: null, nextChunkId: null,
        metadata: {
          sourceType: 'youtube',
          sourceUrl: metadata.url,
          sectionTitle: chapter.title,
          timestampStart: chapter.startSeconds,
          timestampEnd: endSeconds,
        },
      })
    }
  } else {
    // No chapters — split every 5 minutes with 30s overlap
    const totalDuration = (transcriptSegments.at(-1)?.offset ?? 0) + (transcriptSegments.at(-1)?.duration ?? 5)
    let segStart = 0

    while (segStart < totalDuration) {
      const segEnd = segStart + YT_SEGMENT_SECONDS

      const segText = transcriptSegments
        .filter(s => s.offset >= segStart && s.offset < segEnd)
        .map(s => s.text)
        .join(' ')

      if (segText.trim()) {
        chunks.push({
          content: segText,
          contentType: 'youtube',
          mediaRefs: null,
          chunkIndex: 0, chunkTotal: 0, prevChunkId: null, nextChunkId: null,
          metadata: {
            sourceType: 'youtube',
            sourceUrl: metadata.url,
            sectionTitle: `${formatTimestamp(segStart)} - ${formatTimestamp(Math.min(segEnd, totalDuration))}`,
            timestampStart: segStart,
            timestampEnd: Math.min(segEnd, totalDuration),
          },
        })
      }

      if (segEnd >= totalDuration) break
      segStart = segEnd - YT_OVERLAP_SECONDS
    }
  }

  return chunks
}

// ═══════════════════════════════════════════
// 7. IMAGE → 1 image = 1 chunk
// ═══════════════════════════════════════════

export function chunkImage(opts: {
  description: string | null
  shortDescription?: string
  mimeType: string
  sourceFile?: string
  sourceUrl?: string
  width?: number
  height?: number
  filePath?: string
  base64?: string
}): EmbeddableChunk[] {
  const mediaRefs: MediaRef[] = []
  if (opts.base64) mediaRefs.push({ mimeType: opts.mimeType, data: opts.base64 })
  else if (opts.filePath) mediaRefs.push({ mimeType: opts.mimeType, filePath: opts.filePath })

  return [{
    content: opts.description ?? `[Imagen: ${opts.sourceFile ?? 'sin nombre'}]`,
    contentType: 'image',
    mediaRefs: mediaRefs.length > 0 ? mediaRefs : null,
    chunkIndex: 0, chunkTotal: 1, prevChunkId: null, nextChunkId: null,
    metadata: {
      sourceType: 'image',
      sourceFile: opts.sourceFile,
      sourceMimeType: opts.mimeType,
      sourceUrl: opts.sourceUrl,
      sectionTitle: opts.shortDescription ?? opts.sourceFile,
      width: opts.width,
      height: opts.height,
    },
  }]
}

// ═══════════════════════════════════════════
// 8. AUDIO → transcription as text chunk(s)
// ═══════════════════════════════════════════

export function chunkAudio(opts: {
  transcription: string | null
  durationSeconds: number
  mimeType: string
  sourceFile?: string
  sourceUrl?: string
  filePath?: string
}): EmbeddableChunk[] {
  if (!opts.transcription) {
    return [{
      content: `[Audio: ${opts.sourceFile ?? 'sin nombre'}, ${Math.round(opts.durationSeconds)}s, sin transcripción]`,
      contentType: 'text',
      mediaRefs: opts.filePath ? [{ mimeType: opts.mimeType, filePath: opts.filePath }] : null,
      chunkIndex: 0, chunkTotal: 1, prevChunkId: null, nextChunkId: null,
      metadata: {
        sourceType: 'audio',
        sourceFile: opts.sourceFile,
        sourceMimeType: opts.mimeType,
        sourceUrl: opts.sourceUrl,
        durationSeconds: opts.durationSeconds,
      },
    }]
  }

  // Single chunk for now — temporal splitting (60/70s) is Phase 2
  return [{
    content: opts.transcription,
    contentType: 'text',
    mediaRefs: opts.filePath ? [{ mimeType: opts.mimeType, filePath: opts.filePath }] : null,
    chunkIndex: 0, chunkTotal: 1, prevChunkId: null, nextChunkId: null,
    metadata: {
      sourceType: 'audio',
      sourceFile: opts.sourceFile,
      sourceMimeType: opts.mimeType,
      sourceUrl: opts.sourceUrl,
      durationSeconds: opts.durationSeconds,
      timestampStart: 0,
      timestampEnd: opts.durationSeconds,
    },
  }]
}

// ═══════════════════════════════════════════
// 9. VIDEO → description + transcription as text chunk(s)
// ═══════════════════════════════════════════

export function chunkVideo(opts: {
  description: string | null
  transcription: string | null
  durationSeconds: number
  mimeType: string
  sourceFile?: string
  sourceUrl?: string
  filePath?: string
}): EmbeddableChunk[] {
  const parts: string[] = []
  if (opts.description) parts.push(opts.description)
  if (opts.transcription) parts.push(`[Transcripción]: ${opts.transcription}`)
  const content = parts.length > 0
    ? parts.join('\n\n')
    : `[Video: ${opts.sourceFile ?? 'sin nombre'}, ${Math.round(opts.durationSeconds)}s]`

  // Single chunk for now — temporal splitting (50/60s) is Phase 2
  return [{
    content,
    contentType: 'text',
    mediaRefs: opts.filePath ? [{ mimeType: opts.mimeType, filePath: opts.filePath }] : null,
    chunkIndex: 0, chunkTotal: 1, prevChunkId: null, nextChunkId: null,
    metadata: {
      sourceType: 'video',
      sourceFile: opts.sourceFile,
      sourceMimeType: opts.mimeType,
      sourceUrl: opts.sourceUrl,
      durationSeconds: opts.durationSeconds,
      hasDescription: !!opts.description,
      hasTranscription: !!opts.transcription,
      timestampStart: 0,
      timestampEnd: opts.durationSeconds,
    },
  }]
}

// ═══════════════════════════════════════════
// 10. DRIVE → metadata-only chunks for unread files/folders
// ═══════════════════════════════════════════

export function chunkDriveLink(opts: {
  fileId: string
  name: string
  mimeType: string
  driveType: string
  url: string
  suggestedTool: string
  folderContents?: Array<{ id: string; name: string; mimeType: string }>
}): EmbeddableChunk[] {
  if (opts.driveType === 'folder') {
    const listing = opts.folderContents?.map(f => `- ${f.name} (${f.mimeType}, id: ${f.id})`).join('\n') ?? '(vacía)'
    return [{
      content: `[Carpeta de Drive] "${opts.name}"\nContenido:\n${listing}`,
      contentType: 'drive',
      mediaRefs: null,
      chunkIndex: 0, chunkTotal: 1, prevChunkId: null, nextChunkId: null,
      metadata: {
        sourceType: 'drive',
        sourceFile: opts.name,
        sourceMimeType: opts.mimeType,
        sourceUrl: opts.url,
        sectionTitle: opts.name,
        driveType: opts.driveType,
        fileId: opts.fileId,
        fileCount: opts.folderContents?.length ?? 0,
      },
    }]
  }

  return [{
    content: `[Archivo de Drive] "${opts.name}" (${opts.mimeType}). Disponible via ${opts.suggestedTool} con ID "${opts.fileId}".`,
    contentType: 'drive',
    mediaRefs: null,
    chunkIndex: 0, chunkTotal: 1, prevChunkId: null, nextChunkId: null,
    metadata: {
      sourceType: 'drive',
      sourceFile: opts.name,
      sourceMimeType: opts.mimeType,
      sourceUrl: opts.url,
      sectionTitle: opts.name,
      driveType: opts.driveType,
      fileId: opts.fileId,
      suggestedTool: opts.suggestedTool,
    },
  }]
}

// ═══════════════════════════════════════════
// Universal linking function
// ═══════════════════════════════════════════

export function linkChunks(sourceId: string, chunks: EmbeddableChunk[]): LinkedEmbeddableChunk[] {
  // Generate IDs first so we can reference prev/next
  const ids = chunks.map(() => randomUUID())

  return chunks.map((chunk, i) => ({
    ...chunk,
    id: ids[i]!,
    chunkIndex: i,
    chunkTotal: chunks.length,
    prevChunkId: i > 0 ? ids[i - 1]! : null,
    nextChunkId: i < chunks.length - 1 ? ids[i + 1]! : null,
    sourceId,
  }))
}
