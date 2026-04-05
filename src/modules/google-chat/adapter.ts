// LUNA — Module: google-chat — Adapter
// Wrapper para Google Chat API. Recibe webhooks, envía mensajes via Service Account.
// Rooms: require @mention (same pattern as WhatsApp groups).
// Threads: reply in same thread. Retries with backoff. Card click processing.

import { readFileSync } from 'node:fs'
import { google, chat_v1 } from 'googleapis'
import { GoogleAuth } from 'google-auth-library'
import pino from 'pino'
import type { Pool } from 'pg'
import type {
  GoogleChatConfig,
  GoogleChatState,
  ChatEvent,
  ChatAttachmentData,
  SendResult,
  ServiceAccountKeyInfo,
} from './types.js'
import type { AttachmentMeta } from '../../channels/types.js'

const logger = pino({ name: 'google-chat:adapter' })

export class GoogleChatAdapter {
  private auth: GoogleAuth | null = null
  private chatClient: chat_v1.Chat | null = null
  private state: GoogleChatState = {
    status: 'disconnected',
    botEmail: null,
    activeSpaces: 0,
    lastError: null,
  }
  private parsedWhitelist: Set<string> = new Set()
  private getAgentName: () => string

  constructor(
    private config: GoogleChatConfig,
    private db: Pool,
    getAgentName: () => string,
  ) {
    this.getAgentName = getAgentName
    this.rebuildWhitelist()
  }

  // ─── Lifecycle ──────────────────────────────────

  async initialize(): Promise<void> {
    try {
      const keyJson = this.parseServiceAccountKey(this.config.GOOGLE_CHAT_SERVICE_ACCOUNT_KEY)

      this.auth = new GoogleAuth({
        credentials: keyJson,
        scopes: ['https://www.googleapis.com/auth/chat.bot'],
      })

      this.chatClient = google.chat({ version: 'v1', auth: this.auth })

      // Verify connectivity by getting the auth client email
      const authClient = await this.auth.getClient()
      const email = ('email' in authClient) ? (authClient as { email?: string }).email ?? null : null
      this.state.botEmail = email

      // Load active spaces count from DB
      const countRes = await this.db.query('SELECT COUNT(*) as cnt FROM google_chat_spaces WHERE active = true')
      this.state.activeSpaces = parseInt(countRes.rows[0]?.cnt ?? '0', 10)

      this.state.status = 'connected'
      this.state.lastError = null
      logger.info({ botEmail: email, activeSpaces: this.state.activeSpaces }, 'Google Chat adapter initialized')
    } catch (err) {
      this.state.status = 'error'
      this.state.lastError = String(err)
      logger.error({ err }, 'Failed to initialize Google Chat adapter')
      throw err
    }
  }

  shutdown(): void {
    this.chatClient = null
    this.auth = null
    this.state.status = 'disconnected'
    logger.info('Google Chat adapter shut down')
  }

  getState(): GoogleChatState {
    return { ...this.state }
  }

  /** Rebuild whitelist set from comma-separated config string */
  rebuildWhitelist(): void {
    this.parsedWhitelist.clear()
    const raw = this.config.GOOGLE_CHAT_SPACE_WHITELIST.trim()
    if (!raw) return
    for (const s of raw.split(',')) {
      const trimmed = s.trim()
      if (trimmed) this.parsedWhitelist.add(trimmed)
    }
  }

  // ─── Incoming: handle webhook events ──────────────

