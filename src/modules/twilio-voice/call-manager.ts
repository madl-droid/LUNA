// LUNA — Module: twilio-voice — Call Manager
// Gestión de llamadas activas, state machine, lifecycle y puente audio.

import pino from 'pino'
import type { Pool } from 'pg'
import type { Registry } from '../../kernel/registry.js'
import type { TwilioVoiceConfig, ActiveCall, CallDirection, TranscriptEntry } from './types.js'
import { TwilioAdapter } from './twilio-adapter.js'
import { MediaStreamServer } from './media-stream.js'
import { GeminiLiveSession } from './gemini-live.js'
import { SilenceDetector } from './silence-detector.js'
import { mulawToPcm16k, pcmToMulaw8k } from './audio-converter.js'
import { preloadContext, generateCallSummary, persistToMemory } from './voice-engine.js'
import * as pgStore from './pg-store.js'

const logger = pino({ name: 'twilio-voice:call-manager' })

export class CallManager {
  private activeCalls = new Map<string, ActiveCall>() // keyed by streamSid
  private callSidToStream = new Map<string, string>() // callSid → streamSid
  private geminiSessions = new Map<string, GeminiLiveSession>() // keyed by streamSid
  private maxDurationTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private silenceDetector: SilenceDetector
  private mediaServer: MediaStreamServer
  private twilioAdapter: TwilioAdapter
  private config: TwilioVoiceConfig
  private registry: Registry
  private db: Pool

  constructor(
    config: TwilioVoiceConfig,
    registry: Registry,
    db: Pool,
    mediaServer: MediaStreamServer,
    twilioAdapter: TwilioAdapter,
  ) {
    this.config = config
    this.registry = registry
    this.db = db
    this.mediaServer = mediaServer
    this.twilioAdapter = twilioAdapter

    this.silenceDetector = new SilenceDetector(config.VOICE_SILENCE_TIMEOUT_MS, config.VOICE_SILENCE_RMS_THRESHOLD, {
      onSilenceDetected: (callId) => this.handleSilence(callId),
      onFinalSilence: (callId) => this.handleFinalSilence(callId),
    })
  }

  /** Get global accent/language from prompts:service (fallback for when VOICE_GEMINI_LANGUAGE is empty) */
  private getGlobalAccent(): string {
    const promptsSvc = this.registry.getOptional<{ getAccent(): string }>('prompts:service')
    return promptsSvc?.getAccent() || 'es-MX'
  }

  /**
   * Handle an incoming call webhook. Pre-loads context and returns TwiML.
   */
  async handleIncomingCall(
    callSid: string,
    from: string,
    to: string,
    mediaStreamUrl: string,
  ): Promise<string> {
    if (!this.config.VOICE_ENABLED) {
      logger.info({ callSid }, 'Voice calls disabled, rejecting incoming call')
      return `<?xml version="1.0" encoding="UTF-8"?><Response><Say language="es-MX">Lo siento, este servicio no est\u00e1 disponible en este momento.</Say><Hangup/></Response>`
    }

    if (this.activeCalls.size >= this.config.VOICE_MAX_CONCURRENT_CALLS) {
      logger.warn({ callSid, activeCalls: this.activeCalls.size }, 'Max concurrent calls reached')
      return `<?xml version="1.0" encoding="UTF-8"?><Response><Say language="es-MX">Lo siento, en este momento no puedo atender tu llamada. Por favor intenta m\u00e1s tarde.</Say><Hangup/></Response>`
    }

    // Insert call record in DB
    const callId = await pgStore.insertCall(this.db, callSid, 'inbound', from, to, null, this.config.VOICE_GEMINI_VOICE)

    // Start pre-loading context in background (will be ready by the time media stream connects)
    const contextPromise = preloadContext(this.registry, this.db, from, 'inbound', this.config)

    // Store the promise for when stream connects
    this.callSidToStream.set(callSid, '') // placeholder, will be updated on stream start
    // Store context promise on a temporary map
    ;(this as unknown as Record<string, unknown>)[`_ctx_${callSid}`] = contextPromise

    logger.info({ callSid, callId, from }, 'Incoming call, generating TwiML')

    return this.twilioAdapter.generateInboundTwiML(
      mediaStreamUrl,
      this.config.VOICE_ANSWER_DELAY_RINGS,
      { callId, direction: 'inbound' },
    )
  }

