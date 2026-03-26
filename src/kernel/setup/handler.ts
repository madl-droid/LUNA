// LUNA — Setup wizard: HTTP handler
// Runs BEFORE modules are loaded. Handles GET/POST for /setup/step/{1-4}.
// State between steps is in-memory (ephemeral, keyed by cookie).

import * as http from 'node:http'
import * as crypto from 'node:crypto'
import type { Pool } from 'pg'
import type { Redis } from 'ioredis'
import pino from 'pino'

import * as configStore from '../config-store.js'
import { hashPassword, storeCredentials, createSession, sessionCookie } from './auth.js'
import { st, detectSetupLang, type SetupLang } from './i18n.js'
import {
  stepWelcome, stepAdmin, stepLLM, stepSystem, setupCompletePage,
  emptyState, type SetupState,
} from './templates.js'

const logger = pino({ name: 'kernel:setup' })

const SETUP_COOKIE = 'luna_setup_token'

// ═══════════════════════════════════════════
// Default LLM models per provider
// ═══════════════════════════════════════════

const ANTHROPIC_MODELS = {
  classify: 'claude-haiku-4-5-20251001',
  tools: 'claude-haiku-4-5-20251001',
  compress: 'claude-haiku-4-5-20251001',
  respond: 'claude-sonnet-4-6',
  complex: 'claude-sonnet-4-6',
  proactive: 'claude-sonnet-4-6',
}

const GOOGLE_MODELS = {
  classify: 'gemini-2.5-flash',
  tools: 'gemini-2.5-flash',
  compress: 'gemini-2.5-flash',
  respond: 'gemini-2.5-pro',
  complex: 'gemini-2.5-pro',
  proactive: 'gemini-2.5-flash',
}

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

