// LUNA — Module: google-apps — Slides Service
// Lectura, edición y creación de Google Slides.

import { google } from 'googleapis'
import type { OAuth2Client } from 'google-auth-library'
import type { SlideInfo } from './types.js'

export class SlidesService {
  private slides

  constructor(auth: OAuth2Client) {
    this.slides = google.slides({ version: 'v1', auth })
  }

  async getPresentation(presentationId: string): Promise<SlideInfo> {
    const res = await this.slides.presentations.get({ presentationId })

    return {
      presentationId: res.data.presentationId ?? presentationId,
      title: res.data.title ?? '',
      slides: (res.data.slides ?? []).map((s: { objectId?: string | null; pageElements?: unknown[] | null }) => ({
        objectId: s.objectId ?? '',
        pageElements: s.pageElements?.length ?? 0,
      })),
      locale: res.data.locale ?? undefined,
    }
  }

  async createPresentation(title: string): Promise<SlideInfo> {
    const res = await this.slides.presentations.create({
      requestBody: { title },
    })

    return {
      presentationId: res.data.presentationId ?? '',
      title: res.data.title ?? title,
      slides: (res.data.slides ?? []).map((s: { objectId?: string | null; pageElements?: unknown[] | null }) => ({
        objectId: s.objectId ?? '',
        pageElements: s.pageElements?.length ?? 0,
      })),
    }
  }

  async getSlideText(presentationId: string, slideIndex?: number): Promise<string> {
    const res = await this.slides.presentations.get({ presentationId })
    const slides = res.data.slides ?? []

    if (slideIndex !== undefined) {
      const slide = slides[slideIndex]
      if (!slide) return ''
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return this.extractSlideText(slide as any)
    }

    // Todos los slides
    const parts: string[] = []
    for (let i = 0; i < slides.length; i++) {
      const slide = slides[i]!
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const text = this.extractSlideText(slide as any)
      if (text.trim()) {
        parts.push(`[Slide ${i + 1}]\n${text}`)
      }
    }
    return parts.join('\n\n')
  }

  async addSlide(presentationId: string, layout?: string): Promise<string> {
    const objectId = `slide_${Date.now()}`

    const request: Record<string, unknown> = {
      objectId,
    }
    if (layout) {
      request.slideLayoutReference = { predefinedLayout: layout }
    }

    await this.slides.presentations.batchUpdate({
      presentationId,
      requestBody: {
        requests: [{ createSlide: request }],
      },
    })

    return objectId
  }

  async replaceText(presentationId: string, searchText: string, replaceText: string): Promise<number> {
    const res = await this.slides.presentations.batchUpdate({
      presentationId,
      requestBody: {
        requests: [
          {
            replaceAllText: {
              containsText: { text: searchText, matchCase: true },
              replaceText,
            },
          },
        ],
      },
    })

    const reply = res.data.replies?.[0]
    const replaceResult = reply as Record<string, unknown> | undefined
    const replaceAllText = replaceResult?.replaceAllText as Record<string, unknown> | undefined
    return (replaceAllText?.occurrencesChanged as number) ?? 0
  }

  async insertTextInShape(
    presentationId: string,
    shapeId: string,
    text: string,
    insertionIndex = 0,
  ): Promise<void> {
    await this.slides.presentations.batchUpdate({
      presentationId,
      requestBody: {
        requests: [
          {
            insertText: {
              objectId: shapeId,
              text,
              insertionIndex,
            },
          },
        ],
      },
    })
  }

  private extractSlideText(slide: Record<string, unknown>): string {
    const parts: string[] = []
    const elements = (slide.pageElements ?? []) as Array<Record<string, unknown>>

    for (const element of elements) {
      const shape = element.shape as Record<string, unknown> | undefined
      if (!shape) continue

      const textContent = shape.text as Record<string, unknown> | undefined
      if (!textContent) continue

      const textElements = (textContent.textElements ?? []) as Array<Record<string, unknown>>
      for (const te of textElements) {
        const textRun = te.textRun as Record<string, unknown> | undefined
        if (textRun?.content) {
          parts.push(String(textRun.content))
        }
      }
    }

    return parts.join('')
  }
}
