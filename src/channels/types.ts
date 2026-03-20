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
