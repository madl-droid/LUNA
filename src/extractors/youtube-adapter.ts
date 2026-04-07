// LUNA — YouTube Adapter
// Capa unificada de acceso a datos de YouTube.
// Encapsula YouTube Data API v3, youtube-transcript y yt-dlp en una interfaz normalizada.
// Todos los escenarios (attachment, knowledge video/playlist/channel) usan este adapter.

import { execFile } from 'node:child_process'
import { unlink, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { promisify } from 'node:util'
import pino from 'pino'
import type { Registry } from '../kernel/registry.js'

const logger = pino({ name: 'extractors:youtube-adapter' })
const execFileAsync = promisify(execFile)

// ═══════════════════════════════════════════
// Interfaces públicas
// ═══════════════════════════════════════════

export interface YouTubeVideoMeta {
  videoId: string
  title: string
  description: string
  tags: string[]
  publishedAt: string | null
  channelTitle: string | null
  duration: number | null          // segundos (parseado de ISO 8601)
  defaultLanguage: string | null
  topicCategories: string[]        // Wikipedia URLs
  thumbnailUrl: string | null      // URL de mejor resolución disponible
  url: string                      // https://youtube.com/watch?v=XXX
  hasCaption: boolean
}

export interface YouTubeTranscriptResult {
  segments: Array<{ text: string; offset: number; duration?: number }>
  source: 'youtube-captions' | 'yt-dlp-stt'
}

export interface YouTubePlaylistMeta {
  playlistId: string
  title: string
  description: string
  channelTitle: string | null
  videoCount: number
  url: string
}

export interface YouTubeChannelMeta {
  channelId: string
  title: string
  description: string
  uploadsPlaylistId: string | null
  playlists: YouTubePlaylistMeta[]
  url: string
}

export interface YouTubeUrlParseResult {
  type: 'video' | 'playlist' | 'channel' | 'unknown'
  id: string | null
  playlistId?: string
}

// ═══════════════════════════════════════════
// Parsers de URL y duración
// ═══════════════════════════════════════════

/**
 * Parsea videoId/playlistId/channelId de cualquier URL de YouTube.
 * Soporta: watch, shorts, youtu.be, embed, /channel/, /@handle, ?list=
 */
export function parseYouTubeUrl(url: string): YouTubeUrlParseResult {
  try {
    const parsed = new URL(url)
    const hostname = parsed.hostname.replace(/^www\./, '')

    // youtu.be/{videoId}
    if (hostname === 'youtu.be') {
      const id = parsed.pathname.slice(1).split('?')[0] ?? null
      const playlistId = parsed.searchParams.get('list') ?? undefined
      if (id && id.length === 11) return { type: 'video', id, playlistId }
    }

    if (hostname !== 'youtube.com') return { type: 'unknown', id: null }

    const pathname = parsed.pathname

    // /embed/{videoId}
    const embedMatch = pathname.match(/^\/embed\/([\w-]{11})/)
    if (embedMatch?.[1]) return { type: 'video', id: embedMatch[1] }

    // /shorts/{videoId}
    const shortsMatch = pathname.match(/^\/shorts\/([\w-]{11})/)
    if (shortsMatch?.[1]) return { type: 'video', id: shortsMatch[1] }

    // /watch?v={videoId}
    const videoId = parsed.searchParams.get('v')
    const playlistId = parsed.searchParams.get('list') ?? undefined

    if (videoId && videoId.length === 11) {
      return { type: 'video', id: videoId, playlistId }
    }

    // /playlist?list={playlistId}
    if (playlistId && (pathname === '/playlist' || pathname.startsWith('/playlist'))) {
      return { type: 'playlist', id: playlistId }
    }

    // Playlist sin path específico pero con list=
    if (playlistId) {
      return { type: 'playlist', id: playlistId }
    }

    // /channel/{channelId}
    const channelMatch = pathname.match(/^\/channel\/([\w-]+)/)
    if (channelMatch?.[1]) return { type: 'channel', id: channelMatch[1] }

    // /@{handle}
    const handleMatch = pathname.match(/^\/@([\w.-]+)/)
    if (handleMatch?.[1]) return { type: 'channel', id: handleMatch[1] }

    // /c/{customName} o /user/{username}
    const customMatch = pathname.match(/^\/(?:c|user)\/([\w.-]+)/)
    if (customMatch?.[1]) return { type: 'channel', id: customMatch[1] }

    return { type: 'unknown', id: null }
  } catch {
    return { type: 'unknown', id: null }
  }
}

/**
 * Parsea duración ISO 8601 a segundos.
 * PT4M33S → 273, PT1H2M3S → 3723
 */
export function parseDuration(iso: string): number {
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/)
  if (!match) return 0
  const h = parseInt(match[1] ?? '0', 10)
  const m = parseInt(match[2] ?? '0', 10)
  const s = parseInt(match[3] ?? '0', 10)
  return h * 3600 + m * 60 + s
}

