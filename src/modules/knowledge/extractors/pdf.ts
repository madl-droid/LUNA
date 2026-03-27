// LUNA — Module: knowledge — PDF Extractor
// Extrae texto de archivos PDF usando pdf-parse v3 (PDFParse class).

import type { ExtractedContent, ExtractedSection } from '../types.js'

// FIX: K-DOS2 — Límite de tamaño para prevenir OOM en PDF parsing
const MAX_PDF_SIZE = 50 * 1024 * 1024 // 50MB

export async function extractPDF(input: Buffer, fileName: string): Promise<ExtractedContent> {
  if (input.length > MAX_PDF_SIZE) {
    throw new Error(`PDF too large: ${(input.length / 1024 / 1024).toFixed(1)}MB exceeds ${MAX_PDF_SIZE / 1024 / 1024}MB limit`)
  }
  const { PDFParse } = await import('pdf-parse')

  const parser = new PDFParse({ data: new Uint8Array(input) })

  const [textResult, infoResult] = await Promise.all([
    parser.getText(),
    parser.getInfo().catch(() => null),
  ])

  const fullText = textResult.text ?? ''
  const totalPages = textResult.pages?.length ?? 1
  const sections: ExtractedSection[] = []

  // Use per-page text if available
  if (textResult.pages && textResult.pages.length > 0) {
    for (let i = 0; i < textResult.pages.length; i++) {
      const pageText = textResult.pages[i]?.text?.trim()
      if (!pageText || pageText.length < 20) continue
      sections.push({
        title: `Página ${i + 1}`,
        content: pageText,
        page: i + 1,
      })
    }
  }

  // Fallback: split by paragraphs
  if (sections.length === 0) {
    const paragraphs = fullText.split(/\n\s*\n/)
    for (const para of paragraphs) {
      const trimmed = para.trim()
      if (trimmed.length < 20) continue
      sections.push({
        title: null,
        content: trimmed,
        page: 1,
      })
    }
  }

  await parser.destroy().catch(() => {})

  return {
    text: fullText,
    sections,
    metadata: {
      pages: totalPages,
      author: (infoResult?.info as Record<string, unknown> | undefined)?.Author as string | undefined,
      sizeBytes: input.length,
      originalName: fileName,
      extractorUsed: 'pdf-parse',
    },
  }
}
