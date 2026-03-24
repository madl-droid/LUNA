// LUNA — WhatsApp adapter using Baileys 7.x
// Implementación del ChannelAdapter para WhatsApp vía Baileys.

import { makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } from '@whiskeysockets/baileys'
import type { WASocket, BaileysEventMap } from '@whiskeysockets/baileys'
import { Boom } from '@hapi/boom'
import { v4 as uuidv4 } from 'uuid'
import pino from 'pino'
import { config } from '../../config.js'
import type { ChannelAdapter } from '../channel-adapter.js'
import type { ChannelName, OutgoingMessage, SendResult, MessageHandler, IncomingMessage } from '../types.js'

const logger = pino({ name: 'baileys-adapter', level: config.logLevel })

export class BaileysAdapter implements ChannelAdapter {
  readonly channelName: ChannelName = 'whatsapp'
  private socket: WASocket | null = null
  private messageHandlers: MessageHandler[] = []
  private reconnectAttempts = 0

  async initialize(): Promise<void> {
    const { state, saveCreds } = await useMultiFileAuthState(config.whatsapp.authDir)
    const { version } = await fetchLatestBaileysVersion()

    this.socket = makeWASocket({
      version,
      auth: state,
      printQRInTerminal: config.instanceConfig.whatsapp.baileys.printQRInTerminal,
      logger: pino({ level: 'silent' }) as never,
    })

    this.socket.ev.on('creds.update', saveCreds)

    this.socket.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect } = update

      if (connection === 'close') {
        const reason = (lastDisconnect?.error as Boom)?.output?.statusCode
        const shouldReconnect = reason !== DisconnectReason.loggedOut

        if (shouldReconnect && this.reconnectAttempts < config.whatsapp.maxReconnectAttempts) {
          this.reconnectAttempts++
          logger.warn({ attempt: this.reconnectAttempts, reason }, 'WhatsApp disconnected, reconnecting...')
          setTimeout(() => this.initialize(), config.whatsapp.reconnectIntervalMs)
        } else {
          logger.error({ reason }, 'WhatsApp disconnected permanently')
        }
      }

      if (connection === 'open') {
        this.reconnectAttempts = 0
        logger.info('WhatsApp connected successfully')
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

    logger.info('Baileys adapter initialized')
  }

  async shutdown(): Promise<void> {
    if (this.socket) {
      this.socket.end(undefined)
      this.socket = null
    }
    logger.info('Baileys adapter shut down')
  }

  async sendMessage(to: string, message: OutgoingMessage): Promise<SendResult> {
    if (!this.socket) {
      return { success: false, error: 'WhatsApp not connected' }
    }

    try {
      const jid = to.includes('@') ? to : `${to}@s.whatsapp.net`

      if (message.content.type === 'text' && message.content.text) {
        const sent = await this.socket.sendMessage(jid, { text: message.content.text })
        return { success: true, channelMessageId: sent?.key.id ?? undefined }
      }

      if (message.content.type === 'image' && message.content.mediaUrl) {
        const sent = await this.socket.sendMessage(jid, {
          image: { url: message.content.mediaUrl },
          caption: message.content.caption,
        })
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private normalizeMessage(msg: any): IncomingMessage | null {
    const text = msg.message?.conversation
      || msg.message?.extendedTextMessage?.text
      || msg.message?.imageMessage?.caption
      || ''

    const from = msg.key.remoteJid?.replace('@s.whatsapp.net', '') ?? ''
    if (!from) return null

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
        text,
      },
      raw: msg,
    }
  }
}