  /**
   * Handle outbound call initiation.
   */
  async initiateOutboundCall(
    to: string,
    twimlUrl: string,
    statusCallbackUrl: string | undefined,
    _mediaStreamUrl: string,
  ): Promise<{ callSid: string; callId: string }> {
    if (!this.config.VOICE_ENABLED) {
      throw new Error('Voice calls are disabled')
    }

    if (this.activeCalls.size >= this.config.VOICE_MAX_CONCURRENT_CALLS) {
      throw new Error('Max concurrent calls reached')
    }

    // Pre-load context before dialing
    const contextPromise = preloadContext(this.registry, this.db, to, 'outbound', this.config)

    const { callSid } = await this.twilioAdapter.makeCall(to, twimlUrl, statusCallbackUrl)
    const callId = await pgStore.insertCall(
      this.db, callSid, 'outbound', this.config.TWILIO_PHONE_NUMBER, to, null, this.config.VOICE_GEMINI_VOICE,
    )

    this.callSidToStream.set(callSid, '')
    ;(this as unknown as Record<string, unknown>)[`_ctx_${callSid}`] = contextPromise

    logger.info({ callSid, callId, to }, 'Outbound call initiated')
    return { callSid, callId }
  }

  /**
   * Called when Twilio media stream starts (WebSocket connected).
   * Bridges audio to Gemini Live.
   */
  async onMediaStreamStart(streamSid: string, callSid: string, customParams: Record<string, string>): Promise<void> {
    const direction = (customParams['direction'] as CallDirection) || 'inbound'
    const callId = customParams['callId'] || ''

    // Update mapping
    this.callSidToStream.set(callSid, streamSid)

    // Retrieve pre-loaded context
    const ctxPromise = (this as unknown as Record<string, unknown>)[`_ctx_${callSid}`] as
      Promise<Awaited<ReturnType<typeof preloadContext>>> | undefined
    delete (this as unknown as Record<string, unknown>)[`_ctx_${callSid}`]

    const context = ctxPromise ? await ctxPromise : await preloadContext(
      this.registry, this.db, '', direction, this.config,
    )

    // Create active call entry
    const call: ActiveCall = {
      callId,
      callSid,
      streamSid,
      direction,
      from: '',
      to: '',
      status: 'active',
      agentId: context.agentId,
      contactId: context.contactId,
      startedAt: new Date(),
      connectedAt: new Date(),
      geminiVoice: this.config.VOICE_GEMINI_VOICE,
      transcript: [],
      preloadedContext: context,
    }
    this.activeCalls.set(streamSid, call)

    // Update DB
    await pgStore.updateCallStatus(this.db, callSid, 'active', {
      connectedAt: new Date(),
      contactId: context.contactId ?? undefined,
    })

    // Fire hook
    this.registry.runHook('call:connected', {
      callId,
      callSid,
      direction,
      from: call.from,
      to: call.to,
      agentId: context.agentId,
      contactId: context.contactId ?? undefined,
      connectedAt: new Date(),
    }).catch(() => {})

    // Determine API key: module-specific or from LLM module
    const apiKey = this.config.VOICE_GOOGLE_API_KEY || this.getGoogleApiKey()
    if (!apiKey) {
      logger.error({ callSid }, 'No Google API key configured for Gemini Live')
      this.endCall(streamSid, 'error')
      return
    }

    // Connect to Gemini Live
    const gemini = new GeminiLiveSession(
      {
        apiKey,
        model: this.config.VOICE_GEMINI_MODEL,
        voice: this.config.VOICE_GEMINI_VOICE,
        language: this.config.VOICE_GEMINI_LANGUAGE || this.getGlobalAccent(),
        systemInstruction: context.systemInstruction,
        tools: context.tools,
        temperature: this.config.VOICE_GEMINI_TEMPERATURE,
        topP: this.config.VOICE_GEMINI_TOP_P,
        topK: this.config.VOICE_GEMINI_TOP_K,
        maxOutputTokens: this.config.VOICE_GEMINI_MAX_OUTPUT_TOKENS,
        vadStartSensitivity: this.config.VOICE_VAD_START_SENSITIVITY,
        vadEndSensitivity: this.config.VOICE_VAD_END_SENSITIVITY,
        vadPrefixPaddingMs: this.config.VOICE_VAD_PREFIX_PADDING_MS,
        vadSilenceDurationMs: this.config.VOICE_VAD_SILENCE_DURATION_MS,
        bargeInEnabled: this.config.VOICE_BARGE_IN_ENABLED,
        connectionTimeoutMs: this.config.VOICE_GEMINI_CONNECTION_TIMEOUT_MS,
      },
      {
        onAudio: (audioBase64, _mimeType) => {
          // Convert PCM from Gemini to mulaw for Twilio
          const pcmBuffer = Buffer.from(audioBase64, 'base64')
          const mulawBuffer = pcmToMulaw8k(pcmBuffer)
          this.mediaServer.sendAudio(streamSid, mulawBuffer.toString('base64'))
        },
        onText: (text) => {
          // Transcript from Gemini (agent speaking)
          if (text.trim()) {
            const entry: TranscriptEntry = {
              speaker: 'agent',
              text: text.trim(),
              timestampMs: Date.now() - call.startedAt.getTime(),
            }
            call.transcript.push(entry)
            this.registry.runHook('call:transcript', {
              callId,
              speaker: 'agent',
              text: text.trim(),
              timestampMs: entry.timestampMs,
            }).catch(() => {})
          }
        },
        onToolCall: async (id, name, args) => {
          await this.handleToolCall(streamSid, id, name, args)
        },
        onInterrupted: () => {
          // Clear queued audio on Twilio side
          this.mediaServer.clearAudio(streamSid)
        },
        onTurnComplete: () => {
          // Turn complete — silence detector restarts
        },
        onError: (err) => {
          logger.error({ err, callSid, streamSid }, 'Gemini Live error')
        },
        onClose: () => {
          logger.info({ callSid, streamSid }, 'Gemini Live session closed')
        },
      },
    )

    try {
      await gemini.connect()
      this.geminiSessions.set(streamSid, gemini)

      // Start silence monitoring
      this.silenceDetector.startMonitoring(streamSid)

      // Start max duration timer
      this.maxDurationTimers.set(streamSid, setTimeout(() => {
        logger.warn({ callSid, streamSid }, 'Max call duration reached')
        gemini.sendTextInput('[SISTEMA] La llamada ha alcanzado la duraci\u00f3n m\u00e1xima. Informa al caller y termin la llamada.')
        setTimeout(() => this.endCall(streamSid, 'max-duration'), this.config.VOICE_GOODBYE_TIMEOUT_MS)
      }, this.config.VOICE_MAX_CALL_DURATION_MS))

      logger.info({ callSid, streamSid, voice: this.config.VOICE_GEMINI_VOICE }, 'Audio bridge established')
    } catch (err) {
      logger.error({ err, callSid }, 'Failed to connect Gemini Live')
      this.endCall(streamSid, 'error')
    }
  }

