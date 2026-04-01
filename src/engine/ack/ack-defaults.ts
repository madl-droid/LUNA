// LUNA Engine — ACK default messages
// Predefined pool of ack messages used when LLM ACK generation fails.
// Keyed by tone (from channel config avisoStyle), not by channel name.

/** Default ack messages — single pool, tone is handled by LLM generation */
export const DEFAULT_ACK_MESSAGES: string[] = [
  'Un momento...',
  'Dame un segundo...',
  'Estoy en eso...',
  'Ya te reviso...',
  'Un momento, déjame ver...',
]

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
 * Pick a random default ACK message from the pool.
 */
export function pickDefaultAck(_tone?: string): string {
  return DEFAULT_ACK_MESSAGES[Math.floor(Math.random() * DEFAULT_ACK_MESSAGES.length)]!
}