// ═══════════════════════════════════════════
// YouTube Data API v3
// ═══════════════════════════════════════════

/**
 * Obtiene metadata completa de un video via YouTube Data API v3.
 * Consulta: videos.list part=snippet,contentDetails,topicDetails
 */
export async function getVideoMeta(videoId: string, apiKey: string): Promise<YouTubeVideoMeta> {
  if (!apiKey) throw new Error('YouTube API key required for getVideoMeta')

  const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,topicDetails&id=${encodeURIComponent(videoId)}&key=${encodeURIComponent(apiKey)}`
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
  if (!res.ok) throw new Error(`YouTube Data API error: ${res.status}`)

  const data = await res.json() as {
    items?: Array<{
      snippet?: {
        title?: string
        description?: string
        tags?: string[]
        publishedAt?: string
        channelTitle?: string
        defaultLanguage?: string
        thumbnails?: {
          maxres?: { url?: string }
          high?: { url?: string }
          medium?: { url?: string }
          default?: { url?: string }
        }
      }
      contentDetails?: {
        duration?: string
        caption?: string
      }
      topicDetails?: {
        topicCategories?: string[]
      }
    }>
  }

  const item = data.items?.[0]
  if (!item) throw new Error(`Video not found: ${videoId}`)

  const s = item.snippet ?? {}
  const cd = item.contentDetails ?? {}
  const td = item.topicDetails ?? {}

  const thumbnails = s.thumbnails ?? {}
  const thumbnailUrl = thumbnails.maxres?.url
    ?? thumbnails.high?.url
    ?? thumbnails.medium?.url
    ?? thumbnails.default?.url
    ?? null

  return {
    videoId,
    title: s.title ?? 'Sin título',
    description: s.description ?? '',
    tags: s.tags ?? [],
    publishedAt: s.publishedAt ?? null,
    channelTitle: s.channelTitle ?? null,
    duration: cd.duration ? parseDuration(cd.duration) : null,
    defaultLanguage: s.defaultLanguage ?? null,
    topicCategories: td.topicCategories ?? [],
    thumbnailUrl,
    url: `https://www.youtube.com/watch?v=${videoId}`,
    hasCaption: cd.caption === 'true',
  }
}

/**
 * Obtiene transcript via youtube-transcript (español primero, luego default).
 * Si falla y fallbackSTT=true → yt-dlp audio → Gemini STT → borra audio temporal.
 */
