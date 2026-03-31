// LUNA — Global Extractors — Video
// Prepara archivos de video para procesamiento downstream.
// Verifica formato: MP4/MOV/AVI/WebM/WMV/3GPP/MPEG/FLV aceptados por Gemini.
// Si no está en la lista, convierte a MP4 via ffmpeg.
// Detecta pista de audio, mide duración.
// NO hace transcripción ni análisis — eso es concern del consumer.

import { execFile } from 'node:child_process'
import { writeFile, unlink, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { VideoResult, LLMEnrichment } from './types.js'
import type { Registry } from '../kernel/registry.js'
import pino from 'pino'

const logger = pino({ name: 'extractors:video' })

// Formatos aceptados directamente por Gemini
const GEMINI_VIDEO_MIMES = new Set([
  'video/mp4',
  'video/quicktime',     // MOV
  'video/x-msvideo',     // AVI
  'video/webm',
  'video/x-ms-wmv',      // WMV
  'video/3gpp',          // 3GPP
  'video/mpeg',          // MPEG
  'video/x-flv',         // FLV
])

export interface VideoExtractOptions {
  accompanyingText?: string
  senderId?: string
  channel?: string
  receivedAt?: Date
}

/**
 * Prepara un video para procesamiento.
 * Verifica formato, convierte si necesario, mide duración, detecta audio.
 */
export async function extractVideo(
  input: Buffer,
  fileName: string,
  mimeType: string,
  options?: VideoExtractOptions,
): Promise<VideoResult> {
  let buffer = input
  let format = mimeToFormat(mimeType)
  let resolvedMime = mimeType

  // Convertir si el formato no es aceptado por Gemini
  if (!GEMINI_VIDEO_MIMES.has(mimeType)) {
    logger.info({ fileName, mimeType }, 'Converting video to MP4')
    try {
      buffer = await convertToMp4(input, fileName)
      format = 'mp4'
      resolvedMime = 'video/mp4'
    } catch (err) {
      logger.warn({ err, fileName }, 'Video conversion failed, keeping original')
    }
  }

  // Obtener metadata con ffprobe
  const probe = await probeMedia(buffer, fileName)

  return {
    kind: 'video',
    buffer,
    format,
    mimeType: resolvedMime,
    durationSeconds: probe.duration,
    hasAudio: probe.hasAudio,
    accompanyingText: options?.accompanyingText ?? null,
    senderData: options?.senderId ? {
      senderId: options.senderId,
      channel: options.channel ?? 'unknown',
      receivedAt: options.receivedAt ?? new Date(),
    } : undefined,
    metadata: {
      sizeBytes: buffer.length,
      originalName: fileName,
      extractorUsed: 'video-ffprobe',
    },
  }
}

// ═══════════════════════════════════════════
// LLM Enrichment: Descripción + Transcripción via Gemini Multimodal
// Gemini acepta video directamente (MP4, MOV, WebM, etc.)
// ═══════════════════════════════════════════

/**
 * Describe y transcribe un video via Gemini multimodal.
 * Recibe un VideoResult ya procesado (code-only) y le agrega llmEnrichment.
 * Si el video tiene audio, pide transcripción además de descripción visual.
 */
export async function describeVideo(
  videoResult: VideoResult,
  registry: Registry,
): Promise<VideoResult> {
  try {
    const base64Video = videoResult.buffer.toString('base64')

    const hasAudioInstr = videoResult.hasAudio
      ? '\nEl video tiene audio. Incluye también la transcripción del audio al final, precedida por "[Transcripción]:".'
      : ''

    const result = await registry.callHook('llm:chat', {
      task: 'extractor-video-multimodal',
      system: `Eres un asistente que analiza videos. Describe el contenido visual de forma detallada: escenas, textos visibles, personas, objetos, acciones, transiciones. Sé exhaustivo y preciso. Responde en español.${hasAudioInstr}`,
      messages: [{
        role: 'user' as const,
        content: [
          { type: 'video' as const, data: base64Video, mimeType: videoResult.mimeType },
          { type: 'text' as const, text: 'Describe detalladamente el contenido de este video.' },
        ],
      }],
      maxTokens: 4096,
      temperature: 0.1,
    })

    if (result && typeof result === 'object' && 'text' in result) {
      const fullText = (result as { text: string }).text?.trim()
      if (fullText) {
        // Separar descripción de transcripción si existe
        let description = fullText
        let transcription: string | undefined
        const transcriptionMarker = '[Transcripción]:'
        const markerIdx = fullText.indexOf(transcriptionMarker)
        if (markerIdx !== -1) {
          description = fullText.slice(0, markerIdx).trim()
          transcription = fullText.slice(markerIdx + transcriptionMarker.length).trim()
        }

        const enrichment: LLMEnrichment = {
          description,
          transcription,
          provider: (result as { provider?: string }).provider ?? 'google',
          generatedAt: new Date(),
        }
        logger.info({ format: videoResult.format, duration: videoResult.durationSeconds, descLength: description.length }, 'Video described via multimodal')
        return { ...videoResult, llmEnrichment: enrichment }
      }
    }

    logger.warn({ format: videoResult.format }, 'Video multimodal returned empty — no enrichment')
    return videoResult
  } catch (err) {
    logger.warn({ err, format: videoResult.format }, 'describeVideo failed — returning without enrichment')
    return videoResult
  }
}

// ═══════════════════════════════════════════
// FFmpeg / FFprobe helpers
// ═══════════════════════════════════════════

interface ProbeResult {
  duration: number
  hasAudio: boolean
}

async function probeMedia(buffer: Buffer, fileName: string): Promise<ProbeResult> {
  const tmpPath = join(tmpdir(), `luna-probe-${randomUUID()}-${fileName}`)

  try {
    await writeFile(tmpPath, buffer)
    const output = await execPromise('ffprobe', [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      '-show_streams',
      tmpPath,
    ])

    const data = JSON.parse(output) as {
      format?: { duration?: string }
      streams?: Array<{ codec_type?: string }>
    }

    const duration = parseFloat(data.format?.duration ?? '0')
    const hasAudio = (data.streams ?? []).some(s => s.codec_type === 'audio')

    return { duration, hasAudio }
  } catch (err) {
    logger.warn({ err, fileName }, 'ffprobe failed, returning defaults')
    return { duration: 0, hasAudio: false }
  } finally {
    await unlink(tmpPath).catch(() => {})
  }
}

async function convertToMp4(input: Buffer, fileName: string): Promise<Buffer> {
  const inputPath = join(tmpdir(), `luna-in-${randomUUID()}-${fileName}`)
  const outputPath = join(tmpdir(), `luna-out-${randomUUID()}.mp4`)

  try {
    await writeFile(inputPath, input)
    await execPromise('ffmpeg', [
      '-i', inputPath,
      '-c:v', 'libx264',
      '-c:a', 'aac',
      '-movflags', '+faststart',
      '-y',
      outputPath,
    ])
    return await readFile(outputPath)
  } finally {
    await Promise.all([
      unlink(inputPath).catch(() => {}),
      unlink(outputPath).catch(() => {}),
    ])
  }
}

function execPromise(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 10 * 1024 * 1024, timeout: 120_000 }, (err: Error | null, stdout: string) => {
      if (err) reject(err)
      else resolve(stdout)
    })
  })
}

function mimeToFormat(mimeType: string): string {
  const map: Record<string, string> = {
    'video/mp4': 'mp4',
    'video/quicktime': 'mov',
    'video/x-msvideo': 'avi',
    'video/webm': 'webm',
    'video/x-ms-wmv': 'wmv',
    'video/3gpp': '3gp',
    'video/mpeg': 'mpeg',
    'video/x-flv': 'flv',
  }
  return map[mimeType] ?? 'unknown'
}
