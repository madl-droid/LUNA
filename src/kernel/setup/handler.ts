// LUNA — Setup wizard: HTTP handler
// Runs BEFORE modules are loaded. Handles GET/POST for /setup/step/{1-5}.
// State between steps is in-memory (ephemeral, keyed by cookie).

import * as http from 'node:http'
import * as crypto from 'node:crypto'
import type { Pool } from 'pg'
import type { Redis } from 'ioredis'
import pino from 'pino'

import * as configStore from '../config-store.js'
import { hashPassword, createSession, sessionCookie } from './auth.js'
import { st, detectSetupLang, type SetupLang } from './i18n.js'
import {
  stepWelcome, stepAdmin, stepAgent, stepApiKeys, stepSystem, setupCompletePage,
  emptyState, type SetupState,
} from './templates.js'

const logger = pino({ name: 'kernel:setup' })

const SETUP_COOKIE = 'luna_setup_token'

// ═══════════════════════════════════════════
// Form parser (application/x-www-form-urlencoded)
// ═══════════════════════════════════════════

function parseFormBody(req: http.IncomingMessage): Promise<Record<string, string>> {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (chunk: Buffer) => { body += chunk.toString() })
    req.on('end', () => {
      const params = new URLSearchParams(body)
      const result: Record<string, string> = {}
      for (const [key, value] of params) {
        result[key] = value
      }
      resolve(result)
    })
    req.on('error', reject)
  })
}

// ═══════════════════════════════════════════
// Users DDL (copied from users module — idempotent)
// ═══════════════════════════════════════════

const USERS_DDL = `
CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(20) PRIMARY KEY,
  display_name VARCHAR(255),
  list_type VARCHAR(50) NOT NULL DEFAULT 'lead',
  metadata JSONB DEFAULT '{}',
  is_active BOOLEAN DEFAULT true,
  source VARCHAR(50) DEFAULT 'manual',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_users_type ON users(list_type, is_active);

CREATE TABLE IF NOT EXISTS user_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(20) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel VARCHAR(50) NOT NULL,
  sender_id VARCHAR(255) NOT NULL,
  is_primary BOOLEAN DEFAULT false,
  verified BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(channel, sender_id)
);
CREATE INDEX IF NOT EXISTS idx_user_contacts_sender ON user_contacts(sender_id, channel);
CREATE INDEX IF NOT EXISTS idx_user_contacts_user ON user_contacts(user_id);

CREATE TABLE IF NOT EXISTS user_list_config (
  list_type VARCHAR(50) PRIMARY KEY,
  display_name VARCHAR(100) NOT NULL,
  is_enabled BOOLEAN DEFAULT true,
  permissions JSONB NOT NULL,
  sync_config JSONB DEFAULT '{}',
  unregistered_behavior VARCHAR(50) DEFAULT 'silence',
  unregistered_message TEXT,
  max_users INT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
`

const ID_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
function generateUserId(): string {
  let code = ''
  for (let i = 0; i < 5; i++) code += ID_CHARS[Math.floor(Math.random() * ID_CHARS.length)]!
  return `USR-${code}`
}

// ═══════════════════════════════════════════
// Validation
// ═══════════════════════════════════════════

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const PHONE_RE = /^\+\d{7,15}$/
const VALID_AGENT_LANGS = new Set(['es', 'en'])
const VALID_AGENT_ACCENTS: Record<string, Set<string>> = {
  es: new Set(['', 'es-MX', 'es-CO', 'es-EC', 'es-PE', 'es-CL', 'es-CAR']),
  en: new Set(['', 'en-US', 'en-CAR']),
}

