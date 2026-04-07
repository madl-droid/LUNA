// LUNA — Tests — Smart Chunker
// Verifica las estrategias de chunking por tipo de contenido.
// Tests: chunkPdf (3 págs), chunkSheets (1 row = 1 chunk), chunkAudio (temporal).

import { describe, it, expect } from 'vitest'

// ═══════════════════════════════════════════
// chunkPdf
// ═══════════════════════════════════════════

describe('chunkPdf', () => {
  it('chunks 10-page PDF into correct number of chunks (3-page window, 1-page overlap)', async () => {
    const { chunkPdf } = await import('../../src/modules/knowledge/extractors/smart-chunker.js')
    const pageTexts = Array.from({ length: 10 }, (_, i) => `Content of page ${i + 1}. `.repeat(20))
    const chunks = chunkPdf(pageTexts, '/tmp/test.pdf', 10)

    // With 3-page window and 1-page overlap:
    // Pages 1-3, 3-5, 5-7, 7-9, 9-10 = 5 chunks
    expect(chunks.length).toBeGreaterThanOrEqual(4)
    expect(chunks.length).toBeLessThanOrEqual(5)
  })

  it('all chunks have contentType=pdf_pages', async () => {
    const { chunkPdf } = await import('../../src/modules/knowledge/extractors/smart-chunker.js')
    const pageTexts = Array.from({ length: 6 }, (_, i) => `Page ${i + 1} text content here`)
    const chunks = chunkPdf(pageTexts, '/tmp/test.pdf', 6)

    for (const chunk of chunks) {
      expect(chunk.contentType).toBe('pdf_pages')
    }
  })

  it('all chunks have a pageRange in metadata', async () => {
    const { chunkPdf } = await import('../../src/modules/knowledge/extractors/smart-chunker.js')
    const pageTexts = Array.from({ length: 6 }, (_, i) => `Page ${i + 1} text content here`)
    const chunks = chunkPdf(pageTexts, '/tmp/test.pdf', 6)

    for (const chunk of chunks) {
      expect(chunk.metadata.pageRange).toBeDefined()
      expect(typeof chunk.metadata.pageRange).toBe('string')
    }
  })

  it('all chunks have exactly one mediaRef with application/pdf mimeType', async () => {
    const { chunkPdf } = await import('../../src/modules/knowledge/extractors/smart-chunker.js')
    const pageTexts = Array.from({ length: 4 }, (_, i) => `Content of page ${i + 1} with some text`)
    const chunks = chunkPdf(pageTexts, '/tmp/doc.pdf', 4)

    for (const chunk of chunks) {
      expect(chunk.mediaRefs).toHaveLength(1)
      expect(chunk.mediaRefs![0]!.mimeType).toBe('application/pdf')
    }
  })

  it('mediaRef filePath matches the provided pdfFilePath', async () => {
    const { chunkPdf } = await import('../../src/modules/knowledge/extractors/smart-chunker.js')
    const pageTexts = ['Page 1 content', 'Page 2 content', 'Page 3 content', 'Page 4 content']
    const pdfPath = '/instance/knowledge/media/my-doc.pdf'
    const chunks = chunkPdf(pageTexts, pdfPath, 4)

    for (const chunk of chunks) {
      expect(chunk.mediaRefs![0]!.filePath).toBe(pdfPath)
    }
  })

  it('single page PDF returns single chunk', async () => {
    const { chunkPdf } = await import('../../src/modules/knowledge/extractors/smart-chunker.js')
    const chunks = chunkPdf(['Page 1 content here with enough text to qualify'], '/tmp/test.pdf', 1)
    expect(chunks).toHaveLength(1)
    expect(chunks[0]!.metadata.pageRange).toBe('1-1')
  })

  it('covers page 1 in first chunk', async () => {
    const { chunkPdf } = await import('../../src/modules/knowledge/extractors/smart-chunker.js')
    const pageTexts = Array.from({ length: 9 }, (_, i) => `Page ${i + 1}`)
    const chunks = chunkPdf(pageTexts, '/tmp/test.pdf', 9)

    // First chunk always starts from page 1
    const firstPageRange = chunks[0]!.metadata.pageRange as string
    expect(firstPageRange.startsWith('1-')).toBe(true)
  })

  it('last chunk covers the final page', async () => {
    const { chunkPdf } = await import('../../src/modules/knowledge/extractors/smart-chunker.js')
    const totalPages = 7
    const pageTexts = Array.from({ length: totalPages }, (_, i) => `Page ${i + 1} content here`)
    const chunks = chunkPdf(pageTexts, '/tmp/test.pdf', totalPages)

    const lastPageRange = chunks.at(-1)!.metadata.pageRange as string
    const lastPage = parseInt(lastPageRange.split('-')[1]!, 10)
    expect(lastPage).toBe(totalPages)
  })

  it('includes text overlap prefix from previous page on second+ chunks', async () => {
    const { chunkPdf } = await import('../../src/modules/knowledge/extractors/smart-chunker.js')
    // Create page texts where the last 200 chars of page 2 are distinctive
    const pageTexts = Array.from({ length: 6 }, (_, i) => `UNIQUE_MARKER_${i + 1} ` + 'x '.repeat(100))
    const chunks = chunkPdf(pageTexts, '/tmp/test.pdf', 6)

    if (chunks.length > 1) {
      // Second chunk should contain the overlap prefix indicator
      const secondChunk = chunks[1]!
      expect(secondChunk.content).toContain('[...]')
    }
  })

  it('sourceType is pdf in chunk metadata', async () => {
    const { chunkPdf } = await import('../../src/modules/knowledge/extractors/smart-chunker.js')
    const chunks = chunkPdf(['Page content here'], '/tmp/test.pdf', 1)
    expect(chunks[0]!.metadata.sourceType).toBe('pdf')
  })
})

