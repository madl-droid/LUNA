// LUNA — Module: google-chat — Adapter
// Wrapper para Google Chat API. Recibe webhooks, envía mensajes via Service Account.

import { readFileSync } from 'node:fs'
import { google, chat_v1 } from 'googleapis'
import { GoogleAuth } from 'google-auth-library'
import pino from 'pino'
import type { Pool } from 'pg'
import type {
  GoogleChatConfig,
  GoogleChatState,
  GoogleChatStatus,
  ChatEvent,
  SendResult,
  ServiceAccountKeyInfo,
} from './types.js'

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

  constructor(
    private config: GoogleChatConfig,
    private db: Pool,
  ) {}

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

  // ─── Incoming: handle webhook events ──────────────

  async handleWebhookEvent(event: ChatEvent): Promise<{
    id: string
    channelName: string
    channelMessageId: string
    from: string
    timestamp: Date
    content: { type: string; text?: string }
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

    if (event.type !== 'MESSAGE' || !event.message) {
      return null
    }

    // Skip bot messages
    if (event.user.type === 'BOT') return null

    // Track/update space last_message_at
    await this.touchSpace(event)

    // Use argumentText (text without @mention) if available, fallback to full text
    const text = event.message.argumentText?.trim() || event.message.text || ''

    return {
      id: event.message.name,
      channelName: 'google-chat',
      channelMessageId: event.message.name,
      from: event.user.email,
      timestamp: new Date(event.eventTime),
      content: { type: 'text', text },
      raw: event,
    }
  }

  // ─── Outgoing: send messages ──────────────────────

  async sendMessage(spaceName: string, text: string): Promise<SendResult> {
    if (!this.chatClient) {
      return { success: false, error: 'Chat client not initialized' }
    }

    try {
      // Truncate if exceeds max length
      const maxLen = this.config.GOOGLE_CHAT_MAX_MESSAGE_LENGTH
      const truncatedText = text.length > maxLen
        ? text.slice(0, maxLen - 3) + '...'
        : text

      const res = await this.chatClient.spaces.messages.create({
        parent: spaceName,
        requestBody: { text: truncatedText },
      })

      const messageId = res.data.name ?? undefined
      logger.debug({ spaceName, messageId }, 'Message sent to Google Chat')
      return { success: true, channelMessageId: messageId }
    } catch (err) {
      const errMsg = String(err)
      logger.error({ err, spaceName }, 'Failed to send message to Google Chat')
      return { success: false, error: errMsg }
    }
  }

  // ─── Webhook verification ────────────────────────

  verifyWebhookToken(authHeader: string | undefined): boolean {
    // If no webhook token configured, skip verification (dev mode)
    if (!this.config.GOOGLE_CHAT_WEBHOOK_TOKEN) {
      return true
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
