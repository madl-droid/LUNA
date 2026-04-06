// LUNA — Session Chunker
// Splits session messages + attachments into SessionMemoryChunk[] for long-term memory.
// Produces linked chunks per source (text, images, PDFs, slides, video, audio, spreadsheets).

import { randomUUID } from 'node:crypto'
import type { StoredMessage, SessionMemoryChunk, SessionSummarySection } from './types.js'
import {
  MAX_TEXT_WORDS,
  TEXT_OVERLAP_WORDS,
  MAX_PDF_PAGES_PER_REQUEST as MAX_PDF_PAGES,
  PDF_PAGE_OVERLAP,
  MAX_VIDEO_NO_AUDIO_SEC,
  MAX_VIDEO_WITH_AUDIO_SEC,
  VIDEO_OVERLAP_SEC,
  MAX_AUDIO_SEC,
  AUDIO_OVERLAP_SEC,
} from '../knowledge/embedding-limits.js'

// ═══════════════════════════════════════════
// Attachment extraction record (from DB)
// ═══════════════════════════════════════════

export interface AttachmentExtraction {
  id: string
  sessionId: string
  filename: string
  mimeType: string
  category: string
  categoryLabel: string
  extractedText: string | null
  llmText: string | null
  filePath: string | null
  metadata: Record<string, unknown> | null
}

// ═══════════════════════════════════════════
// Pre-link chunk (before ID assignment)
// ═══════════════════════════════════════════

interface PreChunk {
  sourceId: string
  sourceType: string
  contentType: string
  content: string | null
  mediaRef: string | null
  mimeType: string | null
  extraMetadata: Record<string, unknown> | null
}

// ═══════════════════════════════════════════
// Text chunking — conversation messages
// ═══════════════════════════════════════════

export function chunkText(messages: StoredMessage[], interactionTitle: string): PreChunk[] {
  const fullText = messages
    .map(m => `[${m.role === 'assistant' ? 'Agente' : 'Usuario'}]: ${m.contentText || m.content?.text || ''}`)
    .filter(line => line.length > 10)
    .join('\n')

  if (!fullText.trim()) return []

  const words = fullText.split(/\s+/)
  const chunks: PreChunk[] = []
  let start = 0

  while (start < words.length) {
    const end = Math.min(start + MAX_TEXT_WORDS, words.length)
    const chunkWords = words.slice(start, end)

    chunks.push({
      sourceId: `text-${messages[0]?.sessionId ?? 'unknown'}`,
      sourceType: 'text',
      contentType: 'text',
      content: chunkWords.join(' '),
      mediaRef: null,
      mimeType: null,
      extraMetadata: { interaction_title: interactionTitle },
    })

    if (end >= words.length) break
    start = end - TEXT_OVERLAP_WORDS
  }

  return chunks
}

// ═══════════════════════════════════════════
// Image chunking — batch of 6
// ═══════════════════════════════════════════

export function chunkImages(attachments: AttachmentExtraction[], interactionTitle: string): PreChunk[] {
  const chunks: PreChunk[] = []

  for (let i = 0; i < attachments.length; i++) {
    const att = attachments[i]!
    chunks.push({
      sourceId: att.id,
      sourceType: 'image',
      contentType: 'image',
      content: att.llmText || att.extractedText || null,
      mediaRef: att.filePath,
      mimeType: att.mimeType,
      extraMetadata: {
        interaction_title: interactionTitle,
        filename: att.filename,
        original_index: i,
      },
    })
  }

  return chunks
}

// ═══════════════════════════════════════════
// PDF chunking — 6 pages per chunk, 1 page overlap
// ═══════════════════════════════════════════

