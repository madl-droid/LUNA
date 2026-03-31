// LUNA — Tests — Extractors: dual-result extraction + LLM enrichment
// Verifica que los extractores producen resultado de código y se enriquecen con LLM.

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ═══════════════════════════════════════════
// Mock Registry
// ═══════════════════════════════════════════

function createMockRegistry(llmResponse?: { text: string; provider?: string }) {
  const callHook = vi.fn().mockResolvedValue(
    llmResponse ?? { text: 'Mock LLM description', provider: 'google' },
  )
  const getOptional = vi.fn().mockReturnValue(null)

  return {
    callHook,
    getOptional,
    // Minimal Registry interface
    get: vi.fn(),
    has: vi.fn().mockReturnValue(false),
    register: vi.fn(),
  } as unknown as import('../../src/kernel/registry.js').Registry
}

// ═══════════════════════════════════════════
// Helpers: create minimal test buffers
// ═══════════════════════════════════════════

/** Minimal valid PNG: 1x1 pixel transparent */
function createMinimalPNG(): Buffer {
  return Buffer.from(
    '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489' +
    '0000000a49444154789c626000000002000198e195ee0000000049454e44ae426082',
    'hex',
  )
}

/** Minimal text buffer */
function createTextBuffer(text: string): Buffer {
  return Buffer.from(text, 'utf-8')
}

// ═══════════════════════════════════════════
// types.ts — LLMEnrichment + toExtractedContent
// ═══════════════════════════════════════════

describe('types.ts', () => {
  describe('toExtractedContent', () => {
    it('uses LLM description for image when available', async () => {
      const { toExtractedContent } = await import('../../src/extractors/types.js')
      const result = toExtractedContent({
        kind: 'image',
        buffer: Buffer.alloc(0),
        mimeType: 'image/png',
        width: 100,
        height: 100,
        md5: 'abc123',
        accompanyingText: '[Imagen: test.png]',
        llmEnrichment: {
          description: 'Una foto de un gato naranja dormido',
          provider: 'google',
          generatedAt: new Date(),
        },
        metadata: { originalName: 'test.png' },
      })

      expect(result.text).toBe('Una foto de un gato naranja dormido')
      expect(result.sections[0]?.content).toBe('Una foto de un gato naranja dormido')
    })

    it('falls back to accompanyingText when no LLM enrichment', async () => {
      const { toExtractedContent } = await import('../../src/extractors/types.js')
      const result = toExtractedContent({
        kind: 'image',
        buffer: Buffer.alloc(0),
        mimeType: 'image/png',
        width: 100,
        height: 100,
        md5: 'abc123',
        accompanyingText: '[Imagen: test.png]',
        metadata: { originalName: 'test.png' },
      })

      expect(result.text).toBe('[Imagen: test.png]')
    })

    it('uses LLM transcription for audio when available', async () => {
      const { toExtractedContent } = await import('../../src/extractors/types.js')
      const result = toExtractedContent({
        kind: 'audio',
        buffer: Buffer.alloc(0),
        format: 'mp3',
        mimeType: 'audio/mpeg',
        durationSeconds: 30,
        accompanyingText: null,
        llmEnrichment: {
          description: '[Transcripción de audio mp3, 30s]',
          transcription: 'Hola, quiero agendar una cita para mañana.',
          provider: 'google',
          generatedAt: new Date(),
        },
        metadata: { originalName: 'audio.mp3' },
      })

      expect(result.text).toBe('Hola, quiero agendar una cita para mañana.')
    })

    it('uses LLM description + transcription for video', async () => {
      const { toExtractedContent } = await import('../../src/extractors/types.js')
      const result = toExtractedContent({
        kind: 'video',
        buffer: Buffer.alloc(0),
        format: 'mp4',
        mimeType: 'video/mp4',
        durationSeconds: 60,
        hasAudio: true,
        accompanyingText: null,
        llmEnrichment: {
          description: 'Video de una presentación de producto',
          transcription: 'Hoy les presento nuestro nuevo servicio.',
          provider: 'google',
          generatedAt: new Date(),
        },
        metadata: { originalName: 'demo.mp4' },
      })

      expect(result.text).toContain('Video de una presentación de producto')
      expect(result.text).toContain('[Transcripción]: Hoy les presento nuestro nuevo servicio.')
    })

    it('includes slide screenshot descriptions', async () => {
      const { toExtractedContent } = await import('../../src/extractors/types.js')
      const result = toExtractedContent({
        kind: 'slides',
        fileName: 'deck.pptx',
        slides: [
          {
            index: 0,
            title: 'Intro',
            text: 'Bienvenidos',
            screenshotPng: null,
            screenshotDescription: 'Slide con logo y texto de bienvenida',
          },
        ],
        metadata: { originalName: 'deck.pptx' },
      })

      expect(result.text).toContain('[Descripción visual]: Slide con logo y texto de bienvenida')
    })
  })
})

