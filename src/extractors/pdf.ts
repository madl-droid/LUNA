// LUNA — Global Extractors — PDF
// Extrae texto e imágenes de archivos PDF.
// Detecta PDF con texto vs escaneado.
// Texto: títulos por font-size relativo + implícitos. Imágenes filtradas.
// Escaneado: OCR via LLM vision (Gemini). Flag isScanned.

import type { Registry } from '../kernel/registry.js'
import type { PromptsService } from '../modules/prompts/types.js'
import type { ExtractedContent, ExtractedSection } from './types.js'
import { isImplicitTitle, MAX_FILE_SIZE } from './utils.js'
import pino from 'pino'

const logger = pino({ name: 'extractors:pdf' })

const MIN_TEXT_PER_PAGE = 50  // chars: debajo de esto la página es imagen/scan
const MAX_VISION_PAGES = 6   // máximo de páginas para vision OCR

// Minimal fallback — full prompt lives in instance/prompts/system/pdf-ocr.md
const PDF_OCR_SYSTEM_FALLBACK = 'Eres un OCR. Extrae TODO el texto visible de esta imagen. Responde SOLO con el texto extraído.'

// ═══════════════════════════════════════════
// Función principal
// ═══════════════════════════════════════════

export async function extractPDF(
  input: Buffer,
  fileName: string,
  registry?: Registry,
): Promise<ExtractedContent> {
  if (input.length > MAX_FILE_SIZE) {
    throw new Error(`PDF too large: ${(input.length / 1024 / 1024).toFixed(1)}MB exceeds ${MAX_FILE_SIZE / 1024 / 1024}MB limit`)
  }

  const { PDFParse } = await import('pdf-parse')
  const parser = new PDFParse({ data: new Uint8Array(input) })

  const [textResult, infoResult] = await Promise.all([
    parser.getText(),
    parser.getInfo().catch(() => null),
  ])

  const fullText = textResult.text ?? ''
  const totalPages = textResult.pages?.length ?? 1
  const pageTexts: string[] = []
  const imagePages: number[] = []

  // Extraer texto por página y detectar páginas de imagen
  if (textResult.pages && textResult.pages.length > 0) {
    for (let i = 0; i < textResult.pages.length; i++) {
      const pageText = textResult.pages[i]?.text?.trim() ?? ''
      pageTexts.push(pageText)
      if (pageText.length < MIN_TEXT_PER_PAGE) {
        imagePages.push(i + 1)
      }
    }
  }

  // Determinar si es PDF escaneado (>50% páginas con poco texto)
  const isScanned = totalPages > 0 && imagePages.length > totalPages * 0.5

  let sections: ExtractedSection[]

  if (isScanned) {
    // ── PDF escaneado: OCR completo via LLM vision ──
    sections = await extractScannedPdf(parser, imagePages.length > 0 ? imagePages : Array.from({ length: totalPages }, (_, i) => i + 1), fileName, registry)
  } else {
    // ── PDF con texto: extracción normal con títulos ──
    sections = extractTextPdfSections(pageTexts)

    // Intentar extraer contenido visual de páginas con poca texto
    if (imagePages.length > 0 && registry) {
      const visionSections = await extractVisionPages(parser, imagePages, fileName, registry)
      sections.push(...visionSections)
      sections.sort((a, b) => (a.page ?? 0) - (b.page ?? 0))
    }
  }

  await parser.destroy().catch(() => {})

  return {
    text: isScanned ? sections.map(s => s.content).join('\n\n') : fullText,
    sections,
    metadata: {
      pages: totalPages,
      author: (infoResult?.info as Record<string, unknown> | undefined)?.Author as string | undefined,
      sizeBytes: input.length,
      originalName: fileName,
      extractorUsed: isScanned ? 'pdf-ocr-vision' : (imagePages.length > 0 ? 'pdf-parse+vision' : 'pdf-parse'),
      isScanned,
      imagePages: imagePages.length > 0 ? imagePages : undefined,
    },
  }
}

// ═══════════════════════════════════════════
// PDF con texto: detección de títulos
// ═══════════════════════════════════════════

function extractTextPdfSections(pageTexts: string[]): ExtractedSection[] {
  const sections: ExtractedSection[] = []
  let currentTitle: string | null = null
  let currentContent: string[] = []
  let currentPage = 1

  for (let pageIdx = 0; pageIdx < pageTexts.length; pageIdx++) {
    const pageText = pageTexts[pageIdx]!
    if (pageText.length < 20) continue

    const lines = pageText.split('\n')

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!.trim()
      if (!line) continue

      const nextLine = lines[i + 1]?.trim()

      if (isImplicitTitle(line, nextLine)) {
        // Guardar sección anterior
        if (currentContent.length > 0 || currentTitle !== null) {
          const content = currentContent.join('\n').trim()
          if (content.length >= 20 || currentTitle !== null) {
            sections.push({
              title: currentTitle,
              content: content || currentTitle || '',
              page: currentPage,
            })
          }
        }
        currentTitle = line.replace(/:$/, '')
        currentContent = []
        currentPage = pageIdx + 1
      } else {
        currentContent.push(line)
      }
    }
  }

  // Última sección
  if (currentContent.length > 0 || currentTitle !== null) {
    const content = currentContent.join('\n').trim()
    if (content.length >= 20 || currentTitle !== null) {
      sections.push({
        title: currentTitle,
        content: content || currentTitle || '',
        page: currentPage,
      })
    }
  }

  // Fallback: si no hay títulos, secciones por página
  if (sections.length === 0) {
    for (let i = 0; i < pageTexts.length; i++) {
      const text = pageTexts[i]!.trim()
      if (text.length < 20) continue
      sections.push({
        title: `Página ${i + 1}`,
        content: text,
        page: i + 1,
      })
    }
  }

  return sections
}

