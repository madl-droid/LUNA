// LUNA — WhatsApp adapter using Baileys 7.x
// Adaptador de canal WhatsApp vía Baileys.
// Auth state is stored in PostgreSQL, not on the filesystem.

import { makeWASocket, DisconnectReason, fetchLatestBaileysVersion } from '@whiskeysockets/baileys'
import type { WASocket, BaileysEventMap } from '@whiskeysockets/baileys'
import { Boom } from '@hapi/boom'
import { v4 as uuidv4 } from 'uuid'
import type { Pool } from 'pg'
import pino from 'pino'
import { usePostgresAuthState, clearAuthState } from './pg-auth-state.js'
import { PresenceManager } from './presence-manager.js'

const logger = pino({ name: 'whatsapp:adapter' })

export type BaileysStatus = 'disconnected' | 'connecting' | 'connected' | 'qr_ready'

export interface BaileysState {
  status: BaileysStatus
  qr: string | null
  lastDisconnectReason: string | null
  connectedNumber: string | null
}

export interface WhatsAppConfig {
  WHATSAPP_RECONNECT_INTERVAL_MS: number
  WHATSAPP_MAX_RECONNECT_ATTEMPTS: number
  WHATSAPP_MARK_ONLINE: boolean
  WHATSAPP_REJECT_CALLS: boolean
  WHATSAPP_REJECT_CALL_MESSAGE: string
  WHATSAPP_PRIVACY_LAST_SEEN: string
  WHATSAPP_PRIVACY_PROFILE_PIC: string
  WHATSAPP_PRIVACY_STATUS: string
  WHATSAPP_PRIVACY_READ_RECEIPTS: boolean
  WHATSAPP_AGENT_NAME: string
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
  timestamp: Date
  content: { type: string; text?: string; mediaUrl?: string; caption?: string }
  raw?: unknown
}

export type MessageHandler = (message: IncomingMessage) => Promise<void>

export class BaileysAdapter {
  private socket: WASocket | null = null
  private presenceManager = new PresenceManager()
  private messageHandlers: MessageHandler[] = []
  private reconnectAttempts = 0
  private _status: BaileysStatus = 'disconnected'
  private _qr: string | null = null
  private _lastDisconnectReason: string | null = null
  private _connectedNumber: string | null = null
  private _autoReconnect = true
  private config: WhatsAppConfig
  private pool: Pool
  private instanceId: string
  private callbacks: AdapterCallbacks

  constructor(config: WhatsAppConfig, pool: Pool, instanceId: string, callbacks?: AdapterCallbacks) {
    this.config = config
    this.pool = pool
    this.instanceId = instanceId
    this.callbacks = callbacks ?? {}
  }

  getState(): BaileysState {
    return {
      status: this._status,
      qr: this._qr,
      lastDisconnectReason: this._lastDisconnectReason,
      connectedNumber: this._connectedNumber,
    }
  }

  async initialize(): Promise<void> {
    this._status = 'connecting'
    this._qr = null
    this._autoReconnect = true

    const { state, saveCreds } = await usePostgresAuthState(this.pool, this.instanceId)
    const { version } = await fetchLatestBaileysVersion()

    this.socket = makeWASocket({
      version,
      auth: state,
      logger: pino({ level: 'silent' }) as never,
      markOnlineOnConnect: this.config.WHATSAPP_MARK_ONLINE,
      generateHighQualityLinkPreview: false,
      syncFullHistory: false,
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
        const reason = (lastDisconnect?.error as Boom)?.output?.statusCode
        this._lastDisconnectReason = DisconnectReason[reason as number] ?? String(reason)
        this._status = 'disconnected'
        this._connectedNumber = null
        this.emitStatusChange()

        const shouldReconnect = this._autoReconnect && reason !== DisconnectReason.loggedOut

        if (shouldReconnect && this.reconnectAttempts < this.config.WHATSAPP_MAX_RECONNECT_ATTEMPTS) {
          this.reconnectAttempts++
          logger.warn({ attempt: this.reconnectAttempts, reason }, 'WhatsApp disconnected, reconnecting...')
          setTimeout(() => this.initialize(), this.config.WHATSAPP_RECONNECT_INTERVAL_MS)
        } else {
          logger.error({ reason }, 'WhatsApp disconnected permanently')
        }
      }

      if (connection === 'open') {
        this.reconnectAttempts = 0
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

        if (this.callbacks.onConnected) {
          this.callbacks.onConnected().catch(err => logger.error({ err }, 'onConnected callback failed'))
        }
      }
    })

