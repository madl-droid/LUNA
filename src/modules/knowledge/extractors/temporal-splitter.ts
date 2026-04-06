// LUNA — Temporal Splitter
// Parte audio/video en segmentos con ffmpeg.
// Usado por smart-chunker para crear chunks temporales.

import { execFile } from 'node:child_process'
import { writeFile, readFile, unlink, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import pino from 'pino'

const logger = pino({ name: 'temporal-splitter' })

export interface TemporalSegment {
  startSeconds: number
  endSeconds: number
  segmentPath: string  // path al archivo temporal del segmento
}

export interface SplitConfig {
  firstChunkSeconds: number   // 60 para audio, 50 para video
  subsequentSeconds: number   // 70 para audio, 60 para video
  overlapSeconds: number      // 10 para ambos
}

export const AUDIO_SPLIT_CONFIG: SplitConfig = {
  firstChunkSeconds: 60,
  subsequentSeconds: 70,
  overlapSeconds: 10,
}

export const VIDEO_SPLIT_CONFIG: SplitConfig = {
  firstChunkSeconds: 50,
  subsequentSeconds: 60,
  overlapSeconds: 10,
}

/**
 * Calcula los segmentos temporales sin cortar el archivo.
 * Útil para dividir la transcripción por timestamps.
 */
export function calculateSegments(
  totalDurationSeconds: number,
  config: SplitConfig,
): Array<{ startSeconds: number; endSeconds: number }> {
  const segments: Array<{ startSeconds: number; endSeconds: number }> = []

  if (totalDurationSeconds <= 0) return segments

  // Primer chunk
  const firstEnd = Math.min(config.firstChunkSeconds, totalDurationSeconds)
  segments.push({ startSeconds: 0, endSeconds: firstEnd })

  if (firstEnd >= totalDurationSeconds) return segments

  // Chunks subsiguientes con overlap
  let start = firstEnd - config.overlapSeconds
  while (start < totalDurationSeconds) {
    const end = Math.min(start + config.subsequentSeconds, totalDurationSeconds)
    segments.push({ startSeconds: start, endSeconds: end })
    if (end >= totalDurationSeconds) break
    start = end - config.overlapSeconds
  }

  return segments
}

/**
 * Parte un archivo de audio/video en segmentos con ffmpeg.
 * Retorna paths a los archivos temporales de cada segmento.
 * IMPORTANTE: el caller debe limpiar los archivos temporales cuando termine.
 */
export async function splitMediaFile(
  inputBuffer: Buffer,
  mimeType: string,
  totalDurationSeconds: number,
  config: SplitConfig,
): Promise<TemporalSegment[]> {
  const segments = calculateSegments(totalDurationSeconds, config)
  if (segments.length <= 1) return []  // No split needed for single segment

  const ext = mimeToExt(mimeType)
  const tmpDir = join(tmpdir(), `luna-split-${randomUUID()}`)
  await mkdir(tmpDir, { recursive: true })

  const inputPath = join(tmpDir, `input.${ext}`)
  await writeFile(inputPath, inputBuffer)

  const results: TemporalSegment[] = []

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!
    const outputPath = join(tmpDir, `segment_${i}.${ext}`)
    const duration = seg.endSeconds - seg.startSeconds

    try {
      await execPromise('ffmpeg', [
        '-i', inputPath,
        '-ss', String(seg.startSeconds),
        '-t', String(duration),
        '-c', 'copy',  // No re-encode, fast
        '-y',
        outputPath,
      ])

      results.push({
        startSeconds: seg.startSeconds,
        endSeconds: seg.endSeconds,
        segmentPath: outputPath,
      })
    } catch (err) {
      logger.warn({ err, segment: i, start: seg.startSeconds }, 'Failed to split segment')
    }
  }

  // Cleanup input file (segments stay until caller cleans them)
  await unlink(inputPath).catch(() => {})

  return results
}

/**
 * Lee un segment file como Buffer. Caller should unlink after use.
 */
export async function readSegment(segmentPath: string): Promise<Buffer> {
  return readFile(segmentPath)
}

/**
 * Limpia todos los archivos temporales de un split.
 */
export async function cleanupSegments(segments: TemporalSegment[]): Promise<void> {
  await Promise.all(segments.map(s => unlink(s.segmentPath).catch(() => {})))
}

function mimeToExt(mimeType: string): string {
  const map: Record<string, string> = {
    'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/ogg': 'ogg',
    'audio/flac': 'flac', 'audio/aac': 'aac', 'audio/aiff': 'aiff',
    'video/mp4': 'mp4', 'video/quicktime': 'mov', 'video/webm': 'webm',
    'video/x-msvideo': 'avi', 'video/mpeg': 'mpeg',
  }
  return map[mimeType] ?? 'bin'
}

function execPromise(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { maxBuffer: 10 * 1024 * 1024, timeout: 300_000 }, (err: Error | null, stdout: string) => {
      if (err) reject(err)
      else resolve(stdout)
    })
  })
}