function validateAdmin(form: Record<string, string>, lang: SetupLang): Record<string, string> {
  const errors: Record<string, string> = {}
  if (!form['admin_name']?.trim()) errors['admin_name'] = st('err_name_required', lang)
  if (!form['admin_email']?.trim()) errors['admin_email'] = st('err_email_required', lang)
  else if (!EMAIL_RE.test(form['admin_email']!.trim())) errors['admin_email'] = st('err_email_invalid', lang)
  const phone = form['admin_phone']?.trim()
  if (phone && !PHONE_RE.test(phone)) errors['admin_phone'] = st('err_phone_invalid', lang)
  if (!form['admin_password']) errors['admin_password'] = st('err_password_required', lang)
  else if (form['admin_password']!.length < 8) errors['admin_password'] = st('err_password_min', lang)
  if (form['admin_password'] !== form['admin_password_confirm']) errors['admin_password_confirm'] = st('err_password_mismatch', lang)
  return errors
}

function validateAgent(form: Record<string, string>, lang: SetupLang): Record<string, string> {
  const errors: Record<string, string> = {}
  if (!form['agent_name']?.trim()) errors['agent_name'] = st('err_agent_name_required', lang)
  const agentLang = form['agent_language']?.trim() ?? 'es'
  const normalizedLang = VALID_AGENT_LANGS.has(agentLang) ? agentLang : 'es'
  const agentAccent = form['agent_accent']?.trim() ?? ''
  if (!(VALID_AGENT_ACCENTS[normalizedLang]?.has(agentAccent) ?? false)) {
    errors['_global'] = lang === 'es'
      ? 'El acento seleccionado no es valido para ese idioma.'
      : 'The selected accent is not valid for that language.'
  }
  return errors
}

function validateApiKeys(form: Record<string, string>, lang: SetupLang): Record<string, string> {
  const errors: Record<string, string> = {}
  const hasAnthropic = !!form['anthropic_api_key']?.trim()
  const hasGoogle = !!form['google_api_key']?.trim()
  if (!hasAnthropic && !hasGoogle) {
    errors['_global'] = st('err_no_api_key', lang)
  }
  return errors
}

// ═══════════════════════════════════════════
// Main handler
// ═══════════════════════════════════════════

interface WizardContext {
  pool: Pool
  redis: Redis
  sessions: Map<string, SetupState>
  onComplete: () => void
}

function getOrCreateState(req: http.IncomingMessage, ctx: WizardContext): { token: string; state: SetupState; isNew: boolean } {
  const cookies = req.headers['cookie'] ?? ''
  const match = cookies.match(new RegExp(`${SETUP_COOKIE}=([^;]+)`))
  const existing = match?.[1]
  if (existing && ctx.sessions.has(existing)) {
    return { token: existing, state: ctx.sessions.get(existing)!, isNew: false }
  }
  // New session — use existing cookie token (for factory reset prefill) or generate new
  const token = existing ?? crypto.randomBytes(16).toString('hex')
  const state = emptyState()
  ctx.sessions.set(token, state)
  return { token, state, isNew: true }
}

function redirect(res: http.ServerResponse, location: string, token?: string): void {
  const headers: Record<string, string | string[]> = { Location: location }
  if (token) {
    headers['Set-Cookie'] = `${SETUP_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax`
  }
  res.writeHead(302, headers)
  res.end()
}

function sendHtml(res: http.ServerResponse, html: string, token?: string): void {
  const headers: Record<string, string | string[]> = { 'Content-Type': 'text/html; charset=utf-8' }
  if (token) {
    headers['Set-Cookie'] = `${SETUP_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax`
  }
  res.writeHead(200, headers)
  res.end(html)
}

/** Load prefill data from Redis (factory reset scenario). */
async function loadPrefill(redis: Redis, token: string): Promise<Partial<SetupState> | null> {
  try {
    const raw = await redis.get(`setup_prefill:${token}`)
    if (!raw) return null
    await redis.del(`setup_prefill:${token}`)
    return JSON.parse(raw) as Partial<SetupState>
  } catch {
    return null
  }
}

