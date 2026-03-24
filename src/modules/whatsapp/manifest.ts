// LUNA — Module: whatsapp
// Canal WhatsApp vía Baileys (conexión directa).
// Auth state stored in PostgreSQL — no filesystem credentials.

import { z } from 'zod'
import type { ModuleManifest, ApiRoute } from '../../kernel/types.js'
import type { Registry } from '../../kernel/registry.js'
import { jsonResponse } from '../../kernel/http-helpers.js'
import { numEnv, numEnvMin, boolEnv } from '../../kernel/config-helpers.js'
import { BaileysAdapter } from './adapter.js'
import { MessageBatcher } from './message-batcher.js'
import * as configStore from '../../kernel/config-store.js'
import QRCode from 'qrcode'

import pino from 'pino'
import type { IncomingMessage } from './adapter.js'

const manifestLogger = pino({ name: 'whatsapp:manifest' })

let adapter: BaileysAdapter | null = null
let batcher: MessageBatcher | null = null
let precloseTimers = new Map<string, ReturnType<typeof setTimeout>>()
let _registry: Registry | null = null

const apiRoutes: ApiRoute[] = [
  {
    method: 'GET',
    path: 'status',
    handler: async (_req, res) => {
      const moduleEnabled = _registry?.isActive('whatsapp') ?? false
      if (!adapter) {
        jsonResponse(res, 200, { status: 'not_initialized', qrDataUrl: null, lastDisconnectReason: null, connectedNumber: null, moduleEnabled })
        return
      }
      const state = adapter.getState()
      let qrDataUrl: string | null = null
      if (state.qr) {
        try {
          qrDataUrl = await QRCode.toDataURL(state.qr, { width: 300, margin: 2, color: { dark: '#1a1a1a', light: '#ffffff' } })
        } catch { /* ignore */ }
      }
      jsonResponse(res, 200, { status: state.status, qrDataUrl, lastDisconnectReason: state.lastDisconnectReason, connectedNumber: state.connectedNumber, moduleEnabled })
    },
  },
  {
    method: 'POST',
    path: 'connect',
    handler: async (_req, res) => {
      if (!adapter) {
        jsonResponse(res, 400, { error: 'WhatsApp adapter not initialized' })
        return
      }
      try {
        await adapter.initialize()
        jsonResponse(res, 200, { ok: true, status: adapter.getState().status })
      } catch (err) {
        jsonResponse(res, 500, { error: 'Failed to connect: ' + String(err) })
      }
    },
  },
  {
    method: 'POST',
    path: 'disconnect',
    handler: async (_req, res) => {
      if (!adapter) {
        jsonResponse(res, 400, { error: 'WhatsApp adapter not initialized' })
        return
      }
      try {
        await adapter.disconnect()
        jsonResponse(res, 200, { ok: true, status: 'disconnected' })
      } catch (err) {
        jsonResponse(res, 500, { error: 'Failed to disconnect: ' + String(err) })
      }
    },
  },
]