function validateLLM(form: Record<string, string>, lang: SetupLang): Record<string, string> {
  const errors: Record<string, string> = {}
  const proc = form['processing_provider'] ?? 'anthropic'
  const inter = form['interaction_provider'] ?? 'anthropic'
  const needsAnthropic = proc === 'anthropic' || inter === 'anthropic'
  const needsGoogle = proc === 'google' || inter === 'google'
  if (needsAnthropic && !form['anthropic_api_key']?.trim()) {
    errors['anthropic_api_key'] = st('err_anthropic_key_required', lang)
  }
  if (needsGoogle && !form['google_api_key']?.trim()) {
    errors['google_api_key'] = st('err_google_key_required', lang)
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

function getOrCreateState(req: http.IncomingMessage, ctx: WizardContext): { token: string; state: SetupState } {
  const cookies = req.headers['cookie'] ?? ''
  const match = cookies.match(new RegExp(`${SETUP_COOKIE}=([^;]+)`))
  const existing = match?.[1]
  if (existing && ctx.sessions.has(existing)) {
    return { token: existing, state: ctx.sessions.get(existing)! }
  }
  const token = crypto.randomBytes(16).toString('hex')
  const state = emptyState()

  // Check for prefill data (factory reset)
  const prefillKey = existing ? `setup_prefill:${existing}` : null
  // Prefill is loaded async in the handler, this just creates the base state
  ctx.sessions.set(token, state)
  return { token, state }
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

    const { token, state } = getOrCreateState(req, ctx)

    // Try loading prefill on first access
    if (!state.adminName && !state.adminEmail) {
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
        sendHtml(res, stepLLM(lang, state), token)
        return
      }
      if (urlPath === '/setup/step/4') {
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

      // Step 3: LLM configuration
      if (urlPath === '/setup/step/3') {
        state.processingProvider = form['processing_provider'] === 'google' ? 'google' : 'anthropic'
        state.interactionProvider = form['interaction_provider'] === 'google' ? 'google' : 'anthropic'
        state.anthropicApiKey = form['anthropic_api_key']?.trim() ?? ''
        state.googleApiKey = form['google_api_key']?.trim() ?? ''

        const errors = validateLLM(form, lang)
        if (Object.keys(errors).length > 0) {
          sendHtml(res, stepLLM(lang, state, errors), token)
          return
        }
        redirect(res, '/setup/step/4', token)
        return
      }

      // Step 4: System settings — FINALIZE
      if (urlPath === '/setup/step/4') {
        state.instanceName = form['instance_name']?.trim() ?? ''
        state.logLevel = form['log_level'] ?? 'info'
        state.nodeEnv = form['node_env'] ?? 'production'

        try {
          await finalizeSetup(ctx, state, token)
          sendHtml(res, setupCompletePage(lang), token)
        } catch (err) {
          logger.error({ err }, 'Setup finalization failed')
          const errors = { _global: String(err) }
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

async function finalizeSetup(ctx: WizardContext, state: SetupState, token: string): Promise<void> {
  const { pool, redis } = ctx

  logger.info('Finalizing setup wizard...')

  // 1. Create users + user_contacts tables (idempotent)
  const client = await pool.connect()
  try {
    await client.query(USERS_DDL)
  } finally {
    client.release()
  }

  // 2. Ensure admin list config exists
  await pool.query(
    `INSERT INTO user_list_config (list_type, display_name, is_enabled, permissions, max_users)
     VALUES ('admin', 'Administradores', true, $1, 5)
     ON CONFLICT (list_type) DO NOTHING`,
    [JSON.stringify({ tools: ['*'], skills: ['*'], subagents: true, allAccess: true })],
  )

  // 3. Create admin user
  const userId = generateUserId()
  await pool.query(
    `INSERT INTO users (id, display_name, list_type, metadata, source)
     VALUES ($1, $2, 'admin', '{}', 'setup_wizard')`,
    [userId, state.adminName],
  )

  // 4. Add contacts (email + optional phone)
  await pool.query(
    `INSERT INTO user_contacts (user_id, channel, sender_id, is_primary)
     VALUES ($1, 'email', $2, true)
     ON CONFLICT (channel, sender_id) DO NOTHING`,
    [userId, state.adminEmail.toLowerCase()],
  )
  if (state.adminPhone) {
    await pool.query(
      `INSERT INTO user_contacts (user_id, channel, sender_id, is_primary)
       VALUES ($1, 'whatsapp', $2, false)
       ON CONFLICT (channel, sender_id) DO NOTHING`,
      [userId, state.adminPhone],
    )
  }

  // 5. Store credentials (password hash)
  const passwordHash = await hashPassword(state.adminPassword)
  await storeCredentials(pool, userId, passwordHash)

  // 6. Build config entries
  const procModels = state.processingProvider === 'anthropic' ? ANTHROPIC_MODELS : GOOGLE_MODELS
  const interModels = state.interactionProvider === 'anthropic' ? ANTHROPIC_MODELS : GOOGLE_MODELS

  const configEntries: Record<string, string> = {
    // LLM API keys
    ...(state.anthropicApiKey ? { ANTHROPIC_API_KEY: state.anthropicApiKey } : {}),
    ...(state.googleApiKey ? { GOOGLE_AI_API_KEY: state.googleApiKey } : {}),
    // Model assignments
    LLM_CLASSIFY_MODEL: procModels.classify,
    LLM_TOOLS_MODEL: procModels.tools,
    LLM_COMPRESS_MODEL: procModels.compress,
    LLM_RESPOND_MODEL: interModels.respond,
    LLM_COMPLEX_MODEL: interModels.complex,
    LLM_PROACTIVE_MODEL: interModels.proactive,
    // Fallback models (opposite provider)
    ...(state.processingProvider === 'anthropic' && state.googleApiKey
      ? { LLM_FALLBACK_CLASSIFY_MODEL: GOOGLE_MODELS.classify }
      : {}),
    ...(state.interactionProvider === 'anthropic' && state.googleApiKey
      ? { LLM_FALLBACK_RESPOND_MODEL: GOOGLE_MODELS.respond, LLM_FALLBACK_COMPLEX_MODEL: GOOGLE_MODELS.complex }
      : {}),
    // System settings
    LOG_LEVEL: state.logLevel,
    NODE_ENV: state.nodeEnv,
    ...(state.instanceName ? { INSTANCE_NAME: state.instanceName } : {}),
    // Language
    CONSOLE_LANG: state.lang,
    // Mark setup as complete
    SETUP_COMPLETED: 'true',
  }

  // 7. Persist to config_store
  await configStore.setMultiple(pool, configEntries)

  // 8. Create session for the admin (auto-login after setup)
  const sessionToken = await createSession(redis, userId)

  logger.info({ userId, email: state.adminEmail }, 'Setup wizard completed — admin created')

  // 9. Clean up ephemeral state
  ctx.sessions.delete(token)

  // 10. Signal completion — the temporary server will shut down
  // Small delay to let the response be sent
  setTimeout(() => ctx.onComplete(), 500)
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
    processingProvider: (allConfig['LLM_CLASSIFY_MODEL']?.startsWith('claude') ? 'anthropic' : 'google') as 'anthropic' | 'google',
    interactionProvider: (allConfig['LLM_RESPOND_MODEL']?.startsWith('claude') ? 'anthropic' : 'google') as 'anthropic' | 'google',
    anthropicApiKey: allConfig['ANTHROPIC_API_KEY'] ?? '',
    googleApiKey: allConfig['GOOGLE_AI_API_KEY'] ?? '',
    instanceName: allConfig['INSTANCE_NAME'] ?? '',
    logLevel: allConfig['LOG_LEVEL'] ?? 'info',
    nodeEnv: allConfig['NODE_ENV'] ?? 'production',
    lang: (allConfig['CONSOLE_LANG'] as SetupLang) ?? 'es',
  }

  const token = crypto.randomBytes(16).toString('hex')
  await redis.set(`setup_prefill:${token}`, JSON.stringify(prefill), 'EX', 600) // 10 min TTL
  return token
}
