// LUNA — Module: gmail — Types
// Interfaces para el canal de email (Gmail).

export interface EmailConfig {
  EMAIL_POLL_INTERVAL_MS: number
  EMAIL_MAX_ATTACHMENT_SIZE_MB: number
  EMAIL_NOREPLY_ADDRESSES: string // comma-separated
  EMAIL_NOREPLY_PATTERNS: string  // comma-separated patterns (regex)
  EMAIL_PROCESS_LABELS: string    // comma-separated Gmail labels to process
  EMAIL_SKIP_LABELS: string       // comma-separated Gmail labels to skip
  EMAIL_AUTO_MARK_READ: boolean
  EMAIL_INCLUDE_SIGNATURE: boolean
  EMAIL_MAX_HISTORY_FETCH: number
  // OAuth standalone (cuando google-apps no está activo)
  GOOGLE_CLIENT_ID: string
  GOOGLE_CLIENT_SECRET: string
  GOOGLE_REDIRECT_URI: string
  GOOGLE_REFRESH_TOKEN: string
  GOOGLE_TOKEN_REFRESH_BUFFER_MS: number
}

export interface EmailMessage {
  id: string
  threadId: string
  from: string
  fromName: string
  to: string[]
  cc: string[]
  bcc: string[]
  replyTo: string | null
  subject: string
  bodyText: string
  bodyHtml: string
  date: Date
  labels: string[]
  attachments: EmailAttachment[]
  inReplyTo: string | null
  messageId: string  // RFC Message-ID header
  references: string[]
  isReply: boolean
}

export interface EmailAttachment {
  id: string
  filename: string
  mimeType: string
  size: number
  data?: Buffer
}

export interface EmailSendOptions {
  to: string[]
  cc?: string[]
  bcc?: string[]
  subject: string
  bodyHtml: string
  bodyText?: string
  attachments?: Array<{
    filename: string
    mimeType: string
    content: Buffer | string
  }>
  /** Headers for reply/forward threading */
  inReplyTo?: string
  references?: string[]
  threadId?: string
}

export interface EmailReplyOptions {
  originalMessageId: string   // Gmail message ID
  bodyHtml: string
  bodyText?: string
  replyAll: boolean
  attachments?: Array<{
    filename: string
    mimeType: string
    content: Buffer | string
  }>
}

export interface EmailForwardOptions {
  originalMessageId: string
  to: string[]
  additionalText?: string
}

export interface EmailPollerState {
  status: 'idle' | 'polling' | 'error' | 'stopped'
  lastPollAt: Date | null
  messagesProcessed: number
  errors: number
  lastError: string | null
}
