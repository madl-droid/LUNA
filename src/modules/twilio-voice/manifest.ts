// LUNA — Module: twilio-voice
// Canal de voz: Twilio para telefonía + Gemini Live para conversación en tiempo real.
// Voice sub-engine ligero que delega conversación a Gemini y provee contexto + tools.

import { z } from 'zod'
import type { ModuleManifest, ApiRoute } from '../../kernel/types.js'
import type { Registry } from '../../kernel/registry.js'
import { jsonResponse, parseBody, readBody, parseQuery } from '../../kernel/http-helpers.js'
import { numEnv, numEnvMin, boolEnv } from '../../kernel/config-helpers.js'
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
        const config = _registry.getConfig<TwilioVoiceConfig>('twilio-voice')
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

  // Voice preview (TTS)
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
        const config = _registry.getConfig<TwilioVoiceConfig>('twilio-voice')
        const apiKey = config.VOICE_GOOGLE_API_KEY || getGoogleApiKey()

        if (!apiKey) {
          jsonResponse(res, 400, { error: 'No Google API key configured' })
          return
        }

        // Use Gemini TTS endpoint for preview
        const ttsResponse = await fetch(
          `https://texttospeech.googleapis.com/v1/text:synthesize?key=${apiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              input: { text: body.text },
              voice: {
                languageCode: 'es-US',
                name: `es-US-Wavenet-${body.voice === 'Kore' || body.voice === 'Aoede' ? 'A' : 'B'}`,
              },
              audioConfig: { audioEncoding: 'MP3' },
            }),
          },
        )

        if (!ttsResponse.ok) {
          const errText = await ttsResponse.text()
          jsonResponse(res, 500, { error: `TTS failed: ${errText}` })
          return
        }

        const ttsData = await ttsResponse.json() as { audioContent: string }
        jsonResponse(res, 200, {
          audioBase64: ttsData.audioContent,
          mimeType: 'audio/mp3',
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
      if (!callManager || !_registry) {
        res.writeHead(503, { 'Content-Type': 'text/xml' })
        res.end('<?xml version="1.0" encoding="UTF-8"?><Response><Say>Service unavailable</Say><Hangup/></Response>')
        return
      }

      const rawBody = await readBody(req)
      const params = TwilioAdapter.parseWebhookBody(rawBody)
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

      const rawBody = await readBody(req)
      const params = TwilioAdapter.parseWebhookBody(rawBody)
      const callSid = params['CallSid'] ?? ''

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
  removable: true,
  activateByDefault: false,
  depends: ['memory', 'llm'],

  configSchema: z.object({
    TWILIO_ACCOUNT_SID: z.string().default(''),
    TWILIO_AUTH_TOKEN: z.string().default(''),
    TWILIO_PHONE_NUMBER: z.string().default(''),
    VOICE_GEMINI_VOICE: z.string().default('Kore'),
    VOICE_PREVIEW_TEXT: z.string().default('Hola, soy tu asistente virtual. \u00bfEn qu\u00e9 puedo ayudarte hoy?'),
    VOICE_ANSWER_DELAY_RINGS: numEnvMin(1, 2),
    VOICE_SILENCE_TIMEOUT_MS: numEnv(10000),
    VOICE_SILENCE_MESSAGE: z.string().default('\u00bfSigues ah\u00ed?'),
    VOICE_GREETING_INBOUND: z.string().default('Hola, gracias por llamar. \u00bfEn qu\u00e9 puedo ayudarte?'),
    VOICE_GREETING_OUTBOUND: z.string().default('Hola, te llamo de parte de la empresa. \u00bfEs un buen momento para hablar?'),
    VOICE_FILLER_MESSAGE: z.string().default('Dame un momento, estoy revisando eso...'),
    VOICE_GOODBYE_TIMEOUT_MS: numEnv(5000),
    VOICE_MAX_CALL_DURATION_MS: numEnv(1800000),
    VOICE_MAX_CONCURRENT_CALLS: numEnvMin(1, 5),
    VOICE_ENABLED: boolEnv(true),
    VOICE_GOOGLE_API_KEY: z.string().default(''),
  }),

  console: {
    title: {
      es: 'Llamadas de voz (Twilio + Gemini)',
      en: 'Voice calls (Twilio + Gemini)',
    },
    info: {
      es: 'Llamadas telef\u00f3nicas con IA conversacional en tiempo real usando Gemini Live.',
      en: 'Phone calls with real-time conversational AI powered by Gemini Live.',
    },
    order: 15,
    group: 'channels',
    icon: '&#128222;',
    fields: [
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
        label: { es: 'N\u00famero de tel\u00e9fono Twilio', en: 'Twilio Phone Number' },
        info: { es: 'N\u00famero con formato internacional (+1234567890)', en: 'International format number (+1234567890)' },
      },
      {
        key: 'VOICE_GOOGLE_API_KEY',
        type: 'secret',
        label: { es: 'Google API Key (Gemini Live)', en: 'Google API Key (Gemini Live)' },
        info: { es: 'Dejar vac\u00edo para usar la key del m\u00f3dulo LLM', en: 'Leave empty to use the LLM module key' },
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
        info: { es: 'Texto que se usar\u00e1 para previsualizar la voz seleccionada', en: 'Text used to preview the selected voice' },
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
        key: 'VOICE_ANSWER_DELAY_RINGS',
        type: 'number',
        label: { es: 'Timbrazos antes de contestar', en: 'Rings before answering' },
        info: { es: 'N\u00famero de timbrazos para parecer natural (m\u00ednimo 1)', en: 'Number of rings for natural feel (minimum 1)' },
      },
      {
        key: 'VOICE_SILENCE_TIMEOUT_MS',
        type: 'number',
        label: { es: 'Timeout de silencio (ms)', en: 'Silence timeout (ms)' },
        info: { es: 'Tiempo sin habla antes de preguntar si sigue ah\u00ed', en: 'Time without speech before prompting' },
      },
      {
        key: 'VOICE_SILENCE_MESSAGE',
        type: 'text',
        label: { es: 'Mensaje de silencio', en: 'Silence message' },
      },
      {
        key: 'VOICE_FILLER_MESSAGE',
        type: 'text',
        label: { es: 'Mensaje de espera (procesando)', en: 'Filler message (processing)' },
      },
      {
        key: 'VOICE_GOODBYE_TIMEOUT_MS',
        type: 'number',
        label: { es: 'Timeout de despedida (ms)', en: 'Goodbye timeout (ms)' },
        info: { es: 'Tiempo tras despedida antes de colgar', en: 'Time after goodbye before hanging up' },
      },
      {
        key: 'VOICE_MAX_CALL_DURATION_MS',
        type: 'number',
        label: { es: 'Duraci\u00f3n m\u00e1xima de llamada (ms)', en: 'Max call duration (ms)' },
      },
      {
        key: 'VOICE_MAX_CONCURRENT_CALLS',
        type: 'number',
        label: { es: 'M\u00e1ximo de llamadas simult\u00e1neas', en: 'Max concurrent calls' },
      },
      {
        key: 'VOICE_ENABLED',
        type: 'boolean',
        label: { es: 'Llamadas habilitadas', en: 'Calls enabled' },
      },
    ],
    apiRoutes,
  },

  async init(registry: Registry): Promise<void> {
    _registry = registry
    const db = registry.getDb()

    // Create tables
    await createTables(db)

    // Load config
    const config = registry.getConfig<TwilioVoiceConfig>('twilio-voice')

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

    // Provide services
    registry.provide('twilio-voice:callManager', callManager)
    registry.provide('twilio-voice:adapter', twilioAdapter)

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

function getGoogleApiKey(): string {
  try {
    const llmConfig = _registry?.getConfig<{ GOOGLE_AI_API_KEY?: string }>('llm')
    return llmConfig?.GOOGLE_AI_API_KEY ?? ''
  } catch {
    return ''
  }
}

export default manifest
