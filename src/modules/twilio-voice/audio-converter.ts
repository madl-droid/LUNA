// LUNA — Module: twilio-voice — Audio Converter
// Conversión mulaw 8kHz (Twilio) ↔ PCM 16-bit 16kHz (Gemini Live).
// Implementación pura sin dependencias externas.

// ═══════════════════════════════════════════
// Constants
// ═══════════════════════════════════════════

const MULAW_BIAS = 0x84
const MULAW_CLIP = 32635
const TWILIO_SAMPLE_RATE = 8000
const GEMINI_INPUT_SAMPLE_RATE = 16000
const GEMINI_OUTPUT_SAMPLE_RATE = 24000

// ═══════════════════════════════════════════
// Mulaw decode lookup table (256 entries)
// ═══════════════════════════════════════════

const MULAW_DECODE_TABLE = new Int16Array(256)

function buildDecodeLookup(): void {
  for (let i = 0; i < 256; i++) {
    let mu = ~i & 0xff
    const sign = mu & 0x80
    const exponent = (mu >> 4) & 0x07
    let mantissa = mu & 0x0f
    mantissa = (mantissa << 1) | 0x21
    mantissa <<= exponent
    mantissa -= 0x21
    MULAW_DECODE_TABLE[i] = sign ? -mantissa : mantissa
  }
}

buildDecodeLookup()

// ═══════════════════════════════════════════
// Mulaw encode
// ═══════════════════════════════════════════

function encodeMulawSample(sample: number): number {
  const sign = sample < 0 ? 0x80 : 0
  if (sample < 0) sample = -sample
  if (sample > MULAW_CLIP) sample = MULAW_CLIP
  sample += MULAW_BIAS

  let exponent = 7
  const mask = 0x4000
  for (; exponent > 0; exponent--) {
    if (sample & mask) break
    sample <<= 1
  }

  const mantissa = (sample >> (exponent + 3)) & 0x0f
  const byte = ~(sign | (exponent << 4) | mantissa) & 0xff
  return byte
}

// ═══════════════════════════════════════════
// Public conversion functions
// ═══════════════════════════════════════════

/**
 * Convert mulaw 8kHz buffer to PCM 16-bit LE 16kHz buffer.
 * Steps: decode mulaw → PCM 16-bit, then upsample 8kHz → 16kHz via linear interpolation.
 */
export function mulawToPcm16k(mulawBuffer: Buffer): Buffer {
  const sampleCount = mulawBuffer.length
  // Upsample 2x: each input sample produces 2 output samples
  const outputSamples = sampleCount * 2
  const pcmBuffer = Buffer.alloc(outputSamples * 2) // 2 bytes per 16-bit sample

  for (let i = 0; i < sampleCount; i++) {
    const currentSample = MULAW_DECODE_TABLE[mulawBuffer[i]!]!
    const nextSample = i + 1 < sampleCount
      ? MULAW_DECODE_TABLE[mulawBuffer[i + 1]!]!
      : currentSample
    const midSample = (currentSample + nextSample) >> 1

    // Write original sample
    pcmBuffer.writeInt16LE(currentSample, i * 4)
    // Write interpolated sample
    pcmBuffer.writeInt16LE(midSample, i * 4 + 2)
  }

  return pcmBuffer
}

/**
 * Convert PCM 16-bit LE buffer (at given sample rate) to mulaw 8kHz buffer.
 * Downsamples to 8kHz with anti-aliasing (averaging neighboring samples)
 * to avoid high-frequency artifacts that sound like a "bad microphone".
 */
export function pcmToMulaw8k(pcmBuffer: Buffer, inputSampleRate: number = GEMINI_OUTPUT_SAMPLE_RATE): Buffer {
  const bytesPerSample = 2
  const totalSamples = pcmBuffer.length / bytesPerSample
  const ratio = inputSampleRate / TWILIO_SAMPLE_RATE
  // Half-width of the averaging window (samples on each side of center)
  const halfWin = Math.max(1, Math.floor(ratio / 2))
  const outputSamples = Math.floor(totalSamples / ratio)
  const mulawBuffer = Buffer.alloc(outputSamples)

  for (let i = 0; i < outputSamples; i++) {
    const center = Math.floor(i * ratio)
    // Average a window of samples around center for anti-aliasing
    const lo = Math.max(0, center - halfWin)
    const hi = Math.min(totalSamples - 1, center + halfWin)
    let sum = 0
    let count = 0
    for (let j = lo; j <= hi; j++) {
      const off = j * bytesPerSample
      if (off + 1 < pcmBuffer.length) {
        sum += pcmBuffer.readInt16LE(off)
        count++
      }
    }
    const avg = count > 0 ? Math.round(sum / count) : 0
    mulawBuffer[i] = encodeMulawSample(avg)
  }

  return mulawBuffer
}

/**
 * Calculate RMS energy of a PCM 16-bit LE buffer.
 * Used for voice activity detection (VAD).
 */
export function calculateRms(pcmBuffer: Buffer): number {
  const sampleCount = pcmBuffer.length / 2
  if (sampleCount === 0) return 0

  let sumSquares = 0
  for (let i = 0; i < sampleCount; i++) {
    const sample = pcmBuffer.readInt16LE(i * 2)
    sumSquares += sample * sample
  }

  return Math.sqrt(sumSquares / sampleCount)
}

export { TWILIO_SAMPLE_RATE, GEMINI_INPUT_SAMPLE_RATE, GEMINI_OUTPUT_SAMPLE_RATE }

/** Parse sample rate from Gemini mimeType (e.g., 'audio/pcm;rate=24000') */
export function parseSampleRate(mimeType: string, fallback: number = GEMINI_OUTPUT_SAMPLE_RATE): number {
  const match = mimeType.match(/rate=(\d+)/)
  return match ? parseInt(match[1]!, 10) : fallback
}
