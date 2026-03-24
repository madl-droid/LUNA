// LUNA — Module: whatsapp
// Canal WhatsApp vía Baileys (conexión directa).
// Auth state stored in PostgreSQL — no filesystem credentials.

import { z } from 'zod'
import type { ModuleManifest, ApiRoute } from '../../kernel/types.js'
import type { Registry } from '../../kernel/registry.js'
import { jsonResponse } from '../../kernel/http-helpers.js'
import { numEnv, boolEnv } from '../../kernel/config-helpers.js'
import { BaileysAdapter } from './adapter.js'
import * as configStore from '../../kernel/config-store.js'
import QRCode from 'qrcode'

let adapter: BaileysAdapter | null = null
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
    ACK_WHATSAPP_TRIGGER_MS: numEnv(0),
    ACK_WHATSAPP_HOLD_MS: numEnv(1500),
    ACK_WHATSAPP_MESSAGE: z.string().default(''),
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
        key: 'ACK_WHATSAPP_TRIGGER_MS',
        type: 'number',
        label: { es: 'Tiempo para aviso (ms)', en: 'Acknowledgment trigger (ms)' },
        info: { es: 'Si la respuesta tarda mas de este tiempo, se envia un aviso automatico. 0 = desactivado.', en: 'If the response takes longer than this, an automatic acknowledgment is sent. 0 = disabled.' },
        width: 'half',
      },
      {
        key: 'ACK_WHATSAPP_HOLD_MS',
        type: 'number',
        label: { es: 'Pausa antes de respuesta (ms)', en: 'Hold before response (ms)' },
        info: { es: 'Tiempo que se retiene la respuesta real despues del aviso, para que no lleguen juntos.', en: 'Time the real response is held after the ack, so they don\'t arrive together.' },
        width: 'half',
      },
      {
        key: 'ACK_WHATSAPP_MESSAGE',
        type: 'text',
        label: { es: 'Mensaje de aviso', en: 'Acknowledgment message' },
        info: { es: 'Texto del aviso. Se envia automaticamente si la respuesta tarda.', en: 'Acknowledgment text. Sent automatically if the response is slow.' },
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
    const config = registry.getConfig<{
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
    }>('whatsapp')

    const db = registry.getDb()
    // Stable instance ID: survives container recreation across deploys.
    // Falls back to hostname only for local dev without INSTANCE_ID set.
    const instanceId = process.env.INSTANCE_ID || 'luna-default'

    adapter = new BaileysAdapter(config, db, instanceId, {
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

    // Register message handler: incoming messages → fire hook
    adapter.onMessage(async (msg) => {
      await registry.runHook('message:incoming', {
        id: msg.id,
        channelName: msg.channelName,
        channelMessageId: msg.channelMessageId,
        from: msg.from,
        timestamp: msg.timestamp,
        content: msg.content,
        raw: msg.raw,
      })
    })

    // Expose adapter as service for other modules
    registry.provide('whatsapp:adapter', adapter)

    // Auto-connect
    await adapter.initialize()
  },

  async stop() {
    if (adapter) {
      await adapter.shutdown()
      adapter = null
    }
    _registry = null
  },
}

export default manifest
