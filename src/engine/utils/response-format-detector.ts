// LUNA Engine — Response Format Detector
// Code-driven detection of whether the user explicitly requests audio or text response.
// No LLM involved — pure regex pattern matching.

/**
 * Detect if the user explicitly requests a specific response format.
 * Returns 'audio', 'text', or null (no explicit preference).
 *
 * Patterns detected:
 * - "mandame un audio" / "envíame un audio" / "respondeme con audio" → audio
 * - "mandame un mensaje" / "escríbeme" / "respondeme con texto" → text
 */
export function detectExplicitFormat(text: string): 'audio' | 'text' | null {
  if (!text) return null
  const lower = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')

  // ── Audio request patterns ──
  const audioPatterns = [
    /\b(?:manda|envia|enviame|mandame|respondeme|contestame|dime)\b.*\b(?:audio|nota de voz|mensaje de voz|voz)\b/,
    /\b(?:audio|nota de voz|mensaje de voz)\b.*\b(?:manda|envia|enviame|mandame|respondeme|contestame)\b/,
    /\b(?:habla|hablame|dime)\b.*\b(?:por audio|en audio|con audio|por voz|en voz)\b/,
    /\b(?:responde|contesta|respondeme|contestame)\b.*\b(?:en audio|con audio|por audio|por voz|con voz)\b/,
    /\bpor (?:audio|voz)\b/,
    /\ben (?:audio|nota de voz)\b/,
    /\bcon (?:audio|voz)\b/,
    /\b(?:send|reply|respond).*\b(?:audio|voice|voice note|voice message)\b/i,
  ]

  for (const p of audioPatterns) {
    if (p.test(lower)) return 'audio'
  }

  // ── Text request patterns ──
  const textPatterns = [
    /\b(?:manda|envia|enviame|mandame|respondeme|contestame)\b.*\b(?:mensaje|texto|escrito|por escrito)\b/,
    /\b(?:mensaje|texto|escrito)\b.*\b(?:manda|envia|enviame|mandame|respondeme|contestame)\b/,
    /\b(?:escribe|escribeme|escribeme|escribime)\b/,
    /\b(?:responde|contesta|respondeme|contestame)\b.*\b(?:en texto|con texto|por texto|por escrito|con mensaje)\b/,
    /\bpor (?:texto|escrito|mensaje)\b/,
    /\ben (?:texto|escrito)\b/,
    /\b(?:send|reply|respond).*\b(?:text|message|written)\b/i,
    /\bno (?:audio|voz)\b/,
  ]

  for (const p of textPatterns) {
    if (p.test(lower)) return 'text'
  }

  return null
}

/**
 * Determine the response format for a message, considering:
 * 1. Explicit user request ("mandame un audio")
 * 2. Input type (audio → prefer audio on supported channels)
 * 3. Channel support (only instant channels with TTS support)
 *
 * @returns 'audio' | 'text' | 'auto' (auto = let TTS ratio decide)
 */
export function determineResponseFormat(
  text: string,
  inputType: string,
  _channelName: string,
  channelType: string,
  ttsEnabled = false,
): 'audio' | 'text' | 'auto' {
  // 1. Explicit user request overrides everything
  const explicit = detectExplicitFormat(text)
  if (explicit) return explicit

  // 2. Audio input on instant channels → auto (let ratio decide via TTS_AUDIO_TO_AUDIO_FREQ)
  if (inputType === 'audio' && channelType === 'instant') return 'auto'

  // 3. When TTS is enabled for this channel, text input also gets 'auto'
  //    so TTS_TEXT_TO_AUDIO_FREQ ratio (e.g. 5-10%) is actually consulted in post-processor
  if (ttsEnabled && channelType === 'instant') return 'auto'

  // 4. Default: text (async channels, TTS disabled, etc.)
  return 'text'
}
