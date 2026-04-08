// LUNA — WhatsApp adapter using Baileys 7.x
// Adaptador de canal WhatsApp vía Baileys.
// Auth state is stored in PostgreSQL, not on the filesystem.

import { makeWASocket, DisconnectReason, fetchLatestBaileysVersion, downloadMediaMessage } from '@whiskeysockets/baileys'
import type { WASocket, BaileysEventMap } from '@whiskeysockets/baileys'
import { v4 as uuidv4 } from 'uuid'
import type { Pool } from 'pg'
import pino from 'pino'
import { usePostgresAuthState, clearAuthState } from './pg-auth-state.js'
import { PresenceManager } from './presence-manager.js'

const logger = pino({ name: 'whatsapp:adapter' })

function getDisconnectStatusCode(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') return undefined
  const candidate = error as {
    output?: { statusCode?: unknown }
    statusCode?: unknown
    data?: { statusCode?: unknown }
  }
  const statusCode = candidate.output?.statusCode ?? candidate.statusCode ?? candidate.data?.statusCode
  return typeof statusCode === 'number' ? statusCode : undefined
}

export type BaileysStatus = 'disconnected' | 'connecting' | 'connected' | 'qr_ready'

export interface BaileysState {
  status: BaileysStatus
  qr: string | null
  lastDisconnectReason: string | null
  connectedNumber: string | null
  reconnectAttempt: number
  nextRetryAt: number | null
}

export interface WhatsAppConfig {
  WHATSAPP_MARK_ONLINE: boolean
  WHATSAPP_REJECT_CALLS: boolean
  WHATSAPP_PRIVACY_LAST_SEEN: boolean
  WHATSAPP_PRIVACY_PROFILE_PIC: string
  WHATSAPP_PRIVACY_STATUS: string
  WHATSAPP_PRIVACY_READ_RECEIPTS: boolean
  WHATSAPP_MISSED_MSG_ENABLED: boolean
  /** Max age in minutes for 'append' messages to be processed (missed during downtime). 0 = disabled. */
  WHATSAPP_MISSED_MSG_WINDOW_MIN: number
}

export interface AdapterCallbacks {
  onConnected?: () => Promise<void>
  onStatusChange?: (status: BaileysStatus, connectedNumber: string | null) => Promise<void>
}

export interface OutgoingMessageContent {
  type: string
  text?: string
  mediaUrl?: string
  caption?: string
  audioBuffer?: Buffer
  audioDurationSeconds?: number
  ptt?: boolean
}

export interface OutgoingMessage {
  to: string
  content: OutgoingMessageContent
  quotedMessageId?: string
  quotedRaw?: unknown
}

export interface SendResult {
  success: boolean
  channelMessageId?: string
  error?: string
}

export interface IncomingMessage {
  id: string
  channelName: string
  channelMessageId: string
  from: string
  /** Phone number resolved from LID mapping. Used to auto-create voice channel. */
  resolvedPhone?: string
  /** WhatsApp profile name (pushName) */
  senderName?: string
  timestamp: Date
  content: { type: string; text?: string; mediaUrl?: string; caption?: string }
  attachments?: Array<{
    id: string
    filename: string
    mimeType: string
    size: number
    getData: () => Promise<Buffer>
  }>
  raw?: unknown
}

export type MessageHandler = (message: IncomingMessage) => Promise<void>

/** Outgoing message queued during reconnection */
interface QueuedOutgoing {
  to: string
  message: OutgoingMessage
  resolve: (result: SendResult) => void
  enqueuedAt: number
}