export function createSetupHandler(pool: Pool, redis: Redis, onComplete: () => void): (req: http.IncomingMessage, res: http.ServerResponse) => Promise<void> {
  const ctx: WizardContext = { pool, redis, sessions: new Map(), onComplete }

  return async (req, res) => {
    const url = req.url ?? '/'
    const urlPath = url.split('?')[0]!
    const method = req.method ?? 'GET'

    // Health check passthrough
    if (urlPath === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ status: 'setup_pending' }))
      return
    }

    // Redirect everything except /setup/* to /setup/step/1
    if (!urlPath.startsWith('/setup')) {
      redirect(res, '/setup/step/1')
      return
    }

    const { token, state, isNew } = getOrCreateState(req, ctx)

    // Try loading prefill on first access (factory reset scenario)
    if (isNew) {
      const prefill = await loadPrefill(redis, token)
      if (prefill) {
        Object.assign(state, prefill)
        // Never prefill password
        state.adminPassword = ''
      }
    }

    const lang = state.lang || detectSetupLang(req.headers['cookie'])

    // ─── GET: Render steps ──────────────────
    if (method === 'GET') {
      if (urlPath === '/setup/step/1' || urlPath === '/setup') {
        sendHtml(res, stepWelcome(lang, state), token)
        return
      }
      if (urlPath === '/setup/step/2') {
        sendHtml(res, stepAdmin(lang, state), token)
        return
      }
      if (urlPath === '/setup/step/3') {
        sendHtml(res, stepAgent(lang, state), token)
        return
      }
      if (urlPath === '/setup/step/4') {
        sendHtml(res, stepApiKeys(lang, state), token)
        return
      }
      if (urlPath === '/setup/step/5') {
        sendHtml(res, stepSystem(lang, state), token)
        return
      }
      redirect(res, '/setup/step/1', token)
      return
    }

    // ─── POST: Process steps ────────────────
    if (method === 'POST') {
      const form = await parseFormBody(req)

      // Step 1: Language selection
      if (urlPath === '/setup/step/1') {
        const selectedLang = form['lang'] === 'en' ? 'en' : 'es'
        state.lang = selectedLang
        // Set language cookie too
        res.writeHead(302, {
          Location: '/setup/step/2',
          'Set-Cookie': [
            `${SETUP_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax`,
            `luna-lang=${selectedLang}; Path=/; Max-Age=31536000`,
          ],
        })
        res.end()
        return
      }

      // Step 2: Admin account
      if (urlPath === '/setup/step/2') {
        state.adminName = form['admin_name']?.trim() ?? ''
        state.adminEmail = form['admin_email']?.trim() ?? ''
        state.adminPhone = form['admin_phone']?.trim() ?? ''
        state.adminPassword = form['admin_password'] ?? ''

        const errors = validateAdmin(form, lang)
        if (Object.keys(errors).length > 0) {
          sendHtml(res, stepAdmin(lang, state, errors), token)
          return
        }
        redirect(res, '/setup/step/3', token)
        return
      }

      // Step 3: Agent persona
      if (urlPath === '/setup/step/3') {
        state.agentName = form['agent_name']?.trim() ?? ''
        state.agentLastName = form['agent_last_name']?.trim() ?? ''
        state.agentTitle = form['agent_title']?.trim() ?? ''
        const agentLang = form['agent_language']?.trim() ?? 'es'
        state.agentLanguage = VALID_AGENT_LANGS.has(agentLang) ? agentLang : 'es'
        const requestedAccent = form['agent_accent']?.trim() ?? ''
        state.agentAccent = VALID_AGENT_ACCENTS[state.agentLanguage]?.has(requestedAccent)
          ? requestedAccent
          : ''

        const errors = validateAgent(form, lang)
        if (Object.keys(errors).length > 0) {
          sendHtml(res, stepAgent(lang, state, errors), token)
          return
        }
        redirect(res, '/setup/step/4', token)
        return
      }

      // Step 4: API Keys
      if (urlPath === '/setup/step/4') {
        state.anthropicApiKey = form['anthropic_api_key']?.trim() ?? ''
        state.googleApiKey = form['google_api_key']?.trim() ?? ''

        const errors = validateApiKeys(form, lang)
        if (Object.keys(errors).length > 0) {
          sendHtml(res, stepApiKeys(lang, state, errors), token)
          return
        }
        redirect(res, '/setup/step/5', token)
        return
      }

      // Step 5: Company + finalize
      if (urlPath === '/setup/step/5') {
        state.companyName = form['company_name']?.trim() ?? ''

        // Validate company name
        if (!state.companyName) {
          const errors = { company_name: st('err_company_name_required', lang) }
          sendHtml(res, stepSystem(lang, state, errors), token)
          return
        }

        try {
          const authToken = await finalizeSetup(ctx, state, token)
          // Send completion page with BOTH the setup cookie and the session cookie
          const html = setupCompletePage(lang)
          res.writeHead(200, {
            'Content-Type': 'text/html; charset=utf-8',
            'Set-Cookie': [
              `${SETUP_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax`,
              sessionCookie(authToken),
            ],
          })
          res.end(html)
          return
        } catch (err) {
          logger.error({ err }, 'Setup finalization failed')
          const errMsg = err instanceof Error ? err.message : 'Unknown error'
          const errors = { _global: errMsg }
          sendHtml(res, stepSystem(lang, state, errors), token)
        }
        return
      }

      redirect(res, '/setup/step/1', token)
      return
    }

    // Fallback
    redirect(res, '/setup/step/1', token)
  }
}