export function chunkPdf(attachment: AttachmentExtraction, interactionTitle: string): PreChunk[] {
  const text = attachment.extractedText || attachment.llmText || ''
  if (!text.trim()) {
    return [{
      sourceId: attachment.id,
      sourceType: 'pdf',
      contentType: 'pdf_pages',
      content: null,
      mediaRef: attachment.filePath,
      mimeType: attachment.mimeType,
      extraMetadata: { interaction_title: interactionTitle, filename: attachment.filename },
    }]
  }

  // Split by page markers or by word count
  const pages = text.split(/\n---\s*page\s*\d+\s*---\n/i)
  if (pages.length <= 1) {
    // No page markers — split by word count
    return chunkTextByWords(text, attachment.id, 'pdf', 'pdf_pages', interactionTitle, attachment.filePath, attachment.mimeType)
  }

  const chunks: PreChunk[] = []
  let start = 0

  while (start < pages.length) {
    const end = Math.min(start + MAX_PDF_PAGES, pages.length)
    const pageContent = pages.slice(start, end).join('\n\n')

    chunks.push({
      sourceId: attachment.id,
      sourceType: 'pdf',
      contentType: 'pdf_pages',
      content: pageContent,
      mediaRef: attachment.filePath,
      mimeType: attachment.mimeType,
      extraMetadata: {
        interaction_title: interactionTitle,
        filename: attachment.filename,
        page_range: `${start + 1}-${end}`,
      },
    })

    if (end >= pages.length) break
    start = end - PDF_PAGE_OVERLAP
  }

  return chunks
}

// ═══════════════════════════════════════════
// Slides chunking — 1 chunk per slide, batched by 6
// ═══════════════════════════════════════════

export function chunkSlides(attachment: AttachmentExtraction, interactionTitle: string): PreChunk[] {
  const text = attachment.extractedText || attachment.llmText || ''
  if (!text.trim()) {
    return [{
      sourceId: attachment.id,
      sourceType: 'slide',
      contentType: 'slide',
      content: null,
      mediaRef: attachment.filePath,
      mimeType: attachment.mimeType,
      extraMetadata: { interaction_title: interactionTitle, filename: attachment.filename },
    }]
  }

  // Split by slide markers
  const slides = text.split(/\n---\s*slide\s*\d+\s*---\n/i).filter(s => s.trim())
  if (slides.length <= 1) {
    return chunkTextByWords(text, attachment.id, 'slide', 'slide', interactionTitle, attachment.filePath, attachment.mimeType)
  }

  const chunks: PreChunk[] = []
  for (let i = 0; i < slides.length; i++) {
    chunks.push({
      sourceId: attachment.id,
      sourceType: 'slide',
      contentType: 'slide',
      content: slides[i]!.trim(),
      mediaRef: attachment.filePath,
      mimeType: attachment.mimeType,
      extraMetadata: {
        interaction_title: interactionTitle,
        slide_index: i,
        filename: attachment.filename,
      },
    })
  }

  return chunks
}

// ═══════════════════════════════════════════
// Video chunking — segments by duration
// ═══════════════════════════════════════════

export function chunkVideo(attachment: AttachmentExtraction, interactionTitle: string): PreChunk[] {
  const meta = attachment.metadata ?? {}
  const hasAudio = !!meta.hasAudio
  const duration = typeof meta.duration === 'number' ? meta.duration : 0
  const maxSec = hasAudio ? MAX_VIDEO_WITH_AUDIO_SEC : MAX_VIDEO_NO_AUDIO_SEC
  const text = attachment.extractedText || attachment.llmText || ''

  // If short video or no duration info, single chunk
  if (duration <= maxSec || duration === 0) {
    return [{
      sourceId: attachment.id,
      sourceType: 'video_visual',
      contentType: 'video_frames',
      content: text || null,
      mediaRef: attachment.filePath,
      mimeType: attachment.mimeType,
      extraMetadata: {
        interaction_title: interactionTitle,
        timestamp_start: 0,
        timestamp_end: duration || null,
        has_audio: hasAudio,
        duration,
        filename: attachment.filename,
      },
    }]
  }

  // Split into segments
  const chunks: PreChunk[] = []
  let start = 0

  while (start < duration) {
    const end = Math.min(start + maxSec, duration)

    chunks.push({
      sourceId: attachment.id,
      sourceType: 'video_visual',
      contentType: 'video_frames',
      content: text || null,
      mediaRef: attachment.filePath,
      mimeType: attachment.mimeType,
      extraMetadata: {
        interaction_title: interactionTitle,
        timestamp_start: start,
        timestamp_end: end,
        has_audio: hasAudio,
        duration,
        filename: attachment.filename,
      },
    })

    if (end >= duration) break
    start = end - VIDEO_OVERLAP_SEC
  }

  return chunks
}

// ═══════════════════════════════════════════
// Audio chunking — segments by duration
// ═══════════════════════════════════════════

