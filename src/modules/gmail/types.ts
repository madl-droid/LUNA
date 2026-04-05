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
  // Reply & footer
  EMAIL_REPLY_MODE: 'reply-all' | 'reply-sender' | 'agent-decides'
  EMAIL_FOOTER_ENABLED: boolean
  EMAIL_FOOTER_TEXT: string
  // Filtering
  EMAIL_ONLY_FIRST_IN_THREAD: boolean
  EMAIL_IGNORE_SUBJECTS: string   // comma-separated
  EMAIL_ALLOWED_DOMAINS: string   // comma-separated
  EMAIL_BLOCKED_DOMAINS: string   // comma-separated
  // Rate limiting
  EMAIL_ACCOUNT_TYPE: 'workspace' | 'free'
  EMAIL_RATE_LIMIT_PER_HOUR: number
  EMAIL_RATE_LIMIT_PER_DAY: number
  // Always CC
  EMAIL_ALWAYS_CC: string
  // Custom labels
  EMAIL_CUSTOM_LABELS: string  // JSON array of { name, instruction }
  // Batching
  EMAIL_BATCH_WAIT_MS: number
  // Session management
  EMAIL_SESSION_INACTIVITY_HOURS: number
  EMAIL_PRECLOSE_FOLLOWUP_HOURS: number
  EMAIL_PRECLOSE_FOLLOWUP_TEXT: string
  // Naturalidad
  ACK_EMAIL_TRIGGER_MS: number
  ACK_EMAIL_HOLD_MS: number
  ACK_EMAIL_MESSAGE: string
  ACK_EMAIL_STYLE: string
  // Firma
  EMAIL_SIGNATURE_MODE: string
  EMAIL_SIGNATURE_TEXT: string
  // OAuth standalone (cuando google-apps no está activo)
  GMAIL_CLIENT_ID: string
  GMAIL_CLIENT_SECRET: string
  GMAIL_REFRESH_TOKEN: string
  GMAIL_TOKEN_REFRESH_BUFFER_MS: number
  // Triage
  EMAIL_TRIAGE_ENABLED: boolean
  // Attachment processing config
  EMAIL_ATT_IMAGES: boolean
  EMAIL_ATT_DOCUMENTS: boolean
  EMAIL_ATT_SPREADSHEETS: boolean
  EMAIL_ATT_PRESENTATIONS: boolean
  EMAIL_ATT_TEXT: boolean
  EMAIL_ATT_AUDIO: boolean
  EMAIL_ATT_MAX_SIZE_MB: number
  EMAIL_ATT_MAX_PER_MSG: number
}

export interface LunaLabelIds {
  agent: string | null
  escalated: string | null
  converted: string | null
  humanLoop: string | null
  ignored: string | null
}

/** Custom label defined by user in console. Agent uses 'instruction' to decide when to apply it. */
export interface CustomLabel {
  name: string        // Label name in Gmail (e.g. "LUNA/Hot-Lead")
  instruction: string // Instruction for the agent (e.g. "Apply when lead shows strong buying intent")
}

/** Resolved custom label with Gmail ID */
export interface ResolvedCustomLabel extends CustomLabel {
  id: string
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
  /** True when the email has a List-Unsubscribe header (newsletter/marketing). */
  hasListUnsubscribe: boolean
  /** Raw email headers (lowercased keys) for triage classification. */
  rawHeaders: Record<string, string>
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