const manifest: ModuleManifest = {
  name: 'whatsapp',
  version: '1.1.0',
  description: {
    es: 'Canal de WhatsApp usando Baileys (conexión directa, auth en DB)',
    en: 'WhatsApp channel using Baileys (direct connection, DB auth)',
  },
  type: 'channel',
  channelType: 'instant',
  removable: true,
  activateByDefault: true,
  depends: [],

  configSchema: z.object({
    WHATSAPP_RECONNECT_INTERVAL_MS: numEnv(5000),
    WHATSAPP_MAX_RECONNECT_ATTEMPTS: numEnv(10),
    // Aviso de proceso (ack message when response is slow)
    WHATSAPP_AVISO_TRIGGER_MS: numEnv(3000),
    WHATSAPP_AVISO_HOLD_MS: numEnv(2000),
    WHATSAPP_AVISO_MESSAGE: z.string().default('Un momento, estoy revisando eso...'),
    // Rate limits
    WHATSAPP_RATE_LIMIT_HOUR: numEnvMin(1, 30),
    WHATSAPP_RATE_LIMIT_DAY: numEnvMin(1, 200),
    // Socket tuning
    WHATSAPP_MARK_ONLINE: boolEnv(true),
    WHATSAPP_REJECT_CALLS: boolEnv(true),
    WHATSAPP_REJECT_CALL_MESSAGE: z.string().default('No puedo atender llamadas. Escríbeme por chat.'),
    // Privacy
    WHATSAPP_PRIVACY_LAST_SEEN: z.string().default(''),
    WHATSAPP_PRIVACY_PROFILE_PIC: z.string().default(''),
    WHATSAPP_PRIVACY_STATUS: z.string().default(''),
    WHATSAPP_PRIVACY_READ_RECEIPTS: boolEnv(true),
    // Agent name (for @mention detection in groups)
    WHATSAPP_AGENT_NAME: z.string().default('Luna'),
    // Message batching: wait time (seconds) to collect messages before processing
    WHATSAPP_BATCH_WAIT_SECONDS: numEnvMin(15, 30),
    // Session inactivity timeout (hours) — max 24h per Meta policies
    WHATSAPP_SESSION_TIMEOUT_HOURS: numEnvMin(1, 24),
    // Pre-close follow-up
    WHATSAPP_PRECLOSE_FOLLOWUP_HOURS: numEnvMin(0, 1),
    WHATSAPP_PRECLOSE_MESSAGE: z.string().default('¿Sigues ahí? Tu sesión se cerrará pronto por inactividad. Si necesitas algo más, escríbeme.'),
  }),

  console: {
    title: { es: 'WhatsApp', en: 'WhatsApp' },
    info: {
      es: 'Conexión directa a WhatsApp. Credenciales almacenadas en la base de datos, no en el filesystem.',
      en: 'Direct WhatsApp connection. Credentials stored in database, not filesystem.',
    },
    order: 10,
    group: 'channels',
    icon: '&#128172;',
    fields: [
      {
        key: 'WHATSAPP_CONNECTED_NUMBER',
        type: 'readonly',
        label: { es: 'Numero conectado', en: 'Connected number' },
        info: { es: 'Numero de WhatsApp vinculado actualmente (solo lectura)', en: 'Currently linked WhatsApp number (read-only)' },
      },
      {
        key: 'WHATSAPP_CONNECTION_STATUS',
        type: 'readonly',
        label: { es: 'Estado de conexion', en: 'Connection status' },
        info: { es: 'Estado actual de la conexion WhatsApp (solo lectura)', en: 'Current WhatsApp connection status (read-only)' },
      },
      { key: '_divider_reconnect', type: 'divider', label: { es: 'Reconexion', en: 'Reconnection' } },
      {
        key: 'WHATSAPP_RECONNECT_INTERVAL_MS',
        type: 'number',
        label: { es: 'Intervalo de reconexion (ms)', en: 'Reconnection interval (ms)' },
        info: { es: 'Tiempo entre intentos de reconexion automatica', en: 'Time between automatic reconnection attempts' },
        width: 'half',
      },
      {
        key: 'WHATSAPP_MAX_RECONNECT_ATTEMPTS',
        type: 'number',
        label: { es: 'Max intentos de reconexion', en: 'Max reconnection attempts' },
        info: { es: 'Intentos maximos antes de marcar como error', en: 'Maximum attempts before marking as error' },
        width: 'half',
      },
      { key: '_divider_naturalidad', type: 'divider', label: { es: 'Naturalidad', en: 'Naturalness' } },
      {
        key: 'WHATSAPP_AVISO_TRIGGER_MS',
        type: 'number',
        label: { es: 'Tiempo para aviso (ms)', en: 'Acknowledgment trigger (ms)' },
        info: { es: 'Si la respuesta tarda mas de este tiempo, se envia un aviso automatico. 0 = desactivado.', en: 'If the response takes longer than this, an automatic acknowledgment is sent. 0 = disabled.' },
        width: 'half',
      },
      {
        key: 'WHATSAPP_AVISO_HOLD_MS',
        type: 'number',
        label: { es: 'Pausa antes de respuesta (ms)', en: 'Hold before response (ms)' },
        info: { es: 'Tiempo que se retiene la respuesta real despues del aviso, para que no lleguen juntos.', en: 'Time the real response is held after the ack, so they don\'t arrive together.' },
        width: 'half',
      },
      {
        key: 'WHATSAPP_AVISO_MESSAGE',
        type: 'text',
        label: { es: 'Mensaje de aviso', en: 'Acknowledgment message' },
        info: { es: 'Texto del aviso. Se envia automaticamente si la respuesta tarda.', en: 'Acknowledgment text. Sent automatically if the response is slow.' },
      },
      { key: '_divider_rate', type: 'divider', label: { es: 'Limites de envio', en: 'Rate limits' } },
      {
        key: 'WHATSAPP_RATE_LIMIT_HOUR',
        type: 'number',
        label: { es: 'Max mensajes por hora', en: 'Max messages per hour' },
        info: { es: 'Maximo de mensajes por hora por contacto', en: 'Max messages per hour per contact' },
        min: 1,
        max: 100,
        width: 'half',
      },
      {
        key: 'WHATSAPP_RATE_LIMIT_DAY',
        type: 'number',
        label: { es: 'Max mensajes por dia', en: 'Max messages per day' },
        info: { es: 'Maximo de mensajes por dia por contacto', en: 'Max messages per day per contact' },
        min: 1,
        max: 1000,
        width: 'half',
      },
      { key: '_divider_socket', type: 'divider', label: { es: 'Comportamiento', en: 'Behavior' } },
      {
        key: 'WHATSAPP_MARK_ONLINE',
        type: 'boolean',
        label: { es: 'Marcar como en linea', en: 'Mark as online' },
        info: { es: 'Si el bot aparece como en linea en WhatsApp', en: 'Whether the bot appears as online on WhatsApp' },
      },
      {
        key: 'WHATSAPP_REJECT_CALLS',
        type: 'boolean',
        label: { es: 'Rechazar llamadas', en: 'Reject calls' },
        info: { es: 'Rechaza llamadas automaticamente y envia un mensaje', en: 'Automatically reject calls and send a message' },
      },
      {
        key: 'WHATSAPP_REJECT_CALL_MESSAGE',
        type: 'text',
        label: { es: 'Mensaje al rechazar llamada', en: 'Call rejection message' },
        info: { es: 'Texto enviado al contacto cuando se rechaza una llamada', en: 'Text sent to the contact when a call is rejected' },
      },
      {
        key: 'WHATSAPP_AGENT_NAME',
        type: 'text',
        label: { es: 'Nombre del agente', en: 'Agent name' },
        info: { es: 'Nombre para deteccion de @mencion en grupos (default: Luna)', en: 'Name for @mention detection in groups (default: Luna)' },
      },
      { key: '_divider_session', type: 'divider', label: { es: 'Sesion y batching', en: 'Session & batching' } },
      {
        key: 'WHATSAPP_BATCH_WAIT_SECONDS',
        type: 'number',
        label: { es: 'Espera de batching (seg)', en: 'Batch wait (sec)' },
        info: { es: 'Segundos de espera para acumular mensajes antes de procesar. Min 15, max 120.', en: 'Seconds to wait and collect messages before processing. Min 15, max 120.' },
        min: 15,
        max: 120,
        unit: 's',
        width: 'half',
      },
      {
        key: 'WHATSAPP_SESSION_TIMEOUT_HOURS',
        type: 'number',
        label: { es: 'Timeout de sesion (horas)', en: 'Session timeout (hours)' },
        info: { es: 'Horas de inactividad para cerrar la sesion. Max 24h (politica de Meta).', en: 'Inactivity hours to close the session. Max 24h (Meta policy).' },
        min: 1,
        max: 24,
        unit: 'h',
        width: 'half',
      },
      {
        key: 'WHATSAPP_PRECLOSE_FOLLOWUP_HOURS',
        type: 'number',
        label: { es: 'Follow-up pre-cierre (horas)', en: 'Pre-close follow-up (hours)' },
        info: { es: 'Horas antes del cierre de sesion para enviar un recordatorio si se espera respuesta del cliente. 0 = desactivado.', en: 'Hours before session close to send a reminder if awaiting client response. 0 = disabled.' },
        min: 0,
        max: 23,
        unit: 'h',
        width: 'half',
      },
      {
        key: 'WHATSAPP_PRECLOSE_MESSAGE',
        type: 'text',
        label: { es: 'Mensaje pre-cierre', en: 'Pre-close message' },
        info: { es: 'Texto del recordatorio que se envia antes de cerrar la sesion por inactividad.', en: 'Reminder text sent before closing the session due to inactivity.' },
      },
      { key: '_divider_privacy', type: 'divider', label: { es: 'Privacidad', en: 'Privacy' } },
      {
        key: 'WHATSAPP_PRIVACY_LAST_SEEN',
        type: 'select',
        label: { es: 'Ultima conexion', en: 'Last seen' },
        info: { es: 'Quien puede ver tu ultima conexion (vacio = no cambiar)', en: 'Who can see your last seen (empty = dont change)' },
        options: [
          { value: '', label: 'No cambiar' },
          { value: 'all', label: 'Todos' },
          { value: 'contacts', label: 'Contactos' },
          { value: 'none', label: 'Nadie' },
        ],
      },
      {
        key: 'WHATSAPP_PRIVACY_PROFILE_PIC',
        type: 'select',
        label: { es: 'Foto de perfil', en: 'Profile picture' },
        info: { es: 'Quien puede ver tu foto de perfil', en: 'Who can see your profile picture' },
        options: [
          { value: '', label: 'No cambiar' },
          { value: 'all', label: 'Todos' },
          { value: 'contacts', label: 'Contactos' },
          { value: 'none', label: 'Nadie' },
        ],
      },
      {
        key: 'WHATSAPP_PRIVACY_READ_RECEIPTS',
        type: 'boolean',
        label: { es: 'Confirmacion de lectura', en: 'Read receipts' },
        info: { es: 'Si se envian checks azules al leer mensajes', en: 'Whether blue checks are sent when reading messages' },
      },
      { key: '_divider_format', type: 'divider', label: { es: 'Formato de respuesta', en: 'Response format' } },
      {
        key: 'FORMAT_INSTRUCTIONS_WHATSAPP',
        type: 'textarea',
        label: { es: 'Instrucciones de formato', en: 'Format instructions' },
        info: { es: 'Instrucciones que el compositor usa para dar formato a las respuestas de WhatsApp. Dejar vacío para usar el default.', en: 'Instructions the compositor uses to format WhatsApp responses. Leave empty for default.' },
        rows: 6,
      },
    ],
    apiRoutes,
    connectionWizard: {
      title: { es: 'Conectar WhatsApp', en: 'Connect WhatsApp' },
      steps: [
        {
          title: { es: 'Prepara tu telefono', en: 'Prepare your phone' },
          instructions: {
            es: '<ol><li>Abre <strong>WhatsApp</strong> en tu telefono.</li><li>Ve a <strong>Ajustes</strong> (o Menu) > <strong>Dispositivos vinculados</strong>.</li><li>Toca <strong>Vincular un dispositivo</strong>.</li><li>Cuando se active la camara, haz clic en <strong>Siguiente</strong> para generar el QR.</li></ol>',
            en: '<ol><li>Open <strong>WhatsApp</strong> on your phone.</li><li>Go to <strong>Settings</strong> (or Menu) > <strong>Linked devices</strong>.</li><li>Tap <strong>Link a device</strong>.</li><li>When the camera activates, click <strong>Next</strong> to generate the QR.</li></ol>',
          },
        },
        {
          title: { es: 'Escanea el codigo QR', en: 'Scan the QR code' },
          instructions: {
            es: '<p>Apunta la camara de tu telefono al codigo QR que aparece abajo. La conexion se establecera automaticamente.</p>',
            en: '<p>Point your phone camera at the QR code below. The connection will be established automatically.</p>',
          },
        },
      ],
      verifyEndpoint: 'status',
      operationParams: {
        autoReconnect: { es: 'Reconexion automatica tras desconexion', en: 'Auto-reconnect after disconnection' },
        maxRetries: { es: 'Maximo de reintentos de reconexion', en: 'Max reconnection attempts' },
        retryIntervalMs: { es: 'Intervalo entre reintentos (ms)', en: 'Retry interval (ms)' },
      },
    },
  },

  async init(registry: Registry) {
    _registry = registry
    const config = registry.getConfig<WhatsAppFullConfig>('whatsapp')

    const db = registry.getDb()
    // Stable instance ID: survives container recreation across deploys.
    // Falls back to hostname only for local dev without INSTANCE_ID set.
    const instanceId = process.env.INSTANCE_ID || 'luna-default'

    adapter = new BaileysAdapter(config as import('./adapter.js').WhatsAppConfig, db, instanceId, {
      onConnected: async () => {
        if (_registry && !_registry.isActive('whatsapp')) {
          try {
            await _registry.activate('whatsapp')
          } catch { /* already active or other issue */ }
        }
      },
      onStatusChange: async (status, connectedNumber) => {
        try {
          await configStore.set(db, 'WHATSAPP_CONNECTION_STATUS', status, false)
          await configStore.set(db, 'WHATSAPP_CONNECTED_NUMBER', connectedNumber ?? '', false)
        } catch (err) {
          // Non-critical — log and continue
          const pino = await import('pino')
          pino.default({ name: 'whatsapp:manifest' }).warn({ err }, 'Failed to persist connection metadata')
        }
      },
    })

    // Register hook: when pipeline sends a message for whatsapp channel
    registry.addHook('whatsapp', 'message:send', async (payload) => {
      if (payload.channel !== 'whatsapp') return
      if (!adapter) return

      const result = await adapter.sendMessage(payload.to, {
        to: payload.to,
        content: {
          type: payload.content.type,
          text: payload.content.text,
          mediaUrl: payload.content.mediaUrl,
          caption: payload.content.caption,
          audioBuffer: payload.content.audioBuffer,
          audioDurationSeconds: payload.content.audioDurationSeconds,
          ptt: payload.content.ptt,
        },
        quotedRaw: payload.quotedRaw,
      })

      await registry.runHook('message:sent', {
        channel: 'whatsapp',
        to: payload.to,
        channelMessageId: result.channelMessageId,
        success: result.success,
      })
    })

    // Presence: show "typing..." when engine is composing
    registry.addHook('whatsapp', 'channel:composing', async (payload) => {
      if (payload.channel !== 'whatsapp') return
      if (!adapter) return
      await adapter.getPresenceManager().sendComposing(payload.to)
    })

    // Presence: clear typing after all messages sent
    registry.addHook('whatsapp', 'channel:send_complete', async (payload) => {
      if (payload.channel !== 'whatsapp') return
      if (!adapter) return
      await adapter.getPresenceManager().sendPaused(payload.to)
    })

    // ── Channel Config Service ──
    // Provides runtime config to the engine. Engine reads via registry.getOptional().
    // Values are always fresh: buildChannelConfig() reads current config on each call.
    const channelConfigService = {
      get: () => buildChannelConfig(config),
    }
    registry.provide('channel-config:whatsapp', channelConfigService)

    // ── Message Batcher ──
    const dispatchBatch = async (messages: IncomingMessage[]) => {
      if (messages.length === 0) return
      const base = messages[0]!
      if (messages.length > 1) {
        const allTexts = messages
          .map(m => m.content.text ?? '')
          .filter(t => t.length > 0)
        base.content = { ...base.content, text: allTexts.join('\n') }
        manifestLogger.info({ from: base.from, count: messages.length }, 'Batched messages concatenated')
      }
      await registry.runHook('message:incoming', {
        id: base.id, channelName: base.channelName,
        channelMessageId: base.channelMessageId, from: base.from,
        timestamp: base.timestamp, content: base.content, raw: base.raw,
      })
      schedulePrecloseFollowup(base.from, config, registry)
    }

    batcher = new MessageBatcher(config.WHATSAPP_BATCH_WAIT_SECONDS, dispatchBatch)

    // Register message handler: incoming messages → batcher
    adapter.onMessage(async (msg) => {
      if (batcher) {
        batcher.add(msg)
      } else {
        await registry.runHook('message:incoming', {
          id: msg.id, channelName: msg.channelName,
          channelMessageId: msg.channelMessageId, from: msg.from,
          timestamp: msg.timestamp, content: msg.content, raw: msg.raw,
        })
      }
    })

    // Reschedule pre-close follow-up on every sent message (extends session activity)
    registry.addHook('whatsapp', 'message:sent', async (payload) => {
      if (payload.channel !== 'whatsapp') return
      schedulePrecloseFollowup(payload.to, config, registry)
    })

    // ── Hot-reload: re-read config when console applies changes ──
    registry.addHook('whatsapp', 'console:config_applied', async () => {
      const fresh = registry.getConfig<WhatsAppFullConfig>('whatsapp')
      // Update mutable references so all closures see the new values
      Object.assign(config, fresh)
      // Update batcher wait time
      if (batcher) batcher.updateWaitSeconds(fresh.WHATSAPP_BATCH_WAIT_SECONDS)
      manifestLogger.info('WhatsApp config hot-reloaded')
    })

    // Expose adapter as service for other modules
    registry.provide('whatsapp:adapter', adapter)

    // Auto-connect
    await adapter.initialize()
  },

  async stop() {
    if (batcher) {
      batcher.clearAll()
      batcher = null
    }
    // Clear all pre-close timers
    for (const timer of precloseTimers.values()) {
      clearTimeout(timer)
    }
    precloseTimers.clear()
    if (adapter) {
      await adapter.shutdown()
      adapter = null
    }
    _registry = null
  },
}

