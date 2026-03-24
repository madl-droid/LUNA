// LUNA — Module: google-apps — OAuth Manager
// Maneja autenticación OAuth2, refresh de tokens, y estado de conexión.

import { OAuth2Client } from 'google-auth-library'
import pino from 'pino'
import type { Pool } from 'pg'
import type { GoogleApiConfig, GoogleAuthState, TokenInfo } from './types.js'

const logger = pino({ name: 'google-apps:oauth' })

// Scopes por servicio — se combinan según los servicios habilitados
export const SCOPES_BY_SERVICE: Record<string, string[]> = {
  drive: [
    'https://www.googleapis.com/auth/drive',
  ],
  sheets: [
    'https://www.googleapis.com/auth/spreadsheets',
  ],
  docs: [
    'https://www.googleapis.com/auth/documents',
  ],
  slides: [
    'https://www.googleapis.com/auth/presentations',
  ],
  calendar: [
    'https://www.googleapis.com/auth/calendar',
  ],
}

export class OAuthManager {
  private client: OAuth2Client
  private state: GoogleAuthState = {
    status: 'disconnected',
    email: null,
    scopes: [],
    lastRefreshAt: null,
    expiresAt: null,
    error: null,
  }
  private refreshTimer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private config: GoogleApiConfig,
    private db: Pool,
  ) {
    // No redirect_uri in constructor — it's set dynamically per request
    this.client = new OAuth2Client(
      config.GOOGLE_CLIENT_ID,
      config.GOOGLE_CLIENT_SECRET,
    )
  }

  /** Re-create OAuth client with new credentials (for setup-credentials flow) */
  updateCredentials(clientId: string, clientSecret: string): void {
    this.config.GOOGLE_CLIENT_ID = clientId
    this.config.GOOGLE_CLIENT_SECRET = clientSecret
    this.client = new OAuth2Client(clientId, clientSecret)
    logger.info('Google Apps OAuth credentials updated')
  }

  async initialize(): Promise<void> {
    // Intentar cargar token almacenado en DB
    const stored = await this.loadTokenFromDb()
    if (stored) {
      this.client.setCredentials({
        refresh_token: stored.refreshToken,
        access_token: stored.accessToken,
        expiry_date: stored.expiresAt.getTime(),
      })
      this.state.email = stored.email
      this.state.scopes = stored.scopes
      this.state.expiresAt = stored.expiresAt

      // Refresh si está por expirar
      const now = Date.now()
      const expiresIn = stored.expiresAt.getTime() - now
      if (expiresIn < this.config.GOOGLE_TOKEN_REFRESH_BUFFER_MS) {
        await this.refreshAccessToken()
      } else {
        this.state.status = 'connected'
        this.scheduleRefresh(expiresIn - this.config.GOOGLE_TOKEN_REFRESH_BUFFER_MS)
      }
      logger.info({ email: this.state.email }, 'Google OAuth restored from DB')
      return
    }

    // Si hay refresh token en config, usarlo directamente
    if (this.config.GOOGLE_REFRESH_TOKEN) {
      this.client.setCredentials({
        refresh_token: this.config.GOOGLE_REFRESH_TOKEN,
      })
      await this.refreshAccessToken()
      logger.info({ email: this.state.email }, 'Google OAuth initialized from config refresh token')
      return
    }

    logger.warn('No Google refresh token available — OAuth not connected')
  }

  async refreshAccessToken(): Promise<void> {
    try {
      this.state.status = 'refreshing'

      const { credentials } = await this.client.refreshAccessToken()
      const expiryDate = credentials.expiry_date ?? Date.now() + 3600 * 1000

      this.client.setCredentials(credentials)

      // Obtener email si no lo tenemos
      if (!this.state.email && credentials.access_token) {
        try {
          const tokenInfo = await this.client.getTokenInfo(credentials.access_token)
          this.state.email = tokenInfo.email ?? null
        } catch {
          // Non-critical
        }
      }

      this.state.status = 'connected'
      this.state.lastRefreshAt = new Date()
      this.state.expiresAt = new Date(expiryDate)
      this.state.scopes = credentials.scope?.split(' ') ?? this.state.scopes
      this.state.error = null

      // Persistir en DB
      await this.saveTokenToDb({
        accessToken: credentials.access_token ?? '',
        refreshToken: credentials.refresh_token ?? this.config.GOOGLE_REFRESH_TOKEN,
        expiresAt: new Date(expiryDate),
        scopes: this.state.scopes,
        email: this.state.email,
      })

      // Programar siguiente refresh
      const refreshIn = expiryDate - Date.now() - this.config.GOOGLE_TOKEN_REFRESH_BUFFER_MS
      this.scheduleRefresh(Math.max(refreshIn, 60_000))

      logger.info(
        { email: this.state.email, expiresIn: Math.round((expiryDate - Date.now()) / 1000) },
        'Access token refreshed',
      )
    } catch (err) {
      this.state.status = 'error'
      this.state.error = err instanceof Error ? err.message : String(err)
      logger.error({ err }, 'Failed to refresh access token')

      // Retry en 60 segundos
      this.scheduleRefresh(60_000)
    }
  }

  getClient(): OAuth2Client {
    return this.client
  }

  getState(): GoogleAuthState {
    return { ...this.state }
  }

  isConnected(): boolean {
    return this.state.status === 'connected'
  }

  hasCredentials(): boolean {
    return !!(this.config.GOOGLE_CLIENT_ID && this.config.GOOGLE_CLIENT_SECRET)
  }

  /**
   * Generate authorization URL for initial OAuth2 flow.
   * redirect_uri is built dynamically from the incoming request.
   */
  generateAuthUrl(enabledServices: string[], redirectUri: string, state?: string): string {
    const scopes: string[] = []
    for (const service of enabledServices) {
      const svcScopes = SCOPES_BY_SERVICE[service]
      if (svcScopes) scopes.push(...svcScopes)
    }
    // Siempre incluir profile para obtener email
    scopes.push('https://www.googleapis.com/auth/userinfo.email')

    return this.client.generateAuthUrl({
      access_type: 'offline',
      scope: [...new Set(scopes)],
      prompt: 'consent',
      include_granted_scopes: true,
      redirect_uri: redirectUri,
      state: state || 'google-apps',
    })
  }

  /**
   * Exchange authorization code for tokens.
   * Must use the same redirect_uri as generateAuthUrl.
   */
  async handleAuthCallback(code: string, redirectUri: string): Promise<void> {
    const { tokens } = await this.client.getToken({ code, redirect_uri: redirectUri })
    this.client.setCredentials(tokens)

    const expiryDate = tokens.expiry_date ?? Date.now() + 3600 * 1000

    // Obtener email
    if (tokens.access_token) {
      try {
        const tokenInfo = await this.client.getTokenInfo(tokens.access_token)
        this.state.email = tokenInfo.email ?? null
      } catch { /* non-critical */ }
    }

    this.state.status = 'connected'
    this.state.lastRefreshAt = new Date()
    this.state.expiresAt = new Date(expiryDate)
    this.state.scopes = tokens.scope?.split(' ') ?? []
    this.state.error = null

    await this.saveTokenToDb({
      accessToken: tokens.access_token ?? '',
      refreshToken: tokens.refresh_token ?? this.config.GOOGLE_REFRESH_TOKEN,
      expiresAt: new Date(expiryDate),
      scopes: this.state.scopes,
      email: this.state.email,
    })

    const refreshIn = expiryDate - Date.now() - this.config.GOOGLE_TOKEN_REFRESH_BUFFER_MS
    this.scheduleRefresh(Math.max(refreshIn, 60_000))

    logger.info({ email: this.state.email }, 'OAuth callback handled — connected')
  }

  async disconnect(): Promise<void> {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer)
      this.refreshTimer = null
    }

    try {
      const credentials = this.client.credentials
      if (credentials.access_token) {
        await this.client.revokeToken(credentials.access_token)
      }
    } catch {
      // Revoke may fail if token already expired — not critical
    }

    this.client.setCredentials({})
    this.state = {
      status: 'disconnected',
      email: null,
      scopes: [],
      lastRefreshAt: null,
      expiresAt: null,
      error: null,
    }

    // Limpiar de DB
    await this.db.query(`DELETE FROM google_oauth_tokens WHERE id = 'primary'`)
    logger.info('Google OAuth disconnected and tokens revoked')
  }

  async shutdown(): Promise<void> {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer)
      this.refreshTimer = null
    }
  }

  // ─── DB persistence ────────────────────────

  private async saveTokenToDb(token: TokenInfo): Promise<void> {
    try {
      await this.db.query(`
        INSERT INTO google_oauth_tokens (id, access_token, refresh_token, expires_at, scopes, email)
        VALUES ('primary', $1, $2, $3, $4, $5)
        ON CONFLICT (id) DO UPDATE SET
          access_token = $1, refresh_token = $2, expires_at = $3, scopes = $4, email = $5,
          updated_at = now()
      `, [token.accessToken, token.refreshToken, token.expiresAt, JSON.stringify(token.scopes), token.email])
    } catch (err) {
      logger.error({ err }, 'Failed to save token to DB')
    }
  }

  private async loadTokenFromDb(): Promise<TokenInfo | null> {
    try {
      const result = await this.db.query(
        `SELECT access_token, refresh_token, expires_at, scopes, email FROM google_oauth_tokens WHERE id = 'primary'`,
      )
      const row = result.rows[0]
      if (!row) return null
      return {
        accessToken: row.access_token,
        refreshToken: row.refresh_token,
        expiresAt: new Date(row.expires_at),
        scopes: Array.isArray(row.scopes) ? row.scopes : JSON.parse(row.scopes ?? '[]'),
        email: row.email,
      }
    } catch {
      return null
    }
  }

  private scheduleRefresh(ms: number): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer)
    this.refreshTimer = setTimeout(() => {
      this.refreshAccessToken().catch((err) => {
        logger.error({ err }, 'Scheduled token refresh failed')
      })
    }, ms)
  }
}
