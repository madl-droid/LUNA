// LUNA — Module: twilio-voice — Gemini Live API Client
// WebSocket client para Google Gemini Multimodal Live API.
// Maneja audio bidireccional, function calling e interrupciones.

import { WebSocket } from 'ws'
import pino from 'pino'
import type {
  GeminiLiveConfig,
  GeminiSetupMessage,
  GeminiAudioInput,
  GeminiServerContent,
  GeminiToolResponse,
  GeminiToolDeclaration,
} from './types.js'

const logger = pino({ name: 'twilio-voice:gemini-live' })

const GEMINI_LIVE_BASE_URL = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.BidiGenerateContent'

export type GeminiLiveEvents = {
  onAudio: (audioBase64: string, mimeType: string) => void
  onText: (text: string) => void
  onToolCall: (id: string, name: string, args: Record<string, unknown>) => void
  onInterrupted: () => void
  onTurnComplete: () => void
  onError: (error: Error) => void
  onClose: () => void
}

export class GeminiLiveSession {
  private ws: WebSocket | null = null
  private config: GeminiLiveConfig
  private events: GeminiLiveEvents
  private connected = false
  private setupComplete = false
  private reconnecting = false

  constructor(config: GeminiLiveConfig, events: GeminiLiveEvents) {
    this.config = config
    this.events = events
  }

  /**
   * Connect to Gemini Live API and send setup message.
   */
  async connect(): Promise<void> {
    const model = this.config.model
    const url = `${GEMINI_LIVE_BASE_URL}?key=${this.config.apiKey}`
    const connectionTimeoutMs = this.config.connectionTimeoutMs

    return new Promise<void>((resolve, reject) => {
      this.ws = new WebSocket(url)

      const timeout = setTimeout(() => {
        if (!this.connected) {
          this.ws?.close()
          reject(new Error('Gemini Live connection timeout'))
        }
      }, connectionTimeoutMs)

      this.ws.on('open', () => {
        this.connected = true
        clearTimeout(timeout)
        logger.info({ model, voice: this.config.voice }, 'Gemini Live WebSocket connected')
        this.sendSetup()
      })

      this.ws.on('message', (data) => {
        this.handleMessage(data)
        // Resolve promise after setup is complete
        if (this.setupComplete && !this.reconnecting) {
          resolve()
        }
      })

      this.ws.on('close', (code, reason) => {
        this.connected = false
        this.setupComplete = false
        logger.info({ code, reason: reason.toString() }, 'Gemini Live WebSocket closed')
        this.events.onClose()
      })

      this.ws.on('error', (err) => {
        logger.error({ err }, 'Gemini Live WebSocket error')
        this.events.onError(err)
        if (!this.connected) {
          clearTimeout(timeout)
          reject(err)
        }
      })
    })
  }

  /**
   * Send audio chunk to Gemini (caller speaking).
   * Expects PCM 16-bit 16kHz base64-encoded.
   */
  sendAudio(pcmBase64: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.setupComplete) return

    const message: GeminiAudioInput = {
      realtimeInput: {
        mediaChunks: [{
          mimeType: 'audio/pcm;rate=16000',
          data: pcmBase64,
        }],
      },
    }

    this.ws.send(JSON.stringify(message))
  }

  /**
   * Send tool execution result back to Gemini.
   */
  sendToolResponse(id: string, name: string, result: Record<string, unknown>): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return

    const message: GeminiToolResponse = {
      toolResponse: {
        functionResponses: [{
          id,
          name,
          response: result,
        }],
      },
    }

    this.ws.send(JSON.stringify(message))
    logger.debug({ id, name }, 'Tool response sent to Gemini')
  }

  /**
   * Send text message to Gemini (for injecting system events like silence detection).
   */
  sendTextInput(text: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN || !this.setupComplete) return

    this.ws.send(JSON.stringify({
      clientContent: {
        turns: [{
          role: 'user',
          parts: [{ text }],
        }],
        turnComplete: true,
      },
    }))
  }

  /**
   * Close the Gemini Live session.
   */
  close(): void {
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
    this.connected = false
    this.setupComplete = false
  }

  isConnected(): boolean {
    return this.connected && this.setupComplete
  }

  private sendSetup(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return

    const speechConfig: GeminiSetupMessage['setup']['generationConfig']['speechConfig'] = {
      voiceConfig: {
        prebuiltVoiceConfig: {
          voiceName: this.config.voice,
        },
      },
    }

    // Add languageCode if configured
    if (this.config.language) {
      speechConfig.languageCode = this.config.language
    }

    const setup: GeminiSetupMessage = {
      setup: {
        model: `models/${this.config.model}`,
        generationConfig: {
          responseModalities: ['AUDIO'],
          temperature: this.config.temperature,
          topP: this.config.topP,
          topK: this.config.topK,
          maxOutputTokens: this.config.maxOutputTokens,
          speechConfig,
        },
        systemInstruction: {
          parts: [{ text: this.config.systemInstruction }],
        },
        realtimeInputConfig: {
          automaticActivityDetection: {
            startOfSpeechSensitivity: this.config.vadStartSensitivity,
            endOfSpeechSensitivity: this.config.vadEndSensitivity,
            prefixPaddingMs: this.config.vadPrefixPaddingMs,
            silenceDurationMs: this.config.vadSilenceDurationMs,
          },
          activityHandling: this.config.bargeInEnabled
            ? 'START_OF_ACTIVITY_INTERRUPTS'
            : 'NO_INTERRUPTION',
        },
      },
    }

    // Add tools if any
    if (this.config.tools.length > 0) {
      setup.setup.tools = [{
        functionDeclarations: this.config.tools,
      }]
    }

    this.ws.send(JSON.stringify(setup))
    logger.debug({
      model: setup.setup.model,
      voice: speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName,
      temperature: this.config.temperature,
      bargeIn: this.config.bargeInEnabled,
    }, 'Gemini Live setup message sent')
  }

  private handleMessage(data: import('ws').RawData): void {
    try {
      const message = JSON.parse(data.toString()) as GeminiServerContent

      // Setup complete
      if (message.setupComplete !== undefined) {
        this.setupComplete = true
        logger.info('Gemini Live setup complete')
        return
      }

      // Tool calls
      if (message.toolCall) {
        for (const fc of message.toolCall.functionCalls) {
          logger.info({ toolName: fc.name }, 'Gemini requesting tool call')
          this.events.onToolCall(fc.id, fc.name, fc.args)
        }
        return
      }

      // Server content (audio/text/interruption)
      if (message.serverContent) {
        const sc = message.serverContent

        // Interruption
        if (sc.interrupted) {
          this.events.onInterrupted()
          return
        }

        // Model turn with parts
        if (sc.modelTurn?.parts) {
          for (const part of sc.modelTurn.parts) {
            if (part.inlineData) {
              this.events.onAudio(part.inlineData.data, part.inlineData.mimeType)
            }
            if (part.text) {
              this.events.onText(part.text)
            }
            if (part.functionCall) {
              this.events.onToolCall(
                part.functionCall.id,
                part.functionCall.name,
                part.functionCall.args,
              )
            }
          }
        }

        // Turn complete
        if (sc.turnComplete) {
          this.events.onTurnComplete()
        }
      }
    } catch (err) {
      logger.error({ err }, 'Error parsing Gemini Live message')
    }
  }
}
