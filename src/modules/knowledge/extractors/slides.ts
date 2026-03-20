// LUNA — Module: knowledge — Slides Extractor
// Extrae texto de presentaciones SOLO si google-apps está activo.
// Sin Google Auth → este extractor no está disponible.

import type { Registry } from '../../../kernel/registry.js'
import type { ExtractedContent, ExtractedSection } from '../types.js'
import pino from 'pino'

const logger = pino({ name: 'knowledge:extractor:slides' })

/**
 * Extract text from a Google Slides presentation using the Slides API.
 * Requires google:slides service to be available.
 *
 * @param presentationId - Google Slides presentation ID (from Drive)
 * @param registry - Kernel registry for service access
 */
export async function extractSlides(
  presentationId: string,
  registry: Registry,
): Promise<ExtractedContent | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const slidesService = registry.getOptional<any>('google:slides')
  if (!slidesService) {
    logger.warn('Google Slides service not available — cannot extract presentation')
    return null
  }

  try {
    const info = await slidesService.getPresentation(presentationId)
    const textContent = await slidesService.extractText(presentationId)

    const sections: ExtractedSection[] = []
    if (typeof textContent === 'string') {
      // Split by slide markers if present
      const slides = textContent.split(/---slide---/i)
      for (let i = 0; i < slides.length; i++) {
        const text = slides[i]!.trim()
        if (text.length < 10) continue
        sections.push({
          title: `Diapositiva ${i + 1}`,
          content: text,
          page: i + 1,
        })
      }

      // If no slide markers, treat as single section
      if (sections.length === 0 && textContent.trim().length >= 10) {
        sections.push({
          title: info.title ?? 'Presentación',
          content: textContent.trim(),
        })
      }
    }

    return {
      text: typeof textContent === 'string' ? textContent : JSON.stringify(textContent),
      sections,
      metadata: {
        originalName: info.title ?? presentationId,
        extractorUsed: 'google-slides-api',
      },
    }
  } catch (err) {
    logger.error({ presentationId, err }, 'Failed to extract slides')
    return null
  }
}

/**
 * Check if slides extraction is available (google:slides service exists).
 */
export function isSlidesAvailable(registry: Registry): boolean {
  return registry.getOptional('google:slides') !== null
}
