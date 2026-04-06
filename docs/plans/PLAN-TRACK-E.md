# Track E: Tests Completos

## Archivos a crear/modificar
- `tests/extractors/dual-result.test.ts` (extender tests existentes)
- Nuevo: `tests/extractors/metadata.test.ts`
- Nuevo: `tests/extractors/temporal-split.test.ts`
- Nuevo: `tests/knowledge/smart-chunker.test.ts`

## Prerrequisitos
- Todos los tracks (A, B, C, D) completados
- NO puede ejecutarse en paralelo con otros tracks

---

## Tests de Metadata (WP1)

### `tests/extractors/metadata.test.ts`

```typescript
describe('Extractor Metadata Completeness', () => {
  describe('text extractors', () => {
    it('extractMarkdown includes wordCount, lineCount, sectionCount, hasExplicitHeadings', ...)
    it('extractPlainText includes wordCount, lineCount, sectionCount', ...)
    it('extractJSON includes wordCount, sectionCount', ...)
    it('extractMarkdown hasExplicitHeadings=true when # headings present', ...)
    it('extractMarkdown hasExplicitHeadings=false when only implicit titles', ...)
  })

  describe('pdf extractor', () => {
    it('extractPDF includes pages, wordCount, hasImages, sectionCount', ...)
    it('extractPDF marks isScanned for scan PDFs', ...)
    it('extractPDF lists imagePages correctly', ...)
  })

  describe('image extractor', () => {
    it('extractImage includes width, height, md5, format, mimeType', ...)
    it('extractImage md5 matches computed MD5', ...)
  })

  describe('audio extractor', () => {
    it('extractAudio includes durationSeconds, format, mimeType, wasConverted', ...)
    it('extractAudio wasConverted=true when format changed', ...)
    it('extractAudio wasConverted=false for native format', ...)
  })

  describe('video extractor', () => {
    it('extractVideo includes durationSeconds, format, hasAudio, wasConverted', ...)
  })

  describe('web extractor', () => {
    it('extractWeb includes domain, title, fetchedAt, sectionCount, imageCount', ...)
    it('extractWeb fetchedAt is valid ISO date', ...)
  })

  describe('youtube extractor', () => {
    it('extractYouTube includes videoId, duration, hasChapters, sectionCount', ...)
    it('extractYouTube hasChapters=true when chapters present', ...)
  })

  describe('sheets extractor', () => {
    it('extractSheets includes sheetCount, totalRows', ...)
    it('extractSheets sheetCount matches actual sheets', ...)
  })

  describe('docx extractor', () => {
    it('extractDocx includes wordCount, hasImages, imageCount, sectionCount', ...)
  })

  describe('slides extractor', () => {
    it('extractGoogleSlides includes slideCount, hasScreenshots', ...)
  })

  // Meta-test: ningún campo de metadata es undefined
  describe('no undefined metadata', () => {
    it('all metadata fields have defined values or are intentionally omitted', ...)
  })
})
```

---

## Tests de LLM Dual Description (WP5)

### Agregar a `tests/extractors/dual-result.test.ts`

```typescript
describe('LLM dual description', () => {
  it('describeImage parses [DESCRIPCIÓN] and [RESUMEN] format', async () => {
    const registry = createMockRegistry({
      text: '[DESCRIPCIÓN]\nUna foto detallada de un gato naranja dormido sobre un sofá azul.\n\n[RESUMEN]\nGato naranja durmiendo en sofá.',
      provider: 'google',
    })

    const { extractImage, describeImage } = await import('../../src/extractors/image.js')
    const codeResult = await extractImage(createMinimalPNG(), 'cat.png', 'image/png')
    const enriched = await describeImage(codeResult, registry)

    expect(enriched.llmEnrichment?.description).toBe('Una foto detallada de un gato naranja dormido sobre un sofá azul.')
    expect(enriched.llmEnrichment?.shortDescription).toBe('Gato naranja durmiendo en sofá.')
  })

  it('describeImage handles response without [RESUMEN] section', async () => {
    const registry = createMockRegistry({
      text: 'Simple description without format markers',
      provider: 'google',
    })

    const { extractImage, describeImage } = await import('../../src/extractors/image.js')
    const codeResult = await extractImage(createMinimalPNG(), 'test.png', 'image/png')
    const enriched = await describeImage(codeResult, registry)

    expect(enriched.llmEnrichment?.description).toBe('Simple description without format markers')
    expect(enriched.llmEnrichment?.shortDescription).toBeUndefined()
  })

  it('extractors do NOT send temperature in llm:chat calls', async () => {
    const registry = createMockRegistry({ text: 'test', provider: 'google' })

    const { extractImage, describeImage } = await import('../../src/extractors/image.js')
    const codeResult = await extractImage(createMinimalPNG(), 'test.png', 'image/png')
    await describeImage(codeResult, registry)

    const callArgs = (registry.callHook as ReturnType<typeof vi.fn>).mock.calls[0]?.[1]
    expect(callArgs).not.toHaveProperty('temperature')
  })
})
```

