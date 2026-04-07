// LUNA — Tests — YouTube Attachment Handler
// Verifica processYouTubeAttachment con transcript, sin transcript y sin datos.

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Registry } from '../../src/kernel/registry.js'

// Mock del adapter de YouTube
vi.mock('../../src/extractors/youtube-adapter.js', () => ({
  parseYouTubeUrl: vi.fn(),
  getVideoMeta: vi.fn(),
  getTranscript: vi.fn(),
  downloadThumbnail: vi.fn(),
}))

// Mock del parser de chapters
vi.mock('../../src/extractors/youtube.js', () => ({
  parseYoutubeChapters: vi.fn().mockReturnValue([]),
}))

function createMockRegistry(): Registry {
  return {
    callHook: vi.fn(),
    getOptional: vi.fn().mockReturnValue(null),
    get: vi.fn(),
    has: vi.fn().mockReturnValue(false),
    register: vi.fn(),
    provide: vi.fn(),
    addHook: vi.fn(),
    runHook: vi.fn(),
  } as unknown as Registry
}

describe('processYouTubeAttachment', () => {
  let registry: Registry

  beforeEach(async () => {
    registry = createMockRegistry()
    vi.clearAllMocks()
  })

  it('returns null for non-video URL (playlist)', async () => {
    const { parseYouTubeUrl } = await import('../../src/extractors/youtube-adapter.js')
    vi.mocked(parseYouTubeUrl).mockReturnValue({ type: 'playlist', id: 'PLtest' })

    const { processYouTubeAttachment } = await import('../../src/engine/attachments/youtube-handler.js')
    const result = await processYouTubeAttachment('https://www.youtube.com/playlist?list=PLtest', registry)

    expect(result).toBeNull()
  })

  it('returns null for unknown URL', async () => {
    const { parseYouTubeUrl } = await import('../../src/extractors/youtube-adapter.js')
    vi.mocked(parseYouTubeUrl).mockReturnValue({ type: 'unknown', id: null })

    const { processYouTubeAttachment } = await import('../../src/engine/attachments/youtube-handler.js')
    const result = await processYouTubeAttachment('https://example.com/video', registry)

    expect(result).toBeNull()
  })

  it('returns result with transcript text when transcript available', async () => {
    const { parseYouTubeUrl, getVideoMeta, getTranscript, downloadThumbnail } =
      await import('../../src/extractors/youtube-adapter.js')

    vi.mocked(parseYouTubeUrl).mockReturnValue({ type: 'video', id: 'dQw4w9WgXcQ' })
    vi.mocked(getVideoMeta).mockResolvedValue({
      videoId: 'dQw4w9WgXcQ',
      title: 'Test Video',
      description: 'A great video',
      tags: [],
      publishedAt: null,
      channelTitle: 'Test Channel',
      duration: 180,
      defaultLanguage: 'es',
      topicCategories: [],
      thumbnailUrl: null,
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      hasCaption: true,
    })
    vi.mocked(getTranscript).mockResolvedValue({
      segments: [
        { text: 'Hello world', offset: 0, duration: 3 },
        { text: 'How are you', offset: 3, duration: 3 },
      ],
      source: 'youtube-captions',
    })
    vi.mocked(downloadThumbnail).mockResolvedValue(null)

    const { processYouTubeAttachment } = await import('../../src/engine/attachments/youtube-handler.js')
    const result = await processYouTubeAttachment(
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      registry,
    )

    expect(result).not.toBeNull()
    expect(result!.urlExtraction.url).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ')
    expect(result!.urlExtraction.status).toBe('processed')
    expect(result!.urlExtraction.extractedText).toContain('Hello world')
    expect(result!.chunks.length).toBeGreaterThan(0)
  })

  it('returns minimal result when no transcript and no description', async () => {
    const { parseYouTubeUrl, getVideoMeta, getTranscript, downloadThumbnail } =
      await import('../../src/extractors/youtube-adapter.js')

    vi.mocked(parseYouTubeUrl).mockReturnValue({ type: 'video', id: 'emptyvideo' })
    vi.mocked(getVideoMeta).mockResolvedValue({
      videoId: 'emptyvideo',
      title: 'Empty Video',
      description: '',
      tags: [],
      publishedAt: null,
      channelTitle: null,
      duration: 60,
      defaultLanguage: null,
      topicCategories: [],
      thumbnailUrl: null,
      url: 'https://www.youtube.com/watch?v=emptyvideo',
      hasCaption: false,
    })
    vi.mocked(getTranscript).mockResolvedValue(null)
    vi.mocked(downloadThumbnail).mockResolvedValue(null)

    const { processYouTubeAttachment } = await import('../../src/engine/attachments/youtube-handler.js')
    const result = await processYouTubeAttachment(
      'https://www.youtube.com/watch?v=emptyvideo',
      registry,
    )

    // Should return a minimal result (not null) — video with no transcript still returns metadata
    expect(result).not.toBeNull()
    expect(result!.urlExtraction.url).toBe('https://www.youtube.com/watch?v=emptyvideo')
  })
})
