// LUNA — Memory system types

export type SenderType = 'user' | 'agent'

export interface StoredMessage {
  id: string
  sessionId: string
  channelName: string
  senderType: SenderType
  senderId: string
  content: MessageContent
  createdAt: Date
}

export interface MessageContent {
  type: string
  text?: string
  mediaUrl?: string
  summary?: string
}

export interface SessionMeta {
  sessionId: string
  contactId: string
  channelName: string
  startedAt: Date
  lastActivityAt: Date
  messageCount: number
  compressed: boolean
}

export interface CompressionResult {
  summary: string
  originalCount: number
  keptRecentCount: number
}
