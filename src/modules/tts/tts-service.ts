// LUNA — TTS Service
// Calls Google Cloud TTS API to synthesize text to OGG_OPUS audio.

import pino from 'pino'

const logger = pino({ name: 'tts:service' })

export interface TTSConfig {
  TTS_GOOGLE_API_KEY: string
  TTS_VOICE_LANGUAGE: string
  TTS_VOICE_NAME: string
  TTS_SPEAKING_RATE: string
  TTS_PITCH: string
  TTS_MAX_CHARS: number
  TTS_ENABLED_CHANNELS: string
  TTS_AUTO_FOR_AUDIO_INPUT: boolean
  TTS_AUDIO_TO_AUDIO_FREQ: number
  TTS_TEXT_TO_AUDIO_FREQ: number
  TTS_MAX_DURATION: string
}

export interface SynthesizeResult {
  audioBuffer: Buffer
  durationSeconds: number
}

const TTS_API_URL = 'https://texttospeech.googleapis.com/v1/text:synthesize'

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
      const response = await fetch(`${TTS_API_URL}?key=${this.config.TTS_GOOGLE_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input: { text: truncated },
          voice: {
            languageCode: this.config.TTS_VOICE_LANGUAGE,
            name: this.config.TTS_VOICE_NAME,
          },
          audioConfig: {
            audioEncoding: 'OGG_OPUS',
            speakingRate: parseFloat(this.config.TTS_SPEAKING_RATE) || 1.0,
            pitch: parseFloat(this.config.TTS_PITCH) || 0.0,
            sampleRateHertz: 48000,
          },
        }),
      })

      if (!response.ok) {
        const errorText = await response.text()
        logger.error({ status: response.status, body: errorText }, 'Google TTS API error')
        return null
      }

      const data = await response.json() as { audioContent: string }
      const audioBuffer = Buffer.from(data.audioContent, 'base64')

      // Estimate duration: OGG_OPUS at ~24kbps average
      const durationSeconds = Math.max(1, Math.round(audioBuffer.length / 3000))

      logger.info({ textLength: truncated.length, audioBytes: audioBuffer.length, durationSeconds }, 'TTS synthesis complete')

      return { audioBuffer, durationSeconds }
    } catch (err) {
      logger.error({ err }, 'TTS synthesis failed')
      return null
    }
  }
}
