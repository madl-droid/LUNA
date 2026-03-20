// LUNA — Module: knowledge — Markdown/Text Extractor
// Extrae contenido de archivos .md, .txt, .json.

import type { ExtractedContent, ExtractedSection } from '../types.js'

export async function extractMarkdown(input: Buffer, fileName: string): Promise<ExtractedContent> {
  const text = input.toString('utf-8')
  const sections = splitByHeadings(text)

  return {
    text,
    sections,
    metadata: {
      sizeBytes: input.length,
      originalName: fileName,
      extractorUsed: 'markdown',
    },
  }
}

export async function extractPlainText(input: Buffer, fileName: string): Promise<ExtractedContent> {
  const text = input.toString('utf-8')
  const sections: ExtractedSection[] = []

  // Split by double newlines
  const paragraphs = text.split(/\n\s*\n/)
  for (const para of paragraphs) {
    const trimmed = para.trim()
    if (trimmed.length < 20) continue
    sections.push({ title: null, content: trimmed })
  }

  return {
    text,
    sections,
    metadata: {
      sizeBytes: input.length,
      originalName: fileName,
      extractorUsed: 'plain-text',
    },
  }
}

export async function extractJSON(input: Buffer, fileName: string): Promise<ExtractedContent> {
  const raw = input.toString('utf-8')
  let text: string

  try {
    const parsed = JSON.parse(raw) as unknown
    text = typeof parsed === 'string' ? parsed : JSON.stringify(parsed, null, 2)
  } catch {
    text = raw
  }

  return {
    text,
    sections: [{ title: fileName, content: text }],
    metadata: {
      sizeBytes: input.length,
      originalName: fileName,
      extractorUsed: 'json',
    },
  }
}

function splitByHeadings(text: string): ExtractedSection[] {
  const sections: ExtractedSection[] = []
  // Split at markdown headings (keep delimiter)
  const parts = text.split(/(?=^#{1,3}\s)/m)

  for (const part of parts) {
    const trimmed = part.trim()
    if (trimmed.length < 20) continue

    const headingMatch = trimmed.match(/^(#{1,3})\s+(.+?)$/m)
    sections.push({
      title: headingMatch ? headingMatch[2]!.trim() : null,
      content: trimmed,
    })
  }

  // If no headings found, split by paragraphs
  if (sections.length === 0) {
    const paragraphs = text.split(/\n\s*\n/)
    for (const para of paragraphs) {
      const trimmed = para.trim()
      if (trimmed.length < 20) continue
      sections.push({ title: null, content: trimmed })
    }
  }

  return sections
}