// ═══════════════════════════════════════════
// chunkSheets
// ═══════════════════════════════════════════

describe('chunkSheets', () => {
  it('creates 1 chunk per row', async () => {
    const { chunkSheets } = await import('../../src/modules/knowledge/extractors/smart-chunker.js')
    const headers = ['Name', 'Email', 'Phone']
    const rows = [
      ['John', 'john@test.com', '123456789'],
      ['Jane', 'jane@test.com', '987654321'],
      ['Carlos', 'carlos@test.com', '555555555'],
    ]
    const chunks = chunkSheets(headers, rows)
    expect(chunks).toHaveLength(3)
  })

  it('each chunk includes header fields in content', async () => {
    const { chunkSheets } = await import('../../src/modules/knowledge/extractors/smart-chunker.js')
    const headers = ['Name', 'Email', 'Phone']
    const rows = [
      ['John', 'john@test.com', '123456789'],
      ['Jane', 'jane@test.com', '987654321'],
    ]
    const chunks = chunkSheets(headers, rows)

    for (const chunk of chunks) {
      expect(chunk.content).toContain('Name')
      expect(chunk.content).toContain('Email')
      expect(chunk.content).toContain('Phone')
    }
  })

  it('chunk content has header on first line, row on second', async () => {
    const { chunkSheets } = await import('../../src/modules/knowledge/extractors/smart-chunker.js')
    const headers = ['Column1', 'Column2']
    // Row must produce content >= 20 chars to pass the min length filter
    const rows = [['value_alpha', 'value_beta']]
    const chunks = chunkSheets(headers, rows)

    expect(chunks.length).toBeGreaterThan(0)
    const lines = chunks[0]!.content!.split('\n')
    expect(lines[0]).toBe('Column1,Column2')
    expect(lines[1]).toBe('value_alpha,value_beta')
  })

  it('contentType is csv for all chunks', async () => {
    const { chunkSheets } = await import('../../src/modules/knowledge/extractors/smart-chunker.js')
    const chunks = chunkSheets(
      ['A', 'B'],
      [['1', '2'], ['3', '4']],
    )
    for (const chunk of chunks) {
      expect(chunk.contentType).toBe('csv')
    }
  })

  it('returns empty array for no rows', async () => {
    const { chunkSheets } = await import('../../src/modules/knowledge/extractors/smart-chunker.js')
    const chunks = chunkSheets(['Header1', 'Header2'], [])
    expect(chunks).toHaveLength(0)
  })

  it('passes sourceFile to metadata when provided', async () => {
    const { chunkSheets } = await import('../../src/modules/knowledge/extractors/smart-chunker.js')
    const chunks = chunkSheets(
      ['X'],
      [['value1234567890123456789012']],
      { sourceFile: 'my-spreadsheet.csv' },
    )
    if (chunks.length > 0) {
      expect(chunks[0]!.metadata.sourceFile).toBe('my-spreadsheet.csv')
    }
  })
})

