// LUNA — Global Extractors — Audio
// Prepara archivos de audio para procesamiento downstream.
// Formatos aceptados por Gemini: MP3, WAV, AIFF, AAC, OGG, FLAC.
// OGG Opus de WhatsApp cuenta como OGG y no necesita conversión.
// Si el formato no está en la lista, convierte a MP3 via ffmpeg.
// Mide duración. NO hace transcripción — eso es concern del consumer.

import { execFile } from 'node:child_process'
import { writeFile, unlink, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { AudioResult, LLMEnrichment } from './types.js'
import type { Registry } from '../kernel/registry.js'
import pino from 'pino'

const logger = pino({ name: 'extractors:audio' })

// Formatos aceptados directamente por Gemini
const GEMINI_AUDIO_MIMES = new Set([
  'audio/mpeg',         // MP3
  'audio/wav',
  'audio/aiff',
  'audio/aac',
  'audio/ogg',          // OGG (incluye Opus)
  'audio/flac',
])

// Estos MIME types se normalizan a audio/ogg (todos son OGG Opus variants)
const OGG_OPUS_VARIANTS = new Set([
  'audio/ogg; codecs=opus',
  'audio/opus',
  'audio/ogg;codecs=opus',
])

export interface AudioExtractOptions {
  accompanyingText?: string
  senderId?: string
  channel?: string
  receivedAt?: Date
}

/**
 * Prepara un audio para procesamiento.
 * Verifica formato, convierte si necesario, mide duración.
 * NO transcribe — eso lo hace el consumer via LLM STT.
 */
export async function extractAudio(
  input: Buffer,
  fileName: string,
  mimeType: string,
  options?: AudioExtractOptions,
): Promise<AudioResult> {
  let buffer = input
  let format = mimeToFormat(mimeType)
  let resolvedMime = mimeType

  // Normalizar variantes de OGG Opus
  if (OGG_OPUS_VARIANTS.has(mimeType)) {
    resolvedMime = 'audio/ogg'
    format = 'ogg'
  }

  // Convertir si el formato no es aceptado por Gemini
  if (!GEMINI_AUDIO_MIMES.has(resolvedMime)) {
    logger.info({ fileName, mimeType }, 'Converting audio to MP3')
    try {
      buffer = await convertToMp3(input, fileName)
      format = 'mp3'
      resolvedMime = 'audio/mpeg'
    } catch (err) {
      logger.warn({ err, fileName }, 'Audio conversion failed, keeping original')
    }
  }

  // Medir duración con ffprobe
  const duration = await probeDuration(buffer, fileName)

  return {
    kind: 'audio',
    buffer,
    format,
    mimeType: resolvedMime,
    durationSeconds: duration,
    accompanyingText: options?.accompanyingText ?? null,
    senderData: options?.senderId ? {
      senderId: options.senderId,
      channel: options.channel ?? 'unknown',
      receivedAt: options.receivedAt ?? new Date(),
    } : undefined,
    metadata: {
      sizeBytes: buffer.length,
      originalName: fileName,
      extractorUsed: 'audio-ffprobe',
      durationSeconds: duration,
      format,
      mimeType: resolvedMime,
      wasConverted: resolvedMime !== mimeType,
    },
  }
}

// ═══════════════════════════════════════════
// LLM Enrichment: Transcripción via STT
// Usa llm:chat con task 'stt' y content part audio.
// ═══════════════════════════════════════════

/**
 * Transcribe audio via LLM STT (Gemini).
 * Recibe un AudioResult ya procesado (code-only) y le agrega llmEnrichment.
 * Retorna el mismo AudioResult con llmEnrichment populado.
 */
export async function transcribeAudioContent(
  audioResult: AudioResult,
  registry: Registry,
): Promise<AudioResult> {
  try {
    const base64Audio = audioResult.buffer.toString('base64')
    const cleanMime = audioResult.mimeType.split(';')[0]!.trim()

    const result = await registry.callHook('llm:chat', {
      task: 'stt',
      messages: [{
        role: 'user' as const,
        content: [
          { type: 'audio' as const, data: base64Audio, mimeType: cleanMime },
          { type: 'text' as const, text: 'Transcribe el audio anterior. Devuelve SOLO el texto transcrito, sin prefijos ni explicaciones.' },
        ],
      }],
      maxTokens: 4096,
    })

    if (result && typeof result === 'object' && 'text' in result) {
      const transcription = (result as { text: string }).text?.trim()
      if (transcription) {
        const enrichment: LLMEnrichment = {
          description: `[Transcripción de audio ${audioResult.format}, ${Math.round(audioResult.durationSeconds)}s]`,
          transcription,
          provider: (result as { provider?: string }).provider ?? 'google',
          generatedAt: new Date(),
        }
        logger.info({ format: audioResult.format, duration: audioResult.durationSeconds, textLength: transcription.length }, 'Audio transcribed via STT')
        return { ...audioResult, llmEnrichment: enrichment }
      }
    }

    logger.warn({ format: audioResult.format }, 'STT returned empty — no enrichment')
    return audioResult
  } catch (err) {
    logger.warn({ err, format: audioResult.format }, 'transcribeAudioContent failed — returning without enrichment')
    return audioResult
  }
}

// ═══════════════════════════════════════════
// FFmpeg / FFprobe helpers
// ═══════════════════════════════════════════

async function probeDuration(buffer: Buffer, fileName: string): Promise<number> {
  const tmpPath = join(tmpdir(), `luna-audio-${randomUUID()}-${fileName.replace(/[^a-zA-Z0-9.]/g, '_')}`)

  try {
    await writeFile(tmpPath, buffer)
    const output = await execPromise('ffprobe', [
      '-v', 'quiet',
      '-print_format', 'json',
      '-show_format',
      tmpPath,
    ])

    const data = JSON.parse(output) as { format?: { duration?: string } }
    return parseFloat(data.format?.duration ?? '0')
  } catch (err) {
    logger.warn({ err, fileName }, 'ffprobe failed for audio, returning 0')
    return 0
  } finally {
    await unlink(tmpPath).catch(() => {})
  }
}

async function convertToMp3(input: Buffer, fileName: string): Promise<Buffer> {
  const safeName = fileName.replace(/[^a-zA-Z0-9.]/g, '_')
  const inputPath = join(tmpdir(), `luna-ain-${randomUUID()}-${safeName}`)
  const outputPath = join(tmpdir(), `luna-aout-${randomUUID()}.mp3`)

  try {
    await writeFile(inputPath, input)
    await execPromise('ffmpeg', [
      '-i', inputPath,
      '-codec:a', 'libmp3lame',
      '-q:a', '2',
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
    'audio/mpeg': 'mp3',
    'audio/wav': 'wav',
    'audio/aiff': 'aiff',
    'audio/aac': 'aac',
    'audio/ogg': 'ogg',
    'audio/flac': 'flac',
    'audio/opus': 'ogg',
  }
  return map[mimeType] ?? 'unknown'
}
