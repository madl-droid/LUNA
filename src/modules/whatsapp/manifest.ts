// LUNA — Module: whatsapp
// Canal WhatsApp vía Baileys (conexión directa).
// Auth state stored in PostgreSQL — no filesystem credentials.

import { z } from 'zod'
import type { ModuleManifest, ApiRoute } from '../../kernel/types.js'
import type { Registry } from '../../kernel/registry.js'
import { jsonResponse } from '../../kernel/http-helpers.js'
import { numEnv, numEnvMin, boolEnv } from '../../kernel/config-helpers.js'
import { BaileysAdapter } from './adapter.js'
import { MessageBatcher } from '../../channels/message-batcher.js'
import * as configStore from '../../kernel/config-store.js'
import QRCode from 'qrcode'

import pino from 'pino'
import type { IncomingMessage } from '../../channels/types.js'

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
      const { hasAuthCreds: checkCreds } = await import('./pg-auth-state.js')
      let hasCreds = false
      try {
        const pool = _registry?.getDb()
        if (pool) hasCreds = await checkCreds(pool, adapter.instanceId)
      } catch { /* ignore */ }
      jsonResponse(res, 200, {
        status: state.status,
        qrDataUrl,
        lastDisconnectReason: state.lastDisconnectReason,
        connectedNumber: state.connectedNumber,
        moduleEnabled,
        hasCreds,
        reconnectAttempt: state.reconnectAttempt,
        nextRetryAt: state.nextRetryAt,
      })
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
  {
    method: 'POST',
    path: 'force-reconnect',
    handler: async (_req, res) => {
      if (!adapter) {
        jsonResponse(res, 400, { error: 'WhatsApp adapter not initialized' })
        return
      }
      try {
        await adapter.forceReconnect()
        jsonResponse(res, 200, { ok: true, status: adapter.getState().status })
      } catch (err) {
        jsonResponse(res, 500, { error: 'Failed to reconnect: ' + String(err) })
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
    // Aviso de proceso (ack message when response is slow)
    WHATSAPP_AVISO_TRIGGER_MS: numEnv(3000),
    WHATSAPP_AVISO_HOLD_MS: numEnv(2000),
    WHATSAPP_AVISO_MESSAGE: z.string().default('Un momento, estoy revisando eso...'),
    // Socket tuning
    WHATSAPP_MARK_ONLINE: boolEnv(true),
    WHATSAPP_REJECT_CALLS: boolEnv(true),
    // Privacy
    WHATSAPP_PRIVACY_LAST_SEEN: boolEnv(false),
    WHATSAPP_PRIVACY_PROFILE_PIC: z.string().default('all'),
    WHATSAPP_PRIVACY_STATUS: z.string().default('all'),
    WHATSAPP_PRIVACY_READ_RECEIPTS: boolEnv(true),
    // Message batching
    WHATSAPP_BATCH_ENABLED: boolEnv(true),
    WHATSAPP_BATCH_WAIT_SECONDS: numEnvMin(10, 30),
    // Session inactivity timeout (hours)
    WHATSAPP_SESSION_TIMEOUT_HOURS: numEnvMin(3, 24),
    // Pre-close follow-up
    WHATSAPP_PRECLOSE_ENABLED: boolEnv(true),
    WHATSAPP_PRECLOSE_FOLLOWUP_HOURS: numEnvMin(0, 1),
    WHATSAPP_PRECLOSE_MESSAGE: z.string().default('¿Sigues ahí? Tu sesión se cerrará pronto por inactividad. Si necesitas algo más, escríbeme.'),
    // Missed messages
    WHATSAPP_MISSED_MSG_ENABLED: boolEnv(true),
    WHATSAPP_MISSED_MSG_WINDOW_MIN: numEnv(15),
    // Attachment processing
    WHATSAPP_ATT_IMAGES: boolEnv(true),
    WHATSAPP_ATT_DOCUMENTS: boolEnv(true),
    WHATSAPP_ATT_AUDIO: boolEnv(true),
    WHATSAPP_ATT_VIDEO: boolEnv(false),
    WHATSAPP_ATT_SPREADSHEETS: boolEnv(true),
    WHATSAPP_ATT_TEXT: boolEnv(true),
    // Response format
    WHATSAPP_FORMAT_ADVANCED: boolEnv(false),
    FORMAT_INSTRUCTIONS_WHATSAPP: z.string().default(''),
    WHATSAPP_FORMAT_TONE: z.string().default('ninguno'),
    WHATSAPP_FORMAT_MAX_SENTENCES: numEnv(2),
    WHATSAPP_FORMAT_MAX_PARAGRAPHS: numEnv(2),
    WHATSAPP_FORMAT_EMOJI_LEVEL: z.string().default('bajo'),
    WHATSAPP_FORMAT_TYPOS_ENABLED: boolEnv(false),
    WHATSAPP_FORMAT_TYPOS_INTENSITY: z.string().default('0'),
    WHATSAPP_FORMAT_TYPOS_TYPES: z.string().default(''),
    WHATSAPP_FORMAT_OPENING_SIGNS: z.string().default('nunca'),
    WHATSAPP_FORMAT_AUDIO_ENABLED: boolEnv(false),
    WHATSAPP_FORMAT_VOICE_STYLES: boolEnv(false),
    WHATSAPP_FORMAT_EXAMPLE_1: z.string().default(''),
    WHATSAPP_FORMAT_EXAMPLE_2: z.string().default(''),
    WHATSAPP_FORMAT_EXAMPLE_3: z.string().default(''),
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
    // Tab metadata for channel settings page
    tabs: [
      { id: 'behavior', label: { es: 'Comportamiento', en: 'Behavior' } },
      { id: 'format', label: { es: 'Formato de respuesta', en: 'Response format' } },
      { id: 'attachments', label: { es: 'Adjuntos', en: 'Attachments' } },
    ] as Array<{ id: string; label: { es: string; en: string } }>,
    fields: [
      // ═══ TAB: Comportamiento ═══
      { key: '_tab_behavior', type: 'divider', label: { es: 'Comportamiento', en: 'Behavior' }, tab: 'behavior' },
      // Row 1: 3-column switch grid
      { key: 'WHATSAPP_PRIVACY_READ_RECEIPTS', type: 'boolean', label: { es: 'Confirmacion de lectura', en: 'Read receipts' }, description: { es: 'Enviar ticks azules', en: 'Send blue ticks' }, icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>', tab: 'behavior', width: 'third' },
      { key: 'WHATSAPP_PRIVACY_LAST_SEEN', type: 'boolean', label: { es: 'Ultima conexion', en: 'Last seen' }, description: { es: 'Mostrar hora de conexion', en: 'Show connection time' }, icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>', tab: 'behavior', width: 'third' },
      { key: 'WHATSAPP_MARK_ONLINE', type: 'boolean', label: { es: 'En linea', en: 'Online' }, description: { es: 'Aparecer en linea al conectar', en: 'Appear online on connect' }, icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>', tab: 'behavior', width: 'third' },
      { key: 'WHATSAPP_MISSED_MSG_ENABLED', type: 'boolean', label: { es: 'Mensajes perdidos', en: 'Missed messages' }, description: { es: 'Procesar mensajes offline', en: 'Process offline messages' }, icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>', tab: 'behavior', width: 'third' },
      { key: 'WHATSAPP_BATCH_ENABLED', type: 'boolean', label: { es: 'Agrupar mensajes', en: 'Group messages' }, description: { es: 'Acumular antes de procesar', en: 'Accumulate before processing' }, icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2"/><line x1="12" y1="12" x2="12" y2="16"/><line x1="10" y1="14" x2="14" y2="14"/></svg>', tab: 'behavior', width: 'third' },
      { key: 'WHATSAPP_PRECLOSE_ENABLED', type: 'boolean', label: { es: 'Follow-up pre-cierre', en: 'Pre-close follow-up' }, description: { es: 'Recordatorio antes de cerrar', en: 'Reminder before closing' }, icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>', tab: 'behavior', width: 'third' },
      // Row 2: 2-column selectors
      { key: '_divider_selectors', type: 'divider', label: { es: 'Ajustes generales', en: 'General settings' }, tab: 'behavior' },
      { key: 'WHATSAPP_SESSION_TIMEOUT_HOURS', type: 'number', label: { es: 'Tiempo de vida de sesion', en: 'Session lifetime' }, info: { es: 'Horas de inactividad para cerrar la sesion (minimo 3)', en: 'Inactivity hours to close the session (min 3)' }, min: 3, max: 24, unit: 'horas', width: 'half', tab: 'behavior' },
      { key: 'WHATSAPP_BATCH_WAIT_SECONDS', type: 'number', label: { es: 'Tiempo de agrupado', en: 'Grouping time' }, info: { es: 'Segundos para acumular mensajes antes de procesar (10-90, multiplos de 10)', en: 'Seconds to collect messages before processing (10-90, multiples of 10)' }, min: 10, max: 90, step: 10, unit: 'segundos', width: 'half', tab: 'behavior', fieldType: 'volume' },
      { key: 'WHATSAPP_MISSED_MSG_WINDOW_MIN', type: 'select', label: { es: 'Frecuencia busqueda mensajes', en: 'Missed messages frequency' }, info: { es: 'Ventana para procesar mensajes perdidos', en: 'Window to process missed messages' }, width: 'half', tab: 'behavior', options: [{ value: '5', label: '5 min' }, { value: '15', label: '15 min' }, { value: '30', label: '30 min' }, { value: '60', label: '60 min' }] },
      { key: 'WHATSAPP_PRECLOSE_FOLLOWUP_HOURS', type: 'number', label: { es: 'Tiempo follow-up pre-cierre', en: 'Pre-close follow-up time' }, info: { es: 'Horas antes del cierre para enviar recordatorio (max: timeout sesion - 2h)', en: 'Hours before close to send reminder (max: session timeout - 2h)' }, min: 0, max: 22, unit: 'horas', width: 'half', tab: 'behavior' },
      { key: 'WHATSAPP_AVISO_TRIGGER_MS', type: 'number', label: { es: 'Tiempo para ACK', en: 'Time to ACK' }, info: { es: 'Minutos de espera antes de enviar mensaje de espera', en: 'Minutes to wait before sending wait message' }, min: 60000, max: 1800000, step: 60000, unit: 'minutos', width: 'half', tab: 'behavior', fieldType: 'volume' },
      { key: 'WHATSAPP_AVISO_HOLD_MS', type: 'number', label: { es: 'Tiempo post-ACK', en: 'Post-ACK time' }, info: { es: 'Minutos de pausa despues del ACK antes de enviar respuesta real', en: 'Minutes to pause after ACK before sending real response' }, min: 60000, max: 600000, step: 60000, unit: 'minutos', width: 'half', tab: 'behavior', fieldType: 'volume' },
      // Pre-close message
      { key: 'WHATSAPP_PRECLOSE_MESSAGE', type: 'text', label: { es: 'Mensaje pre-cierre', en: 'Pre-close message' }, info: { es: 'Texto del recordatorio antes de cerrar la sesion', en: 'Reminder text before closing session' }, tab: 'behavior' },
      // ACK config
      { key: 'WHATSAPP_AVISO_MESSAGE', type: 'text', label: { es: 'Mensaje de ACK', en: 'ACK message' }, info: { es: 'Texto que se envia mientras se procesa la respuesta', en: 'Text sent while processing the response' }, tab: 'behavior' },

      // ═══ TAB: Formato de respuesta ═══
      { key: '_tab_format', type: 'divider', label: { es: 'Formato de respuesta', en: 'Response format' }, tab: 'format' },
      { key: 'WHATSAPP_FORMAT_ADVANCED', type: 'boolean', label: { es: 'Prompting avanzado', en: 'Advanced prompting' }, info: { es: 'Activa el editor de texto para personalizar el prompt de formato manualmente', en: 'Enable text editor to manually customize the format prompt' }, tab: 'format' },
      { key: 'FORMAT_INSTRUCTIONS_WHATSAPP', type: 'textarea', label: { es: 'Instrucciones de formato', en: 'Format instructions' }, rows: 12, tab: 'format', visibleWhen: { key: 'WHATSAPP_FORMAT_ADVANCED', value: 'true' }, fieldType: 'code-editor' as never },
      // Form fields (hidden when advanced prompting is ON)
      { key: 'WHATSAPP_FORMAT_TONE', type: 'select', label: { es: 'Tono', en: 'Tone' }, tab: 'format', visibleWhen: { key: 'WHATSAPP_FORMAT_ADVANCED', value: 'false' }, options: [{ value: 'formal', label: 'Formal' }, { value: 'informal', label: 'Informal' }, { value: 'amigable', label: { es: 'Amigable', en: 'Friendly' } }, { value: 'directo', label: { es: 'Directo', en: 'Direct' } }, { value: 'conversador', label: { es: 'Conversador', en: 'Conversational' } }, { value: 'ninguno', label: { es: 'Ninguno (el modelo decide)', en: 'None (model decides)' } }] },
      { key: 'WHATSAPP_FORMAT_MAX_SENTENCES', type: 'number', label: { es: 'Max oraciones por parrafo', en: 'Max sentences per paragraph' }, min: 1, max: 10, width: 'half', tab: 'format', visibleWhen: { key: 'WHATSAPP_FORMAT_ADVANCED', value: 'false' } },
      { key: 'WHATSAPP_FORMAT_MAX_PARAGRAPHS', type: 'number', label: { es: 'Max parrafos por respuesta', en: 'Max paragraphs per response' }, min: 1, max: 10, width: 'half', tab: 'format', visibleWhen: { key: 'WHATSAPP_FORMAT_ADVANCED', value: 'false' } },
      { key: 'WHATSAPP_FORMAT_EMOJI_LEVEL', type: 'select', label: { es: 'Uso de emojis', en: 'Emoji usage' }, tab: 'format', visibleWhen: { key: 'WHATSAPP_FORMAT_ADVANCED', value: 'false' }, options: [{ value: 'nunca', label: { es: 'Nunca', en: 'Never' } }, { value: 'bajo', label: { es: 'Bajo', en: 'Low' } }, { value: 'moderado', label: { es: 'Moderado', en: 'Moderate' } }, { value: 'alto', label: { es: 'Alto', en: 'High' } }] },
      { key: 'WHATSAPP_FORMAT_TYPOS_ENABLED', type: 'boolean', label: { es: 'Errores de escritura', en: 'Typos' }, info: { es: 'Introduce errores de escritura para mayor naturalidad', en: 'Introduce typos for more natural conversation' }, tab: 'format', visibleWhen: { key: 'WHATSAPP_FORMAT_ADVANCED', value: 'false' } },
      { key: 'WHATSAPP_FORMAT_TYPOS_INTENSITY', type: 'text', label: { es: 'Intensidad de errores', en: 'Typo intensity' }, info: { es: 'De 0 (bajo) a 1 (alto), con 1 decimal', en: 'From 0 (low) to 1 (high), with 1 decimal' }, tab: 'format', visibleWhen: { key: 'WHATSAPP_FORMAT_ADVANCED', value: 'false' } },
      { key: 'WHATSAPP_FORMAT_TYPOS_TYPES', type: 'text', label: { es: 'Tipos de errores', en: 'Typo types' }, info: { es: 'Separados por coma: tildes,invertidas,doble_letra', en: 'Comma-separated: tildes,inverted,double_letter' }, tab: 'format', visibleWhen: { key: 'WHATSAPP_FORMAT_ADVANCED', value: 'false' } },
      { key: 'WHATSAPP_FORMAT_OPENING_SIGNS', type: 'select', label: { es: 'Signos de apertura', en: 'Opening signs' }, tab: 'format', visibleWhen: { key: 'WHATSAPP_FORMAT_ADVANCED', value: 'false' }, options: [{ value: 'nunca', label: { es: 'Nunca', en: 'Never' } }, { value: 'inicio', label: { es: 'Al inicio', en: 'At start' } }, { value: 'ambos', label: { es: 'Al inicio y final', en: 'Start and end' } }] },
      { key: 'WHATSAPP_FORMAT_AUDIO_ENABLED', type: 'boolean', label: { es: 'Enviar audios', en: 'Send audio' }, info: { es: 'Permite al agente enviar mensajes como notas de voz', en: 'Allow agent to send messages as voice notes' }, tab: 'format', visibleWhen: { key: 'WHATSAPP_FORMAT_ADVANCED', value: 'false' } },
      { key: 'WHATSAPP_FORMAT_EXAMPLE_1', type: 'text', label: { es: 'Ejemplo de respuesta 1', en: 'Response example 1' }, tab: 'format', visibleWhen: { key: 'WHATSAPP_FORMAT_ADVANCED', value: 'false' } },
      { key: 'WHATSAPP_FORMAT_EXAMPLE_2', type: 'text', label: { es: 'Ejemplo de respuesta 2', en: 'Response example 2' }, tab: 'format', visibleWhen: { key: 'WHATSAPP_FORMAT_ADVANCED', value: 'false' } },
      { key: 'WHATSAPP_FORMAT_EXAMPLE_3', type: 'text', label: { es: 'Ejemplo de respuesta 3', en: 'Response example 3' }, tab: 'format', visibleWhen: { key: 'WHATSAPP_FORMAT_ADVANCED', value: 'false' } },

      // ═══ TAB: Adjuntos ═══
      { key: '_tab_attachments', type: 'divider', label: { es: 'Adjuntos', en: 'Attachments' }, tab: 'attachments' },
      { key: 'WHATSAPP_ATT_IMAGES', type: 'boolean', label: { es: 'Procesar imagenes', en: 'Process images' }, description: { es: 'JPEG, PNG, WebP, GIF', en: 'JPEG, PNG, WebP, GIF' }, icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>', tab: 'attachments', width: 'third' },
      { key: 'WHATSAPP_ATT_DOCUMENTS', type: 'boolean', label: { es: 'Procesar documentos', en: 'Process documents' }, description: { es: 'PDF, Word, otros', en: 'PDF, Word, others' }, icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>', tab: 'attachments', width: 'third' },
      { key: 'WHATSAPP_ATT_AUDIO', type: 'boolean', label: { es: 'Procesar audio', en: 'Process audio' }, description: { es: 'Notas de voz y audios', en: 'Voice notes and audio' }, icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/></svg>', tab: 'attachments', width: 'third' },
      { key: 'WHATSAPP_ATT_VIDEO', type: 'boolean', label: { es: 'Procesar videos', en: 'Process videos' }, description: { es: 'Videos recibidos por WhatsApp', en: 'Videos received via WhatsApp' }, icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>', tab: 'attachments', width: 'third' },
      { key: 'WHATSAPP_ATT_SPREADSHEETS', type: 'boolean', label: { es: 'Procesar hojas de calculo', en: 'Process spreadsheets' }, description: { es: 'Excel y CSV', en: 'Excel and CSV' }, icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/></svg>', tab: 'attachments', width: 'third' },
      { key: 'WHATSAPP_ATT_TEXT', type: 'boolean', label: { es: 'Procesar archivos de texto', en: 'Process text files' }, description: { es: '.txt, .md, .json', en: '.txt, .md, .json' }, icon: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>', tab: 'attachments', width: 'third' },
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
    // Read from kernel config (populated from env by kernel/config.ts).
    const { getEnv } = await import('../../kernel/config.js')
    const instanceId = getEnv('INSTANCE_ID') || 'luna-default'

    // ── Agent name: read from centralized prompts config ──
    const getAgentName = (): string => {
      const svc = registry.getOptional<import('../prompts/types.js').PromptsService>('prompts:service')
      if (svc) return svc.getAgentName()
      return 'Luna'
    }

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
    }, getAgentName)

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

      if (!result.success) {
        throw new Error(`WhatsApp send failed: ${result.error ?? 'unknown error'}`)
      }

      await registry.runHook('message:sent', {
        channel: 'whatsapp',
        to: payload.to,
        channelMessageId: result.channelMessageId,
        success: result.success,
      })
    })

    // Signal: ACK (delivery confirmation) — no-op for WhatsApp (Baileys handles delivery automatically)
    registry.addHook('whatsapp', 'channel:ack', async (payload) => {
      if (payload.channel !== 'whatsapp') return
      // Baileys sends delivery receipts automatically, no action needed
    })

    // Signal: READ (mark as read / blue ticks)
    registry.addHook('whatsapp', 'channel:read', async (payload) => {
      if (payload.channel !== 'whatsapp') return
      if (!adapter) return
      if (payload.messageKeys && Array.isArray(payload.messageKeys)) {
        await adapter.markRead(payload.messageKeys as Array<{ remoteJid: string; id: string; fromMe: boolean }>)
      }
    })

    // Presence: show "typing..." or "recording..." when engine is composing
    registry.addHook('whatsapp', 'channel:composing', async (payload) => {
      if (payload.channel !== 'whatsapp') return
      if (!adapter) return
      if (payload.mode === 'recording') {
        await adapter.getPresenceManager().sendRecording(payload.to)
      } else {
        await adapter.getPresenceManager().sendComposing(payload.to)
      }
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
      get: () => {
        const bufferTurns = registry.getOptional<{ get(): { instant: number; async: number; voice: number } }>('memory:buffer-turns')?.get()
        return {
          ...buildChannelConfig(config),
          historyTurns: bufferTurns?.instant ?? 25,
        }
      },
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
        resolvedPhone: base.resolvedPhone, senderName: base.senderName,
        timestamp: base.timestamp, content: base.content, raw: base.raw,
      })
      schedulePrecloseFollowup(base.from, config, registry)
    }

    if (config.WHATSAPP_BATCH_ENABLED) {
      batcher = new MessageBatcher(config.WHATSAPP_BATCH_WAIT_SECONDS, dispatchBatch)
    }

    // Register message handler: incoming messages → batcher (if enabled) or direct dispatch
    adapter.onMessage(async (msg) => {
      const incoming: IncomingMessage = {
        id: msg.id,
        channelName: msg.channelName as IncomingMessage['channelName'],
        channelMessageId: msg.channelMessageId,
        from: msg.from,
        resolvedPhone: msg.resolvedPhone,
        senderName: msg.senderName,
        timestamp: msg.timestamp,
        content: { ...msg.content, type: (msg.content.type || 'text') as IncomingMessage['content']['type'] },
        raw: msg.raw,
      }
      if (batcher) {
        batcher.add(incoming)
      } else {
        await dispatchBatch([incoming])
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
      // Re-apply privacy settings on WhatsApp server (e.g. read receipts toggle)
      if (adapter) {
        adapter.reapplyPrivacySettings().catch(err =>
          manifestLogger.warn({ err }, 'Failed to re-apply privacy settings after config change'),
        )
      }
      // Update batcher: create/destroy based on toggle, update wait time
      if (fresh.WHATSAPP_BATCH_ENABLED && !batcher) {
        batcher = new MessageBatcher(fresh.WHATSAPP_BATCH_WAIT_SECONDS, dispatchBatch)
        manifestLogger.info('Message batcher enabled')
      } else if (!fresh.WHATSAPP_BATCH_ENABLED && batcher) {
        batcher.clearAll()
        batcher = null
        manifestLogger.info('Message batcher disabled')
      } else if (batcher) {
        batcher.updateWaitSeconds(fresh.WHATSAPP_BATCH_WAIT_SECONDS)
      }
      manifestLogger.info('WhatsApp config hot-reloaded')
    })

    // Expose adapter as service for other modules
    registry.provide('whatsapp:adapter', adapter)

    // Auto-connect only if we have saved credentials (previous session).
    // If no creds, wait for user to click Connect in the wizard to avoid
    // generating QR codes that nobody will scan (wastes connection attempts).
    const { hasAuthCreds } = await import('./pg-auth-state.js')
    if (await hasAuthCreds(db, adapter.instanceId)) {
      manifestLogger.info('Saved credentials found, auto-connecting')
      await adapter.initialize()
    } else {
      manifestLogger.info('No saved credentials, waiting for user to connect via wizard')
    }
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
  WHATSAPP_AVISO_TRIGGER_MS: number
  WHATSAPP_AVISO_HOLD_MS: number
  WHATSAPP_AVISO_MESSAGE: string
  WHATSAPP_MARK_ONLINE: boolean
  WHATSAPP_REJECT_CALLS: boolean
  WHATSAPP_PRIVACY_LAST_SEEN: boolean
  WHATSAPP_PRIVACY_PROFILE_PIC: string
  WHATSAPP_PRIVACY_STATUS: string
  WHATSAPP_PRIVACY_READ_RECEIPTS: boolean
  WHATSAPP_BATCH_ENABLED: boolean
  WHATSAPP_BATCH_WAIT_SECONDS: number
  WHATSAPP_SESSION_TIMEOUT_HOURS: number
  WHATSAPP_PRECLOSE_ENABLED: boolean
  WHATSAPP_PRECLOSE_FOLLOWUP_HOURS: number
  WHATSAPP_PRECLOSE_MESSAGE: string
  WHATSAPP_MISSED_MSG_ENABLED: boolean
  WHATSAPP_MISSED_MSG_WINDOW_MIN: number
  // Attachment config
  WHATSAPP_ATT_IMAGES: boolean
  WHATSAPP_ATT_DOCUMENTS: boolean
  WHATSAPP_ATT_AUDIO: boolean
  WHATSAPP_ATT_VIDEO: boolean
  WHATSAPP_ATT_SPREADSHEETS: boolean
  WHATSAPP_ATT_TEXT: boolean
  // Response format
  WHATSAPP_FORMAT_ADVANCED: boolean
  FORMAT_INSTRUCTIONS_WHATSAPP: string
  WHATSAPP_FORMAT_TONE: string
  WHATSAPP_FORMAT_MAX_SENTENCES: number
  WHATSAPP_FORMAT_MAX_PARAGRAPHS: number
  WHATSAPP_FORMAT_EMOJI_LEVEL: string
  WHATSAPP_FORMAT_TYPOS_ENABLED: boolean
  WHATSAPP_FORMAT_TYPOS_INTENSITY: string
  WHATSAPP_FORMAT_TYPOS_TYPES: string
  WHATSAPP_FORMAT_OPENING_SIGNS: string
  WHATSAPP_FORMAT_AUDIO_ENABLED: boolean
  WHATSAPP_FORMAT_VOICE_STYLES: boolean
  WHATSAPP_FORMAT_EXAMPLE_1: string
  WHATSAPP_FORMAT_EXAMPLE_2: string
  WHATSAPP_FORMAT_EXAMPLE_3: string
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
    rateLimitHour: 0,
    rateLimitDay: 200,
    avisoTriggerMs: cfg.WHATSAPP_AVISO_TRIGGER_MS,
    avisoHoldMs: cfg.WHATSAPP_AVISO_HOLD_MS,
    avisoMessages: cfg.WHATSAPP_AVISO_MESSAGE ? [cfg.WHATSAPP_AVISO_MESSAGE] : [],
    avisoStyle: 'casual' as import('../../channels/types.js').AvisoStyle,
    sessionTimeoutMs: cfg.WHATSAPP_SESSION_TIMEOUT_HOURS * 3600000,
    batchWaitSeconds: cfg.WHATSAPP_BATCH_WAIT_SECONDS,
    precloseFollowupMs: cfg.WHATSAPP_PRECLOSE_FOLLOWUP_HOURS * 3600000,
    precloseFollowupMessage: cfg.WHATSAPP_PRECLOSE_MESSAGE,
    typingDelayMsPerChar: 50,
    typingDelayMinMs: 500,
    typingDelayMaxMs: 3000,
    channelType: 'instant',
    supportsTypingIndicator: true,
    ttsEnabled: cfg.WHATSAPP_FORMAT_AUDIO_ENABLED,
    antiSpamMaxPerWindow: 5,
    antiSpamWindowMs: 60000,
    floodThreshold: 20,
    historyTurns: 0, // placeholder — overridden in channel-config service get() with memory:buffer-turns
    attachments: buildAttachmentConfig(cfg),
  }
}

/** Build per-channel attachment config from WhatsApp config fields */
function buildAttachmentConfig(cfg: WhatsAppFullConfig): import('../../engine/attachments/types.js').ChannelAttachmentConfig {
  const categories: import('../../engine/attachments/types.js').AttachmentCategory[] = []
  if (cfg.WHATSAPP_ATT_IMAGES) categories.push('images')
  if (cfg.WHATSAPP_ATT_DOCUMENTS) categories.push('documents')
  if (cfg.WHATSAPP_ATT_AUDIO) categories.push('audio')
  if (cfg.WHATSAPP_ATT_VIDEO) categories.push('video')
  if (cfg.WHATSAPP_ATT_SPREADSHEETS) categories.push('spreadsheets')
  if (cfg.WHATSAPP_ATT_TEXT) categories.push('text')
  return {
    enabledCategories: categories,
    maxFileSizeMb: 25,
    maxAttachmentsPerMessage: 5,
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
  // Respect the PRECLOSE_ENABLED toggle
  if (!config.WHATSAPP_PRECLOSE_ENABLED) return

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
