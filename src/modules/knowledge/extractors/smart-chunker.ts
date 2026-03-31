// LUNA — Module: knowledge — Smart Chunker v2
// Type-specific chunking strategies for Gemini Embedding 2.
// Each content type has its own splitting logic respecting embedding limits.
// Universal linking applied after all chunking.

import { randomUUID } from 'node:crypto'
import type { SmartChunk, LinkedChunk, MediaRef } from '../types.js'

// ═══════════════════════════════════════════
// Gemini Embedding 2 limits
// ═══════════════════════════════════════════

// MAX_TEXT_TOKENS = 8192 (Gemini Embedding 2 limit)
const MAX_WORDS = 6000  // ~8192 tokens ≈ 6000 words (conservative)
const MAX_IMAGES_PER_REQUEST = 6
const MAX_PDF_PAGES_PER_REQUEST = 6
const WORD_OVERLAP = 200
const MIN_CHUNK_WORDS = 20

// ═══════════════════════════════════════════
// 1. DOCS / WORD → text by headings
// ═══════════════════════════════════════════

export function chunkDocs(text: string): SmartChunk[] {
  const chunks: SmartChunk[] = []

  // Split by H1/H2 headings first
  const sections = text.split(/(?=^#{1,2}\s)/m)

  for (const section of sections) {
    const trimmed = section.trim()
    if (!trimmed) continue

    // Extract heading
    const headingMatch = trimmed.match(/^(#{1,2})\s+(.+?)$/m)
    const sectionTitle = headingMatch?.[2]?.trim() ?? null

    const words = trimmed.split(/\s+/)
    if (words.length < MIN_CHUNK_WORDS) continue

    if (words.length <= MAX_WORDS) {
      chunks.push({
        content: trimmed,
        contentType: 'text',
        section: sectionTitle,
        page: null,
        mediaRefs: null,
        extraMetadata: sectionTitle ? { section_title: sectionTitle } : null,
      })
    } else {
      // Split into sub-chunks with word overlap
      let start = 0
      let subIndex = 0
      while (start < words.length) {
        const end = Math.min(start + MAX_WORDS, words.length)
        const slice = words.slice(start, end).join(' ')

        if (slice.split(/\s+/).length >= MIN_CHUNK_WORDS) {
          chunks.push({
            content: slice,
            contentType: 'text',
            section: sectionTitle ? `${sectionTitle} (${subIndex + 1})` : null,
            page: null,
            mediaRefs: null,
            extraMetadata: { section_title: sectionTitle, sub_chunk: subIndex },
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
            section: null,
            page: null,
            mediaRefs: null,
            extraMetadata: null,
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
        section: null,
        page: null,
        mediaRefs: null,
        extraMetadata: null,
      })
    }
  }

  return chunks
}

// ═══════════════════════════════════════════
// 2. SHEETS → CSV with repeated headers
// ═══════════════════════════════════════════

export function chunkSheets(headers: string[], rows: string[][]): SmartChunk[] {
  const chunks: SmartChunk[] = []
  const headerLine = headers.join(',')

  // 1 row = 1 chunk, with header prepended for context
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!
    const content = headerLine + '\n' + row.join(',')
    if (content.trim().length < 20) continue

    chunks.push({
      content,
      contentType: 'csv',
      section: null,
      page: null,
      mediaRefs: null,
      extraMetadata: {
        row_index: i + 2,  // +2 because row 1 is header in sheet
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

export function chunkSlides(slides: Array<{ text: string; imageBase64?: string; title?: string }>): SmartChunk[] {
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
      section: slide.title ?? `Slide ${i + 1}`,
      page: i + 1,
      mediaRefs: mediaRefs.length > 0 ? mediaRefs : null,
      extraMetadata: { slide_index: i, slide_title: slide.title ?? null },
    }
  })
}

// ═══════════════════════════════════════════
// 4. PDF → blocks of max 6 pages
// ═══════════════════════════════════════════

/**
 * Chunk a PDF into blocks of up to 6 pages each.
 * Each chunk stores the PDF page range as media ref (the actual buffer is passed at embed time).
 * Text content is extracted per-page for FTS (passed separately).
 * 1-page overlap between consecutive chunks.
 */
export function chunkPdf(
  pageTexts: string[],
  pdfFilePath: string,
  totalPages: number,
): SmartChunk[] {
  const chunks: SmartChunk[] = []
  let pageStart = 0

  while (pageStart < totalPages) {
    const pageEnd = Math.min(pageStart + MAX_PDF_PAGES_PER_REQUEST, totalPages)
    const textForFts = pageTexts.slice(pageStart, pageEnd).join('\n\n')

    chunks.push({
      content: textForFts || `[PDF páginas ${pageStart + 1}-${pageEnd}]`,
      contentType: 'pdf_pages',
      section: `Páginas ${pageStart + 1}-${pageEnd}`,
      page: pageStart + 1,
      mediaRefs: [{
        mimeType: 'application/pdf',
        filePath: pdfFilePath,
      }],
      extraMetadata: {
        page_range: `${pageStart + 1}-${pageEnd}`,
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

export function chunkWeb(blocks: WebBlock[]): SmartChunk[] {
  const chunks: SmartChunk[] = []

  for (const block of blocks) {
    if (!block.text.trim()) continue

    const words = block.text.split(/\s+/)
    const images = block.images.slice(0, MAX_IMAGES_PER_REQUEST)

    if (words.length <= MAX_WORDS) {
      // Fits in one chunk
      const mediaRefs: MediaRef[] = images.map(img => ({
        mimeType: img.mimeType,
        data: img.data,
      }))

      chunks.push({
        content: block.text,
        contentType: images.length > 0 ? 'image_text' : 'text',
        section: block.heading,
        page: null,
        mediaRefs: mediaRefs.length > 0 ? mediaRefs : null,
        extraMetadata: {
          section: block.heading,
          has_images: images.length > 0,
          image_count: images.length,
        },
      })
    } else {
      // Split text, only first sub-chunk gets images
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
          contentType: isFirst && images.length > 0 ? 'image_text' : 'text',
          section: block.heading ? `${block.heading} (${subIndex + 1})` : null,
          page: null,
          mediaRefs: mediaRefs.length > 0 ? mediaRefs : null,
          extraMetadata: {
            section: block.heading,
            has_images: isFirst && images.length > 0,
            sub_chunk: subIndex,
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
  metadata: { title: string; description: string; thumbnailBase64?: string },
  transcriptSegments: Array<{ text: string; offset: number; duration?: number }>,
  chapters?: Array<{ title: string; startSeconds: number }> | null,
): SmartChunk[] {
  const chunks: SmartChunk[] = []

  // ── Chunk 0: header (thumbnail + title + description) ──
  const headerText = `${metadata.title}\n\n${metadata.description}`.trim()
  const headerMedia: MediaRef[] = metadata.thumbnailBase64
    ? [{ mimeType: 'image/jpeg', data: metadata.thumbnailBase64 }]
    : []

  chunks.push({
    content: headerText || metadata.title,
    contentType: 'yt_header',
    section: metadata.title,
    page: null,
    mediaRefs: headerMedia.length > 0 ? headerMedia : null,
    extraMetadata: {
      video_title: metadata.title,
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
        contentType: 'yt_transcript',
        section: chapter.title,
        page: null,
        mediaRefs: null,
        extraMetadata: {
          timestamp_start: formatTimestamp(chapter.startSeconds),
          timestamp_end: formatTimestamp(endSeconds),
          chapter_title: chapter.title,
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
          contentType: 'yt_transcript',
          section: `${formatTimestamp(segStart)} - ${formatTimestamp(Math.min(segEnd, totalDuration))}`,
          page: null,
          mediaRefs: null,
          extraMetadata: {
            timestamp_start: formatTimestamp(segStart),
            timestamp_end: formatTimestamp(Math.min(segEnd, totalDuration)),
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
// Universal linking function
// ═══════════════════════════════════════════

export function linkChunks(sourceId: string, chunks: SmartChunk[]): LinkedChunk[] {
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
