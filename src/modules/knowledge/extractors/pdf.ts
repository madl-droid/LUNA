// LUNA — Module: knowledge — PDF Extractor
// Extrae texto de archivos PDF usando pdf-parse v3 (PDFParse class).
// Enhanced: detecta páginas con poco texto (posibles imágenes/scans) y usa vision LLM.

import type { Registry } from '../../../kernel/registry.js'
import type { ExtractedContent, ExtractedSection } from '../types.js'
import pino from 'pino'

const logger = pino({ name: 'knowledge:extractor:pdf' })

// FIX: K-DOS2 — Límite de tamaño para prevenir OOM en PDF parsing
const MAX_PDF_SIZE = 50 * 1024 * 1024 // 50MB
const MIN_TEXT_PER_PAGE = 50 // chars: below this, page is likely image/scanned

export async function extractPDF(
  input: Buffer,
  fileName: string,
  registry?: Registry,
): Promise<ExtractedContent> {
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
  const imagePages: number[] = [] // pages with little/no text

  // Use per-page text if available
  if (textResult.pages && textResult.pages.length > 0) {
    for (let i = 0; i < textResult.pages.length; i++) {
      const pageText = textResult.pages[i]?.text?.trim() ?? ''
      if (pageText.length < MIN_TEXT_PER_PAGE) {
        // Page has very little text — likely an image, chart, or scanned page
        imagePages.push(i + 1)
        if (pageText.length >= 20) {
          sections.push({ title: `Página ${i + 1}`, content: pageText, page: i + 1 })
        }
        continue
      }
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
      sections.push({ title: null, content: trimmed, page: 1 })
    }
  }

  // If we detected image-heavy pages and have vision capability, describe them
  if (imagePages.length > 0 && registry) {
    logger.info({ fileName, imagePages, totalPages }, '[PDF] Detected image-heavy pages, attempting vision extraction')
    try {
      const screenshotResult = await parser.getScreenshot({
        partial: imagePages.slice(0, 6), // max 6 pages for vision
        scale: 1.5,
        imageBuffer: true,
      })

      if (screenshotResult?.pages) {
        for (const page of screenshotResult.pages) {
          if (!page.data) continue
          const pageBuffer = Buffer.from(page.data)
          const base64 = pageBuffer.toString('base64')

          try {
            const visionResult = await registry.callHook('llm:chat', {
              task: 'knowledge-pdf-vision',
              system: 'Extrae y describe todo el contenido visible de esta imagen de un documento PDF. Incluye todo el texto, tablas, gráficos y elementos visuales. Responde solo con el contenido extraído.',
              messages: [{
                role: 'user' as const,
                content: [
                  { type: 'image_url', data: base64, mimeType: 'image/png' },
                  { type: 'text', text: `Extrae el contenido completo de esta página ${page.pageNumber} del documento "${fileName}".` },
                ],
              }],
              maxTokens: 3000,
              temperature: 0.1,
            })

            if (visionResult?.text?.trim()) {
              sections.push({
                title: `Página ${page.pageNumber} (visual)`,
                content: visionResult.text.trim(),
                page: page.pageNumber,
              })
              logger.info({ page: page.pageNumber, textLen: visionResult.text.length }, '[PDF] Vision extracted page content')
            }
          } catch (err) {
            logger.warn({ err, page: page.pageNumber }, '[PDF] Vision extraction failed for page')
          }
        }
      }
    } catch (err) {
      logger.warn({ err, imagePages }, '[PDF] Screenshot extraction failed, using text-only')
    }
  } else if (imagePages.length > 0) {
    logger.info({ fileName, imagePages }, '[PDF] Image-heavy pages detected but no registry for vision — text only')
  }

  // Sort sections by page number
  sections.sort((a, b) => (a.page ?? 0) - (b.page ?? 0))

  await parser.destroy().catch(() => {})

  return {
    text: fullText,
    sections,
    metadata: {
      pages: totalPages,
      author: (infoResult?.info as Record<string, unknown> | undefined)?.Author as string | undefined,
      sizeBytes: input.length,
      originalName: fileName,
      extractorUsed: imagePages.length > 0 ? 'pdf-parse+vision' : 'pdf-parse',
      imagePages: imagePages.length > 0 ? imagePages : undefined,
    } as Record<string, unknown>,
  }
}