export async function getTranscript(
  videoId: string,
  registry: Registry,
  opts?: { fallbackSTT?: boolean },
): Promise<YouTubeTranscriptResult | null> {
  // Intento 1: youtube-transcript en español
  try {
    const { fetchTranscript } = await import('youtube-transcript')
    const raw = await fetchTranscript(videoId, { lang: 'es' })
    if (raw.length > 0) {
      return {
        segments: raw.map((s: { text: string; offset?: number; duration?: number }) => ({
          text: s.text,
          offset: s.offset ?? 0,
          duration: s.duration,
        })),
        source: 'youtube-captions',
      }
    }
  } catch { /* intentar default */ }

  // Intento 2: youtube-transcript en idioma default
  try {
    const { fetchTranscript } = await import('youtube-transcript')
    const raw = await fetchTranscript(videoId)
    if (raw.length > 0) {
      return {
        segments: raw.map((s: { text: string; offset?: number; duration?: number }) => ({
          text: s.text,
          offset: s.offset ?? 0,
          duration: s.duration,
        })),
        source: 'youtube-captions',
      }
    }
  } catch { /* continuar al fallback STT */ }

  // Fallback STT: yt-dlp → audio → transcripción
  if (opts?.fallbackSTT) {
    logger.info({ videoId }, '[YT] Transcript unavailable, trying yt-dlp STT fallback')
    const audioResult = await downloadAudio(videoId)
    if (!audioResult) {
      logger.warn({ videoId }, '[YT] yt-dlp audio download failed, no transcript')
      return null
    }

    try {
      const { transcribeAudioContent } = await import('./audio.js')
      const { extractAudio } = await import('./audio.js')

      const audioExt = await extractAudio(audioResult.buffer, `yt_${videoId}.mp3`, audioResult.mimeType)
      const enriched = await transcribeAudioContent(audioExt, registry)
      const transcription = enriched.llmEnrichment?.transcription ?? enriched.llmEnrichment?.description ?? null

      // Limpiar binario temporal
      await unlink(audioResult.tempPath).catch(() => {})

      if (!transcription) return null

      // Convertir texto plano a segmentos aproximados (sin timestamps precisos)
      const words = transcription.split(/\s+/)
      const WORDS_PER_SEGMENT = 150
      const segments: Array<{ text: string; offset: number; duration?: number }> = []
      let wordIndex = 0
      let estimatedOffset = 0

      while (wordIndex < words.length) {
        const chunk = words.slice(wordIndex, wordIndex + WORDS_PER_SEGMENT).join(' ')
        if (chunk) {
          segments.push({ text: chunk, offset: estimatedOffset, duration: 30 })
          estimatedOffset += 30
        }
        wordIndex += WORDS_PER_SEGMENT
      }

      return { segments, source: 'yt-dlp-stt' }
    } catch (err) {
      logger.warn({ err, videoId }, '[YT] STT transcription failed')
      await unlink(audioResult.tempPath).catch(() => {})
      return null
    }
  }

  return null
}

/**
 * Descarga thumbnail como Buffer.
 */
export async function downloadThumbnail(url: string): Promise<{ buffer: Buffer; mimeType: string } | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) })
    if (!res.ok) return null
    const contentType = res.headers.get('content-type') ?? 'image/jpeg'
    const mimeType = contentType.split(';')[0]?.trim() ?? 'image/jpeg'
    const buffer = Buffer.from(await res.arrayBuffer())
    return { buffer, mimeType }
  } catch (err) {
    logger.warn({ err, url }, '[YT] Thumbnail download failed')
    return null
  }
}

/**
 * Descarga video completo via yt-dlp (mp4, mejor calidad hasta 720p).
 * Guarda en outputDir con nombre {videoId}.mp4
 */
export async function downloadVideo(
  videoId: string,
  outputDir: string,
): Promise<{ filePath: string; mimeType: string; sizeBytes: number }> {
  await mkdir(outputDir, { recursive: true })
  const outputPath = join(outputDir, `${videoId}.mp4`)

  try {
    await execFileAsync('yt-dlp', [
      '--format', 'bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720][ext=mp4]/best',
      '--merge-output-format', 'mp4',
      '--max-filesize', '500m',
      '--output', outputPath,
      '--no-playlist',
      `https://www.youtube.com/watch?v=${videoId}`,
    ], { timeout: 300_000 }) // 5 min max
  } catch (err) {
    throw new Error(`yt-dlp video download failed for ${videoId}: ${String(err)}`)
  }

  const { stat } = await import('node:fs/promises')
  const stats = await stat(outputPath)
  return { filePath: outputPath, mimeType: 'video/mp4', sizeBytes: stats.size }
}