// ── Config type ──

interface WhatsAppFullConfig {
  WHATSAPP_RECONNECT_INTERVAL_MS: number
  WHATSAPP_MAX_RECONNECT_ATTEMPTS: number
  WHATSAPP_AVISO_TRIGGER_MS: number
  WHATSAPP_AVISO_HOLD_MS: number
  WHATSAPP_AVISO_MESSAGE: string
  WHATSAPP_RATE_LIMIT_HOUR: number
  WHATSAPP_RATE_LIMIT_DAY: number
  WHATSAPP_MARK_ONLINE: boolean
  WHATSAPP_REJECT_CALLS: boolean
  WHATSAPP_REJECT_CALL_MESSAGE: string
  WHATSAPP_PRIVACY_LAST_SEEN: string
  WHATSAPP_PRIVACY_PROFILE_PIC: string
  WHATSAPP_PRIVACY_STATUS: string
  WHATSAPP_PRIVACY_READ_RECEIPTS: boolean
  WHATSAPP_AGENT_NAME: string
  WHATSAPP_BATCH_WAIT_SECONDS: number
  WHATSAPP_SESSION_TIMEOUT_HOURS: number
  WHATSAPP_PRECLOSE_FOLLOWUP_HOURS: number
  WHATSAPP_PRECLOSE_MESSAGE: string
}

