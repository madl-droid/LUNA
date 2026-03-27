// LUNA — Channel types
// Tipos compartidos entre todos los adaptadores de canal

export type ChannelName = 'whatsapp' | 'email' | 'google-chat' | 'instagram' | 'messenger' | 'voice'

export type MessageContentType = 'text' | 'image' | 'audio' | 'video' | 'document' | 'sticker' | 'location' | 'contact'

export interface MessageContent {
  type: MessageContentType
  text?: string
  mediaUrl?: string
  mimeType?: string
  fileName?: string
  caption?: string
  latitude?: number
  longitude?: number
}

/** Mensaje normalizado que el engine recibe (agnóstico del canal) */
export interface IncomingMessage {
  id: string
  channelName: ChannelName
  channelMessageId: string
  /** Channel-specific sender ID (e.g. LID for WhatsApp, email for Gmail) */
  from: string
  /** Phone number resolved from LID mapping (WhatsApp only). Used to auto-create voice channel. */
  resolvedPhone?: string
  /** Display name from the channel (e.g. WhatsApp pushName). Used for auto-registration. */
  senderName?: string
  timestamp: Date
  content: MessageContent
  attachments?: AttachmentMeta[]
  raw?: unknown
}

export interface OutgoingMessage {
  to: string
  content: MessageContent
  quotedMessageId?: string
}

export interface SendResult {
  success: boolean
  channelMessageId?: string
  error?: string
}

/** Metadata for an attachment received from a channel */
export interface AttachmentMeta {
  id: string
  filename: string
  mimeType: string
  size: number
  /** Lazy loader — fetches the actual binary data on demand */
  getData: () => Promise<Buffer>
}

export interface MediaPayload {
  buffer: Buffer
  mimeType: string
  fileName?: string
}

export type MessageHandler = (message: IncomingMessage) => Promise<void>

/**
 * Channel runtime config — provided by each channel module as a service.
 * The engine reads this to get channel-specific behavior parameters.
 *
 * Pattern for adding a new channel:
 * 1. Add these params to your module's configSchema (with defaults)
 * 2. In init(), provide a service: registry.provide('channel-config:{name}', channelConfig)
 * 3. The engine reads via registry.getOptional('channel-config:{channelName}')
 * 4. Listen to 'console:config_applied' to hot-reload values
 *
 * All values must have sensible defaults so the engine works even if the
 * channel module is not active or hasn't registered its config service.
 */
/** Aviso message style — determines tone of auto-ack messages */
export type AvisoStyle = 'formal' | 'casual' | 'express' | 'dynamic'

export interface ChannelRuntimeConfig {
  /** Max messages per hour to this contact (0 = unlimited) */
  rateLimitHour: number
  /** Max messages per day to this contact (0 = unlimited) */
  rateLimitDay: number
  /** Ms before sending an ack/aviso if response is slow (0 = disabled) */
  avisoTriggerMs: number
  /** Ms to hold the real response after aviso was sent */
  avisoHoldMs: number
  /** Pool of aviso messages (one is picked at random) */
  avisoMessages: string[]
  /** Aviso message style: formal, casual, express, dynamic (rotates among styles) */
  avisoStyle: AvisoStyle
  /** Session inactivity timeout in ms */
  sessionTimeoutMs: number
  /** Batch wait time in seconds (0 = no batching) */
  batchWaitSeconds: number
  /** Ms before session close to send a follow-up reminder (0 = disabled) */
  precloseFollowupMs: number
  /** Message text for the pre-close follow-up */
  precloseFollowupMessage: string

  // ── Typing delay (per-channel, used by engine for composing between bubbles) ──
  /** Ms per character for simulated typing delay */
  typingDelayMsPerChar: number
  /** Minimum typing delay in ms */
  typingDelayMinMs: number
  /** Maximum typing delay in ms */
  typingDelayMaxMs: number

  // ── Channel capabilities ──
  /** Channel type: instant, async, voice */
  channelType: 'instant' | 'async' | 'voice'
  /** Whether the channel API supports typing/composing indicators */
  supportsTypingIndicator: boolean

  // ── Anti-spam (outbound — prevents agent from spamming a contact) ──
  /** Max outbound messages per window (0 = disabled) */
  antiSpamMaxPerWindow: number
  /** Anti-spam window size in ms */
  antiSpamWindowMs: number

  // ── Anti-flooding (inbound — groups rapid user messages) ──
  /** Threshold to trigger immediate flush of batch (0 = disabled) */
  floodThreshold: number

  // ── Attachment processing config ──
  /** Per-channel attachment configuration (optional — engine uses defaults if absent) */
  attachments?: import('../engine/attachments/types.js').ChannelAttachmentConfig
}
