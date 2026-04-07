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
import { CalendarConfigService } from './calendar-config.js'
import { renderCalendarSettingsPage } from './calendar-console.js'
import { CalendarFollowUpScheduler, registerCalendarFollowUpTool } from './calendar-followups.js'
import type { GoogleApiConfig, GoogleServiceName } from './types.js'

const logger = pino({ name: 'google-apps' })

let oauthManager: OAuthManager | null = null
let _registry: Registry | null = null
let _services: {
  drive?: DriveService
  sheets?: SheetsService
  docs?: DocsService
  slides?: SlidesService
  calendar?: CalendarService
} = {}
let _enabledSet: Set<GoogleServiceName> = new Set()
let _toolsRegistered = false
let _calConfigService: CalendarConfigService | null = null
let _calFollowUpScheduler: CalendarFollowUpScheduler | null = null

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

        // Register tools now that OAuth is connected
        if (!_toolsRegistered && _registry && oauthManager.isConnected()) {
          _toolsRegistered = true
          await registerGoogleTools(_registry, _services, _enabledSet, true)
          logger.info('Google tools registered after OAuth connect')
        }

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

        // Register tools now that OAuth is connected
        if (!_toolsRegistered && _registry && oauthManager.isConnected()) {
          _toolsRegistered = true
          await registerGoogleTools(_registry, _services, _enabledSet, true)
          logger.info('Google tools registered after OAuth connect')
        }

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
  // ── Calendar config ──
  {
    method: 'GET',
    path: 'calendar-config',
    handler: async (_req, res) => {
      const config = _calConfigService?.get() ?? null
      const usersDb = _registry?.getOptional<{
        getListConfig(t: string): Promise<{ syncConfig: Record<string, unknown> } | null>
        listByType(t: string, active: boolean): Promise<Array<{ id: string; displayName?: string; contacts?: Array<{ channel: string; senderId: string }>; metadata?: unknown }>>
      }>('users:db')
      const coworkerListConfig = await usersDb?.getListConfig?.('coworker') ?? null
      const roles: string[] = ((coworkerListConfig?.syncConfig as Record<string, unknown>)?.roles as string[]) ?? []
      const allCoworkers = await usersDb?.listByType?.('coworker', true) ?? []
      const coworkersByRole: Record<string, Array<{ id: string; displayName: string; email: string; role: string }>> = {}
      for (const role of roles) {
        coworkersByRole[role] = allCoworkers
          .filter(u => (u.metadata as Record<string, unknown>)?.role === role)
          .map(u => ({
            id: u.id,
            displayName: u.displayName ?? u.id,
            email: u.contacts?.find(c => c.channel === 'email')?.senderId ?? '',
            role,
          }))
      }
      jsonResponse(res, 200, { config, roles, coworkersByRole })
    },
  },
  {
    method: 'POST',
    path: 'calendar-config',
    handler: async (req, res) => {
      if (!_calConfigService) {
        jsonResponse(res, 503, { error: 'Calendar config service not ready' })
        return
      }
      try {
        const body = await parseBody<{
          meetEnabled: boolean
          defaultReminders: Array<{ method: 'email' | 'popup'; minutes: number }>
          defaultDurationMinutes: number
          eventNamePrefix: string
          descriptionInstructions: string
          daysOff: Array<{ type: string; date?: string; start?: string; end?: string }>
          schedulingRoles: Record<string, { enabled: boolean; instructions: string }>
          schedulingCoworkers: Record<string, { enabled: boolean; instructions: string }>
          followUpPost: { enabled: boolean; delayMinutes: number }
          followUpPre: { enabled: boolean; hoursBefore: number }
        }>(req)
        // Clamp numeric values
        if (body.defaultDurationMinutes < 15) body.defaultDurationMinutes = 15
        if (body.defaultDurationMinutes > 480) body.defaultDurationMinutes = 480
        if (body.followUpPost?.delayMinutes < 30) body.followUpPost.delayMinutes = 30
        if (body.followUpPost?.delayMinutes > 360) body.followUpPost.delayMinutes = 360
        if (body.followUpPre?.hoursBefore < 3) body.followUpPre.hoursBefore = 3
        if (body.followUpPre?.hoursBefore > 24) body.followUpPre.hoursBefore = 24
        await _calConfigService.save(body as Parameters<typeof _calConfigService.save>[0])
        jsonResponse(res, 200, { ok: true })
      } catch (err) {
        jsonResponse(res, 500, { error: 'Save failed: ' + String(err) })
      }
    },
  },
  {
    method: 'POST',
    path: 'calendar-check-access',
    handler: async (req, res) => {
      const cal = _services.calendar
      if (!cal) {
        jsonResponse(res, 400, { error: 'Calendar not enabled' })
        return
      }
      try {
        const { emails } = await parseBody<{ emails: string[] }>(req)
        const results: Record<string, { hasAccess: boolean; error?: string }> = {}
        const now = new Date()
        const oneHour = new Date(now.getTime() + 3_600_000)
        for (const email of emails ?? []) {
          try {
            await cal.findFreeSlots(now.toISOString(), oneHour.toISOString(), [email])
            results[email] = { hasAccess: true }
          } catch (err: unknown) {
            results[email] = { hasAccess: false, error: err instanceof Error ? err.message : 'Unknown error' }
          }
        }
        jsonResponse(res, 200, results)
      } catch (err) {
        jsonResponse(res, 500, { error: 'Check failed: ' + String(err) })
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
    GOOGLE_ENABLED_SERVICES: z.string().default('drive,sheets,docs,slides,calendar,gmail,youtube'),
    GOOGLE_TOKEN_REFRESH_BUFFER_MS: numEnv(300000),
    GOOGLE_API_TIMEOUT_MS: numEnv(30000),
    GOOGLE_API_RETRY_MAX: numEnv(2),
  }),

  console: {
    title: { es: 'Google Workspace', en: 'Google Workspace' },
    info: {
      es: 'Conexión OAuth2 a Google. Habilita Drive, Sheets, Docs, Slides, Calendar, Gmail y YouTube. Cada servicio se activa/desactiva individualmente.',
      en: 'OAuth2 connection to Google. Enables Drive, Sheets, Docs, Slides, Calendar, Gmail and YouTube. Each service can be toggled individually.',
    },
    order: 15,
    group: 'modules',
    icon: '&#128279;',
    fields: [
      {
        key: 'GOOGLE_ENABLED_SERVICES',
        type: 'tags',
        label: { es: 'APIs habilitadas', en: 'Enabled APIs' },
        info: { es: 'Selecciona las APIs de Google a habilitar. Requiere re-autenticación al cambiar.', en: 'Select which Google APIs to enable. Requires re-authentication when changed.' },
        options: [
          { value: 'drive', label: 'Drive' },
          { value: 'sheets', label: 'Sheets' },
          { value: 'docs', label: 'Docs' },
          { value: 'slides', label: 'Slides' },
          { value: 'calendar', label: 'Calendar' },
          { value: 'gmail', label: 'Gmail' },
          { value: 'youtube', label: 'YouTube' },
        ],
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
    _enabledSet = new Set<GoogleServiceName>(enabledList as GoogleServiceName[])
    const authClient = oauthManager.getClient()

    _services = {}

    if (_enabledSet.has('drive')) {
      _services.drive = new DriveService(authClient, config)
      registry.provide('google:drive', _services.drive)
      logger.info('Drive service enabled')
    }

    if (_enabledSet.has('sheets')) {
      _services.sheets = new SheetsService(authClient, config)
      registry.provide('google:sheets', _services.sheets)
      logger.info('Sheets service enabled')
    }

    if (_enabledSet.has('docs')) {
      _services.docs = new DocsService(authClient)
      registry.provide('google:docs', _services.docs)
      logger.info('Docs service enabled')
    }

    if (_enabledSet.has('slides')) {
      _services.slides = new SlidesService(authClient)
      registry.provide('google:slides', _services.slides)
      logger.info('Slides service enabled')
    }

    if (_enabledSet.has('calendar')) {
      _services.calendar = new CalendarService(authClient, config)
      registry.provide('google:calendar', _services.calendar)
      logger.info('Calendar service enabled')
    }

    // Inicializar servicio de config de Calendar
    _calConfigService = new CalendarConfigService(db)
    await _calConfigService.load()
    registry.provide('google-apps:calendar-config', _calConfigService)

    // Renderer de la página de settings de Calendar para la console
    registry.provide('google-apps:renderCalendarSection', async (sectionData: { lang?: string }) => {
      const calCfg = _calConfigService!.get()
      const usersDb = registry.getOptional<{
        getListConfig(t: string): Promise<{ syncConfig: Record<string, unknown> } | null>
        listByType(t: string, active: boolean): Promise<Array<{ id: string; displayName?: string; contacts?: Array<{ channel: string; senderId: string }>; metadata?: unknown }>>
      }>('users:db')
      const coworkerListConfig = await usersDb?.getListConfig?.('coworker') ?? null
      const roles: string[] = ((coworkerListConfig?.syncConfig as Record<string, unknown>)?.roles as string[]) ?? []
      const allCoworkers = await usersDb?.listByType?.('coworker', true) ?? []
      const coworkersByRole: Record<string, Array<{ id: string; displayName: string; email: string; role: string }>> = {}
      for (const role of roles) {
        coworkersByRole[role] = allCoworkers
          .filter(u => (u.metadata as Record<string, unknown>)?.role === role)
          .map(u => ({
            id: u.id,
            displayName: u.displayName ?? u.id,
            email: u.contacts?.find(c => c.channel === 'email')?.senderId ?? '',
            role,
          }))
      }
      const lang = (sectionData?.lang === 'en' ? 'en' : 'es') as 'es' | 'en'
      return renderCalendarSettingsPage({ config: calCfg, roles, coworkersByRole, lang })
    })

    // Hot-reload al aplicar config desde la console
    registry.addHook('google-apps', 'console:config_applied', async () => {
      await _calConfigService?.reload()
    }, 100)

    // Inicializar follow-up scheduler de Calendar
    if (_enabledSet.has('calendar')) {
      _calFollowUpScheduler = new CalendarFollowUpScheduler(db, registry)

      // Registrar tool de ejecución de follow-ups
      registerCalendarFollowUpTool(registry, db)

      // Hook: cuando se crea un evento → programar follow-ups
      registry.addHook('google-apps', 'calendar:event-created', async (payload) => {
        try {
          await _calFollowUpScheduler?.scheduleFollowUps(payload as {
            event: import('./types.js').CalendarEvent
            contactId: string
            channel: string
            meetLink?: string | null
          })
        } catch (err) {
          logger.warn({ err }, 'Failed to schedule calendar follow-ups')
        }
      }, 100)

      // Hook: cuando se elimina un evento → cancelar follow-ups
      registry.addHook('google-apps', 'calendar:event-deleted', async (payload) => {
        try {
          const p = payload as { eventId: string }
          await _calFollowUpScheduler?.cancelFollowUps(p.eventId)
        } catch (err) {
          logger.warn({ err }, 'Failed to cancel calendar follow-ups')
        }
      }, 100)

      // Hook: cuando se actualiza un evento → reagendar follow-ups si cambió fecha
      registry.addHook('google-apps', 'calendar:event-updated', async (payload) => {
        try {
          const p = payload as { eventId: string; event: import('./types.js').CalendarEvent; dateChanged: boolean }
          if (p.dateChanged) {
            await _calFollowUpScheduler?.rescheduleFollowUps(p.eventId, p.event)
          }
        } catch (err) {
          logger.warn({ err }, 'Failed to reschedule calendar follow-ups')
        }
      }, 100)
    }

    // Registrar tools solo si OAuth está conectado (sin auth las tools fallarían)
    const oauthConnected = oauthManager?.isConnected() ?? false
    _toolsRegistered = oauthConnected
    await registerGoogleTools(registry, _services, _enabledSet, oauthConnected)

    // Habilitar subagent de calendar si el servicio está activo
    if (_enabledSet.has('calendar')) {
      try {
        await db.query(
          `UPDATE subagent_types SET enabled = true, updated_at = now() WHERE slug = 'google-calendar-scheduler'`
        )
        const saCatalog = registry.getOptional<{ reload(): Promise<void> }>('subagents:catalog')
        await saCatalog?.reload()
        logger.info('Google Calendar scheduler subagent enabled')
      } catch (err) {
        logger.warn({ err }, 'Could not enable calendar scheduler subagent')
      }
    }

    logger.info(
      { email: oauthManager.getState().email, services: enabledList },
      'Google API module initialized',
    )
  },

  async stop() {
    // Deshabilitar subagent de calendar
    if (_registry) {
      try {
        const db = _registry.getDb()
        await db.query(
          `UPDATE subagent_types SET enabled = false, updated_at = now() WHERE slug = 'google-calendar-scheduler'`
        )
        const saCatalog = _registry.getOptional<{ reload(): Promise<void> }>('subagents:catalog')
        await saCatalog?.reload()
      } catch (err) {
        logger.warn({ err }, 'Could not disable calendar scheduler subagent')
      }
    }

    if (oauthManager) {
      await oauthManager.shutdown()
      oauthManager = null
    }
    _registry = null
    _services = {}
    _enabledSet = new Set()
    _toolsRegistered = false
    _calConfigService = null
    _calFollowUpScheduler = null
  },
}

export default manifest
