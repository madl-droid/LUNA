// LUNA Engine — Error fallback messages
// Natural-sounding messages for when the pipeline or delivery fails.
// Keyed by tone (from channel config avisoStyle) so they match the channel's personality.
// The user should feel like a person having a bad moment, not a machine reporting an error.

/** Error fallback messages keyed by tone. '' = neutral fallback. */
export const ERROR_FALLBACK_MESSAGES: Record<string, string[]> = {
  '': [
    'Disculpa, tuve un problema técnico. ¿Podrías repetirme tu mensaje?',
    'Perdona, algo falló de mi lado. ¿Me lo repites?',
    'Lo siento, tuve una dificultad. ¿Podrías intentar de nuevo?',
  ],
  'casual': [
    'Ups, algo falló de mi lado 😅 ¿Me repites tu mensaje?',
    'Perdón, tuve un problemita técnico. ¿Me lo envías de nuevo?',
    'Disculpa, algo no salió bien. ¿Podrías repetirme eso?',
    'Ay, se me cruzaron los cables. ¿Me escribes de nuevo?',
  ],
  'formal': [
    'Disculpe las molestias, tuvimos una dificultad técnica procesando su mensaje. Por favor, intente enviarlo nuevamente.',
    'Lamentamos el inconveniente. Hubo un error al procesar su solicitud. ¿Podría reenviar su mensaje?',
    'Le pedimos disculpas, tuvimos un problema técnico. Por favor, intente de nuevo.',
  ],
  'express': [
    'Error de mi lado, ¿me lo repites?',
    'Falló algo, ¿me reenvías eso?',
    'Ups, no pude procesar eso. ¿De nuevo?',
  ],
}

/** TTS failure fallback messages — sent before the text response when audio was expected but failed. */
export const TTS_FAILURE_MESSAGES: Record<string, string[]> = {
  '': [
    'No pude grabar el audio, te respondo por mensaje:',
    'No me funcionó el audio, te escribo:',
  ],
  'casual': [
    'No me funcionó el micrófono 🎤 te respondo por mensaje:',
    'No pude enviarte el audio, te escribo:',
    'Se me trabó el audio 😅 te mando el mensaje:',
  ],
  'formal': [
    'No fue posible generar el audio. Le respondo por escrito:',
    'Disculpe, no pude enviar la nota de voz. Le respondo por mensaje:',
  ],
  'express': [
    'No pude con el audio, te escribo:',
    'Audio falló, va por texto:',
  ],
}

/**
 * Pick a random TTS failure fallback message for a given tone.
 */
export function pickTTSFailureFallback(tone: string): string {
  const toneMsgs = TTS_FAILURE_MESSAGES[tone]
  if (toneMsgs && toneMsgs.length > 0) {
    return toneMsgs[Math.floor(Math.random() * toneMsgs.length)]!
  }
  const generic = TTS_FAILURE_MESSAGES['']!
  return generic[Math.floor(Math.random() * generic.length)]!
}

/**
 * Pick a random error fallback message for a given tone.
 * Cascade: tone-specific → neutral → hardcoded last resort.
 */
export function pickErrorFallback(tone: string): string {
  const toneMsgs = ERROR_FALLBACK_MESSAGES[tone]
  if (toneMsgs && toneMsgs.length > 0) {
    return toneMsgs[Math.floor(Math.random() * toneMsgs.length)]!
  }
  const generic = ERROR_FALLBACK_MESSAGES['']!
  return generic[Math.floor(Math.random() * generic.length)]!
}
