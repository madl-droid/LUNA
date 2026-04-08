// LUNA — Module: google-apps — Slides Service
// Lectura, edición y creación de Google Slides.

import { google } from 'googleapis'
import type { OAuth2Client } from 'google-auth-library'
import type { SlideInfo, SlideEditOperation } from './types.js'

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
      const text = this.extractSlideText(slide as any)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const notes = this.extractSpeakerNotes(slide as any)
      let result = text
      if (notes) {
        result += '\n[Notas del presentador]: ' + notes
      }
      return result
    }

    // Todos los slides
    const parts: string[] = []
    for (let i = 0; i < slides.length; i++) {
      const slide = slides[i]!
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const text = this.extractSlideText(slide as any)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const notes = this.extractSpeakerNotes(slide as any)
      if (text.trim() || notes.trim()) {
        let slideOutput = `[Slide ${i + 1}]\n${text}`
        if (notes.trim()) {
          slideOutput += `\n[Notas del presentador]: ${notes}`
        }
        parts.push(slideOutput)
      }
    }
    return parts.join('\n\n')
  }

  async addSlide(presentationId: string, layout?: string, insertionIndex?: number): Promise<string> {
    const objectId = `slide_${Date.now()}`

    const request: Record<string, unknown> = { objectId }
    if (layout) {
      request.slideLayoutReference = { predefinedLayout: layout }
    }
    if (insertionIndex !== undefined) {
      request.insertionIndex = insertionIndex
    }

    await this.slides.presentations.batchUpdate({
      presentationId,
      requestBody: {
        requests: [{ createSlide: request }],
      },
    })

    return objectId
  }

  async updateSpeakerNotes(presentationId: string, slideIndex: number, text: string): Promise<void> {
    const res = await this.slides.presentations.get({ presentationId })
    const slides = res.data.slides ?? []
    const slide = slides[slideIndex]
    if (!slide) throw new Error(`Slide ${slideIndex} no encontrado`)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const notesPage = (slide as any).slideProperties?.notesPage
    if (!notesPage) throw new Error('El slide no tiene página de notas')

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pageElements = (notesPage.pageElements ?? []) as Array<any>
    const textBox = pageElements.find(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (el: any) => el.shape?.shapeType === 'TEXT_BOX' || el.shape?.text,
    )
    if (!textBox) throw new Error('No se encontró text box en la página de notas')

    const existingElements = (textBox.shape?.text?.textElements ?? []) as Array<Record<string, unknown>>
    const hasText = existingElements.some(
      (te) => (te.textRun as Record<string, unknown> | undefined)?.content !== undefined &&
        String((te.textRun as Record<string, unknown>).content).trim() !== '',
    )

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const requests: any[] = []
    if (hasText) {
      requests.push({ deleteText: { objectId: textBox.objectId, textRange: { type: 'ALL' } } })
    }
    requests.push({ insertText: { objectId: textBox.objectId, text, insertionIndex: 0 } })

    await this.slides.presentations.batchUpdate({
      presentationId,
      requestBody: { requests },
    })
  }

  async batchEdit(
    presentationId: string,
    operations: SlideEditOperation[],
  ): Promise<{ applied: number; results: Array<{ type: string; detail: unknown }> }> {
    const needsFetch = operations.some((op) => op.type === 'update_notes')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const presentationData: any = needsFetch
      ? (await this.slides.presentations.get({ presentationId })).data
      : null

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const requests: any[] = []
    const results: Array<{ type: string; detail: unknown }> = []

    for (const op of operations) {
      if (op.type === 'replace_text') {
        requests.push({
          replaceAllText: {
            containsText: { text: op.searchText, matchCase: true },
            replaceText: op.replaceText,
          },
        })
        results.push({ type: 'replace_text', detail: { searchText: op.searchText } })
      } else if (op.type === 'add_slide') {
        const slideObjId = `slide_${Date.now()}_${requests.length}`
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const createReq: any = { objectId: slideObjId }
        if (op.layout) createReq.slideLayoutReference = { predefinedLayout: op.layout }
        if (op.insertionIndex !== undefined) createReq.insertionIndex = op.insertionIndex
        requests.push({ createSlide: createReq })
        results.push({ type: 'add_slide', detail: { objectId: slideObjId } })
      } else if (op.type === 'update_notes') {
        const slideData = presentationData?.slides?.[op.slideIndex!]
        if (!slideData) {
          results.push({ type: 'update_notes', detail: { error: `Slide ${op.slideIndex} no encontrado` } })
          continue
        }
        const notesPage = slideData.slideProperties?.notesPage
        if (!notesPage) {
          results.push({ type: 'update_notes', detail: { error: 'Slide sin página de notas' } })
          continue
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const textBox = (notesPage.pageElements ?? []).find(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (el: any) => el.shape?.shapeType === 'TEXT_BOX' || el.shape?.text,
        )
        if (!textBox) {
          results.push({ type: 'update_notes', detail: { error: 'No se encontró text box en notas' } })
          continue
        }
        const existingText = (textBox.shape?.text?.textElements ?? [])
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .some((te: any) => te.textRun?.content?.trim())
        if (existingText) {
          requests.push({ deleteText: { objectId: textBox.objectId, textRange: { type: 'ALL' } } })
        }
        requests.push({ insertText: { objectId: textBox.objectId, text: op.text, insertionIndex: 0 } })
        results.push({ type: 'update_notes', detail: { slideIndex: op.slideIndex, updated: true } })
      }
    }

    if (requests.length > 0) {
      await this.slides.presentations.batchUpdate({
        presentationId,
        requestBody: { requests },
      })
    }

    return { applied: operations.length, results }
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

  private extractSpeakerNotes(slide: Record<string, unknown>): string {
    const slideProps = slide.slideProperties as Record<string, unknown> | undefined
    const notesPage = slideProps?.notesPage as Record<string, unknown> | undefined
    if (!notesPage) return ''

    const pageElements = (notesPage.pageElements ?? []) as Array<Record<string, unknown>>
    const parts: string[] = []

    for (const element of pageElements) {
      const shape = element.shape as Record<string, unknown> | undefined
      if (!shape) continue

      const textContent = shape.text as Record<string, unknown> | undefined
      if (!textContent) continue

      const textElements = (textContent.textElements ?? []) as Array<Record<string, unknown>>
      for (const te of textElements) {
        const textRun = te.textRun as Record<string, unknown> | undefined
        if (textRun?.content) {
          const content = String(textRun.content)
          if (content.trim()) {
            parts.push(content)
          }
        }
      }
    }

    return parts.join('').trim()
  }
}
