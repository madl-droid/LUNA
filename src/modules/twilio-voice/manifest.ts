// LUNA — Module: twilio-voice
// Canal de voz: Twilio para telefonía + Gemini Live para conversación en tiempo real.
// Voice sub-engine ligero que delega conversación a Gemini y provee contexto + tools.

import { z } from 'zod'
import type { ModuleManifest, ApiRoute } from '../../kernel/types.js'
import type { Registry } from '../../kernel/registry.js'
import { jsonResponse, parseBody, readBody, parseQuery } from '../../kernel/http-helpers.js'
import { numEnv, numEnvMin, boolEnv, floatEnvMin } from '../../kernel/config-helpers.js'
import type { Server } from '../../kernel/server.js'
import type { TwilioVoiceConfig, InitiateCallRequest, VoicePreviewRequest } from './types.js'
import { GEMINI_VOICES } from './types.js'
import { TwilioAdapter } from './twilio-adapter.js'
import { MediaStreamServer } from './media-stream.js'
import { CallManager } from './call-manager.js'
import * as pgStore from './pg-store.js'
import { createTables } from './pg-store.js'

let callManager: CallManager | null = null
let mediaServer: MediaStreamServer | null = null
let twilioAdapter: TwilioAdapter | null = null
let _registry: Registry | null = null


// ═══════════════════════════════════════════
// API Routes
// ═══════════════════════════════════════════

const apiRoutes: ApiRoute[] = [
  // Status
  {
    method: 'GET',
    path: 'status',
    handler: async (_req, res) => {
      const configured = twilioAdapter?.isConfigured() ?? false
      jsonResponse(res, 200, {
        configured,
        activeCalls: callManager?.getActiveCallCount() ?? 0,
        calls: callManager?.getActiveCalls() ?? [],
      })
    },
  },

  // List calls
  {
    method: 'GET',
    path: 'calls',
    handler: async (req, res) => {
      if (!_registry) { jsonResponse(res, 500, { error: 'Not initialized' }); return }
      const query = parseQuery(req)
      const limit = parseInt(query.get('limit') ?? '20', 10)
      const offset = parseInt(query.get('offset') ?? '0', 10)
      const status = query.get('status') ?? undefined

      const db = _registry.getDb()
      const result = await pgStore.listCalls(db, limit, offset, status)
      jsonResponse(res, 200, result)
    },
  },

  // Initiate outbound call
  {
    method: 'POST',
    path: 'calls',
    handler: async (req, res) => {
      if (!callManager || !twilioAdapter || !_registry) {
        jsonResponse(res, 500, { error: 'Module not initialized' })
        return
      }
      if (!twilioAdapter.isConfigured()) {
        jsonResponse(res, 400, { error: 'Twilio not configured' })
        return
      }

      const body = await parseBody<InitiateCallRequest>(req)
      if (!body?.to) {
        jsonResponse(res, 400, { error: 'Missing "to" phone number' })
        return
      }

      try {
        // Build the URLs for Twilio webhooks
        const host = req.headers['host'] ?? 'localhost'
        const protocol = req.headers['x-forwarded-proto'] ?? 'https'
        const baseUrl = `${protocol}://${host}`
        const twimlUrl = `${baseUrl}/console/api/twilio-voice/webhook/outbound-twiml`
        const statusUrl = `${baseUrl}/console/api/twilio-voice/webhook/status`
        const mediaStreamUrl = `wss://${host}/twilio/media-stream`

        const result = await callManager.initiateOutboundCall(
          body.to,
          twimlUrl,
          statusUrl,
          mediaStreamUrl,
          body.reason,
        )

        jsonResponse(res, 200, { ok: true, ...result })
      } catch (err) {
        jsonResponse(res, 500, { error: String(err) })
      }
    },
  },

  // Call details + transcript
  {
    method: 'GET',
    path: 'call-details',
    handler: async (req, res) => {
      if (!_registry) { jsonResponse(res, 500, { error: 'Not initialized' }); return }
      const query = parseQuery(req)
      const callId = query.get('id')
      if (!callId) { jsonResponse(res, 400, { error: 'Missing id' }); return }

      const db = _registry.getDb()
      const call = await pgStore.getCall(db, callId)
      if (!call) { jsonResponse(res, 404, { error: 'Call not found' }); return }

      const transcript = await pgStore.getTranscript(db, callId)
      jsonResponse(res, 200, { call, transcript })
    },
  },

  // Call stats
  {
    method: 'GET',
    path: 'call-stats',
    handler: async (req, res) => {
      if (!_registry) { jsonResponse(res, 500, { error: 'Not initialized' }); return }
      const query = parseQuery(req)
      const period = query.get('period') ?? 'day'

      const now = new Date()
      let periodStart: Date
      switch (period) {
        case 'week':
          periodStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
          break
        case 'month':
          periodStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
          break
        default:
          periodStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      }

      const db = _registry.getDb()
      const stats = await pgStore.getCallStats(db, periodStart)
      jsonResponse(res, 200, stats)
    },
  },

  // Voice preview (TTS) — delegates to llm:tts hook
  {
    method: 'POST',
    path: 'voice-preview',
    handler: async (req, res) => {
      if (!_registry) { jsonResponse(res, 500, { error: 'Not initialized' }); return }

      const body = await parseBody<VoicePreviewRequest>(req)
      if (!body?.voice || !body?.text) {
        jsonResponse(res, 400, { error: 'Missing voice or text' })
        return
      }

      try {
        // Map Gemini voice name to Wavenet voice for TTS preview
        const wavenetVoice = `es-US-Wavenet-${body.voice === 'Kore' || body.voice === 'Aoede' ? 'A' : 'B'}`

        const result = await _registry.callHook('llm:tts', {
          text: body.text,
          voice: wavenetVoice,
          languageCode: 'es-US',
          audioEncoding: 'MP3',
        })

        if (!result) {
          jsonResponse(res, 503, { error: 'TTS service not available' })
          return
        }

        jsonResponse(res, 200, {
          audioBase64: result.audioBase64,
          mimeType: result.mimeType,
          voice: body.voice,
        })
      } catch (err) {
        jsonResponse(res, 500, { error: `Voice preview error: ${String(err)}` })
      }
    },
  },

  // Twilio webhook: incoming call
  {
    method: 'POST',
    path: 'webhook/incoming',
    handler: async (req, res) => {
      if (!callManager || !_registry || !twilioAdapter) {
        res.writeHead(503, { 'Content-Type': 'text/xml' })
        res.end('<?xml version="1.0" encoding="UTF-8"?><Response><Say>Service unavailable</Say><Hangup/></Response>')
        return
      }

      const rawBody = await readBody(req)
      const params = TwilioAdapter.parseWebhookBody(rawBody)

      // FIX: TV-1 — Validar firma Twilio antes de procesar
      if (twilioAdapter.isConfigured()) {
        const proto = (req.headers['x-forwarded-proto'] as string)?.split(',')[0]?.trim() || 'https'
        const host = req.headers['host'] ?? 'localhost'
        const webhookUrl = `${proto}://${host}${req.url?.split('?')[0] ?? ''}`
        const signature = req.headers['x-twilio-signature'] as string ?? ''
        if (!twilioAdapter.validateSignature(webhookUrl, params, signature)) {
          res.writeHead(403, { 'Content-Type': 'text/xml' })
          res.end('<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>')
          return
        }
      }

      const callSid = params['CallSid'] ?? ''
      const from = params['From'] ?? ''
      const to = params['To'] ?? ''

      const host = req.headers['host'] ?? 'localhost'
      const mediaStreamUrl = `wss://${host}/twilio/media-stream`

      const twiml = await callManager.handleIncomingCall(callSid, from, to, mediaStreamUrl)
      res.writeHead(200, { 'Content-Type': 'text/xml' })
      res.end(twiml)
    },
  },

  // Twilio webhook: outbound call TwiML
  {
    method: 'POST',
    path: 'webhook/outbound-twiml',
    handler: async (req, res) => {
      if (!twilioAdapter) {
        res.writeHead(503, { 'Content-Type': 'text/xml' })
        res.end('<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>')
        return
      }

      const host = req.headers['host'] ?? 'localhost'
      const mediaStreamUrl = `wss://${host}/twilio/media-stream`

      await readBody(req)
      const twiml = twilioAdapter.generateOutboundTwiML(mediaStreamUrl, {
        callId: '', // will be resolved from callSid mapping
        direction: 'outbound',
      })

      res.writeHead(200, { 'Content-Type': 'text/xml' })
      res.end(twiml)
    },
  },

  // Twilio webhook: status updates
  {
    method: 'POST',
    path: 'webhook/status',
    handler: async (req, res) => {
      const rawBody = await readBody(req)
      const params = TwilioAdapter.parseWebhookBody(rawBody)
      // Status callbacks are informational, log them
      const pino = await import('pino')
      const logger = pino.default({ name: 'twilio-voice:webhook' })
      logger.debug({ callSid: params['CallSid'], status: params['CallStatus'] }, 'Twilio status callback')

      jsonResponse(res, 200, { ok: true })
    },
  },
]

