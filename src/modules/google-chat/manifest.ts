// LUNA — Module: google-chat
// Canal Google Chat via webhook + Chat API (Service Account auth).

import { z } from 'zod'
import pino from 'pino'
import type { ModuleManifest, ApiRoute } from '../../kernel/types.js'
import type { Registry } from '../../kernel/registry.js'
import { jsonResponse, parseBody } from '../../kernel/http-helpers.js'
import { numEnv } from '../../kernel/config-helpers.js'
import { GoogleChatAdapter } from './adapter.js'
import type { GoogleChatConfig, ChatEvent, SetupGuideStep } from './types.js'

const logger = pino({ name: 'google-chat' })

let adapter: GoogleChatAdapter | null = null
let _registry: Registry | null = null

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
          await _registry.runHook('message:incoming', {
            id: normalized.id,
            channelName: normalized.channelName,
            channelMessageId: normalized.channelMessageId,
            from: normalized.from,
            timestamp: normalized.timestamp,
            content: normalized.content,
            raw: normalized.raw,
          })
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
    GOOGLE_CHAT_SERVICE_ACCOUNT_KEY: z.string().default(''),
    GOOGLE_CHAT_WEBHOOK_TOKEN: z.string().default(''),
    GOOGLE_CHAT_MAX_MESSAGE_LENGTH: numEnv(4096),
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
        label: {
          es: 'Service Account Key (JSON)',
          en: 'Service Account Key (JSON)',
        },
        info: {
          es: 'Pega aqui el contenido completo del archivo JSON descargado de Google Cloud Console (IAM > Cuentas de servicio > Claves > Crear clave JSON). Al guardar, el sistema validara automaticamente el JSON y extraera el email del bot y el ID del proyecto.',
          en: 'Paste here the complete content of the JSON file downloaded from Google Cloud Console (IAM > Service Accounts > Keys > Create JSON key). On save, the system will automatically validate the JSON and extract the bot email and project ID.',
        },
      },
      {
        key: 'GOOGLE_CHAT_WEBHOOK_TOKEN',
        type: 'secret',
        label: {
          es: 'Token de verificacion (opcional)',
          en: 'Verification token (optional)',
        },
        info: {
          es: 'Token secreto para verificar que los mensajes vienen de Google Chat. Si se deja vacio, se aceptan todos los requests (solo para desarrollo). En produccion, configura un token aqui y en Google Cloud Console.',
          en: 'Secret token to verify messages come from Google Chat. If left empty, all requests are accepted (development only). In production, set a token here and in Google Cloud Console.',
        },
      },
      {
        key: 'GOOGLE_CHAT_CONNECTION_STATUS',
        type: 'text',
        label: { es: 'Estado de conexion', en: 'Connection status' },
        info: {
          es: 'Estado actual del canal Google Chat (solo lectura)',
          en: 'Current Google Chat channel status (read-only)',
        },
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
            es: '<ol><li>Ve a <a href="https://console.cloud.google.com/apis/library/chat.googleapis.com" target="_blank" rel="noopener">Chat API <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></a> y haz clic en <strong>Habilitar</strong>.</li><li>Ve a <a href="https://console.cloud.google.com/apis/api/chat.googleapis.com/hangouts-chat" target="_blank" rel="noopener">Configuracion de Chat API <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></a> y configura el bot (nombre, avatar, endpoint HTTP).</li></ol>',
            en: '<ol><li>Go to <a href="https://console.cloud.google.com/apis/library/chat.googleapis.com" target="_blank" rel="noopener">Chat API <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></a> and click <strong>Enable</strong>.</li><li>Go to <a href="https://console.cloud.google.com/apis/api/chat.googleapis.com/hangouts-chat" target="_blank" rel="noopener">Chat API Configuration <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:middle"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg></a> and configure the bot (name, avatar, HTTP endpoint).</li></ol>',
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

    // Skip initialization if no service account configured
    if (!config.GOOGLE_CHAT_SERVICE_ACCOUNT_KEY) {
      logger.warn('No GOOGLE_CHAT_SERVICE_ACCOUNT_KEY configured — module active but not connected. Use the setup guide in console to configure.')
      return
    }

    // Validate key before initializing
    const validation = GoogleChatAdapter.validateServiceAccountKey(config.GOOGLE_CHAT_SERVICE_ACCOUNT_KEY)
    if (!validation.valid) {
      logger.error({ errors: validation.errors }, 'Invalid Service Account Key — check the setup guide in console')
      return
    }

    logger.info({ projectId: validation.projectId, botEmail: validation.clientEmail }, 'Service Account Key validated')

    adapter = new GoogleChatAdapter(config, db)

    // Register hook: outbound messages for google-chat channel
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
      const result = await adapter.sendMessage(spaceName, text)

      await registry.runHook('message:sent', {
        channel: 'google-chat',
        to: payload.to,
        channelMessageId: result.channelMessageId,
        success: result.success,
      })
    })

    // Expose adapter as service
    registry.provide('google-chat:adapter', adapter)

    // Initialize adapter (verify service account, connect to API)
    try {
      await adapter.initialize()
    } catch (err) {
      logger.error({ err }, 'Google Chat adapter initialization failed — webhook will still accept events once resolved')
    }
  },

  async stop() {
    if (adapter) {
      adapter.shutdown()
      adapter = null
    }
    _registry = null
  },
}

export default manifest