  /**
   * Called for each audio frame from Twilio (caller speaking).
   */
  onMediaReceived(streamSid: string, mulawBuffer: Buffer): void {
    const gemini = this.geminiSessions.get(streamSid)
    if (!gemini?.isConnected()) return

    // Convert mulaw 8kHz → PCM 16kHz
    const pcmBuffer = mulawToPcm16k(mulawBuffer)

    // Feed to silence detector
    this.silenceDetector.feedAudio(streamSid, pcmBuffer)

    // Send to Gemini
    gemini.sendAudio(pcmBuffer.toString('base64'))
  }

  /**
   * Called when Twilio media stream stops.
   */
  async onMediaStreamStop(streamSid: string): Promise<void> {
    await this.endCall(streamSid, 'caller-hangup')
  }

  /**
   * End a call gracefully.
   */
  async endCall(streamSid: string, reason: string): Promise<void> {
    const call = this.activeCalls.get(streamSid)
    if (!call) return

    // Prevent double-end
    if (call.status === 'completed') return
    call.status = 'completed'

    logger.info({ callSid: call.callSid, streamSid, reason }, 'Ending call')

    // Stop silence monitoring
    this.silenceDetector.stopMonitoring(streamSid)

    // Clear max duration timer
    const maxTimer = this.maxDurationTimers.get(streamSid)
    if (maxTimer) {
      clearTimeout(maxTimer)
      this.maxDurationTimers.delete(streamSid)
    }

    // Close Gemini session
    const gemini = this.geminiSessions.get(streamSid)
    if (gemini) {
      gemini.close()
      this.geminiSessions.delete(streamSid)
    }

    // Close media stream
    this.mediaServer.closeStream(streamSid)

    // Generate summary
    const summary = await generateCallSummary(
      this.registry,
      call.transcript,
      call.preloadedContext?.contactName ?? null,
    )

    // Update DB
    await pgStore.completeCall(this.db, call.callSid, reason, summary)

    // Save transcript to DB
    if (call.transcript.length > 0) {
      await pgStore.insertTranscriptBatch(this.db, call.callId, call.transcript).catch(err =>
        logger.error({ err, callId: call.callId }, 'Failed to save transcript'),
      )
    }

    // Persist to memory system
    if (call.preloadedContext?.contactId) {
      persistToMemory(
        this.registry,
        this.db,
        call.preloadedContext.contactId,
        call.preloadedContext.agentId,
        call.transcript,
        summary,
      ).catch(() => {})
    }

    // Hang up via Twilio (if caller didn't already)
    if (reason !== 'caller-hangup') {
      this.twilioAdapter.hangupCall(call.callSid).catch(err =>
        logger.warn({ err, callSid: call.callSid }, 'Failed to hangup via Twilio API (caller may have already hung up)'),
      )
    }

    // Fire hook
    this.registry.runHook('call:ended', {
      callId: call.callId,
      callSid: call.callSid,
      direction: call.direction,
      from: call.from,
      to: call.to,
      agentId: call.agentId ?? undefined,
      contactId: call.contactId ?? undefined,
      durationSeconds: Math.round((Date.now() - call.startedAt.getTime()) / 1000),
      endReason: reason,
    }).catch(() => {})

    // Cleanup
    this.activeCalls.delete(streamSid)
    this.callSidToStream.delete(call.callSid)
  }

