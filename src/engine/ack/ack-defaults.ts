// LUNA Engine — ACK default messages
// Predefined pool of ack messages used when LLM ACK generation fails.

/** Default ack messages keyed by channel name. '' = all channels. */
export const DEFAULT_ACK_MESSAGES: Record<string, string[]> = {
  '': ['Un momento...', 'Dame un segundo...', 'Estoy en eso...'],
  'whatsapp': ['Un momento...', 'Ya te reviso...', 'Un momento, déjame ver...'],
  'email': ['Procesando su consulta...'],
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
