// LUNA — Module: google-chat
// Canal Google Chat via webhook + Chat API (Service Account auth).

import { z } from 'zod'
import pino from 'pino'
import type { ModuleManifest, ApiRoute } from '../../kernel/types.js'
import type { Registry } from '../../kernel/registry.js'
import { jsonResponse, parseBody } from '../../kernel/http-helpers.js'
import { numEnv } from '../../kernel/config-helpers.js'
import { GoogleChatAdapter } from './adapter.js'
import type { GoogleChatConfig, ChatEvent } from './types.js'

const logger = pino({ name: 'google-chat' })

let adapter: GoogleChatAdapter | null = null
let _registry: Registry | null = null

// ─── API Routes ─────────────────────────────────

const apiRoutes: ApiRoute[] = [
  {
    method: 'POST',
    path: 'webhook',
    handler: async (req, res) => {
      if (!adapter || !_registry) {
        jsonResponse(res, 503, { error: 'Google Chat module not initialized' })
        return
      }

      // Verify webhook token
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
          // Fire incoming hook — engine will process asynchronously
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

        // Always respond 200 to Google Chat webhooks
        jsonResponse(res, 200, {})
      } catch (err) {
        logger.error({ err }, 'Error processing webhook event')
        jsonResponse(res, 200, {}) // Still 200 to avoid retries from Google
      }
    },
  },
  {
    method: 'GET',
    path: 'status',
    handler: async (_req, res) => {
      const moduleEnabled = _registry?.isActive('google-chat') ?? false
      if (!adapter) {
        jsonResponse(res, 200, { status: 'not_initialized', botEmail: null, activeSpaces: 0, moduleEnabled })
        return
      }
      const state = adapter.getState()
      jsonResponse(res, 200, { ...state, moduleEnabled })
    },
  },
  {
    method: 'POST',
    path: 'test-connection',
    handler: async (_req, res) => {
      if (!adapter) {
        jsonResponse(res, 400, { error: 'Google Chat adapter not initialized' })
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
  version: '1.0.0',
  description: {
    es: 'Canal de Google Chat via webhook y Chat API (Service Account)',
    en: 'Google Chat channel via webhook and Chat API (Service Account)',
  },
  type: 'channel',
  removable: true,
  activateByDefault: false,
  depends: [],

  configSchema: z.object({
    GOOGLE_CHAT_SERVICE_ACCOUNT_KEY: z.string().default(''),
    GOOGLE_CHAT_PROJECT_NUMBER: z.string().default(''),
    GOOGLE_CHAT_WEBHOOK_TOKEN: z.string().default(''),
    GOOGLE_CHAT_MAX_MESSAGE_LENGTH: numEnv(4096),
  }),

  oficina: {
    title: { es: 'Google Chat', en: 'Google Chat' },
    info: {
      es: 'Canal Google Chat para Google Workspace. Usa Service Account para autenticación.',
      en: 'Google Chat channel for Google Workspace. Uses Service Account for authentication.',
    },
    order: 15,
    fields: [
      {
        key: 'GOOGLE_CHAT_SERVICE_ACCOUNT_KEY',
        type: 'secret',
        label: { es: 'Service Account Key (JSON)', en: 'Service Account Key (JSON)' },
        info: {
          es: 'JSON del service account de Google Cloud o ruta al archivo .json',
          en: 'Google Cloud service account JSON or path to .json file',
        },
      },
      {
        key: 'GOOGLE_CHAT_PROJECT_NUMBER',
        type: 'text',
        label: { es: 'Project Number', en: 'Project Number' },
        info: {
          es: 'Número del proyecto en Google Cloud Console',
          en: 'Project number from Google Cloud Console',
        },
      },
      {
        key: 'GOOGLE_CHAT_WEBHOOK_TOKEN',
        type: 'secret',
        label: { es: 'Webhook Token', en: 'Webhook Token' },
        info: {
          es: 'Token secreto para verificar requests del webhook (opcional en dev)',
          en: 'Secret token to verify webhook requests (optional in dev)',
        },
      },
      {
        key: 'GOOGLE_CHAT_CONNECTION_STATUS',
        type: 'text',
        label: { es: 'Estado de conexión', en: 'Connection status' },
        info: {
          es: 'Estado actual del canal Google Chat (solo lectura)',
          en: 'Current Google Chat channel status (read-only)',
        },
      },
    ],
    apiRoutes,
  },

  async init(registry: Registry) {
    _registry = registry
    const config = registry.getConfig<GoogleChatConfig>('google-chat')
    const db = registry.getDb()

    // Run migrations
    await runMigrations(db)

    // Skip initialization if no service account configured
    if (!config.GOOGLE_CHAT_SERVICE_ACCOUNT_KEY) {
      logger.warn('No GOOGLE_CHAT_SERVICE_ACCOUNT_KEY configured — module active but not connected')
      return
    }

    adapter = new GoogleChatAdapter(config, db)

    // Register hook: outbound messages for google-chat channel
    registry.addHook('google-chat', 'message:send', async (payload) => {
      if (payload.channel !== 'google-chat') return
      if (!adapter) return

      // `to` can be a space name (spaces/XXX) or an email address
      let spaceName = payload.to
      if (!spaceName.startsWith('spaces/')) {
        // Try to resolve email → space name
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