  async handleWebhookEvent(event: ChatEvent): Promise<{
    id: string
    channelName: string
    channelMessageId: string
    from: string
    timestamp: Date
    content: { type: string; text?: string }
    threadName?: string
    attachments?: AttachmentMeta[]
    raw: unknown
  } | null> {
    if (event.type === 'ADDED_TO_SPACE') {
      await this.trackSpace(event)
      logger.info({ space: event.space.name, type: event.space.type }, 'Bot added to space')
      return null
    }

    if (event.type === 'REMOVED_FROM_SPACE') {
      await this.untrackSpace(event.space.name)
      logger.info({ space: event.space.name }, 'Bot removed from space')
      return null
    }

    // ── CARD_CLICKED handling ──
    if (event.type === 'CARD_CLICKED') {
      if (!this.config.GOOGLE_CHAT_PROCESS_CARD_CLICKS) return null
      const action = this.config.GOOGLE_CHAT_CARD_CLICK_ACTION
      if (action === 'ignore') return null
      if (action === 'log') {
        logger.info({ space: event.space.name, action: event.action }, 'Card clicked (log only)')
        return null
      }
      // action === 'respond' → normalize as a message with the action method name
      const actionText = event.action?.actionMethodName ?? 'card_click'
      return {
        id: `card-${event.space.name}-${Date.now()}`,
        channelName: 'google-chat',
        channelMessageId: `card-${Date.now()}`,
        from: event.user.email,
        timestamp: new Date(event.eventTime),
        content: { type: 'text', text: actionText },
        threadName: event.message?.thread?.name,
        raw: event,
      }
    }

    if (event.type !== 'MESSAGE' || !event.message) {
      return null
    }

    // Skip bot messages
    if (event.user.type === 'BOT') return null

    // ── Space whitelist ──
    if (this.parsedWhitelist.size > 0 && !this.parsedWhitelist.has(event.space.name)) {
      logger.debug({ space: event.space.name }, 'Space not in whitelist, ignoring')
      return null
    }

    const isRoom = event.space.type === 'ROOM' || event.space.type === 'SPACE'

    // ── DM-only mode ──
    if (this.config.GOOGLE_CHAT_DM_ONLY && isRoom) {
      logger.debug({ space: event.space.name }, 'DM-only mode, ignoring room message')
      return null
    }

    // ── Thread filtering ──
    // When PROCESS_THREADS is false, skip messages that are replies in threads.
    // Google Chat always populates thread.name, even for root messages. To distinguish
    // root vs reply: if the message name starts with the thread name, it IS the root.
    if (!this.config.GOOGLE_CHAT_PROCESS_THREADS && event.message.thread?.name) {
      const threadName = event.message.thread.name
      const messageName = event.message.name
      // Root message: its name starts with the same path as the thread.
      // Reply: message name differs from thread's origin message.
      const isRoot = messageName === threadName || messageName.startsWith(threadName + '/')
      if (!isRoot) {
        logger.debug({ space: event.space.name, thread: threadName }, 'Thread processing disabled, skipping reply')
        return null
      }
    }

    // Use argumentText (text without @mention) if available, fallback to full text
    const fullText = event.message.text || ''
    const argumentText = event.message.argumentText?.trim() || ''

    // ── Require mention in rooms (same pattern as WhatsApp groups) ──
    if (isRoom && this.config.GOOGLE_CHAT_REQUIRE_MENTION) {
      const mentioned = this.isBotMentioned(fullText, argumentText)
      if (!mentioned) return null
    }

    // Use argumentText for cleaner processing (text without @mention)
    const text = isRoom && argumentText ? argumentText : fullText

    // Track/update space last_message_at
    await this.touchSpace(event)

    // Extract attachments from webhook payload
    const attachments = this.extractAttachments(event.message.attachment)

    return {
      id: event.message.name,
      channelName: 'google-chat',
      channelMessageId: event.message.name,
      from: event.user.email,
      timestamp: new Date(event.eventTime),
      content: { type: text ? 'text' : (attachments.length > 0 ? 'document' : 'text'), text },
      threadName: event.message.thread?.name,
      attachments: attachments.length > 0 ? attachments : undefined,
      raw: event,
    }
  }

  // ─── Attachment extraction ───────────────────────────

  /**
   * Extract attachments from Google Chat webhook payload.
   * Each attachment gets a lazy loader that fetches the binary via downloadUri
   * using the service account's auth credentials.
   */
  private extractAttachments(rawAttachments?: ChatAttachmentData[]): AttachmentMeta[] {
    if (!rawAttachments || rawAttachments.length === 0) return []

    return rawAttachments
      .filter(att => att.downloadUri || att.driveDataRef)
      .map(att => {
        const filename = att.contentName || att.name.split('/').pop() || `attachment-${Date.now()}`
        const mimeType = att.contentType || 'application/octet-stream'

        return {
          id: `gchat-att-${att.name}`,
          filename,
          mimeType,
          size: 0, // Google Chat webhook doesn't include file size
          getData: () => this.downloadAttachment(att),
        }
      })
  }

  /**
   * Download an attachment binary using the service account's auth token.
   * Supports downloadUri (uploaded content) and driveDataRef (Drive files).
   */
  private async downloadAttachment(att: ChatAttachmentData): Promise<Buffer> {
    if (att.downloadUri) {
      // Uploaded content — fetch with auth header
      const client = this.auth ? await this.auth.getClient() : null
      const headers: Record<string, string> = {}
      if (client && 'getAccessToken' in client) {
        const tokenRes = await (client as { getAccessToken: () => Promise<{ token?: string | null }> }).getAccessToken()
        if (tokenRes.token) headers['Authorization'] = `Bearer ${tokenRes.token}`
      }

      const response = await fetch(att.downloadUri, { headers, signal: AbortSignal.timeout(30_000) })
      if (!response.ok) {
        throw new Error(`Failed to download Google Chat attachment: HTTP ${response.status}`)
      }
      return Buffer.from(await response.arrayBuffer())
    }

    if (att.driveDataRef) {
      // Drive file — use the media.download endpoint via Chat API
      if (!this.chatClient) throw new Error('Chat client not initialized')
      const res = await this.chatClient.media.download(
        { resourceName: att.name },
        { responseType: 'arraybuffer' },
      )
      return Buffer.from(res.data as ArrayBuffer)
    }

    throw new Error(`No download method available for attachment: ${att.name}`)
  }

