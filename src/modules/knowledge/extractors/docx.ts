// LUNA — Module: knowledge — DOCX/Word Extractor
// Extrae texto de archivos .docx usando mammoth.

import type { ExtractedContent, ExtractedSection } from '../types.js'

export async function extractDocx(input: Buffer, fileName: string): Promise<ExtractedContent> {
  // Dynamic import — mammoth is optional dependency
  const mammoth = await import('mammoth')

  const result = await mammoth.extractRawText({ buffer: input })
  const text = result.value

  const sections: ExtractedSection[] = []

  // mammoth returns plain text; split by paragraphs
  const paragraphs = text.split(/\n\s*\n/)
  for (const para of paragraphs) {
    const trimmed = para.trim()
    if (trimmed.length < 20) continue
    sections.push({
      title: null,
      content: trimmed,
    })
  }

  // Also try to get structured HTML for better section detection
  const htmlResult = await mammoth.convertToHtml({ buffer: input })
  const headings = htmlResult.value.match(/<h[1-3][^>]*>(.*?)<\/h[1-3]>/gi) ?? []
  if (headings.length > 0 && sections.length > 0) {
    // Assign heading titles to sections where possible
    let headingIdx = 0
    for (const section of sections) {
      if (headingIdx < headings.length) {
        const heading = headings[headingIdx]!
        const titleMatch = heading.replace(/<[^>]+>/g, '').trim()
        if (section.content.includes(titleMatch)) {
          section.title = titleMatch
          headingIdx++
        }
      }
    }
  }

  return {
    text,
    sections,
    metadata: {
      sizeBytes: input.length,
      originalName: fileName,
      extractorUsed: 'mammoth',
    },
  }
}
