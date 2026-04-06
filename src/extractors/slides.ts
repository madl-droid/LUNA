// LUNA — Global Extractors — Slides / PowerPoint
// Extrae texto y screenshots de presentaciones.
// Google Slides: via API (requiere google:slides service).
// PPTX local: via XML del ZIP + LibreOffice para PDF multimodal.
// Cada slide: texto extraído + imagen PNG renderizada del slide completo.
// No se extraen imágenes individuales embebidas.

import type { Registry } from '../kernel/registry.js'
import type { ExtractedContent, ExtractedSection, SlidesResult, ExtractedSlide, LLMEnrichment } from './types.js'
import { isImplicitTitle } from './utils.js'
import pino from 'pino'

const logger = pino({ name: 'extractors:slides' })

// ═══════════════════════════════════════════
// Google Slides (via API)
// ═══════════════════════════════════════════

/**
 * Extrae texto y screenshots de una presentación de Google Slides.
 * Requiere google:slides service en el registry.
 */
export async function extractGoogleSlides(
  presentationId: string,
  registry: Registry,
): Promise<SlidesResult | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const slidesService = registry.getOptional<any>('google:slides')
  if (!slidesService) {
    logger.warn('Google Slides service not available')
    return null
  }

  try {
    const info = await slidesService.getPresentation(presentationId)
    const textContent = await slidesService.extractText(presentationId)
    const slides: ExtractedSlide[] = []

    if (typeof textContent === 'string') {
      const slideParts = textContent.split(/---slide---/i)

      for (let i = 0; i < slideParts.length; i++) {
        const text = slideParts[i]!.trim()
        if (text.length < 5) continue

        // Detectar título implícito en la primera línea del slide
        const lines = text.split('\n')
        const firstLine = lines[0]?.trim() ?? ''
        const secondLine = lines[1]?.trim()
        const title = isImplicitTitle(firstLine, secondLine) ? firstLine : null

        // Intentar obtener screenshot del slide
        let screenshotPng: Buffer | null = null
        try {
          if (typeof slidesService.getSlideScreenshot === 'function') {
            screenshotPng = await slidesService.getSlideScreenshot(presentationId, i)
          }
        } catch {
          // Screenshot no disponible, continuar sin imagen
        }

        slides.push({ index: i, title, text, screenshotPng })
      }

      // Fallback: si no hay separadores de slide, un solo slide
      if (slides.length === 0 && textContent.trim().length >= 10) {
        slides.push({
          index: 0,
          title: info.title ?? null,
          text: textContent.trim(),
          screenshotPng: null,
        })
      }
    }

    return {
      kind: 'slides',
      fileName: info.title ?? presentationId,
      slides,
      metadata: {
        originalName: info.title ?? presentationId,
        extractorUsed: 'google-slides-api',
        slideCount: slides.length,
        hasScreenshots: slides.some(s => s.screenshotPng !== null),
      },
    }
  } catch (err) {
    logger.error({ presentationId, err }, 'Failed to extract Google Slides')
    return null
  }
}

/**
 * Verifica si la extracción de Google Slides está disponible.
 */
export function isSlidesAvailable(registry: Registry): boolean {
  return registry.getOptional('google:slides') !== null
}

// ═══════════════════════════════════════════
// LLM Enrichment: Descripción de screenshots via Vision
// Cada slide con screenshotPng se describe con Gemini Vision.
// ═══════════════════════════════════════════

/**
 * Describe los screenshots de slides via Gemini Vision.
 * Recibe un SlidesResult y describe cada slide que tenga screenshotPng.
 * Retorna el SlidesResult con screenshotDescription populado en cada slide.
 */
export async function describeSlideScreenshots(
  slidesResult: SlidesResult,
  registry: Registry,
): Promise<SlidesResult> {
  const slidesWithScreenshots = slidesResult.slides.filter(s => s.screenshotPng !== null)
  if (slidesWithScreenshots.length === 0) return slidesResult

  const descriptions: string[] = []

  // Process each slide screenshot sequentially (to avoid rate limits)
  for (const slide of slidesWithScreenshots) {
    try {
      const base64 = slide.screenshotPng!.toString('base64')
      const result = await registry.callHook('llm:chat', {
        task: 'extractor-slide-vision',
        system: 'Eres un asistente que describe diapositivas de presentaciones. Describe el contenido visual: textos, gráficos, diagramas, imágenes, layout y diseño. Sé preciso. Responde en español.\n\nFormato:\n[DESCRIPCIÓN]\n(descripción)\n\n[RESUMEN]\n(1 línea)',
        messages: [{
          role: 'user' as const,
          content: [
            { type: 'image_url' as const, data: base64, mimeType: 'image/png' },
            { type: 'text' as const, text: `Describe el contenido visual de la diapositiva ${slide.index + 1}${slide.title ? ` (${slide.title})` : ''}.` },
          ],
        }],
        maxTokens: 1000,
      })

      if (result && typeof result === 'object' && 'text' in result) {
        const rawText = (result as { text: string }).text?.trim()
        if (rawText) {
          // Parsear formato dual
          const descMatch = rawText.match(/\[DESCRIPCIÓN\]\s*\n([\s\S]*?)(?:\n\[RESUMEN\]\s*\n|$)/)
          const desc = descMatch?.[1]?.trim() ?? rawText
          slide.screenshotDescription = desc
          descriptions.push(desc)
          continue
        }
      }
    } catch (err) {
      logger.warn({ err, slideIndex: slide.index }, 'Failed to describe slide screenshot')
    }
  }

  // Add overall enrichment if any descriptions were generated
  if (descriptions.length > 0) {
    const enrichment: LLMEnrichment = {
      description: `Descripciones visuales de ${descriptions.length} diapositiva(s) generadas`,
      provider: 'google',
      generatedAt: new Date(),
    }
    return { ...slidesResult, llmEnrichment: enrichment }
  }

  return slidesResult
}