// ═══════════════════════════════════════════
// image.ts — extractImage + describeImage
// ═══════════════════════════════════════════

describe('image.ts', () => {
  describe('extractImage (code-only)', () => {
    it('extracts PNG metadata without LLM', async () => {
      const { extractImage } = await import('../../src/extractors/image.js')
      const buffer = createMinimalPNG()
      const result = await extractImage(buffer, 'test.png', 'image/png')

      expect(result.kind).toBe('image')
      expect(result.mimeType).toBe('image/png')
      expect(result.md5).toBeTruthy()
      expect(result.width).toBe(1)
      expect(result.height).toBe(1)
      expect(result.llmEnrichment).toBeUndefined()
      expect(result.accompanyingText).toContain('test.png')
    })
  })

  describe('describeImage (LLM enrichment)', () => {
    it('adds llmEnrichment with vision description', async () => {
      const { extractImage, describeImage } = await import('../../src/extractors/image.js')
      const registry = createMockRegistry({ text: 'Imagen de un formulario con campos de nombre y email', provider: 'google' })

      const codeResult = await extractImage(createMinimalPNG(), 'form.png', 'image/png')
      expect(codeResult.llmEnrichment).toBeUndefined()

      const enriched = await describeImage(codeResult, registry)

      expect(enriched.llmEnrichment).toBeDefined()
      expect(enriched.llmEnrichment!.description).toBe('Imagen de un formulario con campos de nombre y email')
      expect(enriched.llmEnrichment!.provider).toBe('google')
      expect(enriched.llmEnrichment!.generatedAt).toBeInstanceOf(Date)
      // Original fields preserved
      expect(enriched.kind).toBe('image')
      expect(enriched.md5).toBe(codeResult.md5)
    })

    it('returns original result if LLM fails', async () => {
      const { extractImage, describeImage } = await import('../../src/extractors/image.js')
      const registry = createMockRegistry()
      registry.callHook = vi.fn().mockRejectedValue(new Error('LLM unavailable')) as typeof registry.callHook

      const codeResult = await extractImage(createMinimalPNG(), 'test.png', 'image/png')
      const enriched = await describeImage(codeResult, registry)

      expect(enriched.llmEnrichment).toBeUndefined()
      expect(enriched.md5).toBe(codeResult.md5)
    })
  })
})

// ═══════════════════════════════════════════
// index.ts — enrichWithLLM orchestrator
// ═══════════════════════════════════════════

describe('index.ts — enrichWithLLM', () => {
  it('routes image to describeImage', async () => {
    const { enrichWithLLM } = await import('../../src/extractors/index.js')
    const registry = createMockRegistry({ text: 'Descripción de imagen test', provider: 'google' })

    const imageResult = {
      kind: 'image' as const,
      buffer: createMinimalPNG(),
      mimeType: 'image/png',
      width: 1,
      height: 1,
      md5: 'abc',
      accompanyingText: '[test]',
      metadata: { originalName: 'test.png' },
    }

    const enriched = await enrichWithLLM(imageResult, registry)
    expect(enriched.kind).toBe('image')
    if (enriched.kind === 'image') {
      expect(enriched.llmEnrichment?.description).toBe('Descripción de imagen test')
    }
  })

  it('returns document as-is (no LLM needed)', async () => {
    const { enrichWithLLM } = await import('../../src/extractors/index.js')
    const registry = createMockRegistry()

    const docResult = {
      kind: 'document' as const,
      text: 'Contenido del documento',
      sections: [{ title: null, content: 'Contenido del documento' }],
      metadata: { originalName: 'doc.pdf' },
    }

    const enriched = await enrichWithLLM(docResult, registry)
    expect(enriched).toBe(docResult) // Same reference, not enriched
    expect(registry.callHook).not.toHaveBeenCalled()
  })

  it('returns sheets as-is (no LLM needed)', async () => {
    const { enrichWithLLM } = await import('../../src/extractors/index.js')
    const registry = createMockRegistry()

    const sheetsResult = {
      kind: 'sheets' as const,
      parentId: 'sheet1',
      fileName: 'data.xlsx',
      sheets: [],
      metadata: { originalName: 'data.xlsx' },
    }

    const enriched = await enrichWithLLM(sheetsResult, registry)
    expect(enriched).toBe(sheetsResult)
    expect(registry.callHook).not.toHaveBeenCalled()
  })
})

