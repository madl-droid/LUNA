// LUNA — Module: twilio-voice — Twilio Media Stream Handler
// WebSocket handler para Twilio Media Streams. Recibe/envía audio frames.

import { WebSocketServer, WebSocket } from 'ws'
import type { IncomingMessage } from 'node:http'
import type { Socket } from 'node:net'
import pino from 'pino'
import type { TwilioStreamMessage, TwilioMediaMessage } from './types.js'

const logger = pino({ name: 'twilio-voice:media-stream' })

export type MediaStreamEvents = {
  onStart: (streamSid: string, callSid: string, customParams: Record<string, string>) => void
  onMedia: (streamSid: string, payload: Buffer) => void
  onStop: (streamSid: string) => void
}

export class MediaStreamServer {
  private wss: WebSocketServer
  private connections = new Map<string, WebSocket>()

  constructor() {
    this.wss = new WebSocketServer({ noServer: true })
  }

  /**
   * Handle WebSocket upgrade from the kernel HTTP server.
   */
  handleUpgrade(req: IncomingMessage, socket: Socket, head: Buffer, events: MediaStreamEvents): void {
    this.wss.handleUpgrade(req, socket, head, (ws) => {
      this.handleConnection(ws, events)
    })
  }

  /**
   * Send audio data to Twilio (agent speaking).
   * Audio must be mulaw 8kHz base64-encoded.
   */
  sendAudio(streamSid: string, mulawBase64: string): void {
    const ws = this.connections.get(streamSid)
    if (!ws || ws.readyState !== WebSocket.OPEN) return

    ws.send(JSON.stringify({
      event: 'media',
      streamSid,
      media: { payload: mulawBase64 },
    }))
  }

  /**
   * Send mark event to Twilio (to track when audio finishes playing).
   */
  sendMark(streamSid: string, name: string): void {
    const ws = this.connections.get(streamSid)
    if (!ws || ws.readyState !== WebSocket.OPEN) return

    ws.send(JSON.stringify({
      event: 'mark',
      streamSid,
      mark: { name },
    }))
  }

  /**
   * Clear queued audio on Twilio side (for barge-in / interruption).
   */
  clearAudio(streamSid: string): void {
    const ws = this.connections.get(streamSid)
    if (!ws || ws.readyState !== WebSocket.OPEN) return

    ws.send(JSON.stringify({
      event: 'clear',
      streamSid,
    }))
  }

  /**
   * Close a specific media stream connection.
   */
  closeStream(streamSid: string): void {
    const ws = this.connections.get(streamSid)
    if (ws) {
      ws.close()
      this.connections.delete(streamSid)
    }
  }

  /**
   * Shut down the WebSocket server.
   */
  close(): void {
    for (const ws of this.connections.values()) {
      ws.close()
    }
    this.connections.clear()
    this.wss.close()
  }

  private handleConnection(ws: WebSocket, events: MediaStreamEvents): void {
    let streamSid: string | null = null

    ws.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString()) as TwilioStreamMessage

        switch (message.event) {
          case 'connected':
            logger.debug('Twilio media stream connected')
            break

          case 'start': {
            streamSid = message.streamSid
            this.connections.set(streamSid, ws)
            const callSid = message.start.callSid
            const customParams = message.start.customParameters ?? {}
            logger.info({ streamSid, callSid }, 'Media stream started')
            events.onStart(streamSid, callSid, customParams)
            break
          }

          case 'media': {
            const mediaMsg = message as TwilioMediaMessage
            if (mediaMsg.media.track === 'inbound' && streamSid) {
              const audioBuffer = Buffer.from(mediaMsg.media.payload, 'base64')
              events.onMedia(streamSid, audioBuffer)
            }
            break
          }

          case 'stop':
            logger.info({ streamSid }, 'Media stream stopped')
            if (streamSid) {
              events.onStop(streamSid)
              this.connections.delete(streamSid)
            }
            break

          case 'mark':
            // Mark events are used for tracking audio playback completion
            break

          default:
            logger.debug({ event: (message as { event: string }).event }, 'Unknown Twilio stream event')
        }
      } catch (err) {
        logger.error({ err }, 'Error parsing Twilio media stream message')
      }
    })

    ws.on('close', () => {
      if (streamSid) {
        logger.info({ streamSid }, 'Media stream WebSocket closed')
        events.onStop(streamSid)
        this.connections.delete(streamSid)
      }
    })

    ws.on('error', (err) => {
      logger.error({ err, streamSid }, 'Media stream WebSocket error')
    })
  }
}
