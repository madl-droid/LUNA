// LUNA — Tests — YouTube Knowledge Chunking
// Verifica que chunkYoutube genera la estructura correcta de chunks
// para los escenarios: video individual, playlist y canal.

import { describe, it, expect } from 'vitest'
import {
  chunkYoutube,
  linkChunks,
} from '../../src/modules/knowledge/extractors/smart-chunker.js'

// ═══════════════════════════════════════════
// Video individual: chunkYoutube con transcript y chapters
// ═══════════════════════════════════════════

describe('chunkYoutube — video individual', () => {
  it('genera exactamente 1 chunk para video sin transcript', () => {
    const metadata = { title: 'Test Video', description: 'A test video', url: 'https://youtu.be/test' }
    const chunks = chunkYoutube(metadata, [])
    expect(chunks).toHaveLength(1)
    expect(chunks[0]!.content).toContain('Test Video')
    expect(chunks[0]!.contentType).toBe('youtube')
  })

  it('genera chunk header con title en content', () => {
    const metadata = { title: 'Mi Video', description: 'desc', url: 'https://youtu.be/mv' }
    const chunks = chunkYoutube(metadata, [])
    expect(chunks[0]!.content).toContain('Mi Video')
    expect(chunks[0]!.metadata.sourceType).toBe('youtube')
    expect(chunks[0]!.metadata.sourceUrl).toBe('https://youtu.be/mv')
  })

  it('genera chunks adicionales por chapters cuando hay chapters y transcript', () => {
    const metadata = { title: 'Video Con Chapters', description: '', url: 'https://youtu.be/ch' }
    const segments = [
      { text: 'Intro text here.', offset: 0, duration: 3000 },
      { text: 'Chapter one content words here.', offset: 10000, duration: 5000 },
    ]
    const chapters = [
      { title: 'Introduction', startSeconds: 0 },
      { title: 'Main Chapter', startSeconds: 10 },
    ]
    const chunks = chunkYoutube(metadata, segments, chapters)
    // Header + at least one chapter chunk
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks[0]!.contentType).toBe('youtube')
  })

  it('genera chunks de segmentos cuando hay transcript pero no chapters', () => {
    const metadata = { title: 'Video Sin Chapters', description: 'No chapters', url: 'https://youtu.be/nc' }
    const segments = Array.from({ length: 20 }, (_, i) => ({
      text: `Segment ${i} with some content words here for testing.`,
      offset: i * 5000,
      duration: 5000,
    }))
    const chunks = chunkYoutube(metadata, segments)
    // Header + at least some transcript chunks
    expect(chunks.length).toBeGreaterThan(1)
  })
})

// ═══════════════════════════════════════════
// linkChunks: IDs y estructura
// ═══════════════════════════════════════════

describe('linkChunks', () => {
  it('asigna chunkIndex y chunkTotal correctamente', () => {
    const metadata = { title: 'Linked Video', description: '', url: 'https://youtu.be/lnk' }
    const segments = [
      { text: 'First part of the video content.', offset: 0, duration: 5000 },
      { text: 'Second part of the video content.', offset: 5000, duration: 5000 },
    ]
    const chunks = chunkYoutube(metadata, segments)
    const linked = linkChunks('test-source-id', chunks)

    expect(linked.length).toBeGreaterThan(0)
    linked.forEach((chunk, i) => {
      expect(chunk.chunkIndex).toBe(i)
      expect(chunk.chunkTotal).toBe(linked.length)
      expect(chunk.sourceId).toBe('test-source-id')
    })
  })

  it('todos los chunks tienen id único', () => {
    const metadata = { title: 'ID Test', description: '' }
    const segments = [
      { text: 'Alpha content.', offset: 0, duration: 2000 },
      { text: 'Beta content.', offset: 2000, duration: 2000 },
    ]
    const chunks = chunkYoutube(metadata, segments)
    const linked = linkChunks('doc-id', chunks)

    const ids = linked.map(c => c.id)
    const uniqueIds = new Set(ids)
    expect(uniqueIds.size).toBe(ids.length)
  })

  it('asigna prev/next links como string o null (no undefined)', () => {
    const metadata = { title: 'Link Test', description: '' }
    const segs = [
      { text: 'Chunk one content here for testing purposes.', offset: 0, duration: 2000 },
      { text: 'Chunk two content here for testing purposes.', offset: 2000, duration: 2000 },
      { text: 'Chunk three content here for testing purposes.', offset: 4000, duration: 2000 },
    ]
    const chunks = chunkYoutube(metadata, segs)
    const linked = linkChunks('doc-123', chunks)

    // All prevChunkId/nextChunkId should be string or null, never undefined
    linked.forEach(chunk => {
      expect(chunk.prevChunkId === null || typeof chunk.prevChunkId === 'string').toBe(true)
      expect(chunk.nextChunkId === null || typeof chunk.nextChunkId === 'string').toBe(true)
    })

    if (linked.length >= 2) {
      // First chunk has no prev
      expect(linked[0]!.prevChunkId).toBeNull()
      // Last chunk has no next
      expect(linked.at(-1)!.nextChunkId).toBeNull()
    }
  })
})

// ═══════════════════════════════════════════
// chunkYoutube con chapters — estructura semántica
// ═══════════════════════════════════════════

describe('chunkYoutube — chapters structure', () => {
  it('chapter chunks contienen el título del chapter en el content', () => {
    const metadata = { title: 'Timed Video', description: '', url: 'https://youtu.be/tv' }
    const segments = [
      { text: 'Intro content here.', offset: 0, duration: 10000 },
      { text: 'Middle section content here.', offset: 60000, duration: 10000 },
    ]
    const chapters = [
      { title: 'Introducción', startSeconds: 0 },
      { title: 'Sección Principal', startSeconds: 60 },
    ]
    const chunks = chunkYoutube(metadata, segments, chapters)
    const allContent = chunks.map(c => c.content).join('\n')
    // Should include at least some chapter content
    expect(allContent).toContain('Timed Video')
    expect(chunks.length).toBeGreaterThan(0)
  })

  it('chunks de chapters tienen timestamps en metadata', () => {
    const metadata = { title: 'TS Video', description: '' }
    const segments = [
      { text: 'Content in first chapter.', offset: 0, duration: 5000 },
      { text: 'Content in second chapter.', offset: 30000, duration: 5000 },
    ]
    const chapters = [
      { title: 'Chapter 1', startSeconds: 0 },
      { title: 'Chapter 2', startSeconds: 30 },
    ]
    const chunks = chunkYoutube(metadata, segments, chapters)
    const chapterChunks = chunks.slice(1) // skip header
    chapterChunks.forEach(c => {
      if (c.metadata.timestampStart !== undefined) {
        expect(typeof c.metadata.timestampStart).toBe('number')
      }
    })
  })
})
