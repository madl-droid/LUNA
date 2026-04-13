// LUNA — Module: twilio-voice — Call Manager
// Gestión de llamadas activas, state machine, lifecycle y puente audio.

import pino from 'pino'
import type { Pool } from 'pg'
import type { Registry } from '../../kernel/registry.js'
import type { TwilioVoiceConfig, ActiveCall, CallDirection, TranscriptEntry, PreloadedContext } from './types.js'
import { TwilioAdapter } from './twilio-adapter.js'
import { MediaStreamServer } from './media-stream.js'
import { GeminiLiveSession } from './gemini-live.js'
import { SilenceDetector } from './silence-detector.js'
import { mulawToPcm16k, pcmToMulaw8k, parseSampleRate } from './audio-converter.js'
import { preloadContext, persistToMemory } from './voice-engine.js'
import * as pgStore from './pg-store.js'

const logger = pino({ name: 'twilio-voice:call-manager' })

export class CallManager {
  private activeCalls = new Map<string, ActiveCall>() // keyed by streamSid
  private callSidToStream = new Map<string, string>() // callSid → streamSid
  private geminiSessions = new Map<string, GeminiLiveSession>() // keyed by streamSid
  private maxDurationTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private contextPromises = new Map<string, Promise<PreloadedContext>>() // callSid → pre-loaded context
  private lastActivityUpdate = new Map<string, number>() // callId → last update timestamp
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