// ═══════════════════════════════════════════
// Finalize: persist everything
// ═══════════════════════════════════════════

async function finalizeSetup(ctx: WizardContext, state: SetupState, token: string): Promise<string> {
  const { pool, redis } = ctx

  logger.info('Finalizing setup wizard...')

  // 0. Clear all channel credentials for a fresh start
  const channelCleanup = [
    'DELETE FROM wa_auth_creds',
    'DELETE FROM wa_auth_keys',
    'DELETE FROM google_oauth_tokens',
    `DELETE FROM config_store WHERE key IN ('GOOGLE_CHAT_WEBHOOK_TOKEN', 'TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_PHONE_NUMBER', 'WHATSAPP_CONNECTION_STATUS', 'WHATSAPP_CONNECTED_NUMBER')`,
  ]
  for (const sql of channelCleanup) {
    try { await pool.query(sql) } catch { /* tables may not exist on first setup */ }
  }
  logger.info('Cleared all channel credentials for fresh setup')

  // 1. Create tables (DDL — outside transaction, idempotent)
  const ddlClient = await pool.connect()
  try {
    await ddlClient.query(USERS_DDL)
  } finally {
    ddlClient.release()
  }

  // 2. All data operations in a single transaction (atomicity)
  let userId = ''
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    // Clean up any orphaned data from a previous interrupted attempt
    const { rows: orphaned } = await client.query<{ id: string }>(
      `SELECT u.id FROM users u
       JOIN user_contacts uc ON uc.user_id = u.id
       WHERE uc.channel = 'email' AND LOWER(uc.sender_id) = LOWER($1)
         AND u.source = 'setup_wizard'`,
      [state.adminEmail],
    )
    for (const row of orphaned) {
      await client.query(`DELETE FROM user_credentials WHERE user_id = $1`, [row.id])
      await client.query(`DELETE FROM users WHERE id = $1`, [row.id]) // cascades to user_contacts
    }

    // Ensure admin list config
    await client.query(
      `INSERT INTO user_list_config (list_type, display_name, is_enabled, permissions, max_users)
       VALUES ('admin', 'Administradores', true, $1, 5)
       ON CONFLICT (list_type) DO NOTHING`,
      [JSON.stringify({ tools: ['*'], skills: ['*'], subagents: true, allAccess: true })],
    )

    // Create admin user
    userId = generateUserId()
    await client.query(
      `INSERT INTO users (id, display_name, list_type, metadata, source)
       VALUES ($1, $2, 'admin', '{}', 'setup_wizard')`,
      [userId, state.adminName],
    )

    // Add contacts (email + optional phone)
    await client.query(
      `INSERT INTO user_contacts (user_id, channel, sender_id, is_primary)
       VALUES ($1, 'email', $2, true)
       ON CONFLICT (channel, sender_id) DO UPDATE SET user_id = $1, is_primary = true`,
      [userId, state.adminEmail.toLowerCase()],
    )
    if (state.adminPhone) {
      await client.query(
        `INSERT INTO user_contacts (user_id, channel, sender_id, is_primary)
         VALUES ($1, 'whatsapp', $2, false)
         ON CONFLICT (channel, sender_id) DO UPDATE SET user_id = $1`,
        [userId, state.adminPhone],
      )
    }

    // Store credentials (password hash)
    const passwordHash = await hashPassword(state.adminPassword)
    await client.query(
      `INSERT INTO user_credentials (user_id, password_hash)
       VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET password_hash = $2, updated_at = now()`,
      [userId, passwordHash],
    )

    await client.query('COMMIT')
    logger.info({ userId, email: state.adminEmail }, 'Admin user created in transaction')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }

  // 3. Persist config to config_store
  // Determine primary provider based on which API keys are provided
  // Priority: Anthropic > Google (engine defaults assume anthropic)
  const hasAnthropic = !!state.anthropicApiKey
  const hasGoogle = !!state.googleApiKey

  const configEntries: Record<string, string> = {
    // API keys
    ...(hasAnthropic ? { ANTHROPIC_API_KEY: state.anthropicApiKey } : {}),
    ...(hasGoogle ? { GOOGLE_AI_API_KEY: state.googleApiKey } : {}),

    // Agent persona — written to config_store, read by prompts module via registry.getConfig()
    AGENT_NAME: state.agentName,
    ...(state.agentLastName ? { AGENT_LAST_NAME: state.agentLastName } : {}),
    ...(state.agentTitle ? { AGENT_TITLE: state.agentTitle } : {}),
    AGENT_LANGUAGE: state.agentLanguage,
    ...(state.agentAccent ? { AGENT_ACCENT: state.agentAccent } : {}),

    // LLM provider routing — engine reads LLM_*_PROVIDER to know which provider to use
    // No model selection: engine defaults apply (haiku for classify/tools, sonnet for respond/proactive, opus for complex)
    ...(hasAnthropic ? {
      LLM_CLASSIFY_PROVIDER: 'anthropic',
      LLM_TOOLS_PROVIDER: 'anthropic',
      LLM_RESPOND_PROVIDER: 'anthropic',
      LLM_COMPLEX_PROVIDER: 'anthropic',
      LLM_PROACTIVE_PROVIDER: 'anthropic',
    } : {
      // Only Google available — set all providers to google with appropriate models
      LLM_CLASSIFY_PROVIDER: 'google',
      LLM_CLASSIFY_MODEL: 'gemini-2.5-flash',
      LLM_TOOLS_PROVIDER: 'google',
      LLM_TOOLS_MODEL: 'gemini-2.5-flash',
      LLM_RESPOND_PROVIDER: 'google',
      LLM_RESPOND_MODEL: 'gemini-2.5-pro',
      LLM_COMPLEX_PROVIDER: 'google',
      LLM_COMPLEX_MODEL: 'gemini-2.5-pro',
      LLM_PROACTIVE_PROVIDER: 'google',
      LLM_PROACTIVE_MODEL: 'gemini-2.5-flash',
    }),

    // Fallback providers (if both keys are available)
    ...(hasAnthropic && hasGoogle ? {
      LLM_FALLBACK_CLASSIFY_MODEL: 'gemini-2.5-flash',
      LLM_FALLBACK_CLASSIFY_PROVIDER: 'google',
      LLM_FALLBACK_RESPOND_MODEL: 'gemini-2.5-flash',
      LLM_FALLBACK_RESPOND_PROVIDER: 'google',
      LLM_FALLBACK_COMPLEX_MODEL: 'gemini-2.5-pro',
      LLM_FALLBACK_COMPLEX_PROVIDER: 'google',
    } : {}),
    ...(hasGoogle && !hasAnthropic ? {} : {}), // Google-only has no Anthropic fallback

    // Company name — injected into agent identity
    COMPANY_NAME: state.companyName,

    // System config (sensible defaults — no user choice needed)
    LOG_LEVEL: 'info',
    NODE_ENV: 'production',
    CONSOLE_LANG: state.lang,
    SETUP_COMPLETED: 'true',
  }

  await configStore.setMultiple(pool, configEntries)

  // 3b. Ensure default user list configs:
  //     - admin: always enabled, always responded to
  //     - lead: enabled, unregistered_behavior = 'silence' (register but don't respond)
  const DEFAULT_LEAD_PERMS = JSON.stringify({ tools: [], skills: [], subagents: false, allAccess: false })

  await pool.query(
    `INSERT INTO user_list_config (list_type, display_name, is_enabled, permissions, max_users, unregistered_behavior)
     VALUES ('lead', 'Leads', true, $1, NULL, 'silence')
     ON CONFLICT (list_type) DO NOTHING`,
    [DEFAULT_LEAD_PERMS],
  )
  // Ensure admin list is enabled (already created above in transaction, but ensure unregistered_behavior)
  await pool.query(
    `UPDATE user_list_config SET is_enabled = true, unregistered_behavior = 'silence'
     WHERE list_type = 'admin' AND is_enabled = false`,
  )

  // 4. Create session for the admin (auto-login after setup)
  const sessionToken = await createSession(redis, userId)

  logger.info({ userId: 'admin', email: state.adminEmail }, 'Setup wizard completed')

  // 5. Clean up ephemeral state
  ctx.sessions.delete(token)

  // 6. Signal completion — the temporary server will shut down
  // Small delay to let the response be sent
  setTimeout(() => ctx.onComplete(), 500)

  return sessionToken
}

