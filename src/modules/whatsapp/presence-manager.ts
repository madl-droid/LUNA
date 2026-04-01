// LUNA — WhatsApp Presence Manager
// Manages 'composing' / 'paused' / 'available' presence for natural typing UX.

import type { WASocket } from '@whiskeysockets/baileys'
import pino from 'pino'

const logger = pino({ name: 'whatsapp:presence' })

export class PresenceManager {
  private socket: WASocket | null = null
  private activePresences = new Map<string, ReturnType<typeof setTimeout>>()

  setSocket(socket: WASocket | null): void {
    this.socket = socket
    if (!socket) this.clearAll()
  }

  async sendComposing(to: string): Promise<void> {
    if (!this.socket) return
    const jid = to.includes('@') ? to : `${to}@s.whatsapp.net`
    try {
      await this.socket.presenceSubscribe(jid)
      await this.socket.sendPresenceUpdate('composing', jid)

      // Auto-clear after 25s (WhatsApp auto-clears at 30s)
      this.clearPresenceTimer(jid)
      const timer = setTimeout(() => {
        this.sendPaused(to).catch(() => {})
        this.activePresences.delete(jid)
      }, 25000)
      this.activePresences.set(jid, timer)
    } catch (err) {
      logger.debug({ err, to }, 'Failed to send composing presence')
    }
  }

  async sendRecording(to: string): Promise<void> {
    if (!this.socket) return
    const jid = to.includes('@') ? to : `${to}@s.whatsapp.net`
    try {
      await this.socket.presenceSubscribe(jid)
      await this.socket.sendPresenceUpdate('recording', jid)

      // Auto-clear after 25s (WhatsApp auto-clears at 30s)
      this.clearPresenceTimer(jid)
      const timer = setTimeout(() => {
        this.sendPaused(to).catch(() => {})
        this.activePresences.delete(jid)
      }, 25000)
      this.activePresences.set(jid, timer)
    } catch (err) {
      logger.debug({ err, to }, 'Failed to send recording presence')
    }
  }

  async sendPaused(to: string): Promise<void> {
    if (!this.socket) return
    const jid = to.includes('@') ? to : `${to}@s.whatsapp.net`
    try {
      await this.socket.sendPresenceUpdate('paused', jid)
      this.clearPresenceTimer(jid)
    } catch (err) {
      logger.debug({ err, to }, 'Failed to send paused presence')
    }
  }

  async sendAvailable(): Promise<void> {
    if (!this.socket) return
    try {
      await this.socket.sendPresenceUpdate('available')
    } catch (err) {
      logger.debug({ err }, 'Failed to send available presence')
    }
  }

  private clearPresenceTimer(jid: string): void {
    const existing = this.activePresences.get(jid)
    if (existing) {
      clearTimeout(existing)
      this.activePresences.delete(jid)
    }
  }

  clearAll(): void {
    for (const timer of this.activePresences.values()) {
      clearTimeout(timer)
    }
    this.activePresences.clear()
  }
}
