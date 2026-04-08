// LUNA — Module: google-apps — Slides Service
// Lectura, edición y creación de Google Slides.

import { google } from 'googleapis'
import type { OAuth2Client } from 'google-auth-library'
import type { SlideInfo, SlideEditOperation, GoogleApiConfig } from './types.js'
import { googleApiCall } from './api-wrapper.js'

export class SlidesService {
  private slides
  private apiConfig: { timeoutMs: number; maxRetries: number }

  constructor(auth: OAuth2Client, config?: GoogleApiConfig) {
    this.slides = google.slides({ version: 'v1', auth })
    this.apiConfig = {
      timeoutMs: config?.GOOGLE_API_TIMEOUT_MS ?? 30000,
      maxRetries: config?.GOOGLE_API_RETRY_MAX ?? 2,
    }
  }

  async getPresentation(presentationId: string): Promise<SlideInfo> {
    const res = await googleApiCall(
      () => this.slides.presentations.get({ presentationId }),
      this.apiConfig, 'slides.presentations.get',
    )

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
    const res = await googleApiCall(
      () => this.slides.presentations.create({ requestBody: { title } }),
      this.apiConfig, 'slides.presentations.create',
    )

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
    const result = await this.getSlideTextWithInfo(presentationId, slideIndex)
    return result.text
  }

  /** Single-fetch: returns text + title + totalSlides (used by slides-read tool) */
  async getSlideTextWithInfo(
    presentationId: string,
    slideIndex?: number,
  ): Promise<{ text: string; title: string; totalSlides: number }> {
    const res = await googleApiCall(
      () => this.slides.presentations.get({ presentationId }),
      this.apiConfig, 'slides.presentations.get(text)',
    )
    const slides = res.data.slides ?? []
    const title = res.data.title ?? ''
    const totalSlides = slides.length

    if (slideIndex !== undefined) {
      const slide = slides[slideIndex]
      if (!slide) return { text: '', title, totalSlides }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let text = this.extractSlideText(slide as any)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const notes = this.extractSpeakerNotes(slide as any)
      if (notes) text += '\n[Notas del presentador]: ' + notes
      return { text, title, totalSlides }
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
        if (notes.trim()) slideOutput += `\n[Notas del presentador]: ${notes}`
        parts.push(slideOutput)
      }
    }
    return { text: parts.join('\n\n'), title, totalSlides }
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

    await googleApiCall(
      () => this.slides.presentations.batchUpdate({
        presentationId,
        requestBody: { requests: [{ createSlide: request }] },
      }),
      this.apiConfig, 'slides.presentations.batchUpdate(addSlide)',
    )

    return objectId
  }

  async updateSpeakerNotes(presentationId: string, slideIndex: number, text: string): Promise<void> {
    const result = await this.batchEdit(presentationId, [
      { type: 'update_notes', slideIndex, text },
    ])
    const detail = result.results[0]?.detail as Record<string, unknown> | undefined
    if (detail?.error) {
      throw new Error(String(detail.error))
    }
  }

  async batchEdit(
    presentationId: string,
    operations: SlideEditOperation[],
  ): Promise<{ applied: number; results: Array<{ type: string; detail: unknown }> }> {
    const needsFetch = operations.some((op) => op.type === 'update_notes')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const presentationData: any = needsFetch
      ? (await googleApiCall(
          () => this.slides.presentations.get({ presentationId }),
          this.apiConfig, 'slides.presentations.get(batchEdit)',
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ) as any).data
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
      await googleApiCall(
        () => this.slides.presentations.batchUpdate({
          presentationId,
          requestBody: { requests },
        }),
        this.apiConfig, 'slides.presentations.batchUpdate(batch)',
      )
    }

    const successCount = results.filter(r => !(r.detail as Record<string, unknown>)?.error).length
    return { applied: successCount, results }
  }

  async replaceText(presentationId: string, searchText: string, replaceText: string): Promise<number> {
    const res = await googleApiCall(
      () => this.slides.presentations.batchUpdate({
        presentationId,
        requestBody: {
          requests: [
            { replaceAllText: { containsText: { text: searchText, matchCase: true }, replaceText } },
          ],
        },
      }),
      this.apiConfig, 'slides.presentations.batchUpdate(replace)',
    )

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
    await googleApiCall(
      () => this.slides.presentations.batchUpdate({
        presentationId,
        requestBody: {
          requests: [{ insertText: { objectId: shapeId, text, insertionIndex } }],
        },
      }),
      this.apiConfig, 'slides.presentations.batchUpdate(insertShape)',
    )
  }

  /**
   * Extrae texto de un array de pageElements (shapes con texto).
   * Usado por extractSlideText (slide content) y extractSpeakerNotes (notes page).
   */
  private extractTextFromElements(
    pageElements: Array<Record<string, unknown>>,
    options?: { trimEmpty?: boolean },
  ): string {
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
          if (!options?.trimEmpty || content.trim()) {
            parts.push(content)
          }
        }
      }
    }
    return options?.trimEmpty ? parts.join('').trim() : parts.join('')
  }

  private extractSlideText(slide: Record<string, unknown>): string {
    const elements = (slide.pageElements ?? []) as Array<Record<string, unknown>>
    return this.extractTextFromElements(elements)
  }

  private extractSpeakerNotes(slide: Record<string, unknown>): string {
    const slideProps = slide.slideProperties as Record<string, unknown> | undefined
    const notesPage = slideProps?.notesPage as Record<string, unknown> | undefined
    if (!notesPage) return ''
    const elements = (notesPage.pageElements ?? []) as Array<Record<string, unknown>>
    return this.extractTextFromElements(elements, { trimEmpty: true })
  }
}