// ═══════════════════════════════════════════
// Factory reset: save current config as prefill
// ═══════════════════════════════════════════

export async function saveFactoryResetPrefill(pool: Pool, redis: Redis): Promise<string> {
  const allConfig = await configStore.getAll(pool)

  // Look up admin user info
  const { rows: adminRows } = await pool.query<{ id: string; display_name: string | null }>(
    `SELECT id, display_name FROM users WHERE list_type = 'admin' AND is_active = true LIMIT 1`,
  )
  const admin = adminRows[0]

  let adminEmail = ''
  let adminPhone = ''
  if (admin) {
    const { rows: contacts } = await pool.query<{ channel: string; sender_id: string }>(
      `SELECT channel, sender_id FROM user_contacts WHERE user_id = $1`,
      [admin.id],
    )
    for (const c of contacts) {
      if (c.channel === 'email') adminEmail = c.sender_id
      if (c.channel === 'whatsapp') adminPhone = c.sender_id
    }
  }

  const prefill: Partial<SetupState> = {
    adminName: admin?.display_name ?? '',
    adminEmail,
    adminPhone,
    agentName: allConfig['AGENT_NAME'] ?? 'Luna',
    agentLastName: allConfig['AGENT_LAST_NAME'] ?? '',
    agentTitle: allConfig['AGENT_TITLE'] ?? '',
    agentLanguage: allConfig['AGENT_LANGUAGE'] ?? 'es',
    agentAccent: allConfig['AGENT_ACCENT'] ?? '',
    anthropicApiKey: allConfig['ANTHROPIC_API_KEY'] ?? '',
    googleApiKey: allConfig['GOOGLE_AI_API_KEY'] ?? '',
    companyName: allConfig['COMPANY_NAME'] ?? '',
    lang: (allConfig['CONSOLE_LANG'] as SetupLang) ?? 'es',
  }

  const token = crypto.randomBytes(16).toString('hex')
  await redis.set(`setup_prefill:${token}`, JSON.stringify(prefill), 'EX', 600) // 10 min TTL
  return token
}
