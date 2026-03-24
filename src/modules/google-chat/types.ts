// LUNA — Module: google-chat — Types
// Interfaces para Google Chat channel (Service Account auth, webhook events).

// ═══════════════════════════════════════════
// Config del módulo (parsed from configSchema)
// ═══════════════════════════════════════════

export interface GoogleChatConfig {
  GOOGLE_CHAT_SERVICE_ACCOUNT_KEY: string
  GOOGLE_CHAT_WEBHOOK_TOKEN: string
  GOOGLE_CHAT_MAX_MESSAGE_LENGTH: number
}

// ═══════════════════════════════════════════
// Service Account key validation
// ═══════════════════════════════════════════

export interface ServiceAccountKeyInfo {
  valid: boolean
  projectId: string | null
  clientEmail: string | null
  clientId: string | null
  errors: string[]
}

// ═══════════════════════════════════════════
// Setup guide info
// ═══════════════════════════════════════════

export interface SetupGuideStep {
  step: number
  title: { es: string; en: string }
  description: { es: string; en: string }
  done: boolean
}

// ═══════════════════════════════════════════
// Adapter state
// ═══════════════════════════════════════════

export type GoogleChatStatus = 'disconnected' | 'connected' | 'error'

export interface GoogleChatState {
  status: GoogleChatStatus
  botEmail: string | null
  activeSpaces: number
  lastError: string | null
}

// ═══════════════════════════════════════════
// Google Chat webhook event types
// ═══════════════════════════════════════════

export type ChatEventType = 'MESSAGE' | 'ADDED_TO_SPACE' | 'REMOVED_FROM_SPACE' | 'CARD_CLICKED'

export interface ChatSpaceInfo {
  name: string
  type: 'DM' | 'ROOM' | 'SPACE'
  displayName?: string
  singleUserBotDm?: boolean
}

export interface ChatUserInfo {
  name: string
  displayName: string
  email: string
  type: 'HUMAN' | 'BOT'
}

export interface ChatMessageInfo {
  name: string
  text: string
  thread?: { name: string }
  sender: ChatUserInfo
  createTime: string
  space: { name: string }
  argumentText?: string
}

export interface ChatEvent {
  type: ChatEventType
  eventTime: string
  space: ChatSpaceInfo
  user: ChatUserInfo
  message?: ChatMessageInfo
}

// ═══════════════════════════════════════════
// Send result
// ═══════════════════════════════════════════

export interface SendResult {
  success: boolean
  channelMessageId?: string
  error?: string
}