// ═══════════════════════════════════════════
// chunkAudio (temporal)
// ═══════════════════════════════════════════

describe('chunkAudio (temporal)', () => {
  it('creates temporal chunks when segments provided', async () => {
    const { chunkAudio } = await import('../../src/modules/knowledge/extractors/smart-chunker.js')

    const chunks = chunkAudio({
      transcription: 'Hello world this is a test transcript that is quite long and contains many words',
      durationSeconds: 130,
      mimeType: 'audio/mpeg',
      sourceFile: 'test.mp3',
      segments: [
        { startSeconds: 0, endSeconds: 60, segmentPath: '/tmp/seg0.mp3' },
        { startSeconds: 50, endSeconds: 130, segmentPath: '/tmp/seg1.mp3' },
      ],
    })

    expect(chunks).toHaveLength(2)
  })

  it('segment timestamps match provided segments', async () => {
    const { chunkAudio } = await import('../../src/modules/knowledge/extractors/smart-chunker.js')

    const chunks = chunkAudio({
      transcription: 'Hello world this is a test transcript that is quite long enough',
      durationSeconds: 130,
      mimeType: 'audio/mpeg',
      sourceFile: 'test.mp3',
      segments: [
        { startSeconds: 0, endSeconds: 60, segmentPath: '/tmp/seg0.mp3' },
        { startSeconds: 50, endSeconds: 130, segmentPath: '/tmp/seg1.mp3' },
      ],
    })

    expect(chunks[0]!.metadata.timestampStart).toBe(0)
    expect(chunks[0]!.metadata.timestampEnd).toBe(60)
    expect(chunks[1]!.metadata.timestampStart).toBe(50)
    expect(chunks[1]!.metadata.timestampEnd).toBe(130)
  })

  it('each segment chunk has a mediaRef with the segment path', async () => {
    const { chunkAudio } = await import('../../src/modules/knowledge/extractors/smart-chunker.js')

    const chunks = chunkAudio({
      transcription: 'Transcription for this audio file that has enough content',
      durationSeconds: 60,
      mimeType: 'audio/mpeg',
      sourceFile: 'test.mp3',
      segments: [
        { startSeconds: 0, endSeconds: 60, segmentPath: '/tmp/seg0.mp3' },
      ],
    })

    expect(chunks[0]!.mediaRefs).toHaveLength(1)
    expect(chunks[0]!.mediaRefs![0]!.filePath).toBe('/tmp/seg0.mp3')
  })

  it('falls back to single chunk without segments (short audio)', async () => {
    const { chunkAudio } = await import('../../src/modules/knowledge/extractors/smart-chunker.js')

    const chunks = chunkAudio({
      transcription: 'Hello world',
      durationSeconds: 30,
      mimeType: 'audio/mpeg',
      sourceFile: 'short.mp3',
    })

    expect(chunks).toHaveLength(1)
  })

  it('single fallback chunk has correct timestamps (0 to duration)', async () => {
    const { chunkAudio } = await import('../../src/modules/knowledge/extractors/smart-chunker.js')

    const chunks = chunkAudio({
      transcription: 'Short transcript',
      durationSeconds: 45,
      mimeType: 'audio/mpeg',
      sourceFile: 'short.mp3',
    })

    expect(chunks[0]!.metadata.timestampStart).toBe(0)
    expect(chunks[0]!.metadata.timestampEnd).toBe(45)
  })

  it('returns placeholder chunk when no transcription', async () => {
    const { chunkAudio } = await import('../../src/modules/knowledge/extractors/smart-chunker.js')

    const chunks = chunkAudio({
      transcription: null,
      durationSeconds: 120,
      mimeType: 'audio/mpeg',
      sourceFile: 'muted.mp3',
    })

    expect(chunks).toHaveLength(1)
    expect(chunks[0]!.content).toContain('muted.mp3')
  })

  it('sourceType is audio in metadata', async () => {
    const { chunkAudio } = await import('../../src/modules/knowledge/extractors/smart-chunker.js')

    const chunks = chunkAudio({
      transcription: 'Audio transcript content',
      durationSeconds: 30,
      mimeType: 'audio/mpeg',
    })

    expect(chunks[0]!.metadata.sourceType).toBe('audio')
  })
})