export class BaileysAdapter {
  private socket: WASocket | null = null
  private presenceManager = new PresenceManager()
  private messageHandlers: MessageHandler[] = []
  private reconnectAttempts = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  /** Fixed reconnection schedule (WhatsApp Web style): 5s → 10s → 30s → 1m → 3m → 5m → 10m → 15m → 30m → 60m */
  private static readonly RECONNECT_SCHEDULE_MS = [5_000, 10_000, 30_000, 60_000, 180_000, 300_000, 600_000, 900_000, 1_800_000, 3_600_000]
  private _nextRetryAt: number | null = null
  private _status: BaileysStatus = 'disconnected'
  private _qr: string | null = null
  private _lastDisconnectReason: string | null = null
  private _connectedNumber: string | null = null
  private _autoReconnect = true
  /** Mutex: prevents concurrent initialize() calls from creating duplicate sockets */
  private _initializing = false
  /** Maps contact identifiers to their JID suffix (@lid or @s.whatsapp.net) for outbound routing */
  private jidTypeMap = new Map<string, '@s.whatsapp.net' | '@lid'>()
  /** Max entries in jidTypeMap before evicting oldest 20% */
  private static readonly JID_MAP_MAX = 10_000
  /** Outgoing messages queued while socket is reconnecting */
  private _outgoingQueue: QueuedOutgoing[] = []
  private static readonly QUEUE_MAX = 100
  private static readonly QUEUE_TTL_MS = 5 * 60 * 1000 // 5 minutes
  private config: WhatsAppConfig
  private pool: Pool
  readonly instanceId: string
  private callbacks: AdapterCallbacks
  private getAgentName: () => string

  constructor(config: WhatsAppConfig, pool: Pool, instanceId: string, callbacks?: AdapterCallbacks, getAgentName?: () => string) {
    this.config = config
    this.pool = pool
    this.instanceId = instanceId
    this.callbacks = callbacks ?? {}
    this.getAgentName = getAgentName ?? (() => 'Luna')
  }

  getState(): BaileysState {
    return {
      status: this._status,
      qr: this._qr,
      lastDisconnectReason: this._lastDisconnectReason,
      connectedNumber: this._connectedNumber,
      reconnectAttempt: this.reconnectAttempts,
      nextRetryAt: this._nextRetryAt,
    }
  }

  async initialize(): Promise<void> {
    // Mutex: prevent concurrent calls (e.g. hot-reload racing with auto-reconnect)
    if (this._initializing) {
      logger.warn('initialize() called while already initializing — skipping duplicate call')
      return
    }
    this._initializing = true

    try {
      await this._doInitialize()
    } finally {
      this._initializing = false
    }
  }

