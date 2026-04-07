// LUNA — Tests — YouTube Adapter
// Verifica parseYouTubeUrl, parseDuration, getVideoMeta, getTranscript.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  parseYouTubeUrl,
  parseDuration,
} from '../../src/extractors/youtube-adapter.js'

// ═══════════════════════════════════════════
// parseYouTubeUrl
// ═══════════════════════════════════════════

describe('parseYouTubeUrl', () => {
  describe('video URLs', () => {
    it('parses watch URL', () => {
      const r = parseYouTubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
      expect(r.type).toBe('video')
      expect(r.id).toBe('dQw4w9WgXcQ')
    })

    it('parses watch URL with playlist param', () => {
      const r = parseYouTubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PLtest123')
      expect(r.type).toBe('video')
      expect(r.id).toBe('dQw4w9WgXcQ')
      expect(r.playlistId).toBe('PLtest123')
    })

    it('parses youtu.be short URL', () => {
      const r = parseYouTubeUrl('https://youtu.be/dQw4w9WgXcQ')
      expect(r.type).toBe('video')
      expect(r.id).toBe('dQw4w9WgXcQ')
    })

    it('parses /shorts/ URL', () => {
      const r = parseYouTubeUrl('https://www.youtube.com/shorts/abcdefghijk')
      expect(r.type).toBe('video')
      expect(r.id).toBe('abcdefghijk')
    })

    it('parses /embed/ URL', () => {
      const r = parseYouTubeUrl('https://www.youtube.com/embed/dQw4w9WgXcQ')
      expect(r.type).toBe('video')
      expect(r.id).toBe('dQw4w9WgXcQ')
    })
  })

  describe('playlist URLs', () => {
    it('parses playlist URL with /playlist path', () => {
      const r = parseYouTubeUrl('https://www.youtube.com/playlist?list=PLtest123456')
      expect(r.type).toBe('playlist')
      expect(r.id).toBe('PLtest123456')
    })
  })

  describe('channel URLs', () => {
    it('parses /channel/ URL', () => {
      const r = parseYouTubeUrl('https://www.youtube.com/channel/UCxxxxxx')
      expect(r.type).toBe('channel')
      expect(r.id).toBe('UCxxxxxx')
    })

    it('parses /@handle URL', () => {
      const r = parseYouTubeUrl('https://www.youtube.com/@MrBeast')
      expect(r.type).toBe('channel')
      expect(r.id).toBe('MrBeast')
    })
  })

  describe('invalid URLs', () => {
    it('returns unknown for non-YouTube URL', () => {
      const r = parseYouTubeUrl('https://example.com/video')
      expect(r.type).toBe('unknown')
      expect(r.id).toBeNull()
    })

    it('returns unknown for empty string', () => {
      const r = parseYouTubeUrl('')
      expect(r.type).toBe('unknown')
      expect(r.id).toBeNull()
    })

    it('returns unknown for malformed URL', () => {
      const r = parseYouTubeUrl('not-a-url')
      expect(r.type).toBe('unknown')
      expect(r.id).toBeNull()
    })

    it('returns unknown for YouTube URL without recognized path', () => {
      const r = parseYouTubeUrl('https://www.youtube.com/about')
      expect(r.type).toBe('unknown')
      expect(r.id).toBeNull()
    })
  })
})

// ═══════════════════════════════════════════
// parseDuration
// ═══════════════════════════════════════════

describe('parseDuration', () => {
  it('parses PT4M33S → 273', () => {
    expect(parseDuration('PT4M33S')).toBe(273)
  })

  it('parses PT1H2M3S → 3723', () => {
    expect(parseDuration('PT1H2M3S')).toBe(3723)
  })

  it('parses PT1H → 3600', () => {
    expect(parseDuration('PT1H')).toBe(3600)
  })

  it('parses PT30S → 30', () => {
    expect(parseDuration('PT30S')).toBe(30)
  })

  it('parses PT2M → 120', () => {
    expect(parseDuration('PT2M')).toBe(120)
  })

  it('returns 0 for empty string', () => {
    expect(parseDuration('')).toBe(0)
  })

  it('returns 0 for invalid format', () => {
    expect(parseDuration('invalid')).toBe(0)
  })

  it('parses PT0S → 0', () => {
    expect(parseDuration('PT0S')).toBe(0)
  })
})