  /**
   * Get number of active calls.
   */
  getActiveCallCount(): number {
    return this.activeCalls.size
  }

  /**
   * Get list of active calls (for status endpoint).
   */
  getActiveCalls(): Array<{
    callId: string
    callSid: string
    direction: string
    durationSeconds: number
  }> {
    return Array.from(this.activeCalls.values()).map(c => ({
      callId: c.callId,
      callSid: c.callSid,
      direction: c.direction,
      durationSeconds: Math.round((Date.now() - c.startedAt.getTime()) / 1000),
    }))
  }

  /**
   * Stop all calls and clean up (module shutdown).
   */
  async stopAll(): Promise<void> {
    const streamSids = Array.from(this.activeCalls.keys())
    for (const streamSid of streamSids) {
      await this.endCall(streamSid, 'error')
    }
    this.silenceDetector.stopAll()
  }

  // ═══════════════════════════════════════════
  // Internal
  // ═══════════════════════════════════════════

  private async handleToolCall(
    streamSid: string,
    toolCallId: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<void> {
    const call = this.activeCalls.get(streamSid)
    const gemini = this.geminiSessions.get(streamSid)
    if (!call || !gemini) return

    // Handle special end_call tool
    if (toolName === 'end_call') {
      const reason = (args['reason'] as string) || 'goodbye'
      logger.info({ callSid: call.callSid, reason }, 'Gemini requested call end')

      // Send tool response first so Gemini can say final goodbye
      gemini.sendToolResponse(toolCallId, toolName, { success: true })

      // Wait for goodbye timeout then end call
      setTimeout(() => {
        this.endCall(streamSid, 'goodbye')
      }, this.config.VOICE_GOODBYE_TIMEOUT_MS)
      return
    }

    // Execute tool via tools:registry
    const toolRegistry = this.registry.getOptional<{
      executeTool: (name: string, input: Record<string, unknown>, context?: Record<string, unknown>) => Promise<{ success: boolean; data?: unknown; error?: string }>
    }>('tools:registry')

    if (!toolRegistry) {
      gemini.sendToolResponse(toolCallId, toolName, {
        error: 'Tool registry not available',
      })
      return
    }

    logger.info({ callSid: call.callSid, toolName }, 'Executing tool call from voice')

    try {
      const result = await toolRegistry.executeTool(toolName, args, {
        contactId: call.contactId ?? undefined,
        agentId: call.agentId ?? undefined,
        channel: 'voice',
      })

      gemini.sendToolResponse(toolCallId, toolName, result as Record<string, unknown>)

      // Add to transcript
      call.transcript.push({
        speaker: 'system',
        text: `[Tool: ${toolName}] ${result.success ? 'OK' : 'Error: ' + result.error}`,
        timestampMs: Date.now() - call.startedAt.getTime(),
      })
    } catch (err) {
      logger.error({ err, toolName }, 'Tool execution error')
      gemini.sendToolResponse(toolCallId, toolName, {
        error: `Error executing tool: ${String(err)}`,
      })
    }
  }

  private handleSilence(streamSid: string): void {
    const gemini = this.geminiSessions.get(streamSid)
    if (!gemini?.isConnected()) return

    // Inject silence notification to Gemini as a text turn
    gemini.sendTextInput('[SISTEMA] El caller lleva un rato en silencio. Pregunta si sigue ah\u00ed.')
  }

  private handleFinalSilence(streamSid: string): void {
    const gemini = this.geminiSessions.get(streamSid)
    if (!gemini?.isConnected()) {
      this.endCall(streamSid, 'silence')
      return
    }

    // Tell Gemini to say goodbye and end
    gemini.sendTextInput('[SISTEMA] El caller sigue sin responder. Desp\u00eddete y termina la llamada usando end_call.')
  }

  private getGoogleApiKey(): string {
    try {
      const llmConfig = this.registry.getConfig<{ GOOGLE_AI_API_KEY?: string }>('llm')
      return llmConfig?.GOOGLE_AI_API_KEY ?? ''
    } catch {
      return ''
    }
  }
}
