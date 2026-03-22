// LUNA — Module: google-apps
// Provider de servicios Google: OAuth2, Drive, Sheets, Docs, Slides, Calendar.
// Expone servicios via registry para que otros módulos (email, users) los consuman.

import { z } from 'zod'
import pino from 'pino'
import type { ModuleManifest, ApiRoute } from '../../kernel/types.js'
import type { Registry } from '../../kernel/registry.js'
import { jsonResponse, parseBody } from '../../kernel/http-helpers.js'
import { numEnv } from '../../kernel/config-helpers.js'
import { OAuthManager } from './oauth-manager.js'
import { DriveService } from './drive-service.js'
import { SheetsService } from './sheets-service.js'
import { DocsService } from './docs-service.js'
import { SlidesService } from './slides-service.js'
import { CalendarService } from './calendar-service.js'
import { registerGoogleTools } from './tools.js'
import type { GoogleApiConfig, GoogleServiceName } from './types.js'

const logger = pino({ name: 'google-apps' })

let oauthManager: OAuthManager | null = null
let _registry: Registry | null = null

// ─── Migrations ────────────────────────────

async function runMigrations(db: import('pg').Pool): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS google_oauth_tokens (
      id TEXT PRIMARY KEY DEFAULT 'primary',
      access_token TEXT NOT NULL,
      refresh_token TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      scopes JSONB DEFAULT '[]',
      email TEXT,
      created_at TIMESTAMPTZ DEFAULT now(),
      updated_at TIMESTAMPTZ DEFAULT now()
    )
  `)
  logger.info('Google API migrations complete')
}

// ─── API Routes ────────────────────────────

const apiRoutes: ApiRoute[] = [
  {
    method: 'GET',
    path: 'status',
    handler: async (_req, res) => {
      if (!oauthManager) {
        jsonResponse(res, 200, { status: 'not_initialized', email: null, services: {} })
        return
      }
      const state = oauthManager.getState()
      jsonResponse(res, 200, {
        status: state.status,
        email: state.email,
        scopes: state.scopes,
        lastRefreshAt: state.lastRefreshAt,
        expiresAt: state.expiresAt,
        error: state.error,
      })
    },
  },
  {
    method: 'GET',
    path: 'auth-url',
    handler: async (req, res) => {
      if (!oauthManager || !_registry) {
        jsonResponse(res, 400, { error: 'OAuth manager not initialized' })
        return
      }
      const config = _registry.getConfig<GoogleApiConfig>('google-apps')
      const enabledServices = parseEnabledServices(config.GOOGLE_ENABLED_SERVICES)
      // Siempre incluir gmail para el módulo email
      enabledServices.push('gmail')
      const url = oauthManager.generateAuthUrl([...new Set(enabledServices)])
      jsonResponse(res, 200, { url })
    },
  },
  {
    method: 'POST',
    path: 'auth-callback',
    handler: async (req, res) => {
      if (!oauthManager) {
        jsonResponse(res, 400, { error: 'OAuth manager not initialized' })
        return
      }
      try {
        const body = await parseBody(req)
        const code = body.code as string
        if (!code) {
          jsonResponse(res, 400, { error: 'Missing authorization code' })
          return
        }
        await oauthManager.handleAuthCallback(code)
        jsonResponse(res, 200, { ok: true, state: oauthManager.getState() })
      } catch (err) {
        jsonResponse(res, 500, { error: 'Auth callback failed: ' + String(err) })
      }
    },
  },
  {
    method: 'POST',
    path: 'disconnect',
    handler: async (_req, res) => {
      if (!oauthManager) {
        jsonResponse(res, 400, { error: 'OAuth manager not initialized' })
        return
      }
      try {
        await oauthManager.disconnect()
        jsonResponse(res, 200, { ok: true, status: 'disconnected' })
      } catch (err) {
        jsonResponse(res, 500, { error: 'Disconnect failed: ' + String(err) })
      }
    },
  },
  {
    method: 'POST',
    path: 'refresh-token',
    handler: async (_req, res) => {
      if (!oauthManager) {
        jsonResponse(res, 400, { error: 'OAuth manager not initialized' })
        return
      }
      try {
        await oauthManager.refreshAccessToken()
        jsonResponse(res, 200, { ok: true, state: oauthManager.getState() })
      } catch (err) {
        jsonResponse(res, 500, { error: 'Refresh failed: ' + String(err) })
      }
    },
  },
]

// ─── Helpers ───────────────────────────────

function parseEnabledServices(csv: string): string[] {
  return csv.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
}

// ─── Manifest ──────────────────────────────

const manifest: ModuleManifest = {
  name: 'google-apps',
  version: '1.0.0',
  description: {
    es: 'Integración Google API: OAuth2, Drive, Sheets, Docs, Slides, Calendar',
    en: 'Google API integration: OAuth2, Drive, Sheets, Docs, Slides, Calendar',
  },
  type: 'provider',
  removable: true,
  activateByDefault: false,
  depends: [],

  configSchema: z.object({
    GOOGLE_CLIENT_ID: z.string().default(''),
    GOOGLE_CLIENT_SECRET: z.string().default(''),
    GOOGLE_REDIRECT_URI: z.string().default('http://localhost:3000/console/api/google-apps/oauth2callback'),
    GOOGLE_REFRESH_TOKEN: z.string().default(''),
    GOOGLE_ENABLED_SERVICES: z.string().default('drive,sheets,docs,slides,calendar'),
    GOOGLE_TOKEN_REFRESH_BUFFER_MS: numEnv(300000),
    GOOGLE_API_TIMEOUT_MS: numEnv(30000),
    GOOGLE_API_RETRY_MAX: numEnv(2),
  }),

  console: {
    title: { es: 'Google API', en: 'Google API' },
    info: {
      es: 'Conexión OAuth2 a Google. Habilita Drive, Sheets, Docs, Slides y Calendar. Cada servicio se activa/desactiva individualmente.',
      en: 'OAuth2 connection to Google. Enables Drive, Sheets, Docs, Slides and Calendar. Each service can be toggled individually.',
    },
    order: 15,
    group: 'modules',
    icon: '&#128279;',
    fields: [
      {
        key: 'GOOGLE_CLIENT_ID',
        type: 'secret',
        label: { es: 'Client ID', en: 'Client ID' },
        info: { es: 'OAuth2 Client ID de Google Cloud Console', en: 'OAuth2 Client ID from Google Cloud Console' },
      },
      {
        key: 'GOOGLE_CLIENT_SECRET',
        type: 'secret',
        label: { es: 'Client Secret', en: 'Client Secret' },
        info: { es: 'OAuth2 Client Secret de Google Cloud Console', en: 'OAuth2 Client Secret from Google Cloud Console' },
      },
      {
        key: 'GOOGLE_REDIRECT_URI',
        type: 'text',
        label: { es: 'Redirect URI', en: 'Redirect URI' },
        info: { es: 'URI de redirección OAuth2 (debe coincidir con Google Cloud Console)', en: 'OAuth2 redirect URI (must match Google Cloud Console)' },
      },
      {
        key: 'GOOGLE_REFRESH_TOKEN',
        type: 'secret',
        label: { es: 'Refresh Token', en: 'Refresh Token' },
        info: { es: 'Token de refresco OAuth2 (se obtiene tras autorización inicial)', en: 'OAuth2 refresh token (obtained after initial authorization)' },
      },
      {
        key: 'GOOGLE_ENABLED_SERVICES',
        type: 'text',
        label: { es: 'Servicios habilitados', en: 'Enabled services' },
        info: { es: 'Servicios separados por coma: drive, sheets, docs, slides, calendar', en: 'Comma-separated services: drive, sheets, docs, slides, calendar' },
      },
      {
        key: 'GOOGLE_TOKEN_REFRESH_BUFFER_MS',
        type: 'number',
        label: { es: 'Buffer de refresco (ms)', en: 'Refresh buffer (ms)' },
        info: { es: 'Milisegundos antes de expiración para refrescar token (default: 300000 = 5 min)', en: 'Milliseconds before expiry to refresh token (default: 300000 = 5 min)' },
      },
    ],
    apiRoutes,
  },

  async init(registry: Registry) {
    _registry = registry
    const db = registry.getDb()
    const config = registry.getConfig<GoogleApiConfig>('google-apps')

    // Run migrations
    await runMigrations(db)

    // Inicializar OAuth manager
    oauthManager = new OAuthManager(config, db)

    // Intentar conectar si hay credenciales
    if (config.GOOGLE_CLIENT_ID && config.GOOGLE_CLIENT_SECRET) {
      try {
        await oauthManager.initialize()
      } catch (err) {
        logger.warn({ err }, 'OAuth initialization failed — connect manually from console')
      }
    } else {
      logger.info('Google API credentials not configured — set them from console')
    }

    // Registrar servicio OAuth
    registry.provide('google:oauth-client', oauthManager.getClient())
    registry.provide('google:oauth-manager', oauthManager)

    // Inicializar servicios según los habilitados
    const enabledList = parseEnabledServices(config.GOOGLE_ENABLED_SERVICES)
    const enabledSet = new Set<GoogleServiceName>(enabledList as GoogleServiceName[])
    const authClient = oauthManager.getClient()

    const services: {
      drive?: DriveService
      sheets?: SheetsService
      docs?: DocsService
      slides?: SlidesService
      calendar?: CalendarService
    } = {}

    if (enabledSet.has('drive')) {
      services.drive = new DriveService(authClient, config)
      registry.provide('google:drive', services.drive)
      logger.info('Drive service enabled')
    }

    if (enabledSet.has('sheets')) {
      services.sheets = new SheetsService(authClient)
      registry.provide('google:sheets', services.sheets)
      logger.info('Sheets service enabled')
    }

    if (enabledSet.has('docs')) {
      services.docs = new DocsService(authClient)
      registry.provide('google:docs', services.docs)
      logger.info('Docs service enabled')
    }

    if (enabledSet.has('slides')) {
      services.slides = new SlidesService(authClient)
      registry.provide('google:slides', services.slides)
      logger.info('Slides service enabled')
    }

    if (enabledSet.has('calendar')) {
      services.calendar = new CalendarService(authClient)
      registry.provide('google:calendar', services.calendar)
      logger.info('Calendar service enabled')
    }

    // Registrar tools si el módulo tools está disponible
    await registerGoogleTools(registry, services, enabledSet)

    logger.info(
      { email: oauthManager.getState().email, services: enabledList },
      'Google API module initialized',
    )
  },

  async stop() {
    if (oauthManager) {
      await oauthManager.shutdown()
      oauthManager = null
    }
    _registry = null
  },
}

export default manifest
