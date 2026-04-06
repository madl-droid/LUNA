// LUNA — Global Extractors — YouTube
// Extrae metadata y transcript de videos de YouTube.
// Cabecera: título, descripción, tags, fecha, duración, thumbnail.
// Secciones: chapters del video o bloques de 5 minutos de transcript.
// Thumbnail pertenece a la cabecera, no a secciones.

import type { Registry } from '../kernel/registry.js'
import type { YouTubeResult, YouTubeHeader, YouTubeTranscriptSection } from './types.js'
import pino from 'pino'

const logger = pino({ name: 'extractors:youtube' })

const SEGMENT_SECONDS = 300  // 5 minutos
const OVERLAP_SECONDS = 30

// ═══════════════════════════════════════════
// Parser de chapters desde descripción
// ═══════════════════════════════════════════

export interface ParsedChapter {
  title: string
  startSeconds: number
}

/**
 * Parsea chapters de YouTube desde la descripción del video.
 * Formato esperado: "0:00 Intro", "3:45 Demo", etc.
 * Retorna null si no se encontraron al menos 2 chapters.
 */
export function parseYoutubeChapters(description: string): ParsedChapter[] | null {
  const lines = description.split('\n')
  const chapters: ParsedChapter[] = []

  for (const line of lines) {
    const match = line.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s+(.+)$/)
    if (match) {
      const hours = match[3] ? parseInt(match[1]!, 10) : 0
      const minutes = match[3] ? parseInt(match[2]!, 10) : parseInt(match[1]!, 10)
      const seconds = match[3] ? parseInt(match[3], 10) : parseInt(match[2]!, 10)
      const totalSeconds = hours * 3600 + minutes * 60 + seconds
      chapters.push({ title: match[4]!.trim(), startSeconds: totalSeconds })
    }
  }

  return chapters.length >= 2 ? chapters : null
}

// ═══════════════════════════════════════════
// Función principal
// ═══════════════════════════════════════════

export interface YouTubeInput {
  videoId: string
  title: string
  description: string
  tags?: string[]
  publishedAt?: string
  duration?: number
  thumbnail?: Buffer
  thumbnailMimeType?: string
  transcript: Array<{ text: string; offset: number; duration?: number }>
  chapters?: ParsedChapter[] | null
}

/**
 * Construye un YouTubeResult a partir de datos del video.
 * El consumer es responsable de obtener los datos de la API de YouTube.
 */
