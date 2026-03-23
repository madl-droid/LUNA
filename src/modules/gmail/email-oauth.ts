// LUNA — Module: gmail — Standalone OAuth Manager
// OAuth2 ligero para Gmail-only. Se usa cuando el módulo google-apps NO está activo.
// Si google-apps está activo, email usa su OAuthManager compartido.

import { OAuth2Client } from 'google-auth-library'
import pino from 'pino'
import type { Pool } from 'pg'

const logger = pino({ name: 'email:oauth' })

const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.modify',
  'https://www.googleapis.com/auth/userinfo.email',
]

export interface EmailOAuthConfig {
  GMAIL_CLIENT_ID: string
  GMAIL_CLIENT_SECRET: string
  GMAIL_REFRESH_TOKEN: string
  GMAIL_TOKEN_REFRESH_BUFFER_MS: number
}

export interface EmailAuthState {
  status: 'disconnected' | 'connected' | 'error' | 'refreshing'
  email: string | null
  scopes: string[]
  lastRefreshAt: Date | null
  expiresAt: Date | null
  error: string | null
}

/**
 * OAuth2 manager minimalista para email standalone.
 * Redirect URI se construye dinámicamente desde el request (no desde config).
 */
export class EmailOAuthManager {
  private client: OAuth2Client
  private state: EmailAuthState = {
    status: 'disconnected',
    email: null,
    scopes: [],
    lastRefreshAt: null,
    expiresAt: null,
    error: null,
  }
  private refreshTimer: ReturnType<typeof setTimeout> | null = null

  constructor(
    private config: EmailOAuthConfig,
    private db: Pool,
  ) {
    // No redirect_uri in constructor — it's set dynamically per request
    this.client = new OAuth2Client(
      config.GMAIL_CLIENT_ID,
      config.GMAIL_CLIENT_SECRET,
    )
  }

  /** Re-create OAuth client with new credentials (for setup-credentials flow) */
  updateCredentials(clientId: string, clientSecret: string): void {
    this.config.GMAIL_CLIENT_ID = clientId
    this.config.GMAIL_CLIENT_SECRET = clientSecret
    this.client = new OAuth2Client(clientId, clientSecret)
    logger.info('Email OAuth credentials updated')
  }

  async initialize(): Promise<void> {
    if (!this.config.GMAIL_CLIENT_ID || !this.config.GMAIL_CLIENT_SECRET) {
      logger.warn('No Gmail credentials — OAuth not connected')
      return
    }

    // 1. Intentar cargar token de DB
    const stored = await this.loadTokenFromDb()
    logger.debug({ hasStoredToken: !!stored }, 'Token DB lookup result')
    if (stored) {
      this.client.setCredentials({
        refresh_token: stored.refreshToken,
        access_token: stored.accessToken,
        expiry_date: stored.expiresAt.getTime(),
      })
      this.state.email = stored.email
      this.state.scopes = stored.scopes
      this.state.expiresAt = stored.expiresAt

      const now = Date.now()
      const expiresIn = stored.expiresAt.getTime() - now
      if (expiresIn < this.config.GMAIL_TOKEN_REFRESH_BUFFER_MS) {
        await this.refreshAccessToken()
      } else {
        this.state.status = 'connected'
        this.scheduleRefresh(expiresIn - this.config.GMAIL_TOKEN_REFRESH_BUFFER_MS)
      }
      logger.info({ email: this.state.email }, 'Email OAuth restored from DB')
      return
    }

    // 2. Si hay refresh token en config, usarlo
    if (this.config.GMAIL_REFRESH_TOKEN) {
      this.client.setCredentials({
        refresh_token: this.config.GMAIL_REFRESH_TOKEN,
      })
      await this.refreshAccessToken()
      logger.info({ email: this.state.email }, 'Email OAuth initialized from config refresh token')
      return
    }

    logger.warn('No Google refresh token — email OAuth not connected')
  }

  async refreshAccessToken(): Promise<void> {
    try {
      this.state.status = 'refreshing'
      const { credentials } = await this.client.refreshAccessToken()
      const expiryDate = credentials.expiry_date ?? Date.now() + 3600 * 1000

      this.client.setCredentials(credentials)

      if (!this.state.email && credentials.access_token) {
        try {
          const tokenInfo = await this.client.getTokenInfo(credentials.access_token)
          this.state.email = tokenInfo.email ?? null
        } catch { /* non-critical */ }
      }

      this.state.status = 'connected'
      this.state.lastRefreshAt = new Date()
      this.state.expiresAt = new Date(expiryDate)
      this.state.scopes = credentials.scope?.split(' ') ?? this.state.scopes
      this.state.error = null

      await this.saveTokenToDb({
        accessToken: credentials.access_token ?? '',
        refreshToken: credentials.refresh_token ?? this.config.GMAIL_REFRESH_TOKEN,
        expiresAt: new Date(expiryDate),
        scopes: this.state.scopes,
        email: this.state.email,
      })

      const refreshIn = expiryDate - Date.now() - this.config.GMAIL_TOKEN_REFRESH_BUFFER_MS
      this.scheduleRefresh(Math.max(refreshIn, 60_000))

      logger.info(
        { email: this.state.email, expiresIn: Math.round((expiryDate - Date.now()) / 1000) },
        'Email access token refreshed',
      )
    } catch (err) {
      this.state.status = 'error'
      this.state.error = err instanceof Error ? err.message : String(err)
      logger.error({ err }, 'Failed to refresh email access token')
      this.scheduleRefresh(60_000)
    }
  }