/**
 * Descarga solo audio via yt-dlp (mp3) en un directorio temporal.
 * El caller es responsable de eliminar tempPath después de usar el buffer.
 */
export async function downloadAudio(videoId: string): Promise<{ buffer: Buffer; mimeType: string; tempPath: string } | null> {
  const tmpDir = join(tmpdir(), `yt_audio_${randomUUID()}`)
  await mkdir(tmpDir, { recursive: true })
  const outputPath = join(tmpDir, `${videoId}.mp3`)

  try {
    await execFileAsync('yt-dlp', [
      '--extract-audio',
      '--audio-format', 'mp3',
      '--audio-quality', '128K',
      '--output', outputPath,
      '--no-playlist',
      `https://www.youtube.com/watch?v=${videoId}`,
    ], { timeout: 120_000 }) // 2 min max

    const { readFile } = await import('node:fs/promises')
    const buffer = await readFile(outputPath)
    return { buffer, mimeType: 'audio/mpeg', tempPath: outputPath }
  } catch (err) {
    logger.warn({ err, videoId }, '[YT] yt-dlp audio download failed')
    // Limpiar tmpdir
    const { rm } = await import('node:fs/promises')
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {})
    return null
  }
}

/**
 * Lista hasta 250 videos de una playlist via YouTube Data API v3.
 */
export async function listPlaylistVideos(playlistId: string, apiKey: string): Promise<YouTubeVideoMeta[]> {
  if (!apiKey) {
    logger.warn('[YT] No API key for listPlaylistVideos')
    return []
  }

  const videoIds: string[] = []
  let pageToken = ''

  for (let page = 0; page < 5; page++) {  // max 250 videos (5 × 50)
    const url = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=50&playlistId=${encodeURIComponent(playlistId)}&key=${encodeURIComponent(apiKey)}${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''}`
    const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
    if (!res.ok) {
      logger.warn({ status: res.status, playlistId }, '[YT] Playlist API error')
      break
    }
    const data = await res.json() as {
      items?: Array<{ snippet?: { resourceId?: { videoId?: string } } }>
      nextPageToken?: string
    }

    for (const item of data.items ?? []) {
      const vid = item.snippet?.resourceId?.videoId
      if (vid) videoIds.push(vid)
    }

    if (!data.nextPageToken) break
    pageToken = data.nextPageToken
    if (page === 4 && data.nextPageToken) {
      logger.warn({ playlistId, videoCount: videoIds.length }, '[YT] Playlist truncated at 250 videos — more videos exist but were not fetched')
    }
  }

  if (videoIds.length === 0) return []

  // Obtener metadata completa en batches de 50
  const allMeta: YouTubeVideoMeta[] = []
  for (let i = 0; i < videoIds.length; i += 50) {
    const batch = videoIds.slice(i, i + 50)
    try {
      const url = `https://www.googleapis.com/youtube/v3/videos?part=snippet,contentDetails,topicDetails&id=${batch.map(id => encodeURIComponent(id)).join(',')}&key=${encodeURIComponent(apiKey)}`
      const res = await fetch(url, { signal: AbortSignal.timeout(15000) })
      if (!res.ok) continue

      const data = await res.json() as {
        items?: Array<{
          id?: string
          snippet?: {
            title?: string
            description?: string
            tags?: string[]
            publishedAt?: string
            channelTitle?: string
            defaultLanguage?: string
            thumbnails?: { maxres?: { url?: string }; high?: { url?: string }; medium?: { url?: string }; default?: { url?: string } }
          }
          contentDetails?: { duration?: string; caption?: string }
          topicDetails?: { topicCategories?: string[] }
        }>
      }

      for (const item of data.items ?? []) {
        if (!item.id) continue
        const s = item.snippet ?? {}
        const cd = item.contentDetails ?? {}
        const td = item.topicDetails ?? {}
        const thumbnails = s.thumbnails ?? {}
        allMeta.push({
          videoId: item.id,
          title: s.title ?? 'Sin título',
          description: s.description ?? '',
          tags: s.tags ?? [],
          publishedAt: s.publishedAt ?? null,
          channelTitle: s.channelTitle ?? null,
          duration: cd.duration ? parseDuration(cd.duration) : null,
          defaultLanguage: s.defaultLanguage ?? null,
          topicCategories: td.topicCategories ?? [],
          thumbnailUrl: thumbnails.maxres?.url ?? thumbnails.high?.url ?? thumbnails.medium?.url ?? thumbnails.default?.url ?? null,
          url: `https://www.youtube.com/watch?v=${item.id}`,
          hasCaption: cd.caption === 'true',
        })
      }
    } catch (err) {
      logger.warn({ err, batch }, '[YT] Batch video meta fetch failed')
    }
  }

  return allMeta
}