export function extractYouTube(input: YouTubeInput): YouTubeResult {
  // Parsear chapters de la descripción si no se proveen
  const chapters = input.chapters ?? parseYoutubeChapters(input.description)

  // Cabecera
  const header: YouTubeHeader = {
    title: input.title,
    description: input.description,
    tags: input.tags ?? [],
    publishedAt: input.publishedAt ?? null,
    duration: input.duration ?? null,
    thumbnail: input.thumbnail ?? null,
    thumbnailMimeType: input.thumbnailMimeType,
  }

  // Secciones de transcript
  const sections: YouTubeTranscriptSection[] = []

  if (input.transcript.length === 0) {
    return {
      kind: 'youtube',
      videoId: input.videoId,
      header,
      sections,
      metadata: {
        originalName: input.title,
        extractorUsed: 'youtube',
        videoId: input.videoId,
        duration: input.duration ?? null,
        hasChapters: !!(chapters && chapters.length >= 2),
        chapterCount: chapters?.length ?? 0,
        sectionCount: 0,
        hasTranscript: false,
        hasThumbnail: !!input.thumbnail,
      },
    }
  }

  if (chapters && chapters.length >= 2) {
    // Partir por chapters
    for (let i = 0; i < chapters.length; i++) {
      const chapter = chapters[i]!
      const nextStart = chapters[i + 1]?.startSeconds ?? Infinity

      const chapterText = input.transcript
        .filter(s => s.offset >= chapter.startSeconds && s.offset < nextStart)
        .map(s => s.text)
        .join(' ')
        .trim()

      if (!chapterText) continue

      const lastSeg = input.transcript.at(-1)
      const endSeconds = i + 1 < chapters.length
        ? chapters[i + 1]!.startSeconds
        : (lastSeg?.offset ?? chapter.startSeconds) + (lastSeg?.duration ?? 30)

      sections.push({
        title: chapter.title,
        text: chapterText,
        startSeconds: chapter.startSeconds,
        endSeconds,
      })
    }
  } else {
    // Sin chapters: bloques de 5 minutos
    const lastSeg = input.transcript.at(-1)
    const totalDuration = (lastSeg?.offset ?? 0) + (lastSeg?.duration ?? 5)
    let segStart = 0

    while (segStart < totalDuration) {
      const segEnd = segStart + SEGMENT_SECONDS

      const segText = input.transcript
        .filter(s => s.offset >= segStart && s.offset < segEnd)
        .map(s => s.text)
        .join(' ')
        .trim()

      if (segText) {
        sections.push({
          title: null,
          text: segText,
          startSeconds: segStart,
          endSeconds: Math.min(segEnd, totalDuration),
        })
      }

      if (segEnd >= totalDuration) break
      segStart = segEnd - OVERLAP_SECONDS
    }
  }

  return {
    kind: 'youtube',
    videoId: input.videoId,
    header,
    sections,
    metadata: {
      originalName: input.title,
      extractorUsed: 'youtube',
      videoId: input.videoId,
      duration: input.duration ?? null,
      hasChapters: !!(chapters && chapters.length >= 2),
      chapterCount: chapters?.length ?? 0,
      sectionCount: sections.length,
      hasTranscript: input.transcript.length > 0,
      hasThumbnail: !!input.thumbnail,
    },
  }
}

// ═══════════════════════════════════════════
// LLM Enrichment: Descripción del thumbnail via Vision
// ═══════════════════════════════════════════

/**
 * Describe el thumbnail del video via Gemini Vision.
 * Recibe un YouTubeResult y describe el thumbnail si existe.
 * Retorna el YouTubeResult con header.thumbnailDescription populado.
 */
export async function describeThumbnail(
  youtubeResult: YouTubeResult,
  registry: Registry,
): Promise<YouTubeResult> {
  if (!youtubeResult.header.thumbnail) return youtubeResult

  try {
    const base64 = youtubeResult.header.thumbnail.toString('base64')
    const mimeType = youtubeResult.header.thumbnailMimeType ?? 'image/jpeg'

    const result = await registry.callHook('llm:chat', {
      task: 'extractor-thumbnail-vision',
      system: 'Eres un asistente que describe thumbnails de videos de YouTube. Describe brevemente el contenido visual: textos, personas, objetos, estilo gráfico. Sé conciso (2-3 oraciones). Responde en español.',
      messages: [{
        role: 'user' as const,
        content: [
          { type: 'image_url' as const, data: base64, mimeType },
          { type: 'text' as const, text: `Describe el thumbnail del video "${youtubeResult.header.title}".` },
        ],
      }],
      maxTokens: 300,
    })

    if (result && typeof result === 'object' && 'text' in result) {
      const desc = (result as { text: string }).text?.trim()
      if (desc) {
        return {
          ...youtubeResult,
          header: { ...youtubeResult.header, thumbnailDescription: desc },
        }
      }
    }

    logger.warn({ videoId: youtubeResult.videoId }, 'Thumbnail vision returned empty')
    return youtubeResult
  } catch (err) {
    logger.warn({ err, videoId: youtubeResult.videoId }, 'describeThumbnail failed')
    return youtubeResult
  }
}

// ═══════════════════════════════════════════
// Utilidades
// ═══════════════════════════════════════════

export function formatTimestamp(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = Math.floor(seconds % 60)
  return h > 0
    ? `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}