  getClient(): OAuth2Client {
    return this.client
  }

  getState(): EmailAuthState {
    return { ...this.state }
  }

  isConnected(): boolean {
    return this.state.status === 'connected'
  }

  hasCredentials(): boolean {
    return !!(this.config.GMAIL_CLIENT_ID && this.config.GMAIL_CLIENT_SECRET)
  }

  /** Generate auth URL with dynamic redirect_uri from the request */
  generateAuthUrl(redirectUri: string, state?: string): string {
    return this.client.generateAuthUrl({
      access_type: 'offline',
      scope: GMAIL_SCOPES,
      prompt: 'consent',
      include_granted_scopes: true,
      redirect_uri: redirectUri,
      state: state || 'gmail',
    })
  }

  /** Exchange code for tokens, using the same redirect_uri used in generateAuthUrl */
  async handleAuthCallback(code: string, redirectUri: string): Promise<void> {
    const { tokens } = await this.client.getToken({ code, redirect_uri: redirectUri })
    this.client.setCredentials(tokens)

    const expiryDate = tokens.expiry_date ?? Date.now() + 3600 * 1000

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
      refreshToken: tokens.refresh_token ?? this.config.GMAIL_REFRESH_TOKEN,
      expiresAt: new Date(expiryDate),
      scopes: this.state.scopes,
      email: this.state.email,
    })

    const refreshIn = expiryDate - Date.now() - this.config.GMAIL_TOKEN_REFRESH_BUFFER_MS
    this.scheduleRefresh(Math.max(refreshIn, 60_000))

    logger.info({ email: this.state.email }, 'Email OAuth callback handled — connected')
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
    } catch { /* revoke may fail if expired */ }

    this.client.setCredentials({})
    this.state = {
      status: 'disconnected',
      email: null,
      scopes: [],
      lastRefreshAt: null,
      expiresAt: null,
      error: null,
    }

    await this.db.query(`DELETE FROM email_oauth_tokens WHERE id = 'primary'`)
    logger.info('Email OAuth disconnected and tokens revoked')
  }

  async shutdown(): Promise<void> {
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer)
      this.refreshTimer = null
    }
  }

  // ─── DB persistence (tabla propia, no comparte con google-apps) ────

  private async saveTokenToDb(token: { accessToken: string; refreshToken: string; expiresAt: Date; scopes: string[]; email: string | null }): Promise<void> {
    try {
      await this.db.query(`
        INSERT INTO email_oauth_tokens (id, access_token, refresh_token, expires_at, scopes, email)
        VALUES ('primary', $1, $2, $3, $4, $5)
        ON CONFLICT (id) DO UPDATE SET
          access_token = $1, refresh_token = $2, expires_at = $3, scopes = $4, email = $5,
          updated_at = now()
      `, [token.accessToken, token.refreshToken, token.expiresAt, JSON.stringify(token.scopes), token.email])
    } catch (err) {
      logger.error({ err }, 'Failed to save email token to DB')
    }
  }

  private async loadTokenFromDb(): Promise<{ accessToken: string; refreshToken: string; expiresAt: Date; scopes: string[]; email: string | null } | null> {
    try {
      const result = await this.db.query(
        `SELECT access_token, refresh_token, expires_at, scopes, email FROM email_oauth_tokens WHERE id = 'primary'`,
      )
      const row = result.rows[0]
      if (!row) return null
      return {
        accessToken: row.access_token,
        refreshToken: row.refresh_token,
        expiresAt: new Date(row.expires_at),
        scopes: JSON.parse(row.scopes ?? '[]'),
        email: row.email,
      }
    } catch (err) {
      logger.warn({ err }, 'Failed to load email token from DB')
      return null
    }
  }

  private scheduleRefresh(ms: number): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer)
    this.refreshTimer = setTimeout(() => {
      this.refreshAccessToken().catch((err) => {
        logger.error({ err }, 'Scheduled email token refresh failed')
      })
    }, ms)
  }
}