/**
 * Obtiene metadata de un canal: uploads playlist + playlists públicas.
 * handleOrId puede ser @handle, channelId (UCxxx), o nombre de usuario.
 */
export async function getChannelMeta(handleOrId: string, apiKey: string): Promise<YouTubeChannelMeta> {
  if (!apiKey) throw new Error('YouTube API key required for getChannelMeta')

  // Resolver canal
  const isChannelId = handleOrId.startsWith('UC')
  const param = isChannelId
    ? `id=${encodeURIComponent(handleOrId)}`
    : handleOrId.startsWith('@')
      ? `forHandle=${encodeURIComponent(handleOrId.slice(1))}`
      : `forHandle=${encodeURIComponent(handleOrId)}`

  const chUrl = `https://www.googleapis.com/youtube/v3/channels?part=snippet,contentDetails,brandingSettings&${param}&key=${encodeURIComponent(apiKey)}`
  const chRes = await fetch(chUrl, { signal: AbortSignal.timeout(15000) })
  if (!chRes.ok) throw new Error(`YouTube Channel API error: ${chRes.status}`)

  const chData = await chRes.json() as {
    items?: Array<{
      id?: string
      snippet?: { title?: string; description?: string }
      contentDetails?: { relatedPlaylists?: { uploads?: string } }
    }>
  }

  const channel = chData.items?.[0]
  if (!channel?.id) throw new Error(`Channel not found: ${handleOrId}`)

  const channelId = channel.id
  const uploadsPlaylistId = channel.contentDetails?.relatedPlaylists?.uploads ?? null

  // Listar playlists públicas
  const playlists: YouTubePlaylistMeta[] = []
  try {
    const plUrl = `https://www.googleapis.com/youtube/v3/playlists?part=snippet,contentDetails&channelId=${encodeURIComponent(channelId)}&maxResults=50&key=${encodeURIComponent(apiKey)}`
    const plRes = await fetch(plUrl, { signal: AbortSignal.timeout(15000) })
    if (plRes.ok) {
      const plData = await plRes.json() as {
        items?: Array<{
          id?: string
          snippet?: { title?: string; description?: string; channelTitle?: string }
          contentDetails?: { itemCount?: number }
        }>
      }
      for (const pl of plData.items ?? []) {
        if (!pl.id) continue
        playlists.push({
          playlistId: pl.id,
          title: pl.snippet?.title ?? 'Sin título',
          description: pl.snippet?.description ?? '',
          channelTitle: pl.snippet?.channelTitle ?? null,
          videoCount: pl.contentDetails?.itemCount ?? 0,
          url: `https://www.youtube.com/playlist?list=${pl.id}`,
        })
      }
    }
  } catch (err) {
    logger.warn({ err, channelId }, '[YT] Failed to fetch channel playlists')
  }

  const channelHandle = handleOrId.startsWith('@') ? handleOrId : `@${handleOrId}`
  const channelUrl = isChannelId
    ? `https://www.youtube.com/channel/${channelId}`
    : `https://www.youtube.com/${channelHandle}`

  return {
    channelId,
    title: channel.snippet?.title ?? 'Sin título',
    description: channel.snippet?.description ?? '',
    uploadsPlaylistId,
    playlists,
    url: channelUrl,
  }
}