// ═══════════════════════════════════════════
// PDF escaneado: OCR via LLM vision
// ═══════════════════════════════════════════

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function extractScannedPdf(parser: any, pages: number[], fileName: string, registry?: Registry): Promise<ExtractedSection[]> {
  if (!registry) {
    logger.warn({ fileName }, 'PDF escaneado detectado pero sin registry para OCR')
    return [{ title: 'PDF escaneado', content: `[PDF escaneado: ${fileName}. LLM no disponible para OCR.]` }]
  }

  // Load OCR system prompt from .md template
  let ocrSystem = PDF_OCR_SYSTEM_FALLBACK
  const promptsSvc = registry.getOptional<PromptsService>('prompts:service')
  if (promptsSvc) {
    try {
      const tmpl = await promptsSvc.getSystemPrompt('pdf-ocr')
      if (tmpl) ocrSystem = tmpl
    } catch { /* fallback */ }
  }

  const sections: ExtractedSection[] = []
  const pagesToProcess = pages.slice(0, MAX_VISION_PAGES)

  try {
    const screenshotResult = await parser.getScreenshot({
      partial: pagesToProcess,
      scale: 1.5,
      imageBuffer: true,
    })

    if (screenshotResult?.pages) {
      for (const page of screenshotResult.pages) {
        if (!page.data) continue
        const pageBuffer = Buffer.from(page.data)

        try {
          const visionResult = await registry.callHook('llm:chat', {
            task: 'extractor-pdf-ocr',
            system: ocrSystem,
            messages: [{
              role: 'user' as const,
              content: [
                { type: 'image_url', data: pageBuffer.toString('base64'), mimeType: 'image/png' },
                { type: 'text', text: `OCR de la página ${page.pageNumber} del documento "${fileName}".` },
              ],
            }],
            maxTokens: 4000,
            temperature: 0.1,
          })

          if (visionResult?.text?.trim()) {
            // Aplicar detección de títulos implícitos al texto del OCR
            const ocrSections = splitOcrText(visionResult.text.trim(), page.pageNumber)
            sections.push(...ocrSections)
          }
        } catch (err) {
          logger.warn({ err, page: page.pageNumber }, 'OCR vision failed for page')
        }
      }
    }
  } catch (err) {
    logger.warn({ err, fileName }, 'Screenshot extraction failed for scanned PDF')
  }

  if (sections.length === 0) {
    sections.push({ title: 'PDF escaneado', content: `[PDF escaneado sin texto extraíble: ${fileName}]` })
  }

  return sections
}

/**
 * Parte texto de OCR detectando títulos implícitos.
 */
function splitOcrText(text: string, pageNumber: number): ExtractedSection[] {
  const lines = text.split('\n')
  const sections: ExtractedSection[] = []
  let currentTitle: string | null = null
  let currentContent: string[] = []

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    const nextLine = lines[i + 1]

    if (isImplicitTitle(line, nextLine)) {
      if (currentContent.length > 0 || currentTitle !== null) {
        const content = currentContent.join('\n').trim()
        if (content.length >= 10) {
          sections.push({ title: currentTitle, content, page: pageNumber })
        }
      }
      currentTitle = line.trim().replace(/:$/, '')
      currentContent = []
    } else {
      currentContent.push(line)
    }
  }

  if (currentContent.length > 0 || currentTitle !== null) {
    const content = currentContent.join('\n').trim()
    if (content.length >= 10 || currentTitle !== null) {
      sections.push({ title: currentTitle, content: content || currentTitle || '', page: pageNumber })
    }
  }

  // Fallback: todo el texto como una sección
  if (sections.length === 0 && text.length >= 10) {
    sections.push({ title: `Página ${pageNumber} (OCR)`, content: text, page: pageNumber })
  }

  return sections
}

// ═══════════════════════════════════════════
// Extracción visual de páginas con poco texto
// (para PDF con texto pero con páginas de imagen)
// ═══════════════════════════════════════════

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function extractVisionPages(parser: any, imagePages: number[], fileName: string, registry: Registry): Promise<ExtractedSection[]> {
  const sections: ExtractedSection[] = []
  const pagesToProcess = imagePages.slice(0, MAX_VISION_PAGES)

  try {
    const screenshotResult = await parser.getScreenshot({
      partial: pagesToProcess,
      scale: 1.5,
      imageBuffer: true,
    })

    if (screenshotResult?.pages) {
      for (const page of screenshotResult.pages) {
        if (!page.data) continue
        const pageBuffer = Buffer.from(page.data)

        try {
          const visionResult = await registry.callHook('llm:chat', {
            task: 'extractor-pdf-vision',
            system: 'Extrae y describe todo el contenido visible de esta imagen de un documento PDF. Incluye todo el texto, tablas, gráficos y elementos visuales. Responde solo con el contenido extraído.',
            messages: [{
              role: 'user' as const,
              content: [
                { type: 'image_url', data: pageBuffer.toString('base64'), mimeType: 'image/png' },
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
          }
        } catch (err) {
          logger.warn({ err, page: page.pageNumber }, 'Vision extraction failed for page')
        }
      }
    }
  } catch (err) {
    logger.warn({ err, imagePages }, 'Screenshot extraction failed, text-only')
  }

  return sections
}
