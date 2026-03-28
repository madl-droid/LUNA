// LUNA — Module: google-chat
// Canal Google Chat via webhook + Chat API (Service Account auth).

import { z } from 'zod'
import pino from 'pino'
import type { ModuleManifest, ApiRoute } from '../../kernel/types.js'
import type { Registry } from '../../kernel/registry.js'
import { jsonResponse, parseBody } from '../../kernel/http-helpers.js'
import { numEnv, numEnvMin, boolEnv } from '../../kernel/config-helpers.js'
import { GoogleChatAdapter } from './adapter.js'
import { MessageBatcher } from '../../channels/message-batcher.js'
import type { IncomingMessage } from '../../channels/types.js'
import type { GoogleChatConfig, ChatEvent, SetupGuideStep } from './types.js'
import type { PromptsService } from '../prompts/types.js'
import * as configStore from '../../kernel/config-store.js'

const logger = pino({ name: 'google-chat' })

let adapter: GoogleChatAdapter | null = null
let batcher: MessageBatcher | null = null
let _registry: Registry | null = null
// Map contact → last threadName (for reply-in-thread)
const lastThreadByContact = new Map<string, string>()

// ─── API Routes ─────────────────────────────────

const apiRoutes: ApiRoute[] = [
  // ── Webhook (Google Chat llama aquí) ──
  {
    method: 'POST',
    path: 'webhook',
    handler: async (req, res) => {
      if (!adapter || !_registry) {
        jsonResponse(res, 503, { error: 'Google Chat module not initialized' })
        return
      }

      const authHeader = req.headers['authorization'] as string | undefined
      if (!adapter.verifyWebhookToken(authHeader)) {
        jsonResponse(res, 401, { error: 'Unauthorized' })
        return
      }

      try {
        const event = await parseBody<ChatEvent>(req)
        if (!event || !event.type) {
          jsonResponse(res, 400, { error: 'Invalid event payload' })
          return
        }

        logger.debug({ eventType: event.type, space: event.space?.name }, 'Webhook event received')

        const normalized = await adapter.handleWebhookEvent(event)

        if (normalized) {
          // Store threadName for reply-in-thread when engine responds
          if (normalized.threadName) {
            lastThreadByContact.set(normalized.from, normalized.threadName)
          }

          const incomingMsg: IncomingMessage = {
            id: normalized.id,
            channelName: normalized.channelName as IncomingMessage['channelName'],
            channelMessageId: normalized.channelMessageId,
            from: normalized.from,
            timestamp: normalized.timestamp,
            content: { ...normalized.content, type: normalized.content.type as IncomingMessage['content']['type'] },
            raw: normalized.raw,
          }

          // Route through batcher if available (instant channel batching)
          if (batcher) {
            batcher.add(incomingMsg)
          } else {
            await _registry.runHook('message:incoming', incomingMsg)
          }
        }

        // Always 200 to avoid retries from Google
        jsonResponse(res, 200, {})
      } catch (err) {
        logger.error({ err }, 'Error processing webhook event')
        jsonResponse(res, 200, {})
      }
    },
  },

  // ── Status ──
  {
    method: 'GET',
    path: 'status',
    handler: async (_req, res) => {
      const moduleEnabled = _registry?.isActive('google-chat') ?? false
      if (!adapter) {
        jsonResponse(res, 200, {
          status: 'not_initialized',
          botEmail: null,
          activeSpaces: 0,
          moduleEnabled,
          configured: false,
        })
        return
      }
      const state = adapter.getState()
      jsonResponse(res, 200, { ...state, moduleEnabled, configured: true })
    },
  },

  // ── Validate Service Account Key (sin guardar) ──
  {
    method: 'POST',
    path: 'validate-key',
    handler: async (req, res) => {
      try {
        const body = await parseBody<{ key: string }>(req)
        if (!body?.key) {
          jsonResponse(res, 400, { error: 'Missing "key" field in request body' })
          return
        }

        const result = GoogleChatAdapter.validateServiceAccountKey(body.key)
        jsonResponse(res, 200, result)
      } catch (err) {
        jsonResponse(res, 400, {
          valid: false,
          projectId: null,
          clientEmail: null,
          clientId: null,
          errors: ['Error procesando la solicitud / Error processing request: ' + String(err)],
        })
      }
    },
  },

  // ── Test Connection (con credenciales ya guardadas) ──
  {
    method: 'POST',
    path: 'test-connection',
    handler: async (_req, res) => {
      if (!adapter) {
        jsonResponse(res, 200, {
          ok: false,
          status: 'not_initialized',
          botEmail: null,
          activeSpaces: 0,
          error: 'Primero configura el Service Account Key y guarda los cambios / First configure the Service Account Key and save changes',
        })
        return
      }
      const state = adapter.getState()
      jsonResponse(res, 200, {
        ok: state.status === 'connected',
        status: state.status,
        botEmail: state.botEmail,
        activeSpaces: state.activeSpaces,
        error: state.lastError,
      })
    },
  },

  // ── Setup Guide (instrucciones paso a paso) ──
  {
    method: 'GET',
    path: 'setup-guide',
    handler: async (_req, res) => {
      const state = adapter?.getState()
      const hasKey = !!(_registry?.getConfig<GoogleChatConfig>('google-chat').GOOGLE_CHAT_SERVICE_ACCOUNT_KEY)
      const isConnected = state?.status === 'connected'
      const hasSpaces = (state?.activeSpaces ?? 0) > 0

      // Build webhook URL from request host
      const webhookPath = '/console/api/google-chat/webhook'

      const steps: SetupGuideStep[] = [
        {
          step: 1,
          title: {
            es: 'Crear proyecto en Google Cloud',
            en: 'Create Google Cloud project',
          },
          description: {
            es: 'Ve a console.cloud.google.com, crea un proyecto nuevo (o usa uno existente) y habilita la "Google Chat API" desde la biblioteca de APIs.',
            en: 'Go to console.cloud.google.com, create a new project (or use an existing one) and enable the "Google Chat API" from the API library.',
          },
          done: hasKey, // If they have a key, they already have a project
        },
        {
          step: 2,
          title: {
            es: 'Crear Service Account',
            en: 'Create Service Account',
          },
          description: {
            es: 'En Google Cloud Console ve a IAM y administración > Cuentas de servicio > Crear cuenta de servicio. Dale un nombre descriptivo (ej: "luna-chat-bot"). Luego ve a la pestaña "Claves", crea una clave nueva tipo JSON y descarga el archivo.',
            en: 'In Google Cloud Console go to IAM & Admin > Service Accounts > Create Service Account. Give it a descriptive name (e.g., "luna-chat-bot"). Then go to the "Keys" tab, create a new JSON key and download the file.',
          },
          done: hasKey,
        },
        {
          step: 3,
          title: {
            es: 'Pegar el JSON aquí',
            en: 'Paste the JSON here',
          },
          description: {
            es: 'Abre el archivo .json descargado, copia TODO su contenido y pégalo en el campo "Service Account Key" de arriba. Haz clic en Guardar. El sistema validará automáticamente que el JSON sea correcto.',
            en: 'Open the downloaded .json file, copy ALL its content and paste it in the "Service Account Key" field above. Click Save. The system will automatically validate the JSON is correct.',
          },
          done: hasKey && isConnected,
        },
        {
          step: 4,
          title: {
            es: 'Configurar la Chat App en Google Cloud',
            en: 'Configure the Chat App in Google Cloud',
          },
          description: {
            es: `En Google Cloud Console ve a "APIs y servicios" > "Google Chat API" > pestaña "Configuración". Llena: nombre del bot, avatar, descripción. En "Configuración de conexión" selecciona "URL de extremo de la app" y pega: {webhookUrl}. En "Visibilidad" elige quién puede usar el bot. Haz clic en Guardar.`,
            en: `In Google Cloud Console go to "APIs & Services" > "Google Chat API" > "Configuration" tab. Fill in: bot name, avatar, description. Under "Connection settings" select "App URL" and paste: {webhookUrl}. Under "Visibility" choose who can use the bot. Click Save.`,
          },
          done: hasSpaces,
        },
        {
          step: 5,
          title: {
            es: 'Enviar un mensaje de prueba',
            en: 'Send a test message',
          },
          description: {
            es: 'Abre Google Chat en chat.google.com, busca el bot por su nombre y envíale un mensaje directo. Si todo está bien configurado, el bot lo recibirá y responderá.',
            en: 'Open Google Chat at chat.google.com, search for the bot by its name and send it a direct message. If everything is configured correctly, the bot will receive and respond.',
          },
          done: hasSpaces,
        },
      ]

      jsonResponse(res, 200, {
        webhookPath,
        steps,
        currentState: {
          hasKey,
          isConnected,
          hasSpaces,
          botEmail: state?.botEmail ?? null,
        },
      })
    },
  },
]