// ═══════════════════════════════════════════
// Manifest
// ═══════════════════════════════════════════

const manifest: ModuleManifest = {
  name: 'twilio-voice',
  version: '1.0.0',
  description: {
    es: 'Llamadas de voz con Twilio + Gemini Live',
    en: 'Voice calls with Twilio + Gemini Live',
  },
  type: 'channel',
  channelType: 'voice',
  removable: true,
  activateByDefault: false,
  depends: ['memory', 'llm'],

  configSchema: z.object({
    // ── Twilio credentials ──
    TWILIO_ACCOUNT_SID: z.string().default(''),
    TWILIO_AUTH_TOKEN: z.string().default(''),
    TWILIO_PHONE_NUMBER: z.string().default(''),
    // ── Gemini Live — API & model ──
    VOICE_GOOGLE_API_KEY: z.string().default(''),
    VOICE_GEMINI_MODEL: z.string().default('gemini-3.1-flash-live-preview'),
    VOICE_GEMINI_FALLBACK_MODEL: z.string().default('gemini-2.5-flash-live-preview'),
    VOICE_GEMINI_THINKING_LEVEL: z.enum(['minimal', 'low', 'medium', 'high']).default('minimal'),
    VOICE_GEMINI_VOICE: z.string().default('Kore'),
    VOICE_GEMINI_LANGUAGE: z.string().default(''),
    // ── Gemini Live — generation config ──
    VOICE_GEMINI_TEMPERATURE: floatEnvMin(0, 0.7),
    VOICE_GEMINI_TOP_P: floatEnvMin(0, 0.95),
    VOICE_GEMINI_TOP_K: numEnvMin(0, 40),
    VOICE_GEMINI_MAX_OUTPUT_TOKENS: numEnvMin(0, 1024),
    // ── Gemini Live — VAD nativo ──
    VOICE_VAD_START_SENSITIVITY: z.string().default('START_SENSITIVITY_HIGH'),
    VOICE_VAD_END_SENSITIVITY: z.string().default('END_SENSITIVITY_HIGH'),
    VOICE_VAD_PREFIX_PADDING_MS: numEnvMin(0, 20),
    VOICE_VAD_SILENCE_DURATION_MS: numEnvMin(0, 500),
    VOICE_BARGE_IN_ENABLED: boolEnv(true),
    VOICE_GEMINI_CONNECTION_TIMEOUT_MS: numEnvMin(1000, 15000),
    // ── Silence detector local ──
    VOICE_SILENCE_RMS_THRESHOLD: numEnvMin(0, 200),
    // ── Call behavior ──
    VOICE_PREVIEW_TEXT: z.string().default('Hola, soy tu asistente virtual. \u00bfEn qu\u00e9 puedo ayudarte hoy?'),
    VOICE_ANSWER_DELAY_MIN_RINGS: numEnvMin(1, 2),
    VOICE_ANSWER_DELAY_MAX_RINGS: numEnvMin(1, 5),
    VOICE_SILENCE_TIMEOUT_MS: numEnv(10000),
    VOICE_POST_GREETING_SILENCE_TIMEOUT_MS: numEnv(30000),
    VOICE_SILENCE_MESSAGE: z.string().default('\u00bfSigues ah\u00ed?'),
    VOICE_GREETING_INBOUND: z.string().default('Hola, gracias por llamar. \u00bfEn qu\u00e9 puedo ayudarte?'),
    VOICE_GREETING_OUTBOUND: z.string().default('Hola, te llamo de parte de la empresa. \u00bfEs un buen momento para hablar?'),
    VOICE_FILLER_MESSAGE: z.string().default('Dame un momento, estoy revisando eso...'),
    VOICE_GOODBYE_TIMEOUT_MS: numEnv(5000),
    VOICE_MAX_CALL_DURATION_MS: numEnv(1800000),
    VOICE_MAX_CONCURRENT_CALLS: numEnvMin(1, 5),
    VOICE_ENABLED: boolEnv(true),
    // ── Freeze detection + tool filler ──
    VOICE_GEMINI_FREEZE_TIMEOUT_MS: numEnv(10000),
    VOICE_TOOL_FILLER_DELAY_MS: numEnv(3000),
    VOICE_TOOL_TIMEOUT_MS: numEnv(10000),
    VOICE_TOOL_MAX_RETRIES: numEnvMin(0, 1),
    // ── Channel runtime config (engine integration) ──
    VOICE_RATE_LIMIT_HOUR: numEnvMin(0, 0),
    VOICE_RATE_LIMIT_DAY: numEnvMin(0, 0),
    VOICE_SESSION_TIMEOUT_HOURS: numEnvMin(1, 1),
    // ── Outbound call restrictions ──
    VOICE_BUSINESS_HOURS_ENABLED: boolEnv(true),
    VOICE_BUSINESS_HOURS_START: numEnvMin(0, 8),
    VOICE_BUSINESS_HOURS_END: numEnvMin(0, 17),
    VOICE_BUSINESS_HOURS_TIMEZONE: z.string().default('America/Bogota'),
    VOICE_OUTBOUND_RATE_LIMIT_HOUR: numEnvMin(0, 3),
    VOICE_INBOUND_RATE_LIMIT_HOUR: numEnvMin(0, 10),
  }),

  console: {
    title: {
      es: 'Twilio (Voz)',
      en: 'Twilio (Voice)',
    },
    info: {
      es: 'Llamadas telef\u00f3nicas con IA conversacional en tiempo real usando Gemini Live.',
      en: 'Phone calls with real-time conversational AI powered by Gemini Live.',
    },
    order: 15,
    group: 'channels',
    icon: '&#128222;',
    fields: [
      // ── Twilio credentials ──
      {
        key: 'TWILIO_ACCOUNT_SID',
        type: 'secret',
        label: { es: 'Twilio Account SID', en: 'Twilio Account SID' },
      },
      {
        key: 'TWILIO_AUTH_TOKEN',
        type: 'secret',
        label: { es: 'Twilio Auth Token', en: 'Twilio Auth Token' },
      },
      {
        key: 'TWILIO_PHONE_NUMBER',
        type: 'text',
        label: { es: 'Numero de telefono Twilio', en: 'Twilio Phone Number' },
        info: { es: 'Numero con formato internacional (+1234567890)', en: 'International format number (+1234567890)' },
      },
      // ── Gemini Live — API & modelo ──
      { key: '_divider_gemini', type: 'divider', label: { es: 'Gemini Live', en: 'Gemini Live' } },
      {
        key: 'VOICE_GOOGLE_API_KEY',
        type: 'secret',
        label: { es: 'Google API Key (Gemini Live)', en: 'Google API Key (Gemini Live)' },
        info: { es: 'Dejar vacio para usar la key del modulo LLM', en: 'Leave empty to use the LLM module key' },
      },
      {
        key: 'VOICE_GEMINI_MODEL',
        type: 'text',
        label: { es: 'Modelo Gemini Live (primario)', en: 'Gemini Live model (primary)' },
        info: { es: 'Modelo principal (ej: gemini-3.1-flash-live-preview)', en: 'Primary model (e.g., gemini-3.1-flash-live-preview)' },
        width: 'half',
      },
      {
        key: 'VOICE_GEMINI_FALLBACK_MODEL',
        type: 'text',
        label: { es: 'Modelo Gemini Live (fallback)', en: 'Gemini Live model (fallback)' },
        info: { es: 'Modelo alternativo si el primario falla (ej: gemini-2.5-flash-live-preview)', en: 'Fallback model if primary fails (e.g., gemini-2.5-flash-live-preview)' },
        width: 'half',
      },
      {
        key: 'VOICE_GEMINI_THINKING_LEVEL',
        type: 'select',
        label: { es: 'Nivel de razonamiento (thinking)', en: 'Thinking level' },
        info: { es: 'Solo aplica a gemini-3.1. minimal = latencia minima; high = respuestas mas elaboradas', en: 'Only applies to gemini-3.1. minimal = lowest latency; high = more thorough responses' },
        options: [
          { value: 'minimal', label: 'Minimal (recomendado)' },
          { value: 'low', label: 'Low' },
          { value: 'medium', label: 'Medium' },
          { value: 'high', label: 'High' },
        ],
        width: 'half',
      },
      {
        key: 'VOICE_GEMINI_LANGUAGE',
        type: 'text',
        label: { es: 'Idioma (languageCode)', en: 'Language (languageCode)' },
        info: { es: 'Codigo BCP-47 (ej: es-ES, en-US). Vacio = auto-detect', en: 'BCP-47 code (e.g., es-ES, en-US). Empty = auto-detect' },
        width: 'half',
      },
      {
        key: 'VOICE_GEMINI_VOICE',
        type: 'select',
        label: { es: 'Voz del agente', en: 'Agent voice' },
        options: [...GEMINI_VOICES],
      },
      {
        key: 'VOICE_PREVIEW_TEXT',
        type: 'textarea',
        label: { es: 'Texto de preview de voz', en: 'Voice preview text' },
        info: { es: 'Texto que se usara para previsualizar la voz seleccionada', en: 'Text used to preview the selected voice' },
      },
      // ── Generacion ──
      { key: '_divider_generation', type: 'divider', label: { es: 'Generacion (LLM)', en: 'Generation (LLM)' } },
      {
        key: 'VOICE_GEMINI_TEMPERATURE',
        type: 'number',
        label: { es: 'Temperatura', en: 'Temperature' },
        info: { es: 'Creatividad de respuestas (0.0-2.0). Mas alto = mas variado/natural', en: 'Response creativity (0.0-2.0). Higher = more varied/natural' },
        width: 'half',
      },
      {
        key: 'VOICE_GEMINI_TOP_P',
        type: 'number',
        label: { es: 'Top P', en: 'Top P' },
        info: { es: 'Nucleus sampling (0.0-1.0). Controla diversidad de tokens', en: 'Nucleus sampling (0.0-1.0). Controls token diversity' },
        width: 'half',
      },
      {
        key: 'VOICE_GEMINI_TOP_K',
        type: 'number',
        label: { es: 'Top K', en: 'Top K' },
        info: { es: 'Limita tokens candidatos por paso de generacion', en: 'Limits candidate tokens per generation step' },
        width: 'half',
      },
      {
        key: 'VOICE_GEMINI_MAX_OUTPUT_TOKENS',
        type: 'number',
        label: { es: 'Max tokens de salida', en: 'Max output tokens' },
        info: { es: 'Maximo de tokens por respuesta. Previene divagaciones', en: 'Max tokens per response. Prevents rambling' },
        width: 'half',
      },
      // ── VAD nativo de Gemini ──
      { key: '_divider_vad', type: 'divider', label: { es: 'Deteccion de voz (VAD Gemini)', en: 'Voice detection (Gemini VAD)' } },
      {
        key: 'VOICE_VAD_START_SENSITIVITY',
        type: 'select',
        label: { es: 'Sensibilidad inicio de habla', en: 'Start of speech sensitivity' },
        info: { es: 'HIGH = detecta voces suaves. LOW = solo voces claras', en: 'HIGH = detects soft voices. LOW = only clear voices' },
        options: [
          { value: 'START_SENSITIVITY_HIGH', label: 'Alta (High)' },
          { value: 'START_SENSITIVITY_LOW', label: 'Baja (Low)' },
        ],
        width: 'half',
      },
      {
        key: 'VOICE_VAD_END_SENSITIVITY',
        type: 'select',
        label: { es: 'Sensibilidad fin de habla', en: 'End of speech sensitivity' },
        info: { es: 'LOW = espera mas antes de cortar (bueno para pausas). HIGH = corta rapido', en: 'LOW = waits longer before cutting (good for pauses). HIGH = cuts quickly' },
        options: [
          { value: 'END_SENSITIVITY_HIGH', label: 'Alta (High)' },
          { value: 'END_SENSITIVITY_LOW', label: 'Baja (Low)' },
        ],
        width: 'half',
      },
      {
        key: 'VOICE_VAD_PREFIX_PADDING_MS',
        type: 'number',
        label: { es: 'Padding pre-habla (ms)', en: 'Pre-speech padding (ms)' },
        info: { es: 'Audio incluido antes del inicio de habla para no cortar palabras', en: 'Audio included before speech start to avoid cutting words' },
        width: 'half',
      },
      {
        key: 'VOICE_VAD_SILENCE_DURATION_MS',
        type: 'number',
        label: { es: 'Silencio para fin de turno (ms)', en: 'Silence for end of turn (ms)' },
        info: { es: 'Duracion de silencio para que Gemini considere fin de turno del caller', en: 'Silence duration for Gemini to consider caller turn ended' },
        width: 'half',
      },
      {
        key: 'VOICE_BARGE_IN_ENABLED',
        type: 'boolean',
        label: { es: 'Permitir interrupciones (barge-in)', en: 'Allow interruptions (barge-in)' },
        info: { es: 'Si el caller puede interrumpir al agente mientras habla', en: 'Whether the caller can interrupt the agent while speaking' },
      },
      // ── Comportamiento de llamada ──
      { key: '_divider_behavior', type: 'divider', label: { es: 'Comportamiento de llamada', en: 'Call behavior' } },
      {
        key: 'VOICE_GEMINI_FREEZE_TIMEOUT_MS',
        type: 'number',
        label: { es: 'Timeout de freeze de Gemini (ms)', en: 'Gemini freeze timeout (ms)' },
        info: { es: 'Tiempo sin respuesta de Gemini tras turno del caller antes de re-inyectar. 2 fallos = colgar.', en: 'Time without Gemini response after caller turn before re-injecting. 2 failures = hangup.' },
        width: 'half',
      },
      {
        key: 'VOICE_TOOL_FILLER_DELAY_MS',
        type: 'number',
        label: { es: 'Delay antes de filler por tool (ms)', en: 'Tool filler delay (ms)' },
        info: { es: 'Tiempo antes de pedirle a Gemini que diga algo mientras ejecuta una tool lenta', en: 'Time before asking Gemini to say something while a slow tool runs' },
        width: 'half',
      },
      {
        key: 'VOICE_TOOL_TIMEOUT_MS',
        type: 'number',
        label: { es: 'Timeout de ejecucion de tool (ms)', en: 'Tool execution timeout (ms)' },
        info: { es: 'Tiempo maximo por intento de ejecucion de tool antes de reintentar o fallar', en: 'Max time per tool execution attempt before retry or failure' },
        width: 'half',
      },
      {
        key: 'VOICE_TOOL_MAX_RETRIES',
        type: 'number',
        label: { es: 'Reintentos de tool por timeout', en: 'Tool retries on timeout' },
        info: { es: 'Cantidad de reintentos antes de reportar error al caller (0 = sin reintentos)', en: 'Number of retries before reporting error to caller (0 = no retries)' },
        min: 0,
        width: 'half',
      },
      {
        key: 'VOICE_GREETING_INBOUND',
        type: 'textarea',
        label: { es: 'Saludo para llamadas entrantes', en: 'Inbound call greeting' },
      },
      {
        key: 'VOICE_GREETING_OUTBOUND',
        type: 'textarea',
        label: { es: 'Saludo para llamadas salientes', en: 'Outbound call greeting' },
      },
      {
        key: 'VOICE_ANSWER_DELAY_MIN_RINGS',
        type: 'number',
        label: { es: 'Timbrazos minimos antes de contestar', en: 'Min rings before answering' },
        info: { es: 'Minimo de timbrazos para parecer natural (minimo 1)', en: 'Minimum rings for natural feel (minimum 1)' },
        min: 1,
        width: 'half',
      },
      {
        key: 'VOICE_ANSWER_DELAY_MAX_RINGS',
        type: 'number',
        label: { es: 'Timbrazos maximos antes de contestar', en: 'Max rings before answering' },
        info: { es: 'Maximo de timbrazos antes de contestar (aleatorio entre min y max)', en: 'Max rings before answering (random between min and max)' },
        min: 1,
        width: 'half',
      },
      {
        key: 'VOICE_FILLER_MESSAGE',
        type: 'text',
        label: { es: 'Mensaje de espera (procesando)', en: 'Filler message (processing)' },
      },
      // ── Silencio y timeouts ──
      { key: '_divider_silence', type: 'divider', label: { es: 'Silencio y timeouts', en: 'Silence & timeouts' } },
      {
        key: 'VOICE_SILENCE_TIMEOUT_MS',
        type: 'number',
        label: { es: 'Timeout de silencio (ms)', en: 'Silence timeout (ms)' },
        info: { es: 'Tiempo sin habla antes de preguntar si sigue ahi (modo conversacion normal)', en: 'Time without speech before prompting (normal conversation mode)' },
        width: 'half',
      },
      {
        key: 'VOICE_POST_GREETING_SILENCE_TIMEOUT_MS',
        type: 'number',
        label: { es: 'Timeout post-saludo (ms)', en: 'Post-greeting timeout (ms)' },
        info: { es: 'Tiempo extra para que el caller responda tras el saludo inicial (30s recomendado)', en: 'Extra time for caller to respond after initial greeting (30s recommended)' },
        width: 'half',
      },
      {
        key: 'VOICE_SILENCE_RMS_THRESHOLD',
        type: 'number',
        label: { es: 'Umbral RMS de silencio', en: 'Silence RMS threshold' },
        info: { es: 'Nivel de energia por debajo del cual se considera silencio (menor = mas sensible)', en: 'Energy level below which audio is considered silence (lower = more sensitive)' },
        width: 'half',
      },
      {
        key: 'VOICE_SILENCE_MESSAGE',
        type: 'text',
        label: { es: 'Mensaje de silencio', en: 'Silence message' },
      },
      {
        key: 'VOICE_GOODBYE_TIMEOUT_MS',
        type: 'number',
        label: { es: 'Timeout de despedida (ms)', en: 'Goodbye timeout (ms)' },
        info: { es: 'Tiempo tras despedida antes de colgar', en: 'Time after goodbye before hanging up' },
        width: 'half',
      },
      {
        key: 'VOICE_GEMINI_CONNECTION_TIMEOUT_MS',
        type: 'number',
        label: { es: 'Timeout de conexion Gemini (ms)', en: 'Gemini connection timeout (ms)' },
        info: { es: 'Tiempo maximo para conectar WebSocket a Gemini Live', en: 'Maximum time to connect WebSocket to Gemini Live' },
        width: 'half',
      },
      // ── Limites ──
      { key: '_divider_limits', type: 'divider', label: { es: 'Limites', en: 'Limits' } },
      {
        key: 'VOICE_MAX_CALL_DURATION_MS',
        type: 'number',
        label: { es: 'Duracion maxima de llamada (ms)', en: 'Max call duration (ms)' },
        width: 'half',
      },
      {
        key: 'VOICE_MAX_CONCURRENT_CALLS',
        type: 'number',
        label: { es: 'Maximo de llamadas simultaneas', en: 'Max concurrent calls' },
        width: 'half',
      },
      {
        key: 'VOICE_RATE_LIMIT_HOUR',
        type: 'number',
        label: { es: 'Max llamadas/hora por contacto', en: 'Max calls/hour per contact' },
        info: { es: '0 = sin limite', en: '0 = unlimited' },
        min: 0,
        width: 'half',
      },
      {
        key: 'VOICE_RATE_LIMIT_DAY',
        type: 'number',
        label: { es: 'Max llamadas/dia por contacto', en: 'Max calls/day per contact' },
        info: { es: '0 = sin limite', en: '0 = unlimited' },
        min: 0,
        width: 'half',
      },
      {
        key: 'VOICE_SESSION_TIMEOUT_HOURS',
        type: 'number',
        label: { es: 'Timeout de sesion (horas)', en: 'Session timeout (hours)' },
        info: { es: 'Horas de inactividad para cerrar la sesion', en: 'Inactivity hours to close the session' },
        min: 1,
        width: 'half',
      },
      // ── Llamadas salientes ──
      { key: '_divider_outbound', type: 'divider', label: { es: 'Llamadas salientes', en: 'Outbound calls' } },
      {
        key: 'VOICE_BUSINESS_HOURS_ENABLED',
        type: 'boolean',
        label: { es: 'Restringir a horario laboral', en: 'Restrict to business hours' },
        info: { es: 'Si se activa, bloquea llamadas salientes fuera del horario configurado y en fines de semana', en: 'If enabled, blocks outbound calls outside configured hours and on weekends' },
      },
      {
        key: 'VOICE_BUSINESS_HOURS_START',
        type: 'number',
        label: { es: 'Hora de inicio (0-23)', en: 'Start hour (0-23)' },
        info: { es: 'Hora en que comienza el horario laboral (ej: 8 = 8:00 AM)', en: 'Hour business hours begin (e.g.: 8 = 8:00 AM)' },
        min: 0,
        width: 'half',
      },
      {
        key: 'VOICE_BUSINESS_HOURS_END',
        type: 'number',
        label: { es: 'Hora de fin (0-23)', en: 'End hour (0-23)' },
        info: { es: 'Hora en que termina el horario laboral (ej: 17 = 5:00 PM)', en: 'Hour business hours end (e.g.: 17 = 5:00 PM)' },
        min: 0,
        width: 'half',
      },
      {
        key: 'VOICE_BUSINESS_HOURS_TIMEZONE',
        type: 'text',
        label: { es: 'Zona horaria', en: 'Timezone' },
        info: { es: 'Zona horaria IANA (ej: America/Bogota, America/Mexico_City, Europe/Madrid)', en: 'IANA timezone (e.g.: America/Bogota, America/Mexico_City, Europe/Madrid)' },
        width: 'half',
      },
      {
        key: 'VOICE_OUTBOUND_RATE_LIMIT_HOUR',
        type: 'number',
        label: { es: 'Max llamadas salientes/hora por numero', en: 'Max outbound calls/hour per number' },
        info: { es: '0 = sin limite. Limita llamadas salientes al mismo numero en la ultima hora', en: '0 = unlimited. Limits outbound calls to the same number in the last hour' },
        min: 0,
        width: 'half',
      },
      {
        key: 'VOICE_INBOUND_RATE_LIMIT_HOUR',
        type: 'number',
        label: { es: 'Max llamadas entrantes/hora por numero', en: 'Max inbound calls/hour per number' },
        info: { es: '0 = sin limite. Limita llamadas entrantes del mismo numero en la ultima hora', en: '0 = unlimited. Limits inbound calls from the same number in the last hour' },
        min: 0,
        width: 'half',
      },
      {
        key: 'VOICE_ENABLED',
        type: 'boolean',
        label: { es: 'Llamadas habilitadas', en: 'Calls enabled' },
      },
    ],
    apiRoutes,
    connectionWizard: {
      title: { es: 'Conectar Twilio Voice', en: 'Connect Twilio Voice' },
      steps: [
        {
          title: { es: 'Requisitos previos', en: 'Prerequisites' },
          instructions: {
            es: '<p>Para conectar llamadas de voz necesitas:</p><ol><li>Una cuenta de <a href="https://www.twilio.com/try-twilio" target="_blank" rel="noopener">Twilio <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></a> (puedes crear una gratis con creditos de prueba).</li><li>Un <strong>numero de telefono</strong> con capacidad de voz (se compra desde Twilio).</li><li>Las credenciales <strong>Account SID</strong> y <strong>Auth Token</strong> de tu cuenta.</li><li>Opcionalmente, una <strong>Google API Key</strong> para usar Gemini Live como motor de voz (si no se configura, usa la key del modulo LLM).</li></ol>',
            en: '<p>To connect voice calls you need:</p><ol><li>A <a href="https://www.twilio.com/try-twilio" target="_blank" rel="noopener">Twilio <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></a> account (you can create one for free with trial credits).</li><li>A <strong>phone number</strong> with voice capability (purchased from Twilio).</li><li>Your <strong>Account SID</strong> and <strong>Auth Token</strong> credentials.</li><li>Optionally, a <strong>Google API Key</strong> for Gemini Live as the voice engine (if not set, the LLM module key is used).</li></ol>',
          },
        },
        {
          title: { es: 'Obtener credenciales de Twilio', en: 'Get Twilio credentials' },
          instructions: {
            es: '<ol><li>Ve al <a href="https://console.twilio.com/" target="_blank" rel="noopener">Twilio Console <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></a> e inicia sesion.</li><li>En la pagina principal (<strong>Account Info</strong>) encontraras tu <strong>Account SID</strong> y <strong>Auth Token</strong>. Copia ambos.</li><li>Ve a <a href="https://console.twilio.com/us1/develop/phone-numbers/manage/incoming" target="_blank" rel="noopener">Phone Numbers > Manage > Active Numbers <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></a>.</li><li>Si no tienes un numero, haz clic en <a href="https://console.twilio.com/us1/develop/phone-numbers/manage/search" target="_blank" rel="noopener">Buy a Number <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></a> y selecciona uno con capacidad de <strong>Voice</strong>.</li></ol>',
            en: '<ol><li>Go to <a href="https://console.twilio.com/" target="_blank" rel="noopener">Twilio Console <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></a> and sign in.</li><li>On the main page (<strong>Account Info</strong>) you will find your <strong>Account SID</strong> and <strong>Auth Token</strong>. Copy both.</li><li>Go to <a href="https://console.twilio.com/us1/develop/phone-numbers/manage/incoming" target="_blank" rel="noopener">Phone Numbers > Manage > Active Numbers <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></a>.</li><li>If you don\'t have a number, click <a href="https://console.twilio.com/us1/develop/phone-numbers/manage/search" target="_blank" rel="noopener">Buy a Number <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></a> and select one with <strong>Voice</strong> capability.</li></ol>',
          },
        },
        {
          title: { es: 'Configurar webhooks de voz', en: 'Configure voice webhooks' },
          instructions: {
            es: '<ol><li>En <a href="https://console.twilio.com/us1/develop/phone-numbers/manage/incoming" target="_blank" rel="noopener">Phone Numbers > Active Numbers <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></a>, haz clic en tu numero.</li><li>En la seccion <strong>Voice Configuration</strong>, configura <strong>"A call comes in"</strong> como <code>Webhook</code> y pega esta URL:</li></ol><div class="wizard-uri-box"><code class="wizard-uri">{BASE_URL}/console/api/twilio-voice/webhook/incoming</code><button type="button" class="wizard-copy-icon" onclick="copyChWizardUri(this)" title="Copiar"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg></button></div><ol start="3"><li>Configura <strong>"Call status changes"</strong> con esta URL:</li></ol><div class="wizard-uri-box"><code class="wizard-uri">{BASE_URL}/console/api/twilio-voice/webhook/status</code><button type="button" class="wizard-copy-icon" onclick="copyChWizardUri(this)" title="Copiar"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg></button></div><ol start="4"><li>Haz clic en <strong>Save configuration</strong>.</li></ol>',
            en: '<ol><li>In <a href="https://console.twilio.com/us1/develop/phone-numbers/manage/incoming" target="_blank" rel="noopener">Phone Numbers > Active Numbers <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></a>, click on your number.</li><li>In the <strong>Voice Configuration</strong> section, set <strong>"A call comes in"</strong> to <code>Webhook</code> and paste this URL:</li></ol><div class="wizard-uri-box"><code class="wizard-uri">{BASE_URL}/console/api/twilio-voice/webhook/incoming</code><button type="button" class="wizard-copy-icon" onclick="copyChWizardUri(this)" title="Copy"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg></button></div><ol start="3"><li>Set <strong>"Call status changes"</strong> URL to:</li></ol><div class="wizard-uri-box"><code class="wizard-uri">{BASE_URL}/console/api/twilio-voice/webhook/status</code><button type="button" class="wizard-copy-icon" onclick="copyChWizardUri(this)" title="Copy"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg></button></div><ol start="4"><li>Click <strong>Save configuration</strong>.</li></ol>',
          },
        },
        {
          title: { es: 'Ingresa las credenciales', en: 'Enter credentials' },
          instructions: {
            es: '<p>Ingresa los datos de tu cuenta Twilio:</p>',
            en: '<p>Enter your Twilio account details:</p>',
          },
          fields: [
            { key: 'TWILIO_ACCOUNT_SID', label: { es: 'Account SID', en: 'Account SID' }, type: 'text', placeholder: 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' },
            { key: 'TWILIO_AUTH_TOKEN', label: { es: 'Auth Token', en: 'Auth Token' }, type: 'secret', placeholder: 'xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' },
            { key: 'TWILIO_PHONE_NUMBER', label: { es: 'Numero de telefono', en: 'Phone number' }, type: 'text', placeholder: '+1234567890' },
          ],
        },
      ],
      applyAfterSave: true,
      verifyEndpoint: 'status',
      operationParams: {
        autoReconnect: { es: 'Reintentar llamadas tras fallo de conexion', en: 'Retry calls after connection failure' },
        maxRetries: { es: 'Maximo de llamadas simultaneas', en: 'Max concurrent calls' },
        retryIntervalMs: { es: 'Timeout de silencio antes de preguntar (ms)', en: 'Silence timeout before prompting (ms)' },
        custom: [
          { key: 'VOICE_ENABLED', label: { es: 'Llamadas habilitadas', en: 'Calls enabled' }, type: 'boolean', defaultValue: 'true' },
          { key: 'VOICE_MAX_CALL_DURATION_MS', label: { es: 'Duracion maxima de llamada (ms)', en: 'Max call duration (ms)' }, type: 'number', defaultValue: '1800000' },
        ],
      },
    },
  },

  async init(registry: Registry): Promise<void> {
    _registry = registry
    const db = registry.getDb()

    // Create tables
    await createTables(db)

    // Load config (mutable for hot-reload)
    let config = registry.getConfig<TwilioVoiceConfig>('twilio-voice')

    // Initialize adapters
    twilioAdapter = new TwilioAdapter(config)
    mediaServer = new MediaStreamServer()
    callManager = new CallManager(config, registry, db, mediaServer, twilioAdapter)

    // Register WebSocket upgrade handler for Twilio media streams
    const server = registry.getOptional<Server>('kernel:server')
    if (server) {
      server.registerUpgradeHandler('/twilio/media-stream', (req, socket, head) => {
        mediaServer!.handleUpgrade(req, socket, head, {
          onStart: (streamSid, callSid, customParams) => {
            callManager!.onMediaStreamStart(streamSid, callSid, customParams).catch(err => {
              import('pino').then(p => p.default({ name: 'twilio-voice' }).error({ err }, 'Error on media stream start'))
            })
          },
          onMedia: (streamSid, payload) => {
            callManager!.onMediaReceived(streamSid, payload)
          },
          onStop: (streamSid) => {
            callManager!.onMediaStreamStop(streamSid).catch(() => {})
          },
        })
      })
    }

    // ── Channel Config Service ──
    // Provides runtime config to the engine via registry.getOptional('channel-config:voice')
    registry.provide('channel-config:voice', {
      get: (): import('../../channels/types.js').ChannelRuntimeConfig => {
        const bufferTurns = registry.getOptional<{ get(): { instant: number; async: number; voice: number } }>('memory:buffer-turns')?.get()
        return {
          rateLimitHour: config.VOICE_RATE_LIMIT_HOUR,
          rateLimitDay: config.VOICE_RATE_LIMIT_DAY,
          avisoTriggerMs: 0, // no aviso for voice — Gemini handles conversation in real-time
          avisoHoldMs: 0,
          avisoMessages: [],
          avisoStyle: 'formal',
          sessionTimeoutMs: config.VOICE_SESSION_TIMEOUT_HOURS * 3600000,
          batchWaitSeconds: 0, // no batching for voice
          precloseFollowupMs: 0,
          precloseFollowupMessage: '',
          typingDelayMsPerChar: 0, // not applicable for voice
          typingDelayMinMs: 0,
          typingDelayMaxMs: 0,
          channelType: 'voice',
          supportsTypingIndicator: false, // voice has no typing indicator
          ttsEnabled: false, // voice uses Gemini Live, not TTS pipeline
          antiSpamMaxPerWindow: 0,
          antiSpamWindowMs: 0,
          floodThreshold: 0, // no batching/flood for voice
          historyTurns: bufferTurns?.voice ?? 7,
        }
      },
    })

    // Provide services
    registry.provide('twilio-voice:callManager', callManager)
    registry.provide('twilio-voice:adapter', twilioAdapter)

    // ── Hot-reload: re-read config when console applies changes ──
    registry.addHook('twilio-voice', 'console:config_applied', async () => {
      const fresh = registry.getConfig<TwilioVoiceConfig>('twilio-voice')
      Object.assign(config, fresh)
      const pino = await import('pino')
      pino.default({ name: 'twilio-voice' }).info('Config hot-reloaded')
    })

    const pino = await import('pino')
    const logger = pino.default({ name: 'twilio-voice' })
    logger.info({ configured: twilioAdapter.isConfigured() }, 'Twilio Voice module initialized')
  },

  async stop(): Promise<void> {
    if (callManager) {
      await callManager.stopAll()
      callManager = null
    }
    if (mediaServer) {
      mediaServer.close()
      mediaServer = null
    }
    twilioAdapter = null
    _registry = null
  },
}

export default manifest
