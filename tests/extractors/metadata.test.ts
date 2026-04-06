// LUNA — Tests — Extractors: Metadata Completeness
// Verifica que todos los extractores incluyen los campos de metadata esperados.

import { describe, it, expect, vi } from 'vitest'

// ═══════════════════════════════════════════
// Helpers: test buffers
// ═══════════════════════════════════════════

/** Minimal valid PNG: 1x1 pixel transparent */
function createMinimalPNG(): Buffer {
  return Buffer.from(
    '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c489' +
    '0000000a49444154789c626000000002000198e195ee0000000049454e44ae426082',
    'hex',
  )
}

function createTextBuffer(text: string): Buffer {
  return Buffer.from(text, 'utf-8')
}

function createCSVBuffer(headers: string[], rows: string[][]): Buffer {
  const lines = [
    headers.join(','),
    ...rows.map(row => row.join(',')),
  ]
  return Buffer.from(lines.join('\n'), 'utf-8')
}

/** Create a minimal DOCX buffer using JSZip */
async function createMinimalDocx(paragraphText: string): Promise<Buffer> {
  const { default: JSZip } = await import('jszip')
  const zip = new JSZip()

  zip.file('[Content_Types].xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`)

  zip.file('_rels/.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`)

  zip.file('word/_rels/document.xml.rels', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
</Relationships>`)

  zip.file('word/document.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Section Title</w:t></w:r></w:p>
    <w:p><w:r><w:t>${paragraphText}</w:t></w:r></w:p>
  </w:body>
</w:document>`)

  return zip.generateAsync({ type: 'nodebuffer' })
}

/** Mock registry without LLM (for code-only extraction) */
function createMockRegistry() {
  return {
    callHook: vi.fn().mockResolvedValue(null),
    getOptional: vi.fn().mockReturnValue(null),
    get: vi.fn(),
    has: vi.fn().mockReturnValue(false),
    register: vi.fn(),
  } as unknown as import('../../src/kernel/registry.js').Registry
}

// ═══════════════════════════════════════════
// Text Extractors
// ═══════════════════════════════════════════

describe('Extractor Metadata Completeness', () => {
  describe('text extractors', () => {
    it('extractMarkdown includes wordCount, lineCount, sectionCount, hasExplicitHeadings', async () => {
      const { extractMarkdown } = await import('../../src/extractors/text.js')
      const md = '# Título\nContenido del título con varias palabras\n## Sección 2\nMás contenido aquí'
      const result = await extractMarkdown(createTextBuffer(md), 'test.md')

      expect(result.metadata.wordCount).toBeGreaterThan(0)
      expect(result.metadata.lineCount).toBeGreaterThan(0)
      expect(result.metadata.sectionCount).toBeGreaterThan(0)
      expect(result.metadata.hasExplicitHeadings).toBe(true)
    })

    it('extractMarkdown hasExplicitHeadings=true when # headings present', async () => {
      const { extractMarkdown } = await import('../../src/extractors/text.js')
      const md = '# Heading\nContent below heading'
      const result = await extractMarkdown(createTextBuffer(md), 'test.md')
      expect(result.metadata.hasExplicitHeadings).toBe(true)
    })

    it('extractPlainText always returns hasExplicitHeadings=false', async () => {
      // extractPlainText hardcodes hasExplicitHeadings=false (it doesn't process # headings)
      const { extractPlainText } = await import('../../src/extractors/text.js')
      const txt = 'Plain text without any hash headings at all. Just a normal paragraph.'
      const result = await extractPlainText(createTextBuffer(txt), 'test.txt')
      expect(result.metadata.hasExplicitHeadings).toBe(false)
    })

    it('extractMarkdown wordCount matches word count in text', async () => {
      const { extractMarkdown } = await import('../../src/extractors/text.js')
      const md = 'one two three four five'
      const result = await extractMarkdown(createTextBuffer(md), 'test.md')
      expect(result.metadata.wordCount).toBe(5)
    })

    it('extractPlainText includes wordCount, lineCount, sectionCount', async () => {
      const { extractPlainText } = await import('../../src/extractors/text.js')
      const txt = 'This is a simple text file\nWith multiple lines\nAnd some content'
      const result = await extractPlainText(createTextBuffer(txt), 'test.txt')

      expect(result.metadata.wordCount).toBeGreaterThan(0)
      expect(result.metadata.lineCount).toBeGreaterThan(1)
      expect(result.metadata.sectionCount).toBeGreaterThan(0)
    })

    it('extractPlainText lineCount matches actual lines', async () => {
      const { extractPlainText } = await import('../../src/extractors/text.js')
      const txt = 'line one\nline two\nline three'
      const result = await extractPlainText(createTextBuffer(txt), 'test.txt')
      expect(result.metadata.lineCount).toBe(3)
    })

    it('extractJSON includes wordCount, sectionCount', async () => {
      const { extractJSON } = await import('../../src/extractors/text.js')
      const json = '{"name":"test","value":42,"active":true}'
      const result = await extractJSON(createTextBuffer(json), 'data.json')

      expect(result.metadata.wordCount).toBeGreaterThan(0)
      expect(result.metadata.sectionCount).toBe(1)
    })

    it('extractJSON sectionCount is always 1 (single JSON block)', async () => {
      const { extractJSON } = await import('../../src/extractors/text.js')
      const json = JSON.stringify({ a: 1, b: [1, 2, 3], c: { nested: true } })
      const result = await extractJSON(createTextBuffer(json), 'nested.json')
      expect(result.metadata.sectionCount).toBe(1)
    })
  })

  // ═══════════════════════════════════════════
  // Image Extractor
  // ═══════════════════════════════════════════

  describe('image extractor', () => {
    it('extractImage includes width, height, md5, format, mimeType', async () => {
      const { extractImage } = await import('../../src/extractors/image.js')
      const buffer = createMinimalPNG()
      const result = await extractImage(buffer, 'test.png', 'image/png')

      expect(result.metadata.width).toBeDefined()
      expect(result.metadata.height).toBeDefined()
      expect(result.metadata.md5).toBeTruthy()
      expect(result.metadata.format).toBe('png')
      expect(result.metadata.mimeType).toBe('image/png')
    })

    it('extractImage width and height are non-negative', async () => {
      const { extractImage } = await import('../../src/extractors/image.js')
      const result = await extractImage(createMinimalPNG(), 'test.png', 'image/png')

      expect(result.metadata.width).toBeGreaterThanOrEqual(0)
      expect(result.metadata.height).toBeGreaterThanOrEqual(0)
    })

    it('extractImage md5 is a non-empty hex string', async () => {
      const { extractImage } = await import('../../src/extractors/image.js')
      const result = await extractImage(createMinimalPNG(), 'test.png', 'image/png')

      expect(result.metadata.md5).toMatch(/^[a-f0-9]+$/i)
    })

    it('extractImage md5 is deterministic (same buffer → same md5)', async () => {
      const { extractImage } = await import('../../src/extractors/image.js')
      const buffer = createMinimalPNG()
      const result1 = await extractImage(buffer, 'a.png', 'image/png')
      const result2 = await extractImage(buffer, 'b.png', 'image/png')

      expect(result1.metadata.md5).toBe(result2.metadata.md5)
    })

    it('extractImage format matches mime type', async () => {
      const { extractImage } = await import('../../src/extractors/image.js')
      const result = await extractImage(createMinimalPNG(), 'photo.jpg', 'image/jpeg')
      // JPEG mime → 'jpeg' format
      expect(result.metadata.mimeType).toBe('image/jpeg')
      expect(result.metadata.format).toBe('jpeg')
    })
  })

  // ═══════════════════════════════════════════
  // Audio Extractor
  // ═══════════════════════════════════════════

  describe('audio extractor', () => {
    it('extractAudio includes durationSeconds, format, mimeType, wasConverted', async () => {
      const { extractAudio } = await import('../../src/extractors/audio.js')
      const buffer = Buffer.alloc(100)
      const result = await extractAudio(buffer, 'test.mp3', 'audio/mpeg')

      expect(result.metadata.durationSeconds).toBeDefined()
      expect(result.metadata.format).toBe('mp3')
      expect(result.metadata.mimeType).toBe('audio/mpeg')
      expect(result.metadata.wasConverted).toBe(false)
    })

    it('extractAudio wasConverted=false for native Gemini format', async () => {
      const { extractAudio } = await import('../../src/extractors/audio.js')
      const buffer = Buffer.alloc(100)
      const result = await extractAudio(buffer, 'test.ogg', 'audio/ogg')

      expect(result.metadata.wasConverted).toBe(false)
      expect(result.metadata.mimeType).toBe('audio/ogg')
    })

    it('extractAudio wasConverted=true for OGG Opus variant (normalizes mime)', async () => {
      const { extractAudio } = await import('../../src/extractors/audio.js')
      const buffer = Buffer.alloc(100)
      // audio/opus → normalized to audio/ogg → wasConverted=true
      const result = await extractAudio(buffer, 'test.opus', 'audio/opus')

      expect(result.metadata.wasConverted).toBe(true)
      expect(result.metadata.mimeType).toBe('audio/ogg')
      expect(result.metadata.format).toBe('ogg')
    })

    it('extractAudio format is a non-empty string', async () => {
      const { extractAudio } = await import('../../src/extractors/audio.js')
      const result = await extractAudio(Buffer.alloc(100), 'test.wav', 'audio/wav')
      expect(result.metadata.format).toBeTruthy()
    })

    it('extractAudio durationSeconds is a number (may be 0 if ffprobe unavailable)', async () => {
      const { extractAudio } = await import('../../src/extractors/audio.js')
      const result = await extractAudio(Buffer.alloc(100), 'test.mp3', 'audio/mpeg')
      expect(typeof result.metadata.durationSeconds).toBe('number')
    })
  })

  // ═══════════════════════════════════════════
  // Video Extractor
  // ═══════════════════════════════════════════

  describe('video extractor', () => {
    it('extractVideo includes durationSeconds, format, hasAudio, wasConverted', async () => {
      const { extractVideo } = await import('../../src/extractors/video.js')
      const buffer = Buffer.alloc(100)
      const result = await extractVideo(buffer, 'test.mp4', 'video/mp4')

      expect(result.metadata.durationSeconds).toBeDefined()
      expect(result.metadata.format).toBe('mp4')
      expect(result.metadata.hasAudio).toBeDefined()
      expect(result.metadata.wasConverted).toBe(false)
    })

    it('extractVideo wasConverted=false for native Gemini format', async () => {
      const { extractVideo } = await import('../../src/extractors/video.js')
      const result = await extractVideo(Buffer.alloc(100), 'test.webm', 'video/webm')
      expect(result.metadata.wasConverted).toBe(false)
      expect(result.metadata.mimeType).toBe('video/webm')
    })

    it('extractVideo durationSeconds is a number', async () => {
      const { extractVideo } = await import('../../src/extractors/video.js')
      const result = await extractVideo(Buffer.alloc(100), 'test.mp4', 'video/mp4')
      expect(typeof result.metadata.durationSeconds).toBe('number')
    })
  })

  // ═══════════════════════════════════════════
  // YouTube Extractor
  // ═══════════════════════════════════════════

  describe('youtube extractor', () => {
    it('extractYouTube includes videoId, duration, hasChapters, sectionCount', async () => {
      const { extractYouTube } = await import('../../src/extractors/youtube.js')

      const result = extractYouTube({
        videoId: 'abc123',
        title: 'Test Video',
        description: '0:00 Intro\n3:00 Demo section\n7:30 Conclusion',
        duration: 600,
        transcript: [
          { text: 'Hello and welcome', offset: 0, duration: 5 },
          { text: 'In this demo', offset: 180, duration: 5 },
          { text: 'Thank you', offset: 450, duration: 5 },
        ],
      })

      expect(result.metadata.videoId).toBe('abc123')
      expect(result.metadata.duration).toBe(600)
      expect(result.metadata.hasChapters).toBeDefined()
      expect(result.metadata.sectionCount).toBeGreaterThanOrEqual(0)
    })

    it('extractYouTube hasChapters=true when chapters present in description', async () => {
      const { extractYouTube } = await import('../../src/extractors/youtube.js')

      const result = extractYouTube({
        videoId: 'xyz',
        title: 'Video with Chapters',
        description: '0:00 Intro\n5:00 Main Content\n10:00 Outro',
        transcript: [
          { text: 'Welcome', offset: 0 },
          { text: 'Main part', offset: 300 },
          { text: 'Goodbye', offset: 600 },
        ],
      })

      expect(result.metadata.hasChapters).toBe(true)
    })

    it('extractYouTube hasChapters=false when no chapters in description', async () => {
      const { extractYouTube } = await import('../../src/extractors/youtube.js')

      const result = extractYouTube({
        videoId: 'xyz',
        title: 'Video without Chapters',
        description: 'A video without any chapter markers in the description.',
        transcript: [{ text: 'Hello world', offset: 0 }],
      })

      expect(result.metadata.hasChapters).toBe(false)
    })

    it('extractYouTube sectionCount reflects transcript split', async () => {
      const { extractYouTube } = await import('../../src/extractors/youtube.js')

      // Transcript spanning 15 minutes (900s), split every 5 minutes = 3 sections
      const transcript = Array.from({ length: 30 }, (_, i) => ({
        text: `Sentence ${i + 1}`,
        offset: i * 30,
        duration: 30,
      }))

      const result = extractYouTube({
        videoId: 'long',
        title: 'Long Video',
        description: 'No chapters here',
        transcript,
      })

      expect(result.metadata.sectionCount).toBeGreaterThan(0)
    })
  })

  // ═══════════════════════════════════════════
  // Sheets Extractor
  // ═══════════════════════════════════════════

  describe('sheets extractor', () => {
    it('extractSheets includes sheetCount, totalRows', async () => {
      const { extractSheets } = await import('../../src/extractors/sheets.js')
      const csv = createCSVBuffer(
        ['Name', 'Email', 'Phone'],
        [['Alice', 'alice@test.com', '111'], ['Bob', 'bob@test.com', '222']],
      )
      const result = await extractSheets(csv, 'contacts.csv')

      expect(result.metadata.sheetCount).toBeGreaterThan(0)
      expect(result.metadata.totalRows).toBeDefined()
    })

    it('extractSheets sheetCount=1 for CSV file', async () => {
      const { extractSheets } = await import('../../src/extractors/sheets.js')
      const csv = createCSVBuffer(['A', 'B'], [['1', '2'], ['3', '4']])
      const result = await extractSheets(csv, 'data.csv')

      expect(result.metadata.sheetCount).toBe(1)
    })

    it('extractSheets totalRows matches data rows (excluding header)', async () => {
      const { extractSheets } = await import('../../src/extractors/sheets.js')
      const csv = createCSVBuffer(
        ['Col1', 'Col2'],
        [['a', 'b'], ['c', 'd'], ['e', 'f']],
      )
      const result = await extractSheets(csv, 'test.csv')

      expect(result.metadata.totalRows).toBe(3)
    })

    it('extractSheets returns kind=sheets', async () => {
      const { extractSheets } = await import('../../src/extractors/sheets.js')
      const csv = createCSVBuffer(['X'], [['1']])
      const result = await extractSheets(csv, 'single.csv')

      expect(result.kind).toBe('sheets')
    })
  })

  // ═══════════════════════════════════════════
  // DOCX Extractor
  // ═══════════════════════════════════════════

  describe('docx extractor', () => {
    it('extractDocx includes wordCount, hasImages, imageCount, sectionCount', async () => {
      const { extractDocx } = await import('../../src/extractors/docx.js')
      const docxBuffer = await createMinimalDocx(
        'This is the main paragraph with several words for the word count test.',
      )
      const result = await extractDocx(docxBuffer, 'test.docx')

      expect(result.metadata.wordCount).toBeGreaterThan(0)
      expect(result.metadata.hasImages).toBe(false)  // minimal DOCX has no images
      expect(result.metadata.imageCount).toBe(0)
      expect(result.metadata.sectionCount).toBeGreaterThan(0)
    })

    it('extractDocx wordCount matches approximate word count', async () => {
      const { extractDocx } = await import('../../src/extractors/docx.js')
      const text = 'one two three four five six seven eight nine ten'
      const docxBuffer = await createMinimalDocx(text)
      const result = await extractDocx(docxBuffer, 'words.docx')

      // wordCount should be close to 10 (title adds "Section Title" = 2 more words)
      expect(result.metadata.wordCount).toBeGreaterThanOrEqual(10)
    })

    it('extractDocx hasImages=false for text-only DOCX', async () => {
      const { extractDocx } = await import('../../src/extractors/docx.js')
      const docxBuffer = await createMinimalDocx('Text only document')
      const result = await extractDocx(docxBuffer, 'text-only.docx')

      expect(result.metadata.hasImages).toBe(false)
      expect(result.metadata.imageCount).toBe(0)
    })
  })

  // ═══════════════════════════════════════════
  // Google Slides Extractor (mocked)
  // ═══════════════════════════════════════════

  describe('slides extractor', () => {
    it('extractGoogleSlides includes slideCount, hasScreenshots', async () => {
      const { extractGoogleSlides } = await import('../../src/extractors/slides.js')

      const mockSlidesService = {
        getPresentation: vi.fn().mockResolvedValue({ title: 'Test Presentation' }),
        extractText: vi.fn().mockResolvedValue(
          'Welcome to the presentation---slide---Second slide content---slide---Third slide',
        ),
        getSlideScreenshot: vi.fn().mockResolvedValue(null),
      }

      const registry = {
        callHook: vi.fn(),
        getOptional: vi.fn().mockImplementation((key: string) => {
          if (key === 'google:slides') return mockSlidesService
          return null
        }),
        get: vi.fn(),
        has: vi.fn().mockReturnValue(false),
        register: vi.fn(),
      } as unknown as import('../../src/kernel/registry.js').Registry

      const result = await extractGoogleSlides('presentation-id-123', registry)

      expect(result).not.toBeNull()
      expect(result!.metadata.slideCount).toBeGreaterThan(0)
      expect(result!.metadata.hasScreenshots).toBe(false)
    })

    it('extractGoogleSlides returns null when google:slides service unavailable', async () => {
      const { extractGoogleSlides } = await import('../../src/extractors/slides.js')

      const registry = {
        callHook: vi.fn(),
        getOptional: vi.fn().mockReturnValue(null),
        get: vi.fn(),
        has: vi.fn().mockReturnValue(false),
        register: vi.fn(),
      } as unknown as import('../../src/kernel/registry.js').Registry

      const result = await extractGoogleSlides('any-id', registry)
      expect(result).toBeNull()
    })
  })

  // ═══════════════════════════════════════════
  // Meta-test: no undefined metadata fields
  // ═══════════════════════════════════════════

  describe('no undefined metadata', () => {
    it('text extractors metadata has no undefined values for key fields', async () => {
      const { extractMarkdown, extractPlainText, extractJSON } = await import('../../src/extractors/text.js')

      const mdResult = await extractMarkdown(createTextBuffer('# Title\nContent here'), 'test.md')
      const txtResult = await extractPlainText(createTextBuffer('Simple text content here'), 'test.txt')
      const jsonResult = await extractJSON(createTextBuffer('{"key":"value"}'), 'test.json')

      for (const result of [mdResult, txtResult, jsonResult]) {
        expect(result.metadata.wordCount).not.toBeUndefined()
        expect(result.metadata.lineCount).not.toBeUndefined()
        expect(result.metadata.sectionCount).not.toBeUndefined()
        expect(result.metadata.originalName).not.toBeUndefined()
        expect(result.metadata.sizeBytes).not.toBeUndefined()
      }
    })

    it('image extractor metadata has no undefined values for key fields', async () => {
      const { extractImage } = await import('../../src/extractors/image.js')
      const result = await extractImage(createMinimalPNG(), 'test.png', 'image/png')

      expect(result.metadata.width).not.toBeUndefined()
      expect(result.metadata.height).not.toBeUndefined()
      expect(result.metadata.md5).not.toBeUndefined()
      expect(result.metadata.format).not.toBeUndefined()
      expect(result.metadata.mimeType).not.toBeUndefined()
    })
  })
})