// ═══════════════════════════════════════════
// Processor types — CATEGORY_LABEL_MAP
// ═══════════════════════════════════════════

describe('attachment types', () => {
  it('has category labels for all categories', async () => {
    const { CATEGORY_LABEL_MAP } = await import('../../src/engine/attachments/types.js')

    expect(CATEGORY_LABEL_MAP.documents).toBe('PDF/DOC')
    expect(CATEGORY_LABEL_MAP.images).toBe('Imagen')
    expect(CATEGORY_LABEL_MAP.audio).toBe('Audio')
    expect(CATEGORY_LABEL_MAP.spreadsheets).toBe('Hoja de cálculo')
    expect(CATEGORY_LABEL_MAP.presentations).toBe('Presentación')
    expect(CATEGORY_LABEL_MAP.text).toBe('TXT/MD')
    expect(CATEGORY_LABEL_MAP.web_link).toBe('Enlace web')
  })

  it('has SMALL_FILE_TOKEN_THRESHOLD at 8192', async () => {
    const { SMALL_FILE_TOKEN_THRESHOLD } = await import('../../src/engine/attachments/types.js')
    expect(SMALL_FILE_TOKEN_THRESHOLD).toBe(8192)
  })
})

// ═══════════════════════════════════════════
// Text extraction (no LLM needed)
// ═══════════════════════════════════════════

describe('text extractors (code-only)', () => {
  it('extractMarkdown produces sections from headings', async () => {
    const { extractMarkdown } = await import('../../src/extractors/text.js')
    const md = '# Título\nContenido del título\n## Sección 2\nMás contenido'
    const result = await extractMarkdown(createTextBuffer(md), 'doc.md')

    expect(result.sections.length).toBeGreaterThanOrEqual(2)
    expect(result.sections[0]?.title).toBe('Título')
    expect(result.text).toContain('Contenido del título')
  })

  it('extractPlainText handles implicit titles', async () => {
    const { extractPlainText } = await import('../../src/extractors/text.js')
    const txt = 'TITULO IMPORTANTE:\nEste es un párrafo largo con mucho contenido que sigue al título para verificar la detección.'
    const result = await extractPlainText(createTextBuffer(txt), 'note.txt')

    expect(result.text).toContain('TITULO IMPORTANTE')
  })

  it('extractJSON pretty-prints valid JSON', async () => {
    const { extractJSON } = await import('../../src/extractors/text.js')
    const json = '{"name":"test","value":42}'
    const result = await extractJSON(createTextBuffer(json), 'data.json')

    expect(result.text).toContain('"name": "test"')
    expect(result.text).toContain('"value": 42')
  })
})

// ═══════════════════════════════════════════
// classifyMimeType
// ═══════════════════════════════════════════

describe('classifyMimeType', () => {
  it('classifies common MIME types correctly', async () => {
    const { classifyMimeType } = await import('../../src/extractors/index.js')

    expect(classifyMimeType('image/png')).toBe('image')
    expect(classifyMimeType('image/jpeg')).toBe('image')
    expect(classifyMimeType('audio/mpeg')).toBe('audio')
    expect(classifyMimeType('audio/ogg')).toBe('audio')
    expect(classifyMimeType('video/mp4')).toBe('video')
    expect(classifyMimeType('application/pdf')).toBe('document')
    expect(classifyMimeType('text/plain')).toBe('text')
    expect(classifyMimeType('text/markdown')).toBe('text')
    expect(classifyMimeType('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).toBe('sheets')
    expect(classifyMimeType('application/vnd.openxmlformats-officedocument.presentationml.presentation')).toBe('presentation')
    expect(classifyMimeType('application/octet-stream')).toBe('unknown')
  })
})