/**
 * Build ChannelRuntimeConfig from WhatsApp module config.
 * The engine reads this via registry.getOptional('channel-config:whatsapp').
 *
 * Pattern for other channels:
 * 1. Define your params in your module's configSchema
 * 2. In init(): registry.provide('channel-config:{name}', { get: () => buildConfig(cfg) })
 * 3. Engine calls svc.get() to obtain ChannelRuntimeConfig
 */
function buildChannelConfig(cfg: WhatsAppFullConfig): import('../../channels/types.js').ChannelRuntimeConfig {
  return {
    rateLimitHour: cfg.WHATSAPP_RATE_LIMIT_HOUR,
    rateLimitDay: cfg.WHATSAPP_RATE_LIMIT_DAY,
    avisoTriggerMs: cfg.WHATSAPP_AVISO_TRIGGER_MS,
    avisoHoldMs: cfg.WHATSAPP_AVISO_HOLD_MS,
    avisoMessages: cfg.WHATSAPP_AVISO_MESSAGE ? [cfg.WHATSAPP_AVISO_MESSAGE] : [],
    sessionTimeoutMs: cfg.WHATSAPP_SESSION_TIMEOUT_HOURS * 3600000,
    batchWaitSeconds: cfg.WHATSAPP_BATCH_WAIT_SECONDS,
    precloseFollowupMs: cfg.WHATSAPP_PRECLOSE_FOLLOWUP_HOURS * 3600000,
    precloseFollowupMessage: cfg.WHATSAPP_PRECLOSE_MESSAGE,
  }
}

