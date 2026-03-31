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
import type { VideoResult } from './types.js'
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