// ─── Migrations ─────────────────────────────────

async function runMigrations(db: import('pg').Pool): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS google_chat_spaces (
      space_name TEXT PRIMARY KEY,
      space_type TEXT NOT NULL,
      display_name TEXT,
      user_email TEXT,
      bot_added_at TIMESTAMPTZ DEFAULT now(),
      last_message_at TIMESTAMPTZ,
      active BOOLEAN DEFAULT true
    )
  `)
  await db.query(`
    CREATE INDEX IF NOT EXISTS idx_gc_spaces_email ON google_chat_spaces(user_email)
  `)
  logger.debug('Migrations complete')
}

// ─── Manifest ───────────────────────────────────

const manifest: ModuleManifest = {
  name: 'google-chat',
  version: '1.1.0',
  description: {
    es: 'Canal de Google Chat via webhook y Chat API (Service Account)',
    en: 'Google Chat channel via webhook and Chat API (Service Account)',
  },
  type: 'channel',
  channelType: 'instant',
  removable: true,
  activateByDefault: false,
  depends: [],

  configSchema: z.object({
    // Connection
    GOOGLE_CHAT_SERVICE_ACCOUNT_KEY: z.string().default(''),
    GOOGLE_CHAT_WEBHOOK_TOKEN: z.string().default(''),
    GOOGLE_CHAT_MAX_MESSAGE_LENGTH: numEnv(4096),
    // Room behavior
    GOOGLE_CHAT_DM_ONLY: boolEnv(false),
    GOOGLE_CHAT_REQUIRE_MENTION: boolEnv(true),
    GOOGLE_CHAT_SPACE_WHITELIST: z.string().default(''),
    // Threads
    GOOGLE_CHAT_REPLY_IN_THREAD: boolEnv(true),
    GOOGLE_CHAT_PROCESS_THREADS: boolEnv(true),
    // Retries
    GOOGLE_CHAT_MAX_RETRIES: numEnvMin(0, 3),
    GOOGLE_CHAT_RETRY_DELAY_MS: numEnv(1000),
    // Cards
    GOOGLE_CHAT_PROCESS_CARD_CLICKS: boolEnv(false),
    GOOGLE_CHAT_CARD_CLICK_ACTION: z.string().default('respond'),
    // Channel runtime config (read by engine via channel-config service)
    GOOGLE_CHAT_AVISO_TRIGGER_MS: numEnv(3000),
    GOOGLE_CHAT_AVISO_HOLD_MS: numEnv(2000),
    GOOGLE_CHAT_AVISO_MESSAGE: z.string().default('Un momento, estoy revisando eso...'),
    GOOGLE_CHAT_AVISO_STYLE: z.string().default('casual'),
    GOOGLE_CHAT_RATE_LIMIT_HOUR: numEnvMin(1, 30),
    GOOGLE_CHAT_RATE_LIMIT_DAY: numEnvMin(1, 200),
    GOOGLE_CHAT_SESSION_TIMEOUT_HOURS: numEnvMin(1, 24),
    GOOGLE_CHAT_BATCH_WAIT_SECONDS: numEnvMin(0, 0),
    GOOGLE_CHAT_PRECLOSE_FOLLOWUP_HOURS: numEnvMin(0, 1),
    GOOGLE_CHAT_PRECLOSE_MESSAGE: z.string().default('¿Sigues ahí? Tu sesión se cerrará pronto por inactividad. Si necesitas algo más, escríbeme.'),
    // Anti-spam (short-window burst protection)
    GOOGLE_CHAT_ANTISPAM_MAX: numEnv(5),
    GOOGLE_CHAT_ANTISPAM_WINDOW_MS: numEnv(60000),
    // Response format (form builder)
    GOOGLE_CHAT_FORMAT_ADVANCED: boolEnv(false),
    FORMAT_INSTRUCTIONS_GOOGLE_CHAT: z.string().default(''),
    GOOGLE_CHAT_FORMAT_TONE: z.string().default('profesional'),
    GOOGLE_CHAT_FORMAT_MAX_SENTENCES: numEnv(3),
    GOOGLE_CHAT_FORMAT_MAX_PARAGRAPHS: numEnv(3),
    GOOGLE_CHAT_FORMAT_EMOJI_LEVEL: z.string().default('bajo'),
    // Attachment processing — Google Chat supports images and documents
    GOOGLE_CHAT_ATT_IMAGES: boolEnv(true),
    GOOGLE_CHAT_ATT_DOCUMENTS: boolEnv(true),
    GOOGLE_CHAT_ATT_MAX_SIZE_MB: numEnvMin(1, 25),
    GOOGLE_CHAT_ATT_MAX_PER_MSG: numEnvMin(1, 5),
  }),

  console: {
    title: { es: 'Google Chat', en: 'Google Chat' },
    info: {
      es: 'Canal Google Chat para Google Workspace. Usa la guia de configuracion (boton "Ver guia") para conectar paso a paso.',
      en: 'Google Chat channel for Google Workspace. Use the setup guide ("View guide" button) to connect step by step.',
    },
    order: 15,
    group: 'channels',
    icon: '&#128488;',
    fields: [
      {
        key: 'GOOGLE_CHAT_SERVICE_ACCOUNT_KEY',
        type: 'secret',
        label: { es: 'Service Account Key (JSON)', en: 'Service Account Key (JSON)' },
        info: {
          es: 'Pega aqui el contenido completo del archivo JSON descargado de Google Cloud Console (IAM > Cuentas de servicio > Claves > Crear clave JSON).',
          en: 'Paste here the complete content of the JSON file downloaded from Google Cloud Console (IAM > Service Accounts > Keys > Create JSON key).',
        },
      },
      {
        key: 'GOOGLE_CHAT_WEBHOOK_TOKEN',
        type: 'secret',
        label: { es: 'Token de verificacion (opcional)', en: 'Verification token (optional)' },
        info: {
          es: 'Token secreto para verificar webhooks. Vacio = acepta todo (solo desarrollo).',
          en: 'Secret token to verify webhooks. Empty = accept all (development only).',
        },
      },
      {
        key: 'GOOGLE_CHAT_CONNECTION_STATUS',
        type: 'readonly',
        label: { es: 'Estado de conexion', en: 'Connection status' },
        info: { es: 'Estado actual del canal (solo lectura)', en: 'Current channel status (read-only)' },
      },
      { key: '_divider_config', type: 'divider', label: { es: 'Configuracion', en: 'Configuration' } },
      {
        key: 'GOOGLE_CHAT_MAX_MESSAGE_LENGTH',
        type: 'number',
        label: { es: 'Largo maximo de mensaje', en: 'Max message length' },
        info: { es: 'Caracteres maximos por mensaje. Google Chat trunca a 4096.', en: 'Max characters per message. Google Chat truncates at 4096.' },
      },
      { key: '_divider_rooms', type: 'divider', label: { es: 'Comportamiento en Rooms', en: 'Room Behavior' } },
      {
        key: 'GOOGLE_CHAT_DM_ONLY',
        type: 'boolean',
        label: { es: 'Solo DMs', en: 'DMs only' },
        info: { es: 'Si esta activo, ignora mensajes de rooms/spaces y solo procesa mensajes directos.', en: 'If enabled, ignores room/space messages and only processes direct messages.' },
      },
      {
        key: 'GOOGLE_CHAT_REQUIRE_MENTION',
        type: 'boolean',
        label: { es: 'Requerir mencion en rooms', en: 'Require mention in rooms' },
        info: { es: 'En rooms/spaces, solo responde si el bot es @mencionado o llamado por nombre. DMs siempre se procesan. Mismo patron que WhatsApp.', en: 'In rooms/spaces, only responds if the bot is @mentioned or called by name. DMs are always processed. Same pattern as WhatsApp.' },
      },
      {
        key: 'GOOGLE_CHAT_SPACE_WHITELIST',
        type: 'text',
        label: { es: 'Whitelist de spaces', en: 'Space whitelist' },
        info: { es: 'Lista de space names permitidos separados por coma (ej: spaces/AAA,spaces/BBB). Vacio = todos permitidos.', en: 'Comma-separated list of allowed space names (e.g. spaces/AAA,spaces/BBB). Empty = all allowed.' },
      },
      { key: '_divider_threads', type: 'divider', label: { es: 'Threads', en: 'Threads' } },
      {
        key: 'GOOGLE_CHAT_REPLY_IN_THREAD',
        type: 'boolean',
        label: { es: 'Responder en thread', en: 'Reply in thread' },
        info: { es: 'Si esta activo, las respuestas se envian como reply en el mismo hilo del mensaje original.', en: 'If enabled, replies are sent in the same thread as the original message.' },
      },
      {
        key: 'GOOGLE_CHAT_PROCESS_THREADS',
        type: 'boolean',
        label: { es: 'Procesar mensajes en threads', en: 'Process threaded messages' },
        info: { es: 'Si esta activo, procesa mensajes de hilos. Si esta desactivado, solo procesa mensajes raiz.', en: 'If enabled, processes messages from threads. If disabled, only processes root messages.' },
      },
      { key: '_divider_retries', type: 'divider', label: { es: 'Reintentos', en: 'Retries' } },
      {
        key: 'GOOGLE_CHAT_MAX_RETRIES',
        type: 'number',
        label: { es: 'Reintentos de envio', en: 'Send retries' },
        info: { es: 'Reintentos al fallar el envio de mensaje (solo errores transitorios 5xx).', en: 'Retries on message send failure (transient 5xx errors only).' },
        min: 0, max: 10, width: 'half',
      },
      {
        key: 'GOOGLE_CHAT_RETRY_DELAY_MS',
        type: 'number',
        label: { es: 'Delay entre reintentos (ms)', en: 'Retry delay (ms)' },
        info: { es: 'Milisegundos base entre reintentos (se multiplica por intento).', en: 'Base milliseconds between retries (multiplied by attempt number).' },
        min: 100, max: 30000, width: 'half',
      },
      { key: '_divider_cards', type: 'divider', label: { es: 'Cards', en: 'Cards' } },
      {
        key: 'GOOGLE_CHAT_PROCESS_CARD_CLICKS',
        type: 'boolean',
        label: { es: 'Procesar clicks en cards', en: 'Process card clicks' },
        info: { es: 'Si esta activo, eventos CARD_CLICKED se procesan segun la accion seleccionada.', en: 'If enabled, CARD_CLICKED events are processed according to the selected action.' },
      },
      {
        key: 'GOOGLE_CHAT_CARD_CLICK_ACTION',
        type: 'select',
        label: { es: 'Accion al click en card', en: 'Card click action' },
        info: { es: 'Que hacer cuando se hace click en un boton de card.', en: 'What to do when a card button is clicked.' },
        options: [
          { value: 'respond', label: 'Responder / Respond' },
          { value: 'log', label: 'Solo log / Log only' },
          { value: 'ignore', label: 'Ignorar / Ignore' },
        ],
      },
      { key: '_divider_naturalidad', type: 'divider', label: { es: 'Naturalidad', en: 'Naturalness' } },
      {
        key: 'GOOGLE_CHAT_AVISO_TRIGGER_MS',
        type: 'number',
        label: { es: 'Tiempo para aviso (ms)', en: 'Acknowledgment trigger (ms)' },
        info: { es: 'Si la respuesta tarda mas de este tiempo, se envia un aviso automatico. 0 = desactivado.', en: 'If the response takes longer than this, an automatic ack is sent. 0 = disabled.' },
        width: 'half',
      },
      {
        key: 'GOOGLE_CHAT_AVISO_HOLD_MS',
        type: 'number',
        label: { es: 'Pausa antes de respuesta (ms)', en: 'Hold before response (ms)' },
        info: { es: 'Tiempo que se retiene la respuesta real despues del aviso.', en: 'Time the real response is held after the ack.' },
        width: 'half',
      },
      {
        key: 'GOOGLE_CHAT_AVISO_MESSAGE',
        type: 'text',
        label: { es: 'Mensaje de aviso', en: 'Acknowledgment message' },
        info: { es: 'Texto del aviso automatico si la respuesta tarda.', en: 'Ack text sent automatically if the response is slow.' },
      },
      {
        key: 'GOOGLE_CHAT_AVISO_STYLE',
        type: 'select',
        width: 'half',
        label: { es: 'Estilo de aviso', en: 'Ack style' },
        info: { es: 'formal/casual/express: elige al azar. dynamic: rota secuencialmente.', en: 'formal/casual/express: random pick. dynamic: sequential rotation.' },
        options: [
          { value: 'formal', label: 'Formal' },
          { value: 'casual', label: 'Casual' },
          { value: 'express', label: 'Express' },
          { value: 'dynamic', label: 'Dynamic' },
        ],
      },
      { key: '_divider_rate', type: 'divider', label: { es: 'Limites de envio', en: 'Rate limits' } },
      {
        key: 'GOOGLE_CHAT_RATE_LIMIT_HOUR',
        type: 'number',
        label: { es: 'Max mensajes por hora', en: 'Max messages per hour' },
        info: { es: 'Maximo de mensajes por hora por contacto.', en: 'Max messages per hour per contact.' },
        min: 1, max: 100, width: 'half',
      },
      {
        key: 'GOOGLE_CHAT_RATE_LIMIT_DAY',
        type: 'number',
        label: { es: 'Max mensajes por dia', en: 'Max messages per day' },
        info: { es: 'Maximo de mensajes por dia por contacto.', en: 'Max messages per day per contact.' },
        min: 1, max: 1000, width: 'half',
      },
      {
        key: 'GOOGLE_CHAT_ANTISPAM_MAX',
        type: 'number',
        width: 'half',
        label: { es: 'Anti-spam: max mensajes', en: 'Anti-spam: max messages' },
        info: { es: 'Maximo de mensajes del agente en la ventana anti-spam. 0 = desactivado.', en: 'Max agent messages in anti-spam window. 0 = disabled.' },
        min: 0, max: 20,
      },
      {
        key: 'GOOGLE_CHAT_ANTISPAM_WINDOW_MS',
        type: 'number',
        width: 'half',
        label: { es: 'Anti-spam: ventana (ms)', en: 'Anti-spam: window (ms)' },
        info: { es: 'Duracion de la ventana anti-spam en milisegundos (default: 60000 = 1 min).', en: 'Anti-spam window duration in ms (default: 60000 = 1 min).' },
      },
      { key: '_divider_session', type: 'divider', label: { es: 'Sesion', en: 'Session' } },
      {
        key: 'GOOGLE_CHAT_SESSION_TIMEOUT_HOURS',
        type: 'number',
        label: { es: 'Timeout de sesion (horas)', en: 'Session timeout (hours)' },
        info: { es: 'Horas de inactividad para cerrar la sesion.', en: 'Inactivity hours to close the session.' },
        min: 1, max: 72, unit: 'h', width: 'half',
      },
      {
        key: 'GOOGLE_CHAT_PRECLOSE_FOLLOWUP_HOURS',
        type: 'number',
        label: { es: 'Follow-up pre-cierre (horas)', en: 'Pre-close follow-up (hours)' },
        info: { es: 'Horas antes del cierre para enviar recordatorio. 0 = desactivado.', en: 'Hours before close to send reminder. 0 = disabled.' },
        min: 0, max: 23, unit: 'h', width: 'half',
      },
      {
        key: 'GOOGLE_CHAT_PRECLOSE_MESSAGE',
        type: 'text',
        label: { es: 'Mensaje pre-cierre', en: 'Pre-close message' },
        info: { es: 'Texto del recordatorio antes de cerrar sesion por inactividad.', en: 'Reminder text before closing session due to inactivity.' },
      },
      { key: '_divider_format', type: 'divider', label: { es: 'Formato de respuesta', en: 'Response format' } },
      { key: 'GOOGLE_CHAT_FORMAT_ADVANCED', type: 'boolean', label: { es: 'Prompting avanzado', en: 'Advanced prompting' }, info: { es: 'Activa el editor de texto para personalizar el prompt de formato manualmente', en: 'Enable text editor to manually customize the format prompt' } },
      { key: 'FORMAT_INSTRUCTIONS_GOOGLE_CHAT', type: 'textarea', label: { es: 'Instrucciones de formato', en: 'Format instructions' }, rows: 8, visibleWhen: { key: 'GOOGLE_CHAT_FORMAT_ADVANCED', value: 'true' }, fieldType: 'code-editor' as never },
      { key: 'GOOGLE_CHAT_FORMAT_TONE', type: 'select', label: { es: 'Tono', en: 'Tone' }, visibleWhen: { key: 'GOOGLE_CHAT_FORMAT_ADVANCED', value: 'false' }, options: [{ value: 'ninguno', label: { es: 'Sin especificar', en: 'None' } }, { value: 'formal', label: { es: 'Formal', en: 'Formal' } }, { value: 'profesional', label: { es: 'Profesional', en: 'Professional' } }, { value: 'amigable', label: { es: 'Amigable', en: 'Friendly' } }, { value: 'directo', label: { es: 'Directo', en: 'Direct' } }] },
      { key: 'GOOGLE_CHAT_FORMAT_MAX_SENTENCES', type: 'number', label: { es: 'Max oraciones por parrafo', en: 'Max sentences per paragraph' }, min: 1, max: 15, width: 'half', visibleWhen: { key: 'GOOGLE_CHAT_FORMAT_ADVANCED', value: 'false' } },
      { key: 'GOOGLE_CHAT_FORMAT_MAX_PARAGRAPHS', type: 'number', label: { es: 'Max parrafos por respuesta', en: 'Max paragraphs per response' }, min: 1, max: 15, width: 'half', visibleWhen: { key: 'GOOGLE_CHAT_FORMAT_ADVANCED', value: 'false' } },
      { key: 'GOOGLE_CHAT_FORMAT_EMOJI_LEVEL', type: 'select', label: { es: 'Uso de emojis', en: 'Emoji usage' }, visibleWhen: { key: 'GOOGLE_CHAT_FORMAT_ADVANCED', value: 'false' }, options: [{ value: 'nunca', label: { es: 'Nunca', en: 'Never' } }, { value: 'bajo', label: { es: 'Bajo', en: 'Low' } }, { value: 'moderado', label: { es: 'Moderado', en: 'Moderate' } }] },
      { key: '_divider_attachments', type: 'divider', label: { es: 'Adjuntos', en: 'Attachments' } },
      {
        key: 'GOOGLE_CHAT_ATT_IMAGES',
        type: 'boolean',
        label: { es: 'Procesar imagenes', en: 'Process images' },
        description: { es: 'Imagenes compartidas en Google Chat', en: 'Images shared in Google Chat' },
        icon: '&#128247;',
      },
      {
        key: 'GOOGLE_CHAT_ATT_DOCUMENTS',
        type: 'boolean',
        label: { es: 'Procesar documentos', en: 'Process documents' },
        description: { es: 'PDF y documentos compartidos como adjuntos', en: 'PDF and documents shared as attachments' },
        icon: '&#128196;',
      },
      {
        key: 'GOOGLE_CHAT_ATT_MAX_SIZE_MB',
        type: 'number',
        label: { es: 'Tamano max (MB)', en: 'Max size (MB)' },
        info: { es: 'Tamano maximo de archivo a procesar por este canal', en: 'Maximum file size to process for this channel' },
        min: 1,
        max: 50,
        unit: 'MB',
        width: 'half',
      },
      {
        key: 'GOOGLE_CHAT_ATT_MAX_PER_MSG',
        type: 'number',
        label: { es: 'Max adjuntos por mensaje', en: 'Max attachments per message' },
        info: { es: 'Maximo de adjuntos a procesar por mensaje', en: 'Maximum attachments to process per message' },
        min: 1,
        max: 15,
        width: 'half',
      },
    ],
    apiRoutes,
    connectionWizard: {
      title: { es: 'Conectar Google Chat', en: 'Connect Google Chat' },
      steps: [
        {
          title: { es: 'Crear proyecto en Google Cloud', en: 'Create Google Cloud project' },
          instructions: {
            es: '<ol><li>Ve a <a href="https://console.cloud.google.com/" target="_blank" rel="noopener">Google Cloud Console <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></a>.</li><li>Crea un <strong>proyecto nuevo</strong> (o selecciona uno existente).</li><li>Anota el <strong>ID del proyecto</strong> — lo necesitaras mas adelante.</li></ol>',
            en: '<ol><li>Go to <a href="https://console.cloud.google.com/" target="_blank" rel="noopener">Google Cloud Console <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></a>.</li><li>Create a <strong>new project</strong> (or select an existing one).</li><li>Note the <strong>Project ID</strong> — you will need it later.</li></ol>',
          },
        },
        {
          title: { es: 'Crear cuenta de servicio', en: 'Create Service Account' },
          instructions: {
            es: '<ol><li>Ve a <a href="https://console.cloud.google.com/iam-admin/serviceaccounts" target="_blank" rel="noopener">IAM y administracion > Cuentas de servicio <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></a>.</li><li>Haz clic en <strong>Crear cuenta de servicio</strong>.</li><li>Pon un nombre descriptivo (ej: "LUNA Chat Bot").</li><li>No necesitas asignar roles. Haz clic en <strong>Listo</strong>.</li></ol>',
            en: '<ol><li>Go to <a href="https://console.cloud.google.com/iam-admin/serviceaccounts" target="_blank" rel="noopener">IAM & Admin > Service accounts <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></a>.</li><li>Click <strong>Create service account</strong>.</li><li>Give it a descriptive name (e.g. "LUNA Chat Bot").</li><li>No roles needed. Click <strong>Done</strong>.</li></ol>',
          },
        },
        {
          title: { es: 'Descargar clave JSON', en: 'Download JSON key' },
          instructions: {
            es: '<ol><li>Haz clic en la cuenta de servicio que creaste.</li><li>Ve a la pestaña <strong>Claves</strong>.</li><li>Haz clic en <strong>Agregar clave > Crear clave nueva > JSON</strong>.</li><li>Se descargara un archivo <code>.json</code>. Guardalo en un lugar seguro.</li></ol>',
            en: '<ol><li>Click on the service account you created.</li><li>Go to the <strong>Keys</strong> tab.</li><li>Click <strong>Add key > Create new key > JSON</strong>.</li><li>A <code>.json</code> file will download. Keep it safe.</li></ol>',
          },
        },
        {
          title: { es: 'Habilitar Chat API y configurar bot', en: 'Enable Chat API and configure bot' },
          instructions: {
            es: '<ol><li>Ve a <a href="https://console.cloud.google.com/apis/library/chat.googleapis.com" target="_blank" rel="noopener">Chat API <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></a> y haz clic en <strong>Habilitar</strong>.</li><li>Ve a <a href="https://console.cloud.google.com/apis/api/chat.googleapis.com/hangouts-chat" target="_blank" rel="noopener">Configuracion de Chat API <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></a> y configura el bot.</li><li>En <strong>Configuracion de conexion</strong> selecciona <strong>URL de extremo de la app</strong> y pega esta URL:</li></ol><div class="wizard-uri-box"><code class="wizard-uri">{BASE_URL}/console/api/google-chat/webhook</code><button type="button" class="wizard-copy-icon" onclick="copyChWizardUri(this)" title="Copiar"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg></button></div><ol start="4"><li>Haz clic en <strong>Guardar</strong>.</li></ol>',
            en: '<ol><li>Go to <a href="https://console.cloud.google.com/apis/library/chat.googleapis.com" target="_blank" rel="noopener">Chat API <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></a> and click <strong>Enable</strong>.</li><li>Go to <a href="https://console.cloud.google.com/apis/api/chat.googleapis.com/hangouts-chat" target="_blank" rel="noopener">Chat API Configuration <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></a> and configure the bot.</li><li>Under <strong>Connection settings</strong> select <strong>App URL</strong> and paste this URL:</li></ol><div class="wizard-uri-box"><code class="wizard-uri">{BASE_URL}/console/api/google-chat/webhook</code><button type="button" class="wizard-copy-icon" onclick="copyChWizardUri(this)" title="Copy"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg></button></div><ol start="4"><li>Click <strong>Save</strong>.</li></ol>',
          },
        },
        {
          title: { es: 'Pegar clave JSON', en: 'Paste JSON key' },
          instructions: {
            es: '<p>Abre el archivo <code>.json</code> que descargaste y pega todo su contenido aqui:</p>',
            en: '<p>Open the <code>.json</code> file you downloaded and paste its entire contents here:</p>',
          },
          fields: [
            { key: 'GOOGLE_CHAT_SERVICE_ACCOUNT_KEY', label: { es: 'Service Account JSON', en: 'Service Account JSON' }, type: 'textarea', placeholder: '{"type":"service_account","project_id":"..."}' },
          ],
        },
      ],
      saveEndpoint: 'validate-key',
      applyAfterSave: true,
      verifyEndpoint: 'status',
      operationParams: {
        autoReconnect: { es: 'Reconexion automatica del servicio', en: 'Automatic service reconnection' },
        maxRetries: { es: 'Reintentos de autenticacion del Service Account', en: 'Service Account auth retries' },
        retryIntervalMs: { es: 'Intervalo entre reintentos (ms)', en: 'Retry interval (ms)' },
        custom: [
          { key: 'GOOGLE_CHAT_MAX_MESSAGE_LENGTH', label: { es: 'Largo maximo de mensaje', en: 'Max message length' }, type: 'number', defaultValue: '4096' },
        ],
      },
    },
  },

  async init(registry: Registry) {
    _registry = registry
    const config = registry.getConfig<GoogleChatConfig>('google-chat')
    const db = registry.getDb()

    // Run migrations
    await runMigrations(db)

    // ── Agent name: read from centralized prompts config ──
    const getAgentName = (): string => {
      const svc = registry.getOptional<PromptsService>('prompts:service')
      if (svc) return svc.getAgentName()
      return 'Luna'
    }

    // ── Channel Config Service (ALWAYS register, even without key) ──
    const channelConfigService = {
      get: () => buildChannelConfig(config),
    }
    registry.provide('channel-config:google-chat', channelConfigService)

    // ── Message Batcher (instant channel batching) ──
    const dispatchBatch = async (messages: IncomingMessage[]) => {
      if (messages.length === 0) return
      const base = messages[0]!
      if (messages.length > 1) {
        const allTexts = messages
          .map(m => m.content.text ?? '')
          .filter(t => t.length > 0)
        base.content = { ...base.content, text: allTexts.join('\n') }
        logger.info({ from: base.from, count: messages.length }, 'Batched messages concatenated')
      }
      await registry.runHook('message:incoming', {
        id: base.id, channelName: base.channelName,
        channelMessageId: base.channelMessageId, from: base.from,
        timestamp: base.timestamp, content: base.content, raw: base.raw,
      })
    }

    if (config.GOOGLE_CHAT_BATCH_WAIT_SECONDS > 0) {
      batcher = new MessageBatcher(config.GOOGLE_CHAT_BATCH_WAIT_SECONDS, dispatchBatch, 20)
    }

    // ── Hook: outbound messages (ALWAYS register) ──
    registry.addHook('google-chat', 'message:send', async (payload) => {
      if (payload.channel !== 'google-chat') return
      if (!adapter) return

      // `to` can be a space name (spaces/XXX) or an email address
      let spaceName = payload.to
      if (!spaceName.startsWith('spaces/')) {
        const resolved = await adapter.resolveSpaceForEmail(payload.to)
        if (!resolved) {
          logger.warn({ to: payload.to }, 'Cannot resolve Google Chat space for recipient')
          await registry.runHook('message:sent', {
            channel: 'google-chat',
            to: payload.to,
            success: false,
          })
          return
        }
        spaceName = resolved
      }

      const text = payload.content.text ?? ''
      // Use stored threadName for reply-in-thread
      const threadName = lastThreadByContact.get(payload.to)
      const result = await adapter.sendMessage(spaceName, text, threadName)

      await registry.runHook('message:sent', {
        channel: 'google-chat',
        to: payload.to,
        channelMessageId: result.channelMessageId,
        success: result.success,
      })
    })

    // ── Hot-reload: re-read config when console applies changes (ALWAYS register) ──
    registry.addHook('google-chat', 'console:config_applied', async () => {
      const fresh = registry.getConfig<GoogleChatConfig>('google-chat')
      Object.assign(config, fresh)
      if (adapter) adapter.rebuildWhitelist()
      // Update or create/destroy batcher based on new config
      if (fresh.GOOGLE_CHAT_BATCH_WAIT_SECONDS > 0) {
        if (batcher) {
          batcher.updateWaitSeconds(fresh.GOOGLE_CHAT_BATCH_WAIT_SECONDS)
        } else {
          batcher = new MessageBatcher(fresh.GOOGLE_CHAT_BATCH_WAIT_SECONDS, dispatchBatch, 20)
        }
      } else if (batcher) {
        batcher.clearAll()
        batcher = null
      }
      logger.info('Google Chat config hot-reloaded')

      // If adapter doesn't exist yet but key is now configured, create it
      if (!adapter && fresh.GOOGLE_CHAT_SERVICE_ACCOUNT_KEY) {
        const validation = GoogleChatAdapter.validateServiceAccountKey(fresh.GOOGLE_CHAT_SERVICE_ACCOUNT_KEY)
        if (validation.valid) {
          logger.info('Service Account Key detected after hot-reload, initializing adapter...')
          adapter = new GoogleChatAdapter(config, db, getAgentName)
          registry.provide('google-chat:adapter', adapter)
          try {
            await adapter.initialize()
            await configStore.set(db, 'GOOGLE_CHAT_CONNECTION_STATUS', 'connected', false).catch(() => {})
          } catch (err) {
            logger.error({ err }, 'Google Chat adapter initialization failed after hot-reload')
            await configStore.set(db, 'GOOGLE_CHAT_CONNECTION_STATUS', 'error', false).catch(() => {})
          }
        }
      }
    })

    // ── Skip adapter initialization if no service account configured ──
    if (!config.GOOGLE_CHAT_SERVICE_ACCOUNT_KEY) {
      logger.warn('No GOOGLE_CHAT_SERVICE_ACCOUNT_KEY configured — module active but not connected. Configure via console, no restart needed.')
      await configStore.set(db, 'GOOGLE_CHAT_CONNECTION_STATUS', 'not_configured', false).catch(() => {})
      return
    }

    // Validate key before initializing
    const validation = GoogleChatAdapter.validateServiceAccountKey(config.GOOGLE_CHAT_SERVICE_ACCOUNT_KEY)
    if (!validation.valid) {
      logger.error({ errors: validation.errors }, 'Invalid Service Account Key — check the setup guide in console')
      await configStore.set(db, 'GOOGLE_CHAT_CONNECTION_STATUS', 'error', false).catch(() => {})
      return
    }

    logger.info({ projectId: validation.projectId, botEmail: validation.clientEmail }, 'Service Account Key validated')

    adapter = new GoogleChatAdapter(config, db, getAgentName)

    // ── Connection status sync to config_store ──
    await configStore.set(db, 'GOOGLE_CHAT_CONNECTION_STATUS', 'connecting', false).catch(() => {})

    // Expose adapter as service
    registry.provide('google-chat:adapter', adapter)

    // Initialize adapter (verify service account, connect to API)
    try {
      await adapter.initialize()
      await configStore.set(db, 'GOOGLE_CHAT_CONNECTION_STATUS', 'connected', false).catch(() => {})
    } catch (err) {
      logger.error({ err }, 'Google Chat adapter initialization failed — webhook will still accept events once resolved')
      await configStore.set(db, 'GOOGLE_CHAT_CONNECTION_STATUS', 'error', false).catch(() => {})
    }
  },

  async stop() {
    if (batcher) {
      batcher.clearAll()
      batcher = null
    }
    if (adapter) {
      adapter.shutdown()
      adapter = null
    }
    _registry = null
  },
}

// ─── Channel Config builder (same pattern as WhatsApp) ──

function buildChannelConfig(cfg: GoogleChatConfig): import('../../channels/types.js').ChannelRuntimeConfig {
  return {
    rateLimitHour: cfg.GOOGLE_CHAT_RATE_LIMIT_HOUR,
    rateLimitDay: cfg.GOOGLE_CHAT_RATE_LIMIT_DAY,
    avisoTriggerMs: cfg.GOOGLE_CHAT_AVISO_TRIGGER_MS,
    avisoHoldMs: cfg.GOOGLE_CHAT_AVISO_HOLD_MS,
    avisoMessages: cfg.GOOGLE_CHAT_AVISO_MESSAGE ? [cfg.GOOGLE_CHAT_AVISO_MESSAGE] : [],
    avisoStyle: (cfg.GOOGLE_CHAT_AVISO_STYLE || 'casual') as import('../../channels/types.js').AvisoStyle,
    sessionTimeoutMs: cfg.GOOGLE_CHAT_SESSION_TIMEOUT_HOURS * 3600000,
    batchWaitSeconds: cfg.GOOGLE_CHAT_BATCH_WAIT_SECONDS,
    precloseFollowupMs: cfg.GOOGLE_CHAT_PRECLOSE_FOLLOWUP_HOURS * 3600000,
    precloseFollowupMessage: cfg.GOOGLE_CHAT_PRECLOSE_MESSAGE,
    typingDelayMsPerChar: 50,
    typingDelayMinMs: 500,
    typingDelayMaxMs: 3000,
    channelType: 'instant',
    // Google Chat API does NOT support typing indicators for bots/apps.
    // Verified: no endpoint exists in chat.googleapis.com v1 for bot typing state.
    supportsTypingIndicator: false,
    antiSpamMaxPerWindow: cfg.GOOGLE_CHAT_ANTISPAM_MAX,
    antiSpamWindowMs: cfg.GOOGLE_CHAT_ANTISPAM_WINDOW_MS,
    floodThreshold: 20,
    attachments: buildGoogleChatAttachmentConfig(cfg),
  }
}

/** Build per-channel attachment config from Google Chat config fields */
function buildGoogleChatAttachmentConfig(cfg: GoogleChatConfig): import('../../engine/attachments/types.js').ChannelAttachmentConfig {
  const categories: import('../../engine/attachments/types.js').AttachmentCategory[] = []
  if (cfg.GOOGLE_CHAT_ATT_IMAGES) categories.push('images')
  if (cfg.GOOGLE_CHAT_ATT_DOCUMENTS) categories.push('documents')
  return {
    enabledCategories: categories,
    maxFileSizeMb: cfg.GOOGLE_CHAT_ATT_MAX_SIZE_MB,
    maxAttachmentsPerMessage: cfg.GOOGLE_CHAT_ATT_MAX_PER_MSG,
  }
}

export default manifest
