// LUNA — Module: google-chat — Types
// Interfaces para Google Chat channel (Service Account auth, webhook events).

// ═══════════════════════════════════════════
// Config del módulo (parsed from configSchema)
// ═══════════════════════════════════════════

export interface GoogleChatConfig {
  // Connection
  GOOGLE_CHAT_SERVICE_ACCOUNT_KEY: string
  GOOGLE_CHAT_WEBHOOK_TOKEN: string
  // Message limits
  GOOGLE_CHAT_MAX_MESSAGE_LENGTH: number
  // Room behavior
  GOOGLE_CHAT_DM_ONLY: boolean
  GOOGLE_CHAT_REQUIRE_MENTION: boolean
  GOOGLE_CHAT_SPACE_WHITELIST: string
  // Threads
  GOOGLE_CHAT_REPLY_IN_THREAD: boolean
  GOOGLE_CHAT_PROCESS_THREADS: boolean
  // Retries
  GOOGLE_CHAT_MAX_RETRIES: number
  GOOGLE_CHAT_RETRY_DELAY_MS: number
  // Cards
  GOOGLE_CHAT_PROCESS_CARD_CLICKS: boolean
  GOOGLE_CHAT_CARD_CLICK_ACTION: string
  // Channel runtime config (read by engine via channel-config service)
  GOOGLE_CHAT_AVISO_TRIGGER_MS: number
  GOOGLE_CHAT_AVISO_HOLD_MS: number
  GOOGLE_CHAT_AVISO_MESSAGE: string
  GOOGLE_CHAT_AVISO_STYLE: string
  GOOGLE_CHAT_RATE_LIMIT_HOUR: number
  GOOGLE_CHAT_RATE_LIMIT_DAY: number
  GOOGLE_CHAT_SESSION_TIMEOUT_HOURS: number
  GOOGLE_CHAT_BATCH_WAIT_SECONDS: number
  GOOGLE_CHAT_PRECLOSE_FOLLOWUP_HOURS: number
  GOOGLE_CHAT_PRECLOSE_MESSAGE: string
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

export interface ChatCardAction {
  actionMethodName: string
  parameters?: Array<{ key: string; value: string }>
}

export interface ChatEvent {
  type: ChatEventType
  eventTime: string
  space: ChatSpaceInfo
  user: ChatUserInfo
  message?: ChatMessageInfo
  action?: ChatCardAction
}

// ═══════════════════════════════════════════
// Send result
// ═══════════════════════════════════════════

export interface SendResult {
  success: boolean
  channelMessageId?: string
  error?: string
}
