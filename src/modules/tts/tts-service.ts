// LUNA — TTS Service
// Calls Google Gemini AI Studio TTS API to synthesize text to OGG/Opus audio.
// Flow: Gemini TTS → raw PCM (16-bit LE, mono, 24kHz) → WAV header → ffmpeg → OGG/Opus.
// Falls back to WAV if ffmpeg is not available.

import { spawn } from 'node:child_process'
import pino from 'pino'

const logger = pino({ name: 'tts:service' })

export interface TTSConfig {
  TTS_GOOGLE_API_KEY: string
  TTS_VOICE_NAME: string
  TTS_MAX_CHARS: number
  TTS_ENABLED_CHANNELS: string
  TTS_AUTO_FOR_AUDIO_INPUT: boolean
  TTS_AUDIO_TO_AUDIO_FREQ: number
  TTS_TEXT_TO_AUDIO_FREQ: number
  TTS_MAX_DURATION: string
  TTS_VOICE_STYLES?: boolean
  TTS_TEMPERATURE?: number
  TTS_SPEAKING_RATE?: number
}

export interface SynthesizeResult {
  audioBuffer: Buffer
  durationSeconds: number
}

const GEMINI_TTS_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent'

/** Convert raw PCM data to WAV by prepending a 44-byte RIFF header */
function pcmToWav(pcmBuffer: Buffer, sampleRate = 24000, channels = 1, bitsPerSample = 16): Buffer {
  const byteRate = sampleRate * channels * (bitsPerSample / 8)
  const blockAlign = channels * (bitsPerSample / 8)
  const dataSize = pcmBuffer.length
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + dataSize, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(channels, 22)
  header.writeUInt32LE(sampleRate, 24)
  header.writeUInt32LE(byteRate, 28)
  header.writeUInt16LE(blockAlign, 32)
  header.writeUInt16LE(bitsPerSample, 34)
  header.write('data', 36)
  header.writeUInt32LE(dataSize, 40)
  return Buffer.concat([header, pcmBuffer])
}

export class TTSService {
  config: TTSConfig
  private enabledChannels: Set<string>

  constructor(config: TTSConfig) {
    this.config = config
    this.enabledChannels = new Set(
      config.TTS_ENABLED_CHANNELS.split(',').map(c => c.trim()).filter(Boolean),
    )
  }

  /** Hot-reload: update config in place without recreating the service instance */
  updateConfig(fresh: Partial<TTSConfig>): void {
    Object.assign(this.config, fresh)
    if (fresh.TTS_ENABLED_CHANNELS !== undefined) {
      this.enabledChannels = new Set(
        this.config.TTS_ENABLED_CHANNELS.split(',').map(c => c.trim()).filter(Boolean),
      )
    }
  }

  isEnabledForChannel(channel: string): boolean {
    return this.enabledChannels.has(channel)
  }

  shouldAutoTTS(channel: string, inputContentType: string): boolean {
    return this.shouldAutoTTSWithMultiplier(channel, inputContentType, 1.0)
  }

  /**
   * Determine whether to respond with audio, applying a per-contact preference multiplier.
   * @param multiplier 0.0-2.0 — values >1 boost audio probability, <1 dampen it
   */
  shouldAutoTTSWithMultiplier(channel: string, inputContentType: string, multiplier: number): boolean {
    if (!this.isEnabledForChannel(channel)) return false
    if (!this.config.TTS_AUTO_FOR_AUDIO_INPUT) return false

    // Base frequency from config: 0 = never, 100 = always
    const baseFreq = inputContentType === 'audio'
      ? this.config.TTS_AUDIO_TO_AUDIO_FREQ
      : this.config.TTS_TEXT_TO_AUDIO_FREQ

    // Apply per-contact preference multiplier (capped at 100)
    const freq = Math.min(100, baseFreq * multiplier)
    if (freq <= 0) return false
    if (freq >= 100) return true
    return Math.random() * 100 < freq
  }

