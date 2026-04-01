// LUNA — TTS Service
// Calls Google Gemini AI Studio TTS API to synthesize text to WAV audio.
// TODO: Gemini TTS outputs raw PCM (16-bit LE, mono, 24kHz). We prepend a WAV header.
// For WhatsApp voice notes, OGG_OPUS would be ideal but requires ffmpeg for conversion.
// WAV works as a fallback — the engine/WhatsApp adapter may need to handle conversion.

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
  private config: TTSConfig
  private enabledChannels: Set<string>

  constructor(config: TTSConfig) {
    this.config = config
    this.enabledChannels = new Set(
      config.TTS_ENABLED_CHANNELS.split(',').map(c => c.trim()).filter(Boolean),
    )
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

  async synthesize(text: string): Promise<SynthesizeResult | null> {
    if (!this.config.TTS_GOOGLE_API_KEY) {
      logger.warn('TTS API key not configured')
      return null
    }

    // Duration limit: ~700 chars per minute of spoken audio
    const durationMinutes = parseFloat(this.config.TTS_MAX_DURATION) || 2
    const durationChars = Math.round(durationMinutes * 700)
    const maxChars = Math.min(this.config.TTS_MAX_CHARS, durationChars)
    const truncated = text.substring(0, maxChars)

    try {
      const temperature = this.config.TTS_TEMPERATURE ?? 1.2
      const speakingRate = this.config.TTS_SPEAKING_RATE ?? 1.5
      const response = await fetch(`${GEMINI_TTS_API_URL}?key=${this.config.TTS_GOOGLE_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: truncated }] }],
          generationConfig: {
            responseModalities: ['AUDIO'],
            temperature,
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: this.config.TTS_VOICE_NAME || 'Kore' },
              },
              speakingRate,
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
      // Convert raw PCM to WAV (16-bit LE, mono, 24kHz)
      // TODO: For WhatsApp voice notes, OGG_OPUS is preferred. Consider adding ffmpeg conversion.
      const audioBuffer = pcmToWav(pcmBuffer)

      // Estimate duration from PCM: 24000 samples/sec * 2 bytes/sample * 1 channel = 48000 bytes/sec
      const durationSeconds = Math.max(1, Math.round(pcmBuffer.length / 48000))

      logger.info({ textLength: truncated.length, audioBytes: audioBuffer.length, durationSeconds }, 'TTS synthesis complete')

      return { audioBuffer, durationSeconds }
    } catch (err) {
      logger.error({ err }, 'TTS synthesis failed')
      return null
    }
  }
}
