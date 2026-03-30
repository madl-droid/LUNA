// LUNA — Module: google-apps
// Provider de servicios Google: OAuth2, Drive, Sheets, Docs, Slides, Calendar.
// Expone servicios via registry para que otros módulos (email, users) los consuman.

import { z } from 'zod'
import pino from 'pino'
import type { ModuleManifest, ApiRoute } from '../../kernel/types.js'
import type { Registry } from '../../kernel/registry.js'
import { jsonResponse, parseBody, parseQuery, buildBaseUrl, oauthCallbackPage } from '../../kernel/http-helpers.js'
import { numEnv } from '../../kernel/config-helpers.js'
import * as configStore from '../../kernel/config-store.js'
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

/** Build the shared OAuth redirect URI from the request */
function getRedirectUri(req: import('node:http').IncomingMessage): string {
  return `${buildBaseUrl(req)}/console/oauth/callback`
}

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
        hasCredentials: oauthManager.hasCredentials(),
      })
    },
  },
  {
    method: 'GET',
    path: 'auth-status',
    handler: async (req, res) => {
      const redirectUri = getRedirectUri(req)
      if (!oauthManager) {
        jsonResponse(res, 200, { status: 'not_initialized', email: null, hasCredentials: false, redirectUri })
        return
      }
      const state = oauthManager.getState()
      jsonResponse(res, 200, {
        ...state,
        hasCredentials: oauthManager.hasCredentials(),
        redirectUri,
      })
    },
  },
  {
    method: 'POST',
    path: 'setup-credentials',
    handler: async (req, res) => {
      try {
        const body = await parseBody<{ clientId: string; clientSecret: string }>(req)
        if (!body.clientId || !body.clientSecret) {
          jsonResponse(res, 400, { error: 'Missing clientId or clientSecret' })
          return
        }

        // Persist to config_store (encrypted) + .env
        if (_registry) {
          const db = _registry.getDb()
          await configStore.setMultiple(db, {
            GOOGLE_CLIENT_ID: body.clientId,
            GOOGLE_CLIENT_SECRET: body.clientSecret,
          })
        }

        // Re-initialize OAuth manager with new credentials
        if (oauthManager) {
          oauthManager.updateCredentials(body.clientId, body.clientSecret)
        } else {
          const db = _registry!.getDb()
          const config = _registry!.getConfig<GoogleApiConfig>('google-apps')
          oauthManager = new OAuthManager({ ...config, GOOGLE_CLIENT_ID: body.clientId, GOOGLE_CLIENT_SECRET: body.clientSecret }, db)
        }

        // Generate auth URL
        const redirectUri = getRedirectUri(req)
        const config = _registry!.getConfig<GoogleApiConfig>('google-apps')
        const enabledServices = parseEnabledServices(config.GOOGLE_ENABLED_SERVICES)
        // Ensure gmail scopes are always requested during credential setup
        enabledServices.push('gmail')
        const url = oauthManager.generateAuthUrl([...new Set(enabledServices)], redirectUri)
        jsonResponse(res, 200, { ok: true, authUrl: url })
      } catch (err) {
        jsonResponse(res, 500, { error: 'Setup failed: ' + String(err) })
      }
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
      if (!oauthManager.hasCredentials()) {
        jsonResponse(res, 400, { error: 'No credentials configured — use setup-credentials first', needsSetup: true })
        return
      }
      const config = _registry.getConfig<GoogleApiConfig>('google-apps')
      const enabledServices = parseEnabledServices(config.GOOGLE_ENABLED_SERVICES)
      // Siempre incluir gmail para el módulo email
      enabledServices.push('gmail')
      const redirectUri = getRedirectUri(req)
      const url = oauthManager.generateAuthUrl([...new Set(enabledServices)], redirectUri)
      jsonResponse(res, 200, { url })
    },
  },
  {
    method: 'GET',
    path: 'oauth2callback',
    handler: async (req, res) => {
      const query = parseQuery(req)
      const code = query.get('code')
      const error = query.get('error')

      if (error) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(oauthCallbackPage({ success: false, title: 'Error de autorizacion', message: error }))
        return
      }

      if (!code) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(oauthCallbackPage({ success: false, title: 'Error', message: 'Codigo de autorizacion no recibido' }))
        return
      }

      try {
        if (!oauthManager) {
          throw new Error('OAuth manager not initialized')
        }
        const redirectUri = getRedirectUri(req)
        await oauthManager.handleAuthCallback(code, redirectUri)

        const email = oauthManager.getState().email ?? ''
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(oauthCallbackPage({
          success: true,
          title: 'Google Apps conectado',
          message: email ? `Autenticado como ${email}` : 'Esta ventana se cerrara automaticamente',
        }))
      } catch (err) {
        logger.error({ err }, 'Google Apps OAuth callback failed')
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(oauthCallbackPage({ success: false, title: 'Error de autenticacion', message: String(err) }))
      }
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
        const redirectUri = getRedirectUri(req)
        await oauthManager.handleAuthCallback(code, redirectUri)
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
  version: '1.1.0',
  description: {
    es: 'Integración Google API: OAuth2, Drive, Sheets, Docs, Slides, Calendar',
    en: 'Google API integration: OAuth2, Drive, Sheets, Docs, Slides, Calendar',
  },
  type: 'provider',
  removable: true,
  activateByDefault: true,
  depends: [],

  configSchema: z.object({
    GOOGLE_CLIENT_ID: z.string().default(''),
    GOOGLE_CLIENT_SECRET: z.string().default(''),
    GOOGLE_REFRESH_TOKEN: z.string().default(''),
    GOOGLE_ENABLED_SERVICES: z.string().default('drive,sheets,docs,slides,calendar,gmail'),
    GOOGLE_TOKEN_REFRESH_BUFFER_MS: numEnv(300000),
    GOOGLE_API_TIMEOUT_MS: numEnv(30000),
    GOOGLE_API_RETRY_MAX: numEnv(2),
  }),

  console: {
    title: { es: 'Google Workspace', en: 'Google Workspace' },
    info: {
      es: 'Conexión OAuth2 a Google. Habilita Drive, Sheets, Docs, Slides y Calendar. Cada servicio se activa/desactiva individualmente.',
      en: 'OAuth2 connection to Google. Enables Drive, Sheets, Docs, Slides and Calendar. Each service can be toggled individually.',
    },
    order: 15,
    group: 'modules',
    icon: '&#128279;',
    fields: [
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
      logger.info('Google API credentials not configured — use console wizard to set them')
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
      services.sheets = new SheetsService(authClient, config)
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
      services.calendar = new CalendarService(authClient, config)
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