  private async _doInitialize(): Promise<void> {
    this._status = 'connecting'
    this._qr = null
    this._autoReconnect = true

    // Clear any pending reconnect timer
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    // Remove all listeners from previous socket to prevent duplication on reconnect
    if (this.socket) {
      this.socket.ev.removeAllListeners('creds.update')
      this.socket.ev.removeAllListeners('connection.update')
      this.socket.ev.removeAllListeners('messages.upsert')
      this.socket.ev.removeAllListeners('call')
      this.socket.end(undefined)
      this.socket = null
    }

    const { state, saveCreds } = await usePostgresAuthState(this.pool, this.instanceId)
    const { version } = await fetchLatestBaileysVersion()

    this.socket = makeWASocket({
      version,
      auth: state,
      logger: pino({ level: 'warn', name: 'baileys' }) as never,
      markOnlineOnConnect: this.config.WHATSAPP_MARK_ONLINE,
      generateHighQualityLinkPreview: false,
      syncFullHistory: false,
      getMessage: async (_key) => {
        // Required by Baileys 7.x for message retransmission.
        // We don't keep a message store, so return undefined.
        return undefined
      },
    })

    this.socket.ev.on('creds.update', saveCreds)

    this.socket.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update

      if (qr) {
        this._qr = qr
        this._status = 'qr_ready'
        this._connectedNumber = null
        logger.info('QR code available for scanning')
        this.emitStatusChange()
      }

      if (connection === 'close') {
        this._qr = null
        const reason = getDisconnectStatusCode(lastDisconnect?.error)
        this._lastDisconnectReason = DisconnectReason[reason as number] ?? String(reason)
        this._status = 'disconnected'
        this._connectedNumber = null
        this.emitStatusChange()

        const shouldReconnect = this._autoReconnect && reason !== DisconnectReason.loggedOut

        // If logged out (401), clear stale credentials so next connect starts fresh with QR
        if (reason === DisconnectReason.loggedOut) {
          logger.warn('Session logged out (401), clearing auth state for fresh QR on next connect')
          clearAuthState(this.pool, this.instanceId).catch(e => logger.error({ err: e }, 'Failed to clear auth state after logout'))
        }

        const maxAttempts = BaileysAdapter.RECONNECT_SCHEDULE_MS.length
        if (shouldReconnect && this.reconnectAttempts < maxAttempts) {
          const delay = BaileysAdapter.RECONNECT_SCHEDULE_MS[this.reconnectAttempts]!
          this.reconnectAttempts++
          this._nextRetryAt = Date.now() + delay
          logger.warn({ attempt: this.reconnectAttempts, delayMs: delay, reason }, 'WhatsApp disconnected, reconnecting...')
          this.reconnectTimer = setTimeout(() => {
            this._nextRetryAt = null
            void this.initialize().catch(err => {
              logger.error({ err, attempt: this.reconnectAttempts }, 'WhatsApp reconnect attempt failed')
            })
          }, delay)
        } else {
          this._nextRetryAt = null
          logger.error({ reason }, 'WhatsApp disconnected permanently')
        }
      }

      if (connection === 'open') {
        this.reconnectAttempts = 0
        this._nextRetryAt = null
        this._qr = null
        this._status = 'connected'
        this._lastDisconnectReason = null

        // Extract connected phone number from socket user
        const rawId = this.socket?.user?.id ?? null
        this._connectedNumber = rawId ? rawId.replace(/:.*$/, '') : null

        logger.info({ connectedNumber: this._connectedNumber }, 'WhatsApp connected successfully')
        this.emitStatusChange()

        this.presenceManager.setSocket(this.socket)

        // Apply privacy settings if configured
        this.applyPrivacySettings().catch(err =>
          logger.warn({ err }, 'Failed to apply privacy settings')
        )

        // Flush messages queued while disconnected
        void this.flushOutgoingQueue()

        if (this.callbacks.onConnected) {
          this.callbacks.onConnected().catch(err => logger.error({ err }, 'onConnected callback failed'))
        }
      }
    })

    this.socket.ev.on('messages.upsert', async (upsert: BaileysEventMap['messages.upsert']) => {
      logger.info({ type: upsert.type, count: upsert.messages.length }, 'messages.upsert event received')
      // 'notify' = real-time messages, 'append' = history/missed messages (during downtime)
      const missedEnabled = this.config.WHATSAPP_MISSED_MSG_ENABLED ?? true
      const missedWindowMin = this.config.WHATSAPP_MISSED_MSG_WINDOW_MIN ?? 15
      const isNotify = upsert.type === 'notify'
      const isAppend = upsert.type === 'append' && missedEnabled && missedWindowMin > 0

      if (!isNotify && !isAppend) return

      const nowSec = Math.floor(Date.now() / 1000)
      const cutoffSec = nowSec - (missedWindowMin * 60)

      for (const msg of upsert.messages) {
        if (msg.key.fromMe) continue
        if (!msg.message) continue

        // For append messages: only process if recent (within window)
        if (isAppend) {
          const msgTimestamp = typeof msg.messageTimestamp === 'number' ? msg.messageTimestamp : Number(msg.messageTimestamp)
          if (msgTimestamp < cutoffSec) continue
          logger.info({ from: msg.key.remoteJid, age: nowSec - msgTimestamp, type: 'append' }, 'Processing missed message')
        }

        const normalized = await this.normalizeMessage(msg)
        if (!normalized) continue

        for (const handler of this.messageHandlers) {
          try {
            await handler(normalized)
          } catch (err) {
            logger.error({ err, messageId: normalized.id }, 'Error in message handler')
          }
        }
      }
    })

    // Call rejection: silently reject incoming calls
    if (this.config.WHATSAPP_REJECT_CALLS) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.socket.ev.on('call', async (calls: any[]) => {
        for (const call of calls) {
          if (call.status === 'offer') {
            try {
              await this.socket!.rejectCall(call.id, call.from)
              logger.info({ from: call.from, callId: call.id }, 'Call rejected silently')
            } catch (err) {
              logger.warn({ err, from: call.from }, 'Failed to reject call')
            }
          }
        }
      })
    }

    logger.info('Baileys adapter initialized')
  }

  async shutdown(): Promise<void> {
    this._autoReconnect = false
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    // Drain outgoing queue — reject all pending sends
    for (const item of this._outgoingQueue) {
      item.resolve({ success: false, error: 'WhatsApp adapter shutting down' })
    }
    this._outgoingQueue = []
    this.presenceManager.setSocket(null)
    if (this.socket) {
      this.socket.ev.removeAllListeners('creds.update')
      this.socket.ev.removeAllListeners('connection.update')
      this.socket.ev.removeAllListeners('messages.upsert')
      this.socket.ev.removeAllListeners('call')
      this.socket.end(undefined)
      this.socket = null
    }
    this._status = 'disconnected'
    this._qr = null
    this._connectedNumber = null
    logger.info('Baileys adapter shut down')
  }

  async forceReconnect(): Promise<void> {
    logger.info('Force reconnect requested')
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    this._nextRetryAt = null
    this.reconnectAttempts = 0
    await this.initialize()
  }

  async disconnect(): Promise<void> {
    this._autoReconnect = false
    this.presenceManager.setSocket(null)
    // Drain outgoing queue on intentional disconnect
    for (const item of this._outgoingQueue) {
      item.resolve({ success: false, error: 'WhatsApp disconnected' })
    }
    this._outgoingQueue = []
    // Logout with guaranteed socket cleanup even if logout() throws
    try {
      if (this.socket) {
        await this.socket.logout()
      }
    } catch (err) {
      logger.warn({ err }, 'logout() failed during disconnect — continuing socket cleanup')
    } finally {
      if (this.socket) {
        this.socket.end(undefined)
        this.socket = null
      }
    }
    // Clear auth state from DB so next connect starts fresh with QR
    await clearAuthState(this.pool, this.instanceId)
    this._status = 'disconnected'
    this._qr = null
    this._connectedNumber = null
    this.reconnectAttempts = 0
    this.emitStatusChange()
    logger.info('WhatsApp disconnected and session cleared from DB')
  }

  /**
   * Send a message. If the socket is not connected, queues the message and
   * resolves once the socket reconnects and the message is flushed.
   * Queue TTL: 5 minutes. Queue max: 100 messages.
   */
  async sendMessage(to: string, message: OutgoingMessage): Promise<SendResult> {
    if (!this.socket) {
      // Enqueue instead of silently dropping
      return new Promise<SendResult>((resolve) => {
        if (this._outgoingQueue.length >= BaileysAdapter.QUEUE_MAX) {
          const evicted = this._outgoingQueue.shift()!
          logger.warn({ to: evicted.to, queueSize: BaileysAdapter.QUEUE_MAX }, 'Outgoing queue full — evicting oldest message')
          evicted.resolve({ success: false, error: 'Outgoing queue full, message evicted' })
        }
        logger.warn({ to, queueSize: this._outgoingQueue.length + 1 }, 'Socket not connected — queuing outgoing message')
        this._outgoingQueue.push({ to, message, resolve, enqueuedAt: Date.now() })
      })
    }
    return this._doSendMessage(to, message)
  }

  /**
   * Flush outgoing queue after successful reconnect.
   * Discards messages older than QUEUE_TTL_MS.
   */
  private async flushOutgoingQueue(): Promise<void> {
    if (this._outgoingQueue.length === 0) return
    const items = this._outgoingQueue.splice(0)
    logger.info({ count: items.length }, 'Flushing outgoing queue after reconnect')
    const now = Date.now()
    for (const item of items) {
      if (now - item.enqueuedAt > BaileysAdapter.QUEUE_TTL_MS) {
        logger.warn({ to: item.to, ageMs: now - item.enqueuedAt }, 'Dropping expired queued message (TTL 5min exceeded)')
        item.resolve({ success: false, error: 'Message expired in outgoing queue (TTL: 5min)' })
        continue
      }
      const result = await this._doSendMessage(item.to, item.message)
      item.resolve(result)
    }
  }

  /**
   * Internal send with 3 retries and exponential backoff (1s, 2s, 4s).
   * Only retries transient errors (network/timeout); validation errors fail immediately.
   */
  private async _doSendMessage(to: string, message: OutgoingMessage): Promise<SendResult> {
    // Validation errors — fail immediately, no retry
    if (!this.socket) return { success: false, error: 'WhatsApp not connected' }

    const jid = to.includes('@') ? to : `${to}${this.jidTypeMap.get(to) ?? '@s.whatsapp.net'}`
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const quoted = message.quotedRaw ? (message.quotedRaw as any) : undefined

    // Unsupported type — fail immediately (not a transient error)
    if (message.content.type !== 'text' && message.content.type !== 'image' && message.content.type !== 'audio') {
      return { success: false, error: `Unsupported message type: ${message.content.type}` }
    }

    const RETRY_DELAYS_MS = [1000, 2000, 4000]
    let lastErr: unknown

    for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
      if (!this.socket) return { success: false, error: 'WhatsApp disconnected during send' }
      try {
        if (message.content.type === 'text' && message.content.text) {
          const sent = await this.socket.sendMessage(jid, { text: message.content.text }, { quoted })
          return { success: true, channelMessageId: sent?.key.id ?? undefined }
        }

        if (message.content.type === 'image' && message.content.mediaUrl) {
          const sent = await this.socket.sendMessage(jid, {
            image: { url: message.content.mediaUrl },
            caption: message.content.caption,
          }, { quoted })
          return { success: true, channelMessageId: sent?.key.id ?? undefined }
        }

        if (message.content.type === 'audio' && message.content.audioBuffer) {
          const sent = await this.socket.sendMessage(jid, {
            audio: message.content.audioBuffer,
            mimetype: 'audio/ogg; codecs=opus',
            ptt: message.content.ptt ?? true,
            seconds: message.content.audioDurationSeconds,
          }, { quoted })
          return { success: true, channelMessageId: sent?.key.id ?? undefined }
        }
      } catch (err) {
        lastErr = err
        if (attempt < RETRY_DELAYS_MS.length) {
          const delay = RETRY_DELAYS_MS[attempt]!
          logger.warn({ err, to, attempt: attempt + 1, retryInMs: delay }, 'sendMessage failed, retrying with backoff')
          await new Promise(r => setTimeout(r, delay))
        }
      }
    }

    logger.error({ err: lastErr, to }, 'sendMessage exhausted all retries')
    return { success: false, error: String(lastErr) }
  }

  onMessage(handler: MessageHandler): void {
    this.messageHandlers.push(handler)
  }

  /**
   * Mark messages as read (sends blue ticks).
   * Respects WHATSAPP_PRIVACY_READ_RECEIPTS config.
   * @param keys Array of Baileys message keys ({ remoteJid, id, fromMe })
   */
  async markRead(keys: Array<{ remoteJid: string; id: string; fromMe: boolean }>): Promise<void> {
    if (!this.socket) return
    if (keys.length === 0) return
    if (!this.config.WHATSAPP_PRIVACY_READ_RECEIPTS) return
    try {
      await this.socket.readMessages(keys as Parameters<WASocket['readMessages']>[0])
    } catch (err) {
      logger.warn({ err, keys: keys.length }, 'Failed to mark messages as read')
    }
  }

  getPresenceManager(): PresenceManager {
    return this.presenceManager
  }

  private emitStatusChange(): void {
    if (this.callbacks.onStatusChange) {
      this.callbacks.onStatusChange(this._status, this._connectedNumber)
        .catch(err => logger.error({ err }, 'onStatusChange callback failed'))
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async normalizeMessage(msg: any): Promise<IncomingMessage | null> {
    const remoteJid: string = msg.key.remoteJid ?? ''
    if (!remoteJid) return null

    // Ignore WhatsApp status broadcasts — they are not real messages
    if (remoteJid === 'status@broadcast') return null

    const m = msg.message
    // Filter message types that must not reach the LLM pipeline
    if (m?.reactionMessage) {
      logger.debug({ msgId: msg.key.id }, 'Ignoring reaction message')
      return null
    }
    if (m?.stickerMessage) {
      logger.debug({ msgId: msg.key.id }, 'Ignoring sticker message')
      return null
    }
    if (m?.viewOnceMessage || m?.viewOnceMessageV2 || m?.viewOnceMessageV2Extension) {
      logger.debug({ msgId: msg.key.id }, 'Ignoring view-once message')
      return null
    }

    const isGroup = remoteJid.endsWith('@g.us')

    // Resolve sender JID — handles both LID and phone formats
    const senderJid = isGroup ? (msg.key.participant ?? '') : remoteJid
    const { from, resolvedPhone } = await this.resolveJid(senderJid)
    if (!from) return null

    const text = msg.message?.conversation
      || msg.message?.extendedTextMessage?.text
      || msg.message?.imageMessage?.caption
      || ''

    // For group messages: check if bot is mentioned or addressed by name
    if (isGroup) {
      const mentioned = this.isBotMentioned(msg, text)
      if (!mentioned) return null
    }

    // Strip @mention tag from text for cleaner processing
    const cleanText = isGroup ? this.stripMentionTag(text) : text

    // Extract quoted message context (when user cites/replies to a previous message)
    const contextInfo = msg.message?.extendedTextMessage?.contextInfo
    const quotedMsg = contextInfo?.quotedMessage
    const quotedText: string | null = quotedMsg?.conversation
      || quotedMsg?.extendedTextMessage?.text
      || quotedMsg?.imageMessage?.caption
      || null

    // Prefix with quoted context so the LLM knows what the user is replying to
    const finalText = (quotedText && cleanText)
      ? `[Citando: "${quotedText.slice(0, 300)}"]\n${cleanText}`
      : cleanText

    // Build attachments array for media messages
    const attachments = this.extractAttachments(msg)

    // Extract WhatsApp profile name (pushName) for contact registration
    const senderName: string | undefined = msg.pushName || undefined

    return {
      id: uuidv4(),
      channelName: 'whatsapp',
      channelMessageId: msg.key.id ?? '',
      from,
      resolvedPhone: resolvedPhone ?? undefined,
      senderName,
      timestamp: new Date((msg.messageTimestamp as number) * 1000),
      content: {
        type: msg.message?.imageMessage ? 'image'
          : msg.message?.audioMessage ? 'audio'
          : msg.message?.documentMessage ? 'document'
          : 'text',
        text: finalText,
      },
      attachments: attachments.length > 0 ? attachments : undefined,
      raw: msg,
    }
  }

  /**
   * Evict oldest entries from jidTypeMap when it grows beyond JID_MAP_MAX.
   * Map preserves insertion order so iteration starts from the oldest.
   */
  private evictJidMapIfNeeded(): void {
    if (this.jidTypeMap.size < BaileysAdapter.JID_MAP_MAX) return
    const evictCount = Math.floor(BaileysAdapter.JID_MAP_MAX * 0.2)
    let evicted = 0
    for (const key of this.jidTypeMap.keys()) {
      if (evicted >= evictCount) break
      this.jidTypeMap.delete(key)
      evicted++
    }
    logger.debug({ evicted, remaining: this.jidTypeMap.size }, 'jidTypeMap: evicted oldest entries')
  }

  private async resolveJid(jid: string): Promise<{ from: string; resolvedPhone: string | null }> {
    if (jid.endsWith('@lid')) {
      const lidNumber = jid.replace(/:.*@/, '@').replace('@lid', '')
      this.evictJidMapIfNeeded()
      this.jidTypeMap.set(lidNumber, '@lid')

      // Try to resolve LID → phone via Baileys signal repository
      let phone: string | null = null
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const repo = (this.socket as any)?.signalRepository
        if (repo?.lidMapping) {
          const pn = await repo.lidMapping.getPNForLID(jid)
          if (pn) {
            const raw = pn.replace(/:.*@/, '@').replace('@s.whatsapp.net', '')
            phone = raw.startsWith('+') ? raw : `+${raw}`
            logger.info({ lid: lidNumber, phone }, 'LID resolved to phone number')
          }
        }
      } catch (err) {
        logger.debug({ err, lid: lidNumber }, 'LID resolution failed (mapping may not be available yet)')
      }

      return { from: lidNumber, resolvedPhone: phone }
    }

    // Standard phone JID — add + prefix for E.164 consistency with user_contacts
    const raw = jid.replace(/:.*@/, '@').replace('@s.whatsapp.net', '')
    const phone = raw.startsWith('+') ? raw : `+${raw}`
    this.evictJidMapIfNeeded()
    this.jidTypeMap.set(phone, '@s.whatsapp.net')
    return { from: phone, resolvedPhone: null }
  }

  /**
   * Check if the bot is mentioned in a group message.
   * Detection: protocol @mention, @agentName in text, or agentName prefix.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private isBotMentioned(msg: any, text: string): boolean {
    // Method 1: Protocol-level @mention
    const mentionedJids: string[] = msg.message?.extendedTextMessage?.contextInfo?.mentionedJid ?? []
    const myJid = this.socket?.user?.id
    if (myJid) {
      const myNumber = myJid.replace(/:.*$/, '').replace('@s.whatsapp.net', '')
      for (const jid of mentionedJids) {
        if (jid.includes(myNumber)) return true
      }
    }

    // Method 2 & 3: Text-based detection
    const agentName = this.getAgentName().toLowerCase()
    const lowerText = text.toLowerCase().trim()

    if (lowerText.includes(`@${agentName}`)) return true
    if (lowerText.startsWith(agentName + ',') || lowerText.startsWith(agentName + ':')) return true
    if (lowerText.startsWith(agentName + ' ')) return true

    return false
  }

  private stripMentionTag(text: string): string {
    const agentName = this.getAgentName()
    // Remove @number mentions (e.g., @5491155551234)
    let cleaned = text.replace(/@\d{7,15}/g, '').trim()
    // Remove @agentName (case-insensitive)
    const mentionRegex = new RegExp(`@${agentName}`, 'gi')
    cleaned = cleaned.replace(mentionRegex, '').trim()
    // Remove leading "AgentName," or "AgentName:" prefix
    const prefixRegex = new RegExp(`^${agentName}[,:;]?\\s*`, 'i')
    cleaned = cleaned.replace(prefixRegex, '').trim()
    return cleaned || text
  }

  /**
   * Download media with a 30s timeout and 50MB size limit.
   * - Pre-checks reportedSize from metadata (fast fail, no download needed)
   * - Races the download against an AbortController timer
   * - Post-checks actual buffer size (in case metadata was wrong/missing)
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async downloadWithLimits(msg: any, reportedSize: number, label: string): Promise<Buffer> {
    const MAX_SIZE_BYTES = 50 * 1024 * 1024 // 50MB
    if (reportedSize > MAX_SIZE_BYTES) {
      throw new Error(`${label} too large: ${reportedSize} bytes (max 50MB)`)
    }
    const start = Date.now()
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 30_000)
    try {
      const bufferPromise: Promise<Buffer> = downloadMediaMessage(msg, 'buffer', {})
        .then(b => {
          const buf = Buffer.from(b as Uint8Array)
          if (buf.length > MAX_SIZE_BYTES) {
            throw new Error(`${label} too large: ${buf.length} bytes (max 50MB)`)
          }
          logger.debug({ label, sizeBytes: buf.length, elapsedMs: Date.now() - start }, 'Media downloaded')
          return buf
        })
      return await Promise.race([
        bufferPromise,
        new Promise<never>((_, reject) => {
          controller.signal.addEventListener('abort', () =>
            reject(new Error(`${label} download timed out (30s)`)),
          )
        }),
      ])
    } finally {
      clearTimeout(timeoutId)
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private extractAttachments(msg: any): IncomingMessage['attachments'] & object {
    const attachments: NonNullable<IncomingMessage['attachments']> = []
    const m = msg.message

    if (m?.imageMessage) {
      const reportedSize = m.imageMessage.fileLength ? Number(m.imageMessage.fileLength) : 0
      attachments.push({
        id: `wa-img-${msg.key.id}`,
        filename: m.imageMessage.caption || `image-${msg.key.id}.jpg`,
        mimeType: m.imageMessage.mimetype || 'image/jpeg',
        size: reportedSize,
        getData: () => this.downloadWithLimits(msg, reportedSize, 'image'),
      })
    }

    if (m?.audioMessage) {
      const reportedSize = m.audioMessage.fileLength ? Number(m.audioMessage.fileLength) : 0
      attachments.push({
        id: `wa-audio-${msg.key.id}`,
        filename: `audio-${msg.key.id}.ogg`,
        mimeType: m.audioMessage.mimetype || 'audio/ogg; codecs=opus',
        size: reportedSize,
        getData: () => this.downloadWithLimits(msg, reportedSize, 'audio'),
      })
    }

    if (m?.documentMessage) {
      const reportedSize = m.documentMessage.fileLength ? Number(m.documentMessage.fileLength) : 0
      attachments.push({
        id: `wa-doc-${msg.key.id}`,
        filename: m.documentMessage.fileName || `document-${msg.key.id}`,
        mimeType: m.documentMessage.mimetype || 'application/octet-stream',
        size: reportedSize,
        getData: () => this.downloadWithLimits(msg, reportedSize, 'document'),
      })
    }

    if (m?.videoMessage) {
      const reportedSize = m.videoMessage.fileLength ? Number(m.videoMessage.fileLength) : 0
      attachments.push({
        id: `wa-video-${msg.key.id}`,
        filename: m.videoMessage.caption || `video-${msg.key.id}.mp4`,
        mimeType: m.videoMessage.mimetype || 'video/mp4',
        size: reportedSize,
        getData: () => this.downloadWithLimits(msg, reportedSize, 'video'),
      })
    }

    return attachments
  }

  /** Re-apply privacy + presence settings to WhatsApp server. Called on connect and on config hot-reload. */
  async reapplyPrivacySettings(): Promise<void> {
    return this.applyPrivacySettings()
  }

  private async applyPrivacySettings(): Promise<void> {
    if (!this.socket) return
    // Baileys 7.x exposes individual privacy update methods (not a single updatePrivacySettings)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sock = this.socket as any
    const applied: string[] = []

    // Read receipts — MUST call this for readMessages() to send blue ticks.
    // Baileys internally checks fetchPrivacySettings().readreceipts === 'all'.
    try {
      if (sock.updateReadReceiptsPrivacy) {
        await sock.updateReadReceiptsPrivacy(this.config.WHATSAPP_PRIVACY_READ_RECEIPTS ? 'all' : 'none')
        applied.push('readreceipts')
      }
    } catch (err) { logger.warn({ err }, 'Failed to update read receipts privacy') }

    // Last seen
    try {
      if (sock.updateLastSeenPrivacy) {
        await sock.updateLastSeenPrivacy(this.config.WHATSAPP_PRIVACY_LAST_SEEN ? 'all' : 'none')
        applied.push('lastSeen')
      }
    } catch (err) { logger.warn({ err }, 'Failed to update last seen privacy') }

    // Profile picture
    try {
      if (sock.updateProfilePicturePrivacy) {
        await sock.updateProfilePicturePrivacy(this.config.WHATSAPP_PRIVACY_PROFILE_PIC || 'all')
        applied.push('profilePicture')
      }
    } catch (err) { logger.warn({ err }, 'Failed to update profile picture privacy') }

    // Status
    try {
      if (sock.updateStatusPrivacy) {
        await sock.updateStatusPrivacy(this.config.WHATSAPP_PRIVACY_STATUS || 'all')
        applied.push('status')
      }
    } catch (err) { logger.warn({ err }, 'Failed to update status privacy') }

    // Online visibility (who can see when you're online)
    try {
      if (sock.updateOnlinePrivacy) {
        await sock.updateOnlinePrivacy(this.config.WHATSAPP_MARK_ONLINE ? 'all' : 'none')
        applied.push('online')
      }
    } catch (err) { logger.warn({ err }, 'Failed to update online privacy') }

    if (applied.length > 0) {
      logger.info({ applied }, 'Privacy settings applied via individual Baileys APIs')
      // Force-refresh Baileys' cached privacy settings so readMessages() sees the new values.
      // Without this, readMessages() reads stale cache and sends 'read-self' instead of 'read'.
      try {
        if (sock.fetchPrivacySettings) {
          await sock.fetchPrivacySettings(true)
          logger.info('Privacy settings cache refreshed')
        }
      } catch (err) { logger.warn({ err }, 'Failed to refresh privacy settings cache') }
    }

    // Send online/offline presence (markOnlineOnConnect only applies at socket creation)
    try {
      await this.socket.sendPresenceUpdate(this.config.WHATSAPP_MARK_ONLINE ? 'available' : 'unavailable')
      logger.info({ online: this.config.WHATSAPP_MARK_ONLINE }, 'Presence update sent')
    } catch (err) { logger.warn({ err }, 'Failed to send presence update') }
  }
}