// ═══════════════════════════════════════════
// PPTX local (ZIP/XML)
// ═══════════════════════════════════════════

/**
 * Extrae texto plano de un XML de slide PPTX.
 * Busca todos los elementos <a:t> (text runs).
 */
function extractTextFromSlideXml(xml: string): string {
  const textParts: string[] = []
  const regex = /<a:t[^>]*>([^<]*)<\/a:t>/g
  let match: RegExpExecArray | null
  while ((match = regex.exec(xml)) !== null) {
    if (match[1]) textParts.push(match[1])
  }
  return textParts.join(' ').trim()
}

/**
 * Extrae el título del slide (primer placeholder de tipo title/ctrTitle).
 */
function extractTitleFromSlideXml(xml: string): string | null {
  // Buscar shape con nvSpPr que tenga type="title" o type="ctrTitle"
  const titleMatch = xml.match(/<p:sp>[\s\S]*?<p:nvSpPr>[\s\S]*?type="(?:title|ctrTitle)"[\s\S]*?<\/p:nvSpPr>[\s\S]*?<a:t[^>]*>([^<]*)<\/a:t>/i)
  return titleMatch?.[1]?.trim() ?? null
}

/**
 * Extrae una presentación PPTX local.
 * 1. Extrae texto de los slides del XML del ZIP
 * 2. Extrae speaker notes del XML
 * 3. Convierte a PDF con LibreOffice (para embedding multimodal)
 * 4. Retorna SlidesResult con pdfBuffer y speakerNotes para el chunker
 */
export async function extractPptx(
  input: Buffer,
  fileName: string,
): Promise<SlidesResult & { pdfBuffer?: Buffer; speakerNotes?: Array<{ slideIndex: number; text: string }> }> {
  const { default: JSZip } = await import('jszip')

  const zip = await JSZip.loadAsync(input)
  const slides: ExtractedSlide[] = []
  const speakerNotes: Array<{ slideIndex: number; text: string }> = []

  // Encontrar slides en orden
  let slideIndex = 0
  while (true) {
    const slideFile = zip.file(`ppt/slides/slide${slideIndex + 1}.xml`)
    if (!slideFile) break

    const slideXml = await slideFile.async('string')
    const text = extractTextFromSlideXml(slideXml)
    const title = extractTitleFromSlideXml(slideXml)

    slides.push({
      index: slideIndex,
      title,
      text,
      screenshotPng: null,
    })

    // Speaker notes
    const notesFile = zip.file(`ppt/notesSlides/notesSlide${slideIndex + 1}.xml`)
    if (notesFile) {
      const notesXml = await notesFile.async('string')
      const noteText = extractTextFromSlideXml(notesXml)
      if (noteText.trim()) {
        speakerNotes.push({ slideIndex, text: noteText.trim() })
      }
    }

    slideIndex++
  }

  // Convertir a PDF con LibreOffice para pipeline visual
  let pdfBuffer: Buffer | undefined
  try {
    const { convertToPdf } = await import('./convert-to-pdf.js')
    const result = await convertToPdf(input, fileName)
    if (result) pdfBuffer = result
  } catch (err) {
    logger.warn({ err, fileName }, 'PDF conversion failed for PPTX — continuing without PDF')
  }

  return {
    kind: 'slides',
    fileName,
    slides,
    pdfBuffer,
    speakerNotes,
    metadata: {
      originalName: fileName,
      extractorUsed: 'pptx-xml' + (pdfBuffer ? '+libreoffice-pdf' : ''),
      slideCount: slides.length,
      hasScreenshots: false,
      sizeBytes: input.length,
    },
  }
}

// ═══════════════════════════════════════════
// Backward-compatible para consumers existentes
// ═══════════════════════════════════════════

/**
 * Extrae slides y devuelve ExtractedContent.
 * Wrapper backward-compatible.
 */
export async function extractSlidesAsContent(
  presentationId: string,
  registry: Registry,
): Promise<ExtractedContent | null> {
  const result = await extractGoogleSlides(presentationId, registry)
  if (!result) return null

  const text = result.slides.map(s => `[Slide ${s.index + 1}] ${s.title ?? ''}\n${s.text}`).join('\n\n')
  const sections: ExtractedSection[] = result.slides.map(s => ({
    title: s.title ?? `Diapositiva ${s.index + 1}`,
    content: s.text,
    page: s.index + 1,
  }))

  return {
    text,
    sections,
    metadata: result.metadata,
  }
}
