// LUNA — Channel types
// Tipos compartidos entre todos los adaptadores de canal

export type ChannelName = 'whatsapp' | 'email' | 'instagram' | 'messenger' | 'voice'

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
  from: string
  timestamp: Date
  content: MessageContent
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
  /** Session inactivity timeout in ms */
  sessionTimeoutMs: number
  /** Batch wait time in seconds (0 = no batching) */
  batchWaitSeconds: number
  /** Ms before session close to send a follow-up reminder (0 = disabled) */
  precloseFollowupMs: number
  /** Message text for the pre-close follow-up */
  precloseFollowupMessage: string
}