  // ─── Mention detection (same pattern as WhatsApp) ──────

  /**
   * Check if the bot is mentioned in a room message.
   * Detection methods (mirrors WhatsApp's isBotMentioned):
   * 1. argumentText differs from text → Google stripped a @mention
   * 2. @agentName in text
   * 3. agentName prefix ("Luna," or "Luna:" at start)
   */
  private isBotMentioned(fullText: string, argumentText: string): boolean {
    // Method 1: Google Chat provides argumentText when bot is @mentioned
    // If argumentText is non-empty and differs from fullText, bot was mentioned
    if (argumentText && argumentText !== fullText.trim()) return true

    // Method 2 & 3: Text-based detection (same as WhatsApp)
    const agentName = this.getAgentName().toLowerCase()
    const lowerText = fullText.toLowerCase().trim()

    if (lowerText.includes(`@${agentName}`)) return true
    if (lowerText.startsWith(agentName + ',') || lowerText.startsWith(agentName + ':')) return true
    if (lowerText.startsWith(agentName + ' ')) return true

    return false
  }

  // ─── Outgoing: send messages ──────────────────────

  async sendMessage(spaceName: string, text: string, threadName?: string): Promise<SendResult> {
    if (!this.chatClient) {
      return { success: false, error: 'Chat client not initialized' }
    }

    const maxRetries = this.config.GOOGLE_CHAT_MAX_RETRIES
    const retryDelay = this.config.GOOGLE_CHAT_RETRY_DELAY_MS

    // Truncate if exceeds max length
    const maxLen = this.config.GOOGLE_CHAT_MAX_MESSAGE_LENGTH
    const truncatedText = text.length > maxLen
      ? text.slice(0, maxLen - 3) + '...'
      : text

    // Build request body
    const requestBody: chat_v1.Schema$Message = { text: truncatedText }

    // Reply in thread if configured and threadName available
    if (this.config.GOOGLE_CHAT_REPLY_IN_THREAD && threadName) {
      requestBody.thread = { name: threadName }
    }

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const res = await this.chatClient.spaces.messages.create({
          parent: spaceName,
          requestBody,
          // messageReplyOption needed when replying to a thread
          ...(requestBody.thread ? { messageReplyOption: 'REPLY_MESSAGE_FALLBACK_TO_NEW_THREAD' } : {}),
        })

        const messageId = res.data.name ?? undefined
        logger.debug({ spaceName, messageId, attempt }, 'Message sent to Google Chat')
        return { success: true, channelMessageId: messageId }
      } catch (err) {
        const errMsg = String(err)

        // Don't retry on 4xx errors (client errors)
        const is4xx = errMsg.includes('400') || errMsg.includes('401')
          || errMsg.includes('403') || errMsg.includes('404')
          || errMsg.includes('409') || errMsg.includes('429')
        if (is4xx || attempt === maxRetries) {
          logger.error({ err, spaceName, attempt }, 'Failed to send message to Google Chat')
          return { success: false, error: errMsg }
        }

        // Retry with linear backoff for transient errors
        const delay = retryDelay * (attempt + 1)
        logger.warn({ err, spaceName, attempt, nextRetryMs: delay }, 'Retrying Google Chat send')
        await new Promise(r => setTimeout(r, delay))
      }
    }

    return { success: false, error: 'Max retries exceeded' }
  }

  // ─── Webhook verification ────────────────────────

  verifyWebhookToken(authHeader: string | undefined): boolean {
    // FIX: SEC-4.2 — Rechazar si no hay token configurado (antes aceptaba todo)
    if (!this.config.GOOGLE_CHAT_WEBHOOK_TOKEN) {
      logger.warn('Google Chat webhook rejected: no verification token configured')
      return false
    }

    if (!authHeader) return false

    // Google Chat sends: "Bearer <token>" or just the token
    const token = authHeader.startsWith('Bearer ')
      ? authHeader.slice(7)
      : authHeader

    return token === this.config.GOOGLE_CHAT_WEBHOOK_TOKEN
  }

  // ─── Space tracking ──────────────────────────────

  private async trackSpace(event: ChatEvent): Promise<void> {
    const userEmail = event.space.type === 'DM' ? event.user.email : null
    await this.db.query(
      `INSERT INTO google_chat_spaces (space_name, space_type, display_name, user_email, bot_added_at, active)
       VALUES ($1, $2, $3, $4, now(), true)
       ON CONFLICT (space_name) DO UPDATE SET active = true, display_name = $3, user_email = COALESCE($4, google_chat_spaces.user_email)`,
      [event.space.name, event.space.type, event.space.displayName ?? null, userEmail],
    )
    this.state.activeSpaces++
  }

  private async untrackSpace(spaceName: string): Promise<void> {
    await this.db.query(
      'UPDATE google_chat_spaces SET active = false WHERE space_name = $1',
      [spaceName],
    )
    if (this.state.activeSpaces > 0) this.state.activeSpaces--
  }

  private async touchSpace(event: ChatEvent): Promise<void> {
    const userEmail = event.user.type === 'HUMAN' ? event.user.email : null
    await this.db.query(
      `INSERT INTO google_chat_spaces (space_name, space_type, display_name, user_email, last_message_at, active)
       VALUES ($1, $2, $3, $4, now(), true)
       ON CONFLICT (space_name) DO UPDATE SET last_message_at = now(), user_email = COALESCE($4, google_chat_spaces.user_email)`,
      [event.space.name, event.space.type, event.space.displayName ?? null, userEmail],
    )
  }

  /** Resolve space name for a user email (for outbound messages in DMs) */
  async resolveSpaceForEmail(email: string): Promise<string | null> {
    const res = await this.db.query(
      'SELECT space_name FROM google_chat_spaces WHERE user_email = $1 AND active = true AND space_type = $2 ORDER BY last_message_at DESC NULLS LAST LIMIT 1',
      [email, 'DM'],
    )
    return res.rows[0]?.space_name ?? null
  }

  // ─── Validation ───────────────────────────────────

  /** Validate a service account key JSON without initializing the adapter */
  static validateServiceAccountKey(keyInput: string): ServiceAccountKeyInfo {
    const result: ServiceAccountKeyInfo = {
      valid: false,
      projectId: null,
      clientEmail: null,
      clientId: null,
      errors: [],
    }

    if (!keyInput || !keyInput.trim()) {
      result.errors.push('El JSON del Service Account está vacío / Service Account JSON is empty')
      return result
    }

    let parsed: Record<string, unknown>
    try {
      const trimmed = keyInput.trim()
      if (trimmed.startsWith('{')) {
        parsed = JSON.parse(trimmed) as Record<string, unknown>
      } else {
        // Try reading as file path
        try {
          const content = readFileSync(trimmed, 'utf-8')
          parsed = JSON.parse(content) as Record<string, unknown>
        } catch {
          result.errors.push('No se pudo leer el archivo. Verifica la ruta / Could not read file. Check the path')
          return result
        }
      }
    } catch {
      result.errors.push('JSON inválido. Asegúrate de pegar el contenido completo del archivo .json / Invalid JSON. Make sure to paste the complete .json file content')
      return result
    }

    // Check required fields
    if (parsed.type !== 'service_account') {
      result.errors.push('El JSON no es de tipo "service_account". Descarga el JSON correcto desde Google Cloud Console → IAM → Service Accounts → Keys / JSON is not type "service_account". Download the correct JSON from Google Cloud Console → IAM → Service Accounts → Keys')
    }

    if (!parsed.private_key || typeof parsed.private_key !== 'string') {
      result.errors.push('Falta el campo "private_key" / Missing "private_key" field')
    }

    if (!parsed.client_email || typeof parsed.client_email !== 'string') {
      result.errors.push('Falta el campo "client_email" / Missing "client_email" field')
    } else {
      result.clientEmail = parsed.client_email as string
    }

    if (parsed.project_id && typeof parsed.project_id === 'string') {
      result.projectId = parsed.project_id as string
    }

    if (parsed.client_id && typeof parsed.client_id === 'string') {
      result.clientId = parsed.client_id as string
    }

    if (result.errors.length === 0) {
      result.valid = true
    }

    return result
  }

  // ─── Private helpers ─────────────────────────────

  private parseServiceAccountKey(keyInput: string): Record<string, unknown> {
    // Accept either raw JSON or a file path
    const trimmed = keyInput.trim()
    if (trimmed.startsWith('{')) {
      return JSON.parse(trimmed) as Record<string, unknown>
    }
    // If it looks like a path, read the file
    const content = readFileSync(trimmed, 'utf-8')
    return JSON.parse(content) as Record<string, unknown>
  }
}