/**
 * Schedule a pre-close follow-up reminder for a contact.
 * Reads config dynamically so hot-reload changes take effect.
 */
function schedulePrecloseFollowup(
  contactId: string,
  config: WhatsAppFullConfig,
  registry: Registry,
): void {
  const existing = precloseTimers.get(contactId)
  if (existing) clearTimeout(existing)

  const precloseHours = config.WHATSAPP_PRECLOSE_FOLLOWUP_HOURS
  const sessionTimeoutHours = config.WHATSAPP_SESSION_TIMEOUT_HOURS
  if (precloseHours <= 0 || precloseHours >= sessionTimeoutHours) return

  const delayMs = (sessionTimeoutHours - precloseHours) * 3600000

  const timer = setTimeout(async () => {
    precloseTimers.delete(contactId)
    try {
      manifestLogger.info({ contactId, precloseHours }, 'Sending pre-close follow-up')
      await registry.runHook('message:send', {
        channel: 'whatsapp',
        to: contactId,
        content: { type: 'text', text: config.WHATSAPP_PRECLOSE_MESSAGE },
      })
    } catch (err) {
      manifestLogger.warn({ err, contactId }, 'Failed to send pre-close follow-up')
    }
  }, delayMs)

  precloseTimers.set(contactId, timer)
}

export default manifest
