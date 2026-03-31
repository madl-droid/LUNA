// LUNA — Global Extractors — Slides / PowerPoint
// Extrae texto y screenshots de presentaciones.
// Google Slides: via API (requiere google:slides service).
// PPTX: via text extraction + screenshot si disponible.
// Cada slide: texto extraído + imagen PNG renderizada del slide completo.
// No se extraen imágenes individuales embebidas.

import type { Registry } from '../kernel/registry.js'
import type { ExtractedContent, ExtractedSection, SlidesResult, ExtractedSlide } from './types.js'
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