  /**
   * Synthesize a single text segment into audio.
   * NOTE: Does NOT cap text length — callers (synthesizeChunks) are responsible for capping/chunking.
   * For direct use, cap text before calling.
   */
  async synthesize(text: string): Promise<SynthesizeResult | null> {
    if (!this.config.TTS_GOOGLE_API_KEY) {
      logger.warn('TTS API key not configured')
      return null
    }
    if (!text || text.trim().length === 0) return null

    try {
      const temperature = this.config.TTS_TEMPERATURE ?? 1.2
      const rateTag = speakingRateToTag(this.config.TTS_SPEAKING_RATE ?? 1.0)
      const textToSynthesize = rateTag ? `${rateTag} ${text}` : text
      const response = await fetch(`${GEMINI_TTS_API_URL}?key=${this.config.TTS_GOOGLE_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: textToSynthesize }] }],
          generationConfig: {
            responseModalities: ['AUDIO'],
            temperature,
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: this.config.TTS_VOICE_NAME || 'Kore' },
              },
            },
          },
        }),
      })

      if (!response.ok) {
        const errorText = await response.text()
        logger.error({ status: response.status, body: errorText }, 'Gemini TTS API error')
        return null
      }

      const data = await response.json() as {
        candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data?: string } }> } }>
      }
      const base64Audio = data.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data
      if (!base64Audio) {
        logger.error({ data }, 'Gemini TTS: no audio data in response')
        return null
      }

      const pcmBuffer = Buffer.from(base64Audio, 'base64')
      const wavBuffer = pcmToWav(pcmBuffer)

      // Convert WAV → OGG/Opus via ffmpeg (required for WhatsApp voice notes)
      let audioBuffer: Buffer
      try {
        audioBuffer = await wavToOggOpus(wavBuffer)
      } catch (err) {
        logger.warn({ err }, 'ffmpeg OGG/Opus conversion failed, using WAV fallback')
        audioBuffer = wavBuffer
      }

      // Estimate duration from PCM: 24000 samples/sec * 2 bytes/sample * 1 channel = 48000 bytes/sec
      const durationSeconds = Math.max(1, Math.round(pcmBuffer.length / 48000))

      logger.info({ textLength: text.length, audioBytes: audioBuffer.length, durationSeconds }, 'TTS synthesis complete')

      return { audioBuffer, durationSeconds }
    } catch (err) {
      logger.error({ err }, 'TTS synthesis failed')
      return null
    }
  }

  /**
   * Split text into chunks and synthesize each separately.
   * Uses TTS_MAX_DURATION to cap total text, then splits into ~900-char chunks.
   * Max 2 chunks to avoid flooding the chat with voice notes.
   */
  async synthesizeChunks(text: string): Promise<SynthesizeResult[]> {
    if (!this.config.TTS_GOOGLE_API_KEY) {
      logger.warn('TTS API key not configured')
      return []
    }
    if (!text || text.trim().length === 0) return []

    // Cap total text by duration (~700 chars/min)
    const durationMinutes = parseFloat(this.config.TTS_MAX_DURATION) || 2
    const durationChars = Math.round(durationMinutes * 700)
    const maxChars = Math.min(this.config.TTS_MAX_CHARS, durationChars)
    const capped = text.substring(0, maxChars)

    // Split into chunks (~900 chars by sentence boundaries, max 2)
    const CHUNK_SIZE = 900
    const MAX_CHUNKS = 2
    const chunks = splitTextIntoChunks(capped, CHUNK_SIZE).slice(0, MAX_CHUNKS)

    logger.info({ totalChars: capped.length, chunks: chunks.length }, 'TTS chunking')

    // Synthesize each chunk sequentially (avoid hammering the API)
    const results: SynthesizeResult[] = []
    for (const chunk of chunks) {
      const result = await this.synthesize(chunk)
      if (result) results.push(result)
    }
    return results
  }
}

// ─── Audio conversion ──────────────────────────────

const FFMPEG_TIMEOUT_MS = 15_000

/** Convert WAV buffer to OGG/Opus via ffmpeg (stdin→stdout, no temp files) */
async function wavToOggOpus(wavBuffer: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let settled = false
    const proc = spawn('ffmpeg', [
      '-i', 'pipe:0',
      '-c:a', 'libopus',
      '-b:a', '48k',
      '-application', 'voip',
      '-f', 'ogg',
      'pipe:1',
    ], { stdio: ['pipe', 'pipe', 'pipe'] })

    const outChunks: Buffer[] = []
    const errChunks: Buffer[] = []
    proc.stdout.on('data', (chunk: Buffer) => outChunks.push(chunk))
    proc.stderr.on('data', (chunk: Buffer) => errChunks.push(chunk))

    // Timeout: kill ffmpeg if it hangs
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true
        proc.kill('SIGKILL')
        reject(new Error('ffmpeg timed out after 15s'))
      }
    }, FFMPEG_TIMEOUT_MS)

    proc.on('close', (code) => {
      clearTimeout(timer)
      if (settled) return
      settled = true
      if (code === 0) {
        resolve(Buffer.concat(outChunks))
      } else {
        const stderr = Buffer.concat(errChunks).toString('utf-8').slice(-500)
        reject(new Error(`ffmpeg exited with code ${code}: ${stderr}`))
      }
    })
    proc.on('error', (err) => {
      clearTimeout(timer)
      if (!settled) { settled = true; reject(err) }
    })

    proc.stdin.write(wavBuffer)
    proc.stdin.end()
  })
}

// ─── Speaking rate → style tag ──────────────────────────────

/**
 * Convert a numeric speaking rate multiplier to a Gemini TTS bracket style tag.
 * Gemini TTS does not accept speakingRate as an API field; instead, bracket tags
 * embedded in the text act as style cues the model honors.
 *
 * Mapping (mirrors the 0.25–2.0 range of the old Cloud TTS speakingRate):
 *   ≤ 0.6   → [extremely slow]
 *   0.6–0.85 → [slow]
 *   0.85–1.15 → (normal, no tag)
 *   1.15–1.5  → [fast]
 *   > 1.5    → [extremely fast]
 */
function speakingRateToTag(rate: number): string {
  if (rate <= 0.6) return '[extremely slow]'
  if (rate <= 0.85) return '[slow]'
  if (rate <= 1.15) return ''
  if (rate <= 1.5) return '[fast]'
  return '[extremely fast]'
}

// ─── Text chunking ──────────────────────────────

/** Split text into chunks of approximately maxChars, breaking at sentence boundaries */
function splitTextIntoChunks(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) return [text]

  const chunks: string[] = []
  let remaining = text

  while (remaining.length > 0 && chunks.length < 5) {
    if (remaining.length <= maxChars) {
      chunks.push(remaining)
      break
    }

    // Find the last sentence boundary within maxChars
    const slice = remaining.substring(0, maxChars)
    const lastPeriod = Math.max(
      slice.lastIndexOf('. '),
      slice.lastIndexOf('? '),
      slice.lastIndexOf('! '),
      slice.lastIndexOf('\n'),
    )

    const breakAt = lastPeriod > maxChars * 0.5 ? lastPeriod + 1 : maxChars
    chunks.push(remaining.substring(0, breakAt).trim())
    remaining = remaining.substring(breakAt).trim()
  }

  return chunks.filter(c => c.length > 0)
}