// ═══════════════════════════════════════════
// chunkDocs
// ═══════════════════════════════════════════

describe('chunkDocs', () => {
  it('returns array of chunks for text with headings', async () => {
    const { chunkDocs } = await import('../../src/modules/knowledge/extractors/smart-chunker.js')
    const text = `# Introduction

This is the introduction section with quite a bit of content. It contains multiple sentences and enough words to pass the minimum threshold for a chunk.

## Main Content

This is the main content section. It also has enough words to be a valid chunk when processed by the chunker algorithm.`

    const chunks = chunkDocs(text)
    expect(chunks.length).toBeGreaterThan(0)
  })

  it('chunks have contentType=text', async () => {
    const { chunkDocs } = await import('../../src/modules/knowledge/extractors/smart-chunker.js')
    const text = `# Section\nThis section has content with enough words to be included in the chunks output.`
    const chunks = chunkDocs(text)

    for (const chunk of chunks) {
      expect(chunk.contentType).toBe('text')
    }
  })

  it('passes sourceFile to chunk metadata', async () => {
    const { chunkDocs } = await import('../../src/modules/knowledge/extractors/smart-chunker.js')
    const text = `# Title\nThis is content with enough words to satisfy the minimum chunk word count requirement for the chunker.`
    const chunks = chunkDocs(text, { sourceFile: 'my-doc.md' })

    if (chunks.length > 0) {
      expect(chunks[0]!.metadata.sourceFile).toBe('my-doc.md')
    }
  })
})

// ═══════════════════════════════════════════
// linkChunks
// ═══════════════════════════════════════════

describe('linkChunks', () => {
  it('assigns unique IDs to all chunks', async () => {
    const { chunkSheets, linkChunks } = await import('../../src/modules/knowledge/extractors/smart-chunker.js')
    const chunks = chunkSheets(
      ['Name', 'Value'],
      [
        ['Alice', 'val1-long-enough-data'],
        ['Bob', 'val2-long-enough-data'],
        ['Carlos', 'val3-long-enough-data'],
      ],
    )

    const linked = linkChunks('source-123', chunks)
    const ids = linked.map(c => c.id)
    const uniqueIds = new Set(ids)
    expect(uniqueIds.size).toBe(linked.length)
  })

  it('sets sourceId on all chunks', async () => {
    const { chunkSheets, linkChunks } = await import('../../src/modules/knowledge/extractors/smart-chunker.js')
    const chunks = chunkSheets(
      ['Col'],
      [['row1-long-enough-value'], ['row2-long-enough-value']],
    )

    const linked = linkChunks('my-source', chunks)
    for (const chunk of linked) {
      expect(chunk.sourceId).toBe('my-source')
    }
  })

  it('sets chunkIndex and chunkTotal correctly', async () => {
    const { chunkSheets, linkChunks } = await import('../../src/modules/knowledge/extractors/smart-chunker.js')
    const chunks = chunkSheets(
      ['X', 'Y'],
      [
        ['a1', 'b1-long-enough'],
        ['a2', 'b2-long-enough'],
        ['a3', 'b3-long-enough'],
      ],
    )

    const linked = linkChunks('src', chunks)
    for (let i = 0; i < linked.length; i++) {
      expect(linked[i]!.chunkIndex).toBe(i)
      expect(linked[i]!.chunkTotal).toBe(linked.length)
    }
  })

  it('sets prevChunkId and nextChunkId for linked chains', async () => {
    const { chunkSheets, linkChunks } = await import('../../src/modules/knowledge/extractors/smart-chunker.js')
    const chunks = chunkSheets(
      ['A', 'B', 'C'],
      [
        ['x1', 'y1', 'z1-long-enough'],
        ['x2', 'y2', 'z2-long-enough'],
        ['x3', 'y3', 'z3-long-enough'],
      ],
    )

    const linked = linkChunks('src', chunks)
    if (linked.length >= 2) {
      expect(linked[0]!.prevChunkId).toBeNull()
      expect(linked[0]!.nextChunkId).toBe(linked[1]!.id)
      expect(linked.at(-1)!.nextChunkId).toBeNull()
    }
  })
})
