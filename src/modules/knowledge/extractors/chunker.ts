// LUNA — Module: knowledge — Chunker
// Divide contenido extraído en chunks indexables con overlap.

import type { ExtractedSection } from '../types.js'

export interface ChunkOutput {
  content: string
  section: string | null
  chunkIndex: number
  page: number | null
}

const MAX_CHUNK_SIZE = 1500
const OVERLAP_SIZE = 200
const MIN_CHUNK_SIZE = 30

/**
 * Split extracted sections into searchable chunks.
 * Preserves section metadata and adds overlap between chunks.
 */
export function chunkSections(sections: ExtractedSection[]): ChunkOutput[] {
  const chunks: ChunkOutput[] = []
  let globalIndex = 0

  for (const section of sections) {
    const text = section.content.trim()
    if (text.length < MIN_CHUNK_SIZE) continue

    if (text.length <= MAX_CHUNK_SIZE) {
      chunks.push({
        content: text,
        section: section.title,
        chunkIndex: globalIndex++,
        page: section.page ?? null,
      })
    } else {
      // Split with overlap
      let start = 0
      while (start < text.length) {
        const end = Math.min(start + MAX_CHUNK_SIZE, text.length)
        const slice = text.substring(start, end).trim()

        if (slice.length >= MIN_CHUNK_SIZE) {
          chunks.push({
            content: slice,
            section: section.title,
            chunkIndex: globalIndex++,
            page: section.page ?? null,
          })
        }

        if (end >= text.length) break
        start = end - OVERLAP_SIZE
      }
    }
  }

  return chunks
}

/**
 * Split raw text into sections by headings or double newlines.
 * Used by extractors that don't produce structured sections.
 */
export function splitTextIntoSections(text: string, defaultPage?: number): ExtractedSection[] {
  // Split by markdown headings or double newlines
  const parts = text.split(/(?=^#{1,3}\s)/m)

  const sections: ExtractedSection[] = []
  for (const part of parts) {
    const paragraphs = part.split(/\n\s*\n/)
    for (const para of paragraphs) {
      const trimmed = para.trim()
      if (trimmed.length < MIN_CHUNK_SIZE) continue

      // Extract heading if present
      const headingMatch = trimmed.match(/^(#{1,3})\s+(.+?)$/m)
      sections.push({
        title: headingMatch ? headingMatch[2]!.trim() : null,
        content: trimmed,
        page: defaultPage,
      })
    }
  }

  return sections
}
