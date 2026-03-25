// LUNA Engine — ACK default messages
// Predefined pool of ack messages used when LLM ACK generation fails.
// Keyed by tone (from channel config avisoStyle), not by channel name.

/** Default ack messages keyed by tone. '' = neutral fallback. */
export const DEFAULT_ACK_MESSAGES: Record<string, string[]> = {
  '': ['Un momento...', 'Dame un segundo...', 'Estoy en eso...'],
  'casual': ['Un momento...', 'Ya te reviso...', 'Un momento, déjame ver...', 'Dame un segundo...'],
  'formal': ['Un momento por favor...', 'Procesando su consulta...', 'Permítame un momento...'],
  'express': ['Un seg...', 'Ya va...', 'Voy...'],
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
 * Pick a random default ACK message for a given tone.
 * Cascade: tone-specific → neutral → hardcoded.
 */
export function pickDefaultAck(tone: string): string {
  const toneMessages = DEFAULT_ACK_MESSAGES[tone]
  if (toneMessages && toneMessages.length > 0) {
    return toneMessages[Math.floor(Math.random() * toneMessages.length)]!
  }
  const generic = DEFAULT_ACK_MESSAGES['']!
  return generic[Math.floor(Math.random() * generic.length)]!
}