export function chunkAudio(attachment: AttachmentExtraction, interactionTitle: string): PreChunk[] {
  const meta = attachment.metadata ?? {}
  const duration = typeof meta.duration === 'number' ? meta.duration : 0
  const text = attachment.extractedText || attachment.llmText || ''

  // If short audio or no duration, single chunk
  if (duration <= MAX_AUDIO_SEC || duration === 0) {
    return [{
      sourceId: attachment.id,
      sourceType: 'audio',
      contentType: 'audio_segment',
      content: text || null,
      mediaRef: attachment.filePath,
      mimeType: attachment.mimeType,
      extraMetadata: {
        interaction_title: interactionTitle,
        timestamp_start: 0,
        timestamp_end: duration || null,
        filename: attachment.filename,
      },
    }]
  }

  // Split text transcript by estimated segments
  const words = text.split(/\s+/)
  const wordsPerSec = duration > 0 ? words.length / duration : 2
  const chunks: PreChunk[] = []
  let start = 0

  while (start < duration) {
    const end = Math.min(start + MAX_AUDIO_SEC, duration)
    const wordStart = Math.floor(start * wordsPerSec)
    const wordEnd = Math.min(Math.floor(end * wordsPerSec), words.length)
    const segmentText = words.slice(wordStart, wordEnd).join(' ')

    chunks.push({
      sourceId: attachment.id,
      sourceType: 'audio',
      contentType: 'audio_segment',
      content: segmentText || null,
      mediaRef: attachment.filePath,
      mimeType: attachment.mimeType,
      extraMetadata: {
        interaction_title: interactionTitle,
        timestamp_start: start,
        timestamp_end: end,
        filename: attachment.filename,
      },
    })

    if (end >= duration) break
    start = end - AUDIO_OVERLAP_SEC
  }

  return chunks
}

// ═══════════════════════════════════════════
// Spreadsheet chunking — text by tabs, split by words
// ═══════════════════════════════════════════

export function chunkSpreadsheet(attachment: AttachmentExtraction, interactionTitle: string): PreChunk[] {
  const text = attachment.extractedText || attachment.llmText || ''
  if (!text.trim()) return []

  // Try to split by tab markers
  const tabs = text.split(/\n---\s*tab[:\s]*/i)
  if (tabs.length > 1) {
    const chunks: PreChunk[] = []
    for (const tab of tabs) {
      const trimmed = tab.trim()
      if (!trimmed) continue
      const tabName = trimmed.split('\n')[0]?.trim() ?? 'Sheet'
      const tabChunks = chunkTextByWords(
        trimmed, attachment.id, 'spreadsheet', 'text',
        interactionTitle, null, null,
      )
      for (const chunk of tabChunks) {
        chunk.extraMetadata = { ...chunk.extraMetadata, tab_name: tabName }
      }
      chunks.push(...tabChunks)
    }
    return chunks
  }

  return chunkTextByWords(text, attachment.id, 'spreadsheet', 'text', interactionTitle, null, null)
}

// ═══════════════════════════════════════════
// Thematic section chunking — one chunk per LLM-identified topic
// ═══════════════════════════════════════════

export function chunkByThematicSections(
  messages: StoredMessage[],
  interactionTitle: string,
  sections: SessionSummarySection[],
): PreChunk[] {
  const sessionId = messages[0]?.sessionId ?? 'unknown'
  const chunks: PreChunk[] = []

  for (const section of sections) {
    // Build section content: topic summary + attachment references
    let content = `[${section.topic}]\n${section.summary}`
    if (section.attachments && section.attachments.length > 0) {
      content += '\n\nAdjuntos:\n' + section.attachments.join('\n')
    }

    chunks.push({
      sourceId: `section-${sessionId}`,
      sourceType: 'text',
      contentType: 'text',
      content,
      mediaRef: null,
      mimeType: null,
      extraMetadata: { interaction_title: interactionTitle, topic: section.topic },
    })
  }

  // Safety: if sections produced no chunks, fall back to word-count split
  if (chunks.length === 0) {
    return chunkText(messages, interactionTitle)
  }

  return chunks
}

// ═══════════════════════════════════════════
// Link chunks — assign UUIDs and prev/next pointers
// ═══════════════════════════════════════════