    this.silenceDetector = new SilenceDetector(
      config.VOICE_SILENCE_TIMEOUT_MS,
      config.VOICE_POST_GREETING_SILENCE_TIMEOUT_MS,
      config.VOICE_SILENCE_RMS_THRESHOLD,
      {
        onSilenceDetected: (callId) => this.handleSilence(callId),
        onFinalSilence: (callId) => this.handleFinalSilence(callId),
      },
    )
  }

  /** Get global accent/language from prompts:service (fallback for when VOICE_GEMINI_LANGUAGE is empty) */
  private getGlobalAccent(): string {
    const promptsSvc = this.registry.getOptional<{ getAccent(): string }>('prompts:service')
    return promptsSvc?.getAccent() || 'es-MX'
  }

  /** Get voice name from TTS module (identity page) — single source of truth for agent voice */
  private getVoiceName(): string {
    try {
      const ttsConfig = this.registry.getConfig<{ TTS_VOICE_NAME?: string }>('tts')
      return ttsConfig?.TTS_VOICE_NAME || this.config.VOICE_GEMINI_VOICE || 'Kore'
    } catch {
      return this.config.VOICE_GEMINI_VOICE || 'Kore'
    }
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

    // Check per-number inbound rate limit
    if (this.config.VOICE_INBOUND_RATE_LIMIT_HOUR > 0) {
      const recentInbound = await pgStore.countRecentCalls(this.db, from, 'inbound', 60)
      if (recentInbound >= this.config.VOICE_INBOUND_RATE_LIMIT_HOUR) {
        logger.warn({ callSid, from, count: recentInbound, limit: this.config.VOICE_INBOUND_RATE_LIMIT_HOUR }, 'Inbound rate limit exceeded')
        return `<?xml version="1.0" encoding="UTF-8"?><Response><Say language="es-MX">Lo siento, has superado el l\u00edmite de llamadas por hora. Por favor intenta m\u00e1s tarde.</Say><Hangup/></Response>`
      }
    }

    // Insert call record in DB
    const callId = await pgStore.insertCall(this.db, callSid, 'inbound', from, to, this.getVoiceName())

    // Start pre-loading context in background — ring delay gives time for loading.
    // Context MUST be fully loaded before Gemini connects (enforced in onMediaStreamStart).
    const contextPromise = preloadContext(this.registry, this.db, from, 'inbound', this.config)

    // Store the promise for when stream connects
    this.callSidToStream.set(callSid, '') // placeholder, will be updated on stream start
    this.contextPromises.set(callSid, contextPromise)

    logger.info({ callSid, callId, from }, 'Incoming call — context loading, generating TwiML with ring delay')

    // Random ring delay between min and max for natural feel
    const minRings = this.config.VOICE_ANSWER_DELAY_MIN_RINGS
    const maxRings = Math.max(minRings, this.config.VOICE_ANSWER_DELAY_MAX_RINGS) // guard: max must be >= min
    const answerDelayRings = Math.floor(Math.random() * (maxRings - minRings + 1)) + minRings
    logger.debug({ callSid, answerDelayRings, minRings, maxRings }, 'Ring delay selected')

    return this.twilioAdapter.generateInboundTwiML(
      mediaStreamUrl,
      answerDelayRings,
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
    reason?: string,
  ): Promise<{ callSid: string; callId: string }> {
    if (!this.config.VOICE_ENABLED) {
      throw new Error('Voice calls are disabled')
    }

    if (this.activeCalls.size >= this.config.VOICE_MAX_CONCURRENT_CALLS) {
      throw new Error('Max concurrent calls reached')
    }

    // ── Business hours check ──
    if (this.config.VOICE_BUSINESS_HOURS_ENABLED) {
      const now = new Date()
      const localHour = getLocalHour(now, this.config.VOICE_BUSINESS_HOURS_TIMEZONE)
      const dayOfWeek = getLocalDayOfWeek(now, this.config.VOICE_BUSINESS_HOURS_TIMEZONE)

      if (dayOfWeek === 0 || dayOfWeek === 6) {
        throw new Error('Fuera de horario laboral (fin de semana)')
      }

      if (localHour < this.config.VOICE_BUSINESS_HOURS_START || localHour >= this.config.VOICE_BUSINESS_HOURS_END) {
        throw new Error(`Fuera de horario laboral (${this.config.VOICE_BUSINESS_HOURS_START}:00-${this.config.VOICE_BUSINESS_HOURS_END}:00)`)
      }
    }

    // ── Outbound rate limit by phone number ──
    if (this.config.VOICE_OUTBOUND_RATE_LIMIT_HOUR > 0) {
      const recentCalls = await pgStore.countRecentCalls(this.db, to, 'outbound', 60)
      if (recentCalls >= this.config.VOICE_OUTBOUND_RATE_LIMIT_HOUR) {
        throw new Error(`Límite alcanzado: ${recentCalls}/${this.config.VOICE_OUTBOUND_RATE_LIMIT_HOUR} llamadas/hora a este número`)
      }
    }

    // Fully load context BEFORE dialing — system must be 100% ready before the call starts
    const contextPromise = preloadContext(this.registry, this.db, to, 'outbound', this.config, reason)
    await contextPromise
    logger.info({ to }, 'Outbound context fully loaded, dialing')

    const { callSid } = await this.twilioAdapter.makeCall(to, twimlUrl, statusCallbackUrl, this.config.VOICE_OUTBOUND_RING_TIMEOUT_S)
    const callId = await pgStore.insertCall(
      this.db, callSid, 'outbound', this.config.TWILIO_PHONE_NUMBER, to, this.getVoiceName(),
    )

    this.callSidToStream.set(callSid, '')
    this.contextPromises.set(callSid, contextPromise)

    logger.info({ callSid, callId, to, reason }, 'Outbound call initiated')
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

    // Retrieve pre-loaded context — must be fully resolved before connecting Gemini
    const ctxPromise = this.contextPromises.get(callSid)
    this.contextPromises.delete(callSid)

    const ctxStartMs = Date.now()
    const context = ctxPromise ? await ctxPromise : await preloadContext(
      this.registry, this.db, '', direction, this.config,
    )
    logger.info({ callSid, contextLoadMs: Date.now() - ctxStartMs, contactId: context.contactId }, 'Context fully loaded, bridging to Gemini')

    // Create real session in sessions table for compression pipeline integration
    let sessionId: string | null = null
    try {
      const sessionResult = await this.db.query<{ id: string }>(
        `INSERT INTO sessions (id, contact_id, channel_name, status, started_at, last_activity_at)
         VALUES (gen_random_uuid(), $1, 'voice', 'active', NOW(), NOW())
         RETURNING id`,
        [context.contactId],
      )
      sessionId = sessionResult.rows[0]?.id ?? null
    } catch (err) {
      logger.error({ err, callSid }, 'Failed to create voice session in DB')
    }

    // Create active call entry
    const call: ActiveCall = {
      callId,
      callSid,
      streamSid,
      direction,
      from: '',
      to: '',
      status: 'active',
      contactId: context.contactId,
      sessionId,
      startedAt: new Date(),
      connectedAt: new Date(),
      geminiVoice: this.getVoiceName(),
      modelUsed: this.config.VOICE_GEMINI_MODEL, // updated after connect()
      transcript: [],
      preloadedContext: context,
      // Greeting gate: outbound starts unlocked (caller already listening)
      greetingDone: direction === 'outbound',
      // Freeze detection
      geminiSpeaking: false,
      geminiResponseTimer: null,
      geminiFreezeAttempts: 0,
      lastCallerTranscript: '',
      lastRawCallerAudioAt: 0,
      // Tool cancel via barge-in
      cancelledToolCalls: new Set(),
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
        fallbackModel: this.config.VOICE_GEMINI_FALLBACK_MODEL,
        thinkingLevel: this.config.VOICE_GEMINI_THINKING_LEVEL,
        voice: this.getVoiceName(),
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
        onAudio: (audioBase64, mimeType) => {
          // Gemini is producing audio — cancel any freeze timer and mark as speaking
          if (!call.geminiSpeaking) {
            call.geminiSpeaking = true
            // Pause silence detector while agent is talking
            this.silenceDetector.agentStartedSpeaking(streamSid)
            if (call.geminiResponseTimer) {
              clearTimeout(call.geminiResponseTimer)
              call.geminiResponseTimer = null
            }
            call.geminiFreezeAttempts = 0
          }
          // Convert PCM from Gemini (24kHz default, parsed from mimeType) to mulaw 8kHz for Twilio
          const pcmBuffer = Buffer.from(audioBase64, 'base64')
          const sampleRate = parseSampleRate(mimeType)
          const mulawBuffer = pcmToMulaw8k(pcmBuffer, sampleRate)
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
          // Gemini finished speaking this turn
          call.geminiSpeaking = false

          // First turn complete = greeting finished; unlock audio gate and start silence detector
          if (!call.greetingDone) {
            call.greetingDone = true
            this.silenceDetector.startMonitoring(streamSid)
            logger.debug({ callSid }, 'Greeting done, audio gate unlocked')
          }
          // Agent finished speaking → now it's the user's turn → start silence countdown
          this.silenceDetector.agentTurnComplete(streamSid)
        },
        onError: (err) => {
          logger.error({ err, callSid, streamSid }, 'Gemini Live error')
        },
        onClose: () => {
          logger.info({ callSid, streamSid }, 'Gemini Live session closed')
        },
        onUserTranscript: (text, isFinal) => {
          // Native caller transcription — add final entries to transcript
          if (isFinal && text.trim()) {
            const entry: TranscriptEntry = {
              speaker: 'caller',
              text: text.trim(),
              timestampMs: Date.now() - call.startedAt.getTime(),
            }
            call.transcript.push(entry)
            logger.debug({ text: text.trim() }, 'Native caller transcript (final)')

            // Update freeze detection state
            call.lastCallerTranscript = text.trim()
            call.lastRawCallerAudioAt = Date.now()

            // Start freeze timer if Gemini isn't already responding
            if (!call.geminiSpeaking) {
              this.startGeminiResponseTimer(streamSid)
            }
          }
        },
        onAgentTranscript: (text, isFinal) => {
          // Native agent transcription — log for debugging
          logger.debug({ text: text.trim(), isFinal }, 'Native agent transcript')
        },
        onToolCallCancellation: (ids) => {
          logger.info({ ids, callSid }, 'Tool calls cancelled by barge-in')
          for (const id of ids) {
            call.cancelledToolCalls.add(id)
          }
          // Clear pending Twilio audio buffer so barge-in takes effect immediately
          if (call.streamSid) {
            this.mediaServer.clearAudio(call.streamSid)
          }
        },
      },
    )

    try {
      await gemini.connect()
      // Record which model was actually used (primary or fallback)
      call.modelUsed = gemini.modelUsed
      this.geminiSessions.set(streamSid, gemini)

      // Trigger initial greeting — Gemini Live needs a prompt to start talking
      const greetingTrigger = direction === 'inbound'
        ? '[SISTEMA] La llamada acaba de conectar. El cliente está al teléfono esperando. Di tu saludo inicial ahora.'
        : '[SISTEMA] La llamada saliente acaba de conectar. La persona contestó. Saluda y preséntate ahora.'
      gemini.sendTextInput(greetingTrigger)

      // Start silence monitoring immediately for outbound; inbound waits for greeting to complete
      if (direction === 'outbound') {
        this.silenceDetector.startMonitoring(streamSid)
      }

      // Start max duration timer
      this.maxDurationTimers.set(streamSid, setTimeout(() => {
        logger.warn({ callSid, streamSid }, 'Max call duration reached')
        gemini.sendTextInput('[SISTEMA] La llamada ha alcanzado la duraci\u00f3n m\u00e1xima. Informa al caller y termin la llamada.')
        setTimeout(() => this.endCall(streamSid, 'max-duration'), this.config.VOICE_GOODBYE_TIMEOUT_MS)
      }, this.config.VOICE_MAX_CALL_DURATION_MS))

      logger.info({ callSid, streamSid, voice: call.geminiVoice, modelUsed: call.modelUsed }, 'Audio bridge established')
    } catch (err) {
      logger.error({ err, callSid }, 'Failed to connect Gemini Live')
      this.endCall(streamSid, 'error')
    }
  }

  /**
   * Called for each audio frame from Twilio (caller speaking).
   */
  onMediaReceived(streamSid: string, mulawBuffer: Buffer): void {
    const call = this.activeCalls.get(streamSid)
    const gemini = this.geminiSessions.get(streamSid)
    if (!gemini?.isConnected()) return

    // GREETING GATE: don't forward caller audio until Gemini completes greeting (inbound only)
    if (call && !call.greetingDone) return

    // Track timestamp of last raw caller audio (for freeze detection)
    if (call) call.lastRawCallerAudioAt = Date.now()

    // Convert mulaw 8kHz → PCM 16kHz
    const pcmBuffer = mulawToPcm16k(mulawBuffer)

    // Feed to silence detector
    this.silenceDetector.feedAudio(streamSid, pcmBuffer)

    // Update session activity (throttled to max 1/min, fire-and-forget)
    if (call) this.updateSessionActivity(call)

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

    // Clear freeze detection timer
    if (call.geminiResponseTimer) {
      clearTimeout(call.geminiResponseTimer)
      call.geminiResponseTimer = null
    }

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

    // Update DB (summary will be generated by the compression pipeline)
    await pgStore.completeCall(this.db, call.callSid, reason, call.modelUsed || null)

    // Save transcript to DB
    if (call.transcript.length > 0) {
      await pgStore.insertTranscriptBatch(this.db, call.callId, call.transcript).catch(err =>
        logger.error({ err, callId: call.callId }, 'Failed to save transcript'),
      )
    }

    // Persist to memory system (saves messages, closes session, enqueues compression)
    if (call.contactId && call.sessionId) {
      persistToMemory(
        this.registry,
        this.db,
        call.contactId,
        call.sessionId,
        call.startedAt,
        call.transcript,
      ).catch(() => {})
    }

    // Safety: close session if persistToMemory didn't (e.g., empty transcript, no contactId)
    if (call.sessionId) {
      this.db.query(
        `UPDATE sessions SET status = 'closed', last_activity_at = NOW()
         WHERE id = $1 AND status = 'active'`,
        [call.sessionId],
      ).catch(() => {})
    }

    // Clean up activity tracker
    this.lastActivityUpdate.delete(call.callId)

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

    // Handle proxy tool: use_tool → forward to the real tool
    let actualToolName = toolName
    let actualArgs = args
    if (toolName === 'use_tool') {
      actualToolName = (args['tool_name'] as string) || ''
      actualArgs = (args['arguments'] as Record<string, unknown>) || {}
      logger.info({ callSid: call.callSid, proxyTool: actualToolName }, 'Proxy tool call via use_tool')
      if (!actualToolName) {
        gemini.sendToolResponse(toolCallId, toolName, { error: 'tool_name is required' })
        return
      }
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

    logger.info({ callSid: call.callSid, toolName: actualToolName }, 'Executing tool call from voice')

    const maxRetries = this.config.VOICE_TOOL_MAX_RETRIES
    let attempt = 0

    while (attempt <= maxRetries) {
      // Start filler timer: if tool takes too long, ask Gemini to say something natural
      const fillerTimer = setTimeout(() => {
        if (!call.cancelledToolCalls.has(toolCallId) && gemini.isConnected()) {
          const msg = attempt === 0
            ? `[Sistema: la herramienta '${actualToolName}' est\u00e1 tardando. Decile algo breve y natural al caller mientras esperamos.]`
            : `[Sistema: '${actualToolName}' sigue tardando. Decile que est\u00e1s reintentando, algo como 'hmm, dej\u00e1me intentar de nuevo'.]`
          gemini.sendTextInput(msg)
        }
      }, this.config.VOICE_TOOL_FILLER_DELAY_MS)

      let result: { success: boolean; data?: unknown; error?: string } | null = null
      let timedOut = false

      let timeoutTimer: ReturnType<typeof setTimeout> | null = null
      try {
        result = await Promise.race([
          toolRegistry.executeTool(actualToolName, actualArgs, {
            contactId: call.contactId ?? undefined,
            channel: 'voice',
          }),
          new Promise<never>((_, reject) => {
            timeoutTimer = setTimeout(() => reject(new Error('tool_timeout')), this.config.VOICE_TOOL_TIMEOUT_MS)
          }),
        ]).finally(() => {
          if (timeoutTimer) clearTimeout(timeoutTimer)
        })
      } catch (err) {
        if ((err as Error).message === 'tool_timeout') {
          timedOut = true
        } else {
          clearTimeout(fillerTimer)
          logger.error({ err, toolName: actualToolName }, 'Tool execution error')
          gemini.sendToolResponse(toolCallId, toolName, {
            error: `Error executing tool: ${String(err)}`,
          })
          return
        }
      } finally {
        clearTimeout(fillerTimer)
      }

      // Check if cancelled by barge-in
      if (call.cancelledToolCalls.has(toolCallId)) {
        logger.info({ callSid: call.callSid, toolCallId, toolName: actualToolName }, 'Tool cancelled by barge-in, discarding result')
        if (call.streamSid) {
          this.mediaServer.clearAudio(call.streamSid)
        }
        return
      }

      if (timedOut) {
        attempt++
        if (attempt <= maxRetries) {
          logger.warn({ callSid: call.callSid, toolName: actualToolName, attempt }, 'Tool timed out, retrying')
          continue
        }

        // All retries exhausted
        logger.error({ callSid: call.callSid, toolName: actualToolName }, 'Tool timed out after all retries')
        gemini.sendTextInput(
          `[Sistema: La herramienta '${actualToolName}' fall\u00f3 despu\u00e9s de reintentar. Decile que no pudiste completar esa acci\u00f3n ahora pero que lo dej\u00e1s agendado para hacerlo despu\u00e9s de la llamada. Usa la herramienta end_call si ya no hay m\u00e1s temas.]`,
        )
        gemini.sendToolResponse(toolCallId, toolName, {
          error: `Tool timed out after ${attempt} attempt(s)`,
        })
        call.transcript.push({
          speaker: 'system',
          text: `[Tool: ${actualToolName}] Timeout after ${attempt} attempt(s)`,
          timestampMs: Date.now() - call.startedAt.getTime(),
        })
        return
      }

      // Success
      gemini.sendToolResponse(toolCallId, toolName, result as Record<string, unknown>)

      call.transcript.push({
        speaker: 'system',
        text: `[Tool: ${actualToolName}] ${result!.success ? 'OK' : 'Error: ' + result!.error}`,
        timestampMs: Date.now() - call.startedAt.getTime(),
      })
      return
    }
  }

  /**
   * Start (or restart) the freeze detection timer for a call.
   * If Gemini doesn't produce audio within VOICE_GEMINI_FREEZE_TIMEOUT_MS:
   *   - attempt 1: re-inject caller's last transcript as a system text prompt
   *   - attempt 2+: hang up with reason 'gemini_freeze'
   */
  private startGeminiResponseTimer(streamSid: string): void {
    const call = this.activeCalls.get(streamSid)
    if (!call) return

    // Clear existing timer
    if (call.geminiResponseTimer) {
      clearTimeout(call.geminiResponseTimer)
      call.geminiResponseTimer = null
    }

    call.geminiResponseTimer = setTimeout(() => {
      call.geminiResponseTimer = null
      const c = this.activeCalls.get(streamSid)
      if (!c || c.status !== 'active') return

      // If Gemini is already speaking, it recovered — nothing to do
      if (c.geminiSpeaking) return

      // If there's no recent raw audio from caller, silence detector handles it
      const silentCaller = Date.now() - c.lastRawCallerAudioAt > this.config.VOICE_GEMINI_FREEZE_TIMEOUT_MS
      if (silentCaller) return

      const gemini = this.geminiSessions.get(streamSid)
      if (!gemini?.isConnected()) return

      if (c.geminiFreezeAttempts < 1) {
        // First attempt: re-inject the caller's last transcript
        c.geminiFreezeAttempts++
        logger.warn({ callSid: c.callSid, attempt: c.geminiFreezeAttempts }, 'Gemini freeze detected, re-injecting transcript')
        gemini.sendTextInput(
          `[Sistema: No respondiste al caller. Su \u00faltimo mensaje fue: "${c.lastCallerTranscript}". Resp\u00f3ndele ahora.]`,
        )
        // Schedule second attempt
        this.startGeminiResponseTimer(streamSid)
      } else {
        // Second consecutive freeze — hang up
        c.geminiFreezeAttempts++
        logger.error({ callSid: c.callSid, attempt: c.geminiFreezeAttempts }, 'Gemini freeze: second failure, hanging up')
        this.endCall(streamSid, 'gemini_freeze')
      }
    }, this.config.VOICE_GEMINI_FREEZE_TIMEOUT_MS)
  }

  /**
   * Update sessions.last_activity_at during an active call.
   * Throttled to max 1 update/min to avoid hammering the DB on every audio frame.
   */
  private updateSessionActivity(call: ActiveCall): void {
    if (!call.sessionId) return
    const now = Date.now()
    const last = this.lastActivityUpdate.get(call.callId) ?? 0
    if (now - last < 60_000) return

    this.lastActivityUpdate.set(call.callId, now)
    this.db.query(
      'UPDATE sessions SET last_activity_at = NOW() WHERE id = $1',
      [call.sessionId],
    ).catch(() => {}) // fire-and-forget, must not block audio path
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

// ═══════════════════════════════════════════
// Timezone helpers
// ═══════════════════════════════════════════

function getLocalHour(date: Date, tz: string): number {
  try {
    return parseInt(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: tz }).format(date), 10)
  } catch {
    return date.getUTCHours()
  }
}

function getLocalDayOfWeek(date: Date, tz: string): number {
  try {
    const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: tz }).format(date)
    return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(weekday)
  } catch {
    return date.getUTCDay()
  }
}
