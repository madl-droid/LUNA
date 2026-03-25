// LUNA Engine — ACK default messages
// Predefined pool of ack messages used when LLM ACK generation fails.

/** Default ack messages keyed by channel name. '' = all channels. */
export const DEFAULT_ACK_MESSAGES: Record<string, string[]> = {
  '': ['Un momento...', 'Dame un segundo...', 'Estoy en eso...'],
  'whatsapp': ['Un momento...', 'Ya te reviso...', 'Un momento, déjame ver...'],
  'email': ['Procesando su consulta...'],
}

/**
 * Error fallback messages: natural-sounding messages for when something fails.
 * These replace ACKs when the pipeline encounters an error — the user should
 * feel like they're talking to a person having a bad moment, not a machine.
 */
export const ERROR_FALLBACK_MESSAGES: Record<string, string[]> = {
  '': [
    'Disculpa, tuve un problema técnico. ¿Podrías repetirme tu mensaje?',
    'Perdona, algo falló de mi lado. ¿Me lo repites?',
    'Lo siento, tuve una dificultad. ¿Podrías intentar de nuevo?',
  ],
  'whatsapp': [
    'Ups, algo falló de mi lado 😅 ¿Me repites tu mensaje?',
    'Perdón, tuve un problemita técnico. ¿Me lo envías de nuevo?',
    'Disculpa, algo no salió bien. ¿Podrías repetirme eso?',
    'Ay, se me cruzaron los cables. ¿Me escribes de nuevo?',
  ],
  'email': [
    'Disculpe las molestias, tuvimos una dificultad técnica procesando su mensaje. Por favor, intente enviarlo nuevamente.',
  ],
}

/** Generic action descriptions mapped from execution plan step types. */
export const ACTION_DESCRIPTIONS: Record<string, string> = {
  web_search: 'búsqueda de información',
  api_call: 'consulta al sistema',
  calendar_check: 'revisión de agenda',
  knowledge_lookup: 'consulta en base de conocimiento',
  subagent: 'análisis detallado',
  respond_only: 'preparación de respuesta',
  default: 'procesamiento',
}

/**
 * Pick a random error fallback message for a given channel.
 * Cascade: channel-specific → generic → hardcoded last resort.
 */
export function pickErrorFallback(channel: string): string {
  const channelMsgs = ERROR_FALLBACK_MESSAGES[channel]
  if (channelMsgs && channelMsgs.length > 0) {
    return channelMsgs[Math.floor(Math.random() * channelMsgs.length)]!
  }
  const generic = ERROR_FALLBACK_MESSAGES['']!
  return generic[Math.floor(Math.random() * generic.length)]!
}