// ═══════════════════════════════════════════
// getVideoMeta (fetch mock)
// ═══════════════════════════════════════════

describe('getVideoMeta', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    globalThis.fetch = vi.fn()
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('maps API response to YouTubeVideoMeta', async () => {
    const { getVideoMeta } = await import('../../src/extractors/youtube-adapter.js')

    const mockItem = {
      id: 'dQw4w9WgXcQ',
      snippet: {
        title: 'Test Video',
        description: 'A test video',
        tags: ['tag1', 'tag2'],
        publishedAt: '2024-01-01T00:00:00Z',
        channelTitle: 'Test Channel',
        defaultLanguage: 'es',
        thumbnails: {
          maxres: { url: 'https://example.com/thumb.jpg' },
        },
      },
      contentDetails: {
        duration: 'PT4M33S',
        caption: 'false',
      },
      topicDetails: {
        topicCategories: ['https://en.wikipedia.org/wiki/Music'],
      },
    }

    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ items: [mockItem] }),
    } as Response)

    const meta = await getVideoMeta('dQw4w9WgXcQ', 'fake-api-key')

    expect(meta.videoId).toBe('dQw4w9WgXcQ')
    expect(meta.title).toBe('Test Video')
    expect(meta.description).toBe('A test video')
    expect(meta.tags).toEqual(['tag1', 'tag2'])
    expect(meta.channelTitle).toBe('Test Channel')
    expect(meta.duration).toBe(273)
    expect(meta.thumbnailUrl).toBe('https://example.com/thumb.jpg')
    expect(meta.hasCaption).toBe(false)
    expect(meta.url).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
  })

  it('throws when API returns no items', async () => {
    const { getVideoMeta } = await import('../../src/extractors/youtube-adapter.js')

    vi.mocked(globalThis.fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ items: [] }),
    } as Response)

    await expect(getVideoMeta('notfound', 'fake-key')).rejects.toThrow()
  })

  it('throws when fetch fails', async () => {
    const { getVideoMeta } = await import('../../src/extractors/youtube-adapter.js')

    vi.mocked(globalThis.fetch).mockRejectedValueOnce(new Error('Network error'))

    await expect(getVideoMeta('vid123', 'fake-key')).rejects.toThrow()
  })
})

// ═══════════════════════════════════════════
// getTranscript
// ═══════════════════════════════════════════

describe('getTranscript', () => {
  it('returns captions when youtube-transcript succeeds', async () => {
    vi.doMock('youtube-transcript', () => ({
      fetchTranscript: vi.fn().mockResolvedValue([
        { text: 'Hello world', offset: 0, duration: 2000 },
        { text: 'Second segment', offset: 2000, duration: 2000 },
      ]),
    }))

    const { getTranscript } = await import('../../src/extractors/youtube-adapter.js')
    const registry = { callHook: vi.fn(), getOptional: vi.fn() } as never

    const result = await getTranscript('dQw4w9WgXcQ', registry)

    expect(result).not.toBeNull()
    expect(result!.source).toBe('youtube-captions')
    expect(result!.segments.length).toBeGreaterThan(0)
    expect(result!.segments[0]!.text).toBe('Hello world')

    vi.doUnmock('youtube-transcript')
  })

  it('returns null when transcript fails and fallbackSTT is false', async () => {
    vi.doMock('youtube-transcript', () => ({
      fetchTranscript: vi.fn().mockRejectedValue(new Error('No transcript')),
    }))

    const { getTranscript } = await import('../../src/extractors/youtube-adapter.js')
    const registry = { callHook: vi.fn(), getOptional: vi.fn() } as never

    const result = await getTranscript('vid123', registry, { fallbackSTT: false })

    expect(result).toBeNull()

    vi.doUnmock('youtube-transcript')
  })
})
