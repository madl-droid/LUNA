// LUNA Engine — ACK types
// Types for the LLM-generated acknowledgment system.

export interface AckConfig {
  /** Ms before sending an ack if response is slow (0 = disabled) */
  triggerMs: number
  /** Ms to hold the real response after ack was sent */
  holdMs: number
}

export interface AckGenerationContext {
  /** Contact display name (may be empty) */
  contactName: string
  /** User message (truncated to 200 chars) */
  userMessage: string
  /** Generic action description (never reveals internal plan) */
  actionType: string
  /** Tone: casual for WhatsApp, formal for email, neutral otherwise */
  tone: 'casual' | 'formal' | 'neutral'
}