---

## Tests de Temporal Splitting (WP3, WP4)

### `tests/extractors/temporal-split.test.ts`

```typescript
import { describe, it, expect } from 'vitest'
import { calculateSegments, AUDIO_SPLIT_CONFIG, VIDEO_SPLIT_CONFIG } from '../../src/modules/knowledge/extractors/temporal-splitter.js'

describe('calculateSegments', () => {
  describe('audio config (60/70/10)', () => {
    it('returns empty for 0 duration', () => {
      expect(calculateSegments(0, AUDIO_SPLIT_CONFIG)).toEqual([])
    })

    it('returns single segment for audio <= 60s', () => {
      const segments = calculateSegments(45, AUDIO_SPLIT_CONFIG)
      expect(segments).toHaveLength(1)
      expect(segments[0]).toEqual({ startSeconds: 0, endSeconds: 45 })
    })

    it('returns single segment for exactly 60s', () => {
      const segments = calculateSegments(60, AUDIO_SPLIT_CONFIG)
      expect(segments).toHaveLength(1)
      expect(segments[0]).toEqual({ startSeconds: 0, endSeconds: 60 })
    })

    it('splits 130s audio into correct segments', () => {
      // 60s first, then 70s with 10s overlap
      const segments = calculateSegments(130, AUDIO_SPLIT_CONFIG)
      expect(segments).toHaveLength(2)
      expect(segments[0]).toEqual({ startSeconds: 0, endSeconds: 60 })
      expect(segments[1]).toEqual({ startSeconds: 50, endSeconds: 130 })
      // Overlap: segment 2 starts at 60-10=50
    })

    it('splits 200s audio into correct segments', () => {
      const segments = calculateSegments(200, AUDIO_SPLIT_CONFIG)
      expect(segments).toHaveLength(3)
      expect(segments[0]).toEqual({ startSeconds: 0, endSeconds: 60 })
      expect(segments[1]).toEqual({ startSeconds: 50, endSeconds: 120 })
      expect(segments[2]).toEqual({ startSeconds: 110, endSeconds: 200 })
    })

    it('overlap is exactly 10 seconds between consecutive segments', () => {
      const segments = calculateSegments(300, AUDIO_SPLIT_CONFIG)
      for (let i = 1; i < segments.length; i++) {
        const overlap = segments[i - 1]!.endSeconds - segments[i]!.startSeconds
        expect(overlap).toBe(10)
      }
    })

    it('all seconds covered (no gaps)', () => {
      const duration = 500
      const segments = calculateSegments(duration, AUDIO_SPLIT_CONFIG)
      expect(segments[0]!.startSeconds).toBe(0)
      expect(segments.at(-1)!.endSeconds).toBe(duration)

      for (let i = 1; i < segments.length; i++) {
        expect(segments[i]!.startSeconds).toBeLessThan(segments[i - 1]!.endSeconds)
      }
    })
  })

  describe('video config (50/60/10)', () => {
    it('returns single segment for video <= 50s', () => {
      const segments = calculateSegments(40, VIDEO_SPLIT_CONFIG)
      expect(segments).toHaveLength(1)
      expect(segments[0]).toEqual({ startSeconds: 0, endSeconds: 40 })
    })

    it('splits 120s video correctly', () => {
      const segments = calculateSegments(120, VIDEO_SPLIT_CONFIG)
      expect(segments).toHaveLength(3)
      expect(segments[0]).toEqual({ startSeconds: 0, endSeconds: 50 })
      expect(segments[1]).toEqual({ startSeconds: 40, endSeconds: 100 })
      expect(segments[2]).toEqual({ startSeconds: 90, endSeconds: 120 })
    })
  })
})
```

---

## Tests de Smart Chunker (WP2)

### `tests/knowledge/smart-chunker.test.ts`