    this.socket.ev.on('messages.upsert', async (upsert: BaileysEventMap['messages.upsert']) => {
      if (upsert.type !== 'notify') return

      for (const msg of upsert.messages) {
        if (msg.key.fromMe) continue
        if (!msg.message) continue

        const normalized = this.normalizeMessage(msg)
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

    // Call rejection: auto-reject incoming calls if configured
    if (this.config.WHATSAPP_REJECT_CALLS) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.socket.ev.on('call', async (calls: any[]) => {
        for (const call of calls) {
          if (call.status === 'offer') {
            try {
              await this.socket!.rejectCall(call.id, call.from)
              logger.info({ from: call.from, callId: call.id }, 'Call rejected')
              if (this.config.WHATSAPP_REJECT_CALL_MESSAGE) {
                const jid = call.from.includes('@') ? call.from : `${call.from}@s.whatsapp.net`
                await this.socket!.sendMessage(jid, { text: this.config.WHATSAPP_REJECT_CALL_MESSAGE })
              }
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
    this.presenceManager.setSocket(null)
    if (this.socket) {
      this.socket.end(undefined)
      this.socket = null
    }
    this._status = 'disconnected'
    this._qr = null
    this._connectedNumber = null
    logger.info('Baileys adapter shut down')
  }

  async disconnect(): Promise<void> {
    this._autoReconnect = false
    this.presenceManager.setSocket(null)
    if (this.socket) {
      await this.socket.logout()
      this.socket.end(undefined)
      this.socket = null
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

  async sendMessage(to: string, message: OutgoingMessage): Promise<SendResult> {
    if (!this.socket) {
      return { success: false, error: 'WhatsApp not connected' }
    }

    try {
      const jid = to.includes('@') ? to : `${to}@s.whatsapp.net`

      // Build quoted context if present
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const quoted = message.quotedRaw ? (message.quotedRaw as any) : undefined

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

      return { success: false, error: `Unsupported message type: ${message.content.type}` }
    } catch (err) {
      logger.error({ err, to }, 'Failed to send WhatsApp message')
      return { success: false, error: String(err) }
    }
  }

  onMessage(handler: MessageHandler): void {
    this.messageHandlers.push(handler)
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
  private normalizeMessage(msg: any): IncomingMessage | null {
    const remoteJid: string = msg.key.remoteJid ?? ''
    if (!remoteJid) return null

    const isGroup = remoteJid.endsWith('@g.us')
    const from = isGroup
      ? (msg.key.participant ?? '').replace('@s.whatsapp.net', '')
      : remoteJid.replace('@s.whatsapp.net', '')
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

    return {
      id: uuidv4(),
      channelName: 'whatsapp',
      channelMessageId: msg.key.id ?? '',
      from,
      timestamp: new Date((msg.messageTimestamp as number) * 1000),
      content: {
        type: msg.message?.imageMessage ? 'image'
          : msg.message?.audioMessage ? 'audio'
          : msg.message?.documentMessage ? 'document'
          : 'text',
        text: cleanText,
      },
      raw: msg,
    }
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
    const agentName = this.config.WHATSAPP_AGENT_NAME.toLowerCase()
    const lowerText = text.toLowerCase().trim()

    if (lowerText.includes(`@${agentName}`)) return true
    if (lowerText.startsWith(agentName + ',') || lowerText.startsWith(agentName + ':')) return true
    if (lowerText.startsWith(agentName + ' ')) return true

    return false
  }

  private stripMentionTag(text: string): string {
    const agentName = this.config.WHATSAPP_AGENT_NAME
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

  private async applyPrivacySettings(): Promise<void> {
    if (!this.socket) return
    const settings: Record<string, string> = {}

    if (this.config.WHATSAPP_PRIVACY_LAST_SEEN) {
      settings.lastSeen = this.config.WHATSAPP_PRIVACY_LAST_SEEN
    }
    if (this.config.WHATSAPP_PRIVACY_PROFILE_PIC) {
      settings.profilePicture = this.config.WHATSAPP_PRIVACY_PROFILE_PIC
    }
    if (this.config.WHATSAPP_PRIVACY_STATUS) {
      settings.status = this.config.WHATSAPP_PRIVACY_STATUS
    }
    if (!this.config.WHATSAPP_PRIVACY_READ_RECEIPTS) {
      settings.readreceipts = 'none'
    }

    if (Object.keys(settings).length === 0) return

    try {
      await (this.socket as unknown as { updatePrivacySettings(s: Record<string, string>): Promise<void> }).updatePrivacySettings(settings)
      logger.info({ settings: Object.keys(settings) }, 'Privacy settings applied')
    } catch (err) {
      logger.warn({ err }, 'updatePrivacySettings failed (may not be supported in this Baileys version)')
    }
  }
}