export function linkSessionChunks(
  sessionId: string,
  contactId: string,
  chunks: PreChunk[],
): SessionMemoryChunk[] {
  if (chunks.length === 0) return []

  // Group by sourceId for linking
  const groups = new Map<string, PreChunk[]>()
  for (const chunk of chunks) {
    const list = groups.get(chunk.sourceId) ?? []
    list.push(chunk)
    groups.set(chunk.sourceId, list)
  }

  const result: SessionMemoryChunk[] = []

  for (const [, groupChunks] of groups) {
    const ids = groupChunks.map(() => randomUUID())
    const total = groupChunks.length

    for (let i = 0; i < groupChunks.length; i++) {
      const c = groupChunks[i]!
      result.push({
        id: ids[i]!,
        sessionId,
        contactId,
        sourceId: c.sourceId,
        sourceType: c.sourceType,
        contentType: c.contentType,
        chunkIndex: i,
        chunkTotal: total,
        prevChunkId: i > 0 ? ids[i - 1]! : null,
        nextChunkId: i < total - 1 ? ids[i + 1]! : null,
        content: c.content,
        mediaRef: c.mediaRef,
        mimeType: c.mimeType,
        extraMetadata: c.extraMetadata,
        hasEmbedding: false,
        embedding: null,
      })
    }
  }

  return result
}

// ═══════════════════════════════════════════
// Main orchestrator
// ═══════════════════════════════════════════

export function chunkSession(
  sessionId: string,
  contactId: string,
  messages: StoredMessage[],
  attachments: AttachmentExtraction[],
  interactionTitle: string,
  sections?: SessionSummarySection[] | null,
): SessionMemoryChunk[] {
  const preChunks: PreChunk[] = []

  // 1. Conversation text — use thematic sections if available, otherwise word-count split
  if (sections && sections.length > 0) {
    preChunks.push(...chunkByThematicSections(messages, interactionTitle, sections))
  } else {
    preChunks.push(...chunkText(messages, interactionTitle))
  }

  // 2. Classify and chunk each attachment by category
  for (const att of attachments) {
    const category = att.category.toLowerCase()

    if (category === 'images' || att.mimeType.startsWith('image/')) {
      // Images collected individually — linking handles grouping
      preChunks.push(...chunkImages([att], interactionTitle))
    } else if (category === 'documents' && att.mimeType === 'application/pdf') {
      preChunks.push(...chunkPdf(att, interactionTitle))
    } else if (category === 'documents' && (att.mimeType.includes('presentation') || att.mimeType.includes('slide'))) {
      preChunks.push(...chunkSlides(att, interactionTitle))
    } else if (category === 'documents' && (att.mimeType.includes('spreadsheet') || att.mimeType.includes('excel') || att.mimeType.includes('csv'))) {
      preChunks.push(...chunkSpreadsheet(att, interactionTitle))
    } else if (category === 'video' || att.mimeType.startsWith('video/')) {
      preChunks.push(...chunkVideo(att, interactionTitle))
    } else if (category === 'audio' || att.mimeType.startsWith('audio/')) {
      preChunks.push(...chunkAudio(att, interactionTitle))
    } else {
      // Default: treat as text document
      const text = att.extractedText || att.llmText || ''
      if (text.trim()) {
        preChunks.push(...chunkTextByWords(text, att.id, 'text', 'text', interactionTitle, att.filePath, att.mimeType))
      }
    }
  }

  // 3. Link all chunks (assign IDs, prev/next, index/total per sourceId)
  return linkSessionChunks(sessionId, contactId, preChunks)
}

// ═══════════════════════════════════════════
// Helper: split text into word-bounded chunks
// ═══════════════════════════════════════════

function chunkTextByWords(
  text: string,
  sourceId: string,
  sourceType: string,
  contentType: string,
  interactionTitle: string,
  mediaRef: string | null,
  mimeType: string | null,
): PreChunk[] {
  const words = text.split(/\s+/).filter(w => w.length > 0)
  if (words.length === 0) return []

  const chunks: PreChunk[] = []
  let start = 0

  while (start < words.length) {
    const end = Math.min(start + MAX_TEXT_WORDS, words.length)

    chunks.push({
      sourceId,
      sourceType,
      contentType,
      content: words.slice(start, end).join(' '),
      mediaRef,
      mimeType,
      extraMetadata: { interaction_title: interactionTitle },
    })

    if (end >= words.length) break
    start = end - TEXT_OVERLAP_WORDS
  }

  return chunks
}