```typescript
import { describe, it, expect } from 'vitest'

describe('chunkPdf', () => {
  it('chunks 10-page PDF into 4 chunks of max 3 pages', async () => {
    const { chunkPdf } = await import('../../src/modules/knowledge/extractors/smart-chunker.js')
    const pageTexts = Array.from({ length: 10 }, (_, i) => `Content of page ${i + 1}. `.repeat(20))
    const chunks = chunkPdf(pageTexts, '/tmp/test.pdf', 10)

    // Con 3 págs max y 1 overlap: 1-3, 3-5, 5-7, 7-9, 9-10 = 5 chunks
    expect(chunks.length).toBeGreaterThanOrEqual(4)
    expect(chunks.length).toBeLessThanOrEqual(5)

    // Verificar que todas las páginas están cubiertas
    for (const chunk of chunks) {
      expect(chunk.metadata.pageRange).toBeDefined()
      expect(chunk.contentType).toBe('pdf_pages')
      expect(chunk.mediaRefs).toHaveLength(1)
      expect(chunk.mediaRefs![0]!.mimeType).toBe('application/pdf')
    }
  })

  it('single page PDF returns single chunk', async () => {
    const { chunkPdf } = await import('../../src/modules/knowledge/extractors/smart-chunker.js')
    const chunks = chunkPdf(['Page 1 content here with enough text'], '/tmp/test.pdf', 1)
    expect(chunks).toHaveLength(1)
    expect(chunks[0]!.metadata.pageRange).toBe('1-1')
  })

  it('includes text overlap from previous page', async () => {
    const { chunkPdf } = await import('../../src/modules/knowledge/extractors/smart-chunker.js')
    const pageTexts = Array.from({ length: 6 }, (_, i) => `UNIQUE_MARKER_${i + 1} ` + 'x '.repeat(100))
    const chunks = chunkPdf(pageTexts, '/tmp/test.pdf', 6)

    // Second chunk should start with text from last part of overlap page
    if (chunks.length > 1) {
      const secondChunk = chunks[1]!
      // Should contain overlap prefix indicator
      expect(secondChunk.content).toContain('[...]')
    }
  })
})

describe('chunkSheets', () => {
  it('creates 1 chunk per row with headers', async () => {
    const { chunkSheets } = await import('../../src/modules/knowledge/extractors/smart-chunker.js')
    const headers = ['Name', 'Email', 'Phone']
    const rows = [
      ['John', 'john@test.com', '123'],
      ['Jane', 'jane@test.com', '456'],
    ]
    const chunks = chunkSheets(headers, rows)

    expect(chunks).toHaveLength(2)
    // Each chunk must include headers
    for (const chunk of chunks) {
      expect(chunk.content).toContain('Name')
      expect(chunk.content).toContain('Email')
    }
  })
})

describe('chunkAudio (temporal)', () => {
  it('creates temporal chunks when segments provided', async () => {
    const { chunkAudio } = await import('../../src/modules/knowledge/extractors/smart-chunker.js')

    const chunks = chunkAudio({
      transcription: 'Hello world this is a test transcript that is quite long',
      durationSeconds: 130,
      mimeType: 'audio/mpeg',
      sourceFile: 'test.mp3',
      segments: [
        { startSeconds: 0, endSeconds: 60, segmentPath: '/tmp/seg0.mp3' },
        { startSeconds: 50, endSeconds: 130, segmentPath: '/tmp/seg1.mp3' },
      ],
    })

    expect(chunks).toHaveLength(2)
    expect(chunks[0]!.metadata.timestampStart).toBe(0)
    expect(chunks[0]!.metadata.timestampEnd).toBe(60)
    expect(chunks[1]!.metadata.timestampStart).toBe(50)
    expect(chunks[1]!.metadata.timestampEnd).toBe(130)
  })

  it('falls back to single chunk without segments', async () => {
    const { chunkAudio } = await import('../../src/modules/knowledge/extractors/smart-chunker.js')

    const chunks = chunkAudio({
      transcription: 'Hello world',
      durationSeconds: 30,
      mimeType: 'audio/mpeg',
      sourceFile: 'short.mp3',
    })

    expect(chunks).toHaveLength(1)
  })
})
```

---

## Ejecutar tests

```bash
# Dentro del container o con node 22:
npx vitest run tests/extractors/ tests/knowledge/smart-chunker.test.ts

# O específico:
npx vitest run tests/extractors/metadata.test.ts
npx vitest run tests/extractors/temporal-split.test.ts
npx vitest run tests/knowledge/smart-chunker.test.ts
```

## Commit message sugerido
```
test(extractors): comprehensive tests for metadata, temporal splitting, and chunking

- Add metadata completeness tests for all extractors
- Add LLM dual description parsing tests
- Add temporal segment calculation tests (audio 60/70/10, video 50/60/10)
- Add smart chunker tests: PDF 3-page, sheets per-row, audio temporal
- Verify temperature not hardcoded in extractor LLM calls
```
