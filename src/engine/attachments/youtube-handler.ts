// LUNA Engine — YouTube Attachment Handler
// Procesa links de YouTube enviados por leads en el chat.
// Extrae metadata + transcript → UrlExtraction para inyección de contexto.
// También produce EmbeddableChunks para embedding en memoria (attachment lifecycle).

import pino from 'pino'
import type { Registry } from '../../kernel/registry.js'
import type { UrlExtraction } from './types.js'
import {
  parseYouTubeUrl,
  getVideoMeta,
  getTranscript,
  downloadThumbnail,
} from '../../extractors/youtube-adapter.js'
import { parseYoutubeChapters } from '../../extractors/youtube.js'
import { chunkYoutube } from '../../modules/knowledge/extractors/smart-chunker.js'
import type { EmbeddableChunk } from '../../modules/knowledge/embedding-limits.js'

const logger = pino({ name: 'engine:youtube-handler' })

export interface YouTubeAttachmentResult {
  urlExtraction: UrlExtraction
  chunks: EmbeddableChunk[]
}

/**
 * Procesa una URL de YouTube como attachment.
 * Extrae metadata, transcript y thumbnail.
 * Retorna UrlExtraction para inyección en contexto + EmbeddableChunks para memoria.
 */
export async function processYouTubeAttachment(
  url: string,
  registry: Registry,
): Promise<YouTubeAttachmentResult | null> {
  const parsed = parseYouTubeUrl(url)
  if (parsed.type !== 'video' || !parsed.id) {
    logger.debug({ url, type: parsed.type }, '[YT-ATT] Not a video URL, skipping')
    return null
  }

  const videoId = parsed.id

  // Obtener API key del registry (knowledge config o kernel config)
  let apiKey = ''
  try {
    const knowledgeConfig = registry.getOptional<{ KNOWLEDGE_GOOGLE_AI_API_KEY?: string }>('knowledge:config')
    apiKey = knowledgeConfig?.KNOWLEDGE_GOOGLE_AI_API_KEY ?? ''
  } catch { /* no API key */ }

  // 1. Metadata del video (opcional — si no hay API key, solo transcript)
  let title = `Video YouTube: ${videoId}`
  let description = ''
  let channelTitle: string | null = null
  let thumbnailUrl: string | null = null
  let duration: number | null = null
  let tags: string[] = []

  if (apiKey) {
    try {
      const meta = await getVideoMeta(videoId, apiKey)
      title = meta.title
      description = meta.description
      channelTitle = meta.channelTitle
      thumbnailUrl = meta.thumbnailUrl
      duration = meta.duration
      tags = meta.tags
    } catch (err) {
      logger.warn({ err, videoId }, '[YT-ATT] getVideoMeta failed, continuing without metadata')
    }
  }

  // 2. Transcript
  const transcriptResult = await getTranscript(videoId, registry, { fallbackSTT: true })
  const segments = transcriptResult?.segments ?? []

  if (segments.length === 0 && !description.trim()) {
    logger.warn({ videoId }, '[YT-ATT] No transcript and no description, returning minimal result')
    return {
      urlExtraction: {
        url,
        title,
        extractedText: description || `Video de YouTube sin transcript disponible. Título: ${title}`,
        tokenEstimate: Math.ceil((description || title).length / 4),
        status: 'processed',
        injectionRisk: false,
      },
      chunks: [],
    }
  }

  // 3. Thumbnail
  let thumbnailBase64: string | undefined
  if (thumbnailUrl) {
    const thumb = await downloadThumbnail(thumbnailUrl)
    if (thumb) {
      thumbnailBase64 = thumb.buffer.toString('base64')
    }
  }

  // 4. Chapters de la descripción
  const chapters = description ? parseYoutubeChapters(description) : null

  // 5. Chunks para embedding
  const chunks = chunkYoutube(
    { title, description, thumbnailBase64, url },
    segments,
    chapters,
  )

  // Enriquecer chunks con metadata YouTube
  for (const chunk of chunks) {
    chunk.metadata = {
      ...chunk.metadata,
      videoId,
      channelTitle,
      duration,
      tags,
      transcriptSource: transcriptResult?.source ?? null,
    }
  }

  // 6. Texto extraído para inyección de contexto
  const fullTranscriptText = segments.map(s => s.text).join(' ').trim()
  const contextParts: string[] = []

  contextParts.push(`**${title}**`)
  if (channelTitle) contextParts.push(`Canal: ${channelTitle}`)
  if (duration) contextParts.push(`Duración: ${Math.round(duration / 60)}min`)
  if (description) contextParts.push(`\nDescripción: ${description.substring(0, 500)}${description.length > 500 ? '...' : ''}`)
  if (fullTranscriptText) contextParts.push(`\nTranscripción: ${fullTranscriptText.substring(0, 3000)}${fullTranscriptText.length > 3000 ? '...' : ''}`)

  const extractedText = contextParts.join('\n')

  logger.info({
    videoId, title, segmentCount: segments.length,
    hasChapters: !!chapters, hasThumbnail: !!thumbnailBase64, chunkCount: chunks.length,
  }, '[YT-ATT] Video processed')

  return {
    urlExtraction: {
      url,
      title,
      extractedText,
      tokenEstimate: Math.ceil(extractedText.length / 4),
      status: 'processed',
      injectionRisk: false,
    },
    chunks,
  }
}
