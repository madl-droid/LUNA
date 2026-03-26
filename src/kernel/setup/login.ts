// LUNA — Login page: handler + templates
// Provides login/logout for the console. Runs at kernel level.

import type * as http from 'node:http'
import type { Pool } from 'pg'
import type { Redis } from 'ioredis'
import pino from 'pino'

import {
  findUserByEmail, verifyPassword, getCredentials,
  createSession, destroySession, getSessionToken,
  sessionCookie, clearSessionCookie,
} from './auth.js'
import { st, detectSetupLang, type SetupLang } from './i18n.js'

const logger = pino({ name: 'kernel:login' })

// ═══════════════════════════════════════════
// CSS (matches wizard styling)
// ═══════════════════════════════════════════

const LOGIN_CSS = `
  :root { --primary: #6C5CE7; --primary-hover: #5A4BD1; --bg: #F8F9FA; --card: #FFFFFF;
    --text: #2D3436; --text-muted: #636E72; --border: #DFE6E9; --error: #D63031;
    --radius: 12px; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: var(--bg); color: var(--text); min-height: 100vh;
    display: flex; align-items: center; justify-content: center; padding: 20px; }
  .login-card { background: var(--card); border-radius: var(--radius); box-shadow: 0 4px 24px rgba(0,0,0,0.08);
    max-width: 400px; width: 100%; padding: 40px; }
  .login-logo { text-align: center; margin-bottom: 24px; }
  .login-logo h1 { font-size: 28px; color: var(--primary); letter-spacing: 2px; }
  .login-logo p { color: var(--text-muted); font-size: 13px; }
  h2 { font-size: 20px; margin-bottom: 20px; text-align: center; }
  .field { margin-bottom: 16px; }
  .field label { display: block; font-size: 13px; font-weight: 600; margin-bottom: 4px; }
  .field input { width: 100%; padding: 10px 12px; border: 1px solid var(--border);
    border-radius: 8px; font-size: 14px; outline: none; transition: border-color 0.2s; }
  .field input:focus { border-color: var(--primary); }
  .btn { width: 100%; padding: 10px 24px; border-radius: 8px; font-size: 14px; font-weight: 600;
    cursor: pointer; border: none; background: var(--primary); color: white; margin-top: 8px; }
  .btn:hover { background: var(--primary-hover); }
  .flash { padding: 10px 14px; border-radius: 8px; font-size: 13px; margin-bottom: 16px; }
  .flash-error { background: #FFF3F3; border: 1px solid var(--error); color: var(--error); }
  .flash-success { background: #F0FFF4; border: 1px solid #00B894; color: #00B894; }
`

function esc(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

// ═══════════════════════════════════════════
// Login page template
// ═══════════════════════════════════════════

function loginPage(lang: SetupLang, flash?: { type: 'error' | 'success'; message: string }): string {
  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>LUNA — ${esc(st('login_title', lang))}</title>
  <style>${LOGIN_CSS}</style>
</head>
<body>
  <div class="login-card">
    <div class="login-logo">
      <h1>LUNA</h1>
      <p>${esc(st('app_subtitle', lang))}</p>
    </div>
    <h2>${esc(st('login_title', lang))}</h2>
    ${flash ? `<div class="flash flash-${flash.type}">${esc(flash.message)}</div>` : ''}
    <form method="POST" action="/console/login">
      <div class="field">
        <label>${esc(st('login_email', lang))}</label>
        <input type="email" name="email" required autofocus>
      </div>
      <div class="field">
        <label>${esc(st('login_password', lang))}</label>
        <input type="password" name="password" required>
      </div>
      <button type="submit" class="btn">${esc(st('login_submit', lang))}</button>
    </form>
  </div>
</body>
</html>`
}

// ═══════════════════════════════════════════
// Form parser
// ═══════════════════════════════════════════

function parseFormBody(req: http.IncomingMessage): Promise<Record<string, string>> {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (chunk: Buffer) => { body += chunk.toString() })
    req.on('end', () => {
      const params = new URLSearchParams(body)
      const result: Record<string, string> = {}
      for (const [key, value] of params) result[key] = value
      resolve(result)
    })
    req.on('error', reject)
  })
}

// ═══════════════════════════════════════════
// Login handler
// ═══════════════════════════════════════════

/**
 * Handle login/logout requests. Returns true if the request was handled.
 * Called from kernel/server.ts before the console handler.
 */
export function createLoginHandler(pool: Pool, redis: Redis): (req: http.IncomingMessage, res: http.ServerResponse) => Promise<boolean> {
  return async (req, res) => {
    const url = req.url ?? '/'
    const urlPath = url.split('?')[0]!
    const method = req.method ?? 'GET'
    const lang = detectSetupLang(req.headers['cookie'])

    // GET /console/login — show login form
    if (urlPath === '/console/login' && method === 'GET') {
      const query = new URL(url, 'http://localhost').searchParams
      let flash: { type: 'error' | 'success'; message: string } | undefined
      if (query.get('expired') === '1') flash = { type: 'error', message: st('login_session_expired', lang) }
      if (query.get('logout') === '1') flash = { type: 'success', message: st('logout_success', lang) }

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end(loginPage(lang, flash))
      return true
    }

    // POST /console/login — authenticate
    if (urlPath === '/console/login' && method === 'POST') {
      const form = await parseFormBody(req)
      const email = form['email']?.trim() ?? ''
      const password = form['password'] ?? ''

      const user = await findUserByEmail(pool, email)
      if (!user) {
        logger.warn({ email }, 'Login failed — user not found')
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(loginPage(lang, { type: 'error', message: st('login_error', lang) }))
        return true
      }

      const storedHash = await getCredentials(pool, user.userId)
      if (!storedHash || !await verifyPassword(password, storedHash)) {
        logger.warn({ email }, 'Login failed — invalid password')
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
        res.end(loginPage(lang, { type: 'error', message: st('login_error', lang) }))
        return true
      }

      // Success — create session and redirect to console
      const token = await createSession(redis, user.userId)
      const { updateLastLogin } = await import('./auth.js')
      await updateLastLogin(pool, user.userId)
      logger.info({ userId: user.userId, email }, 'Login successful')

      res.writeHead(302, {
        Location: '/console',
        'Set-Cookie': sessionCookie(token),
      })
      res.end()
      return true
    }

    // POST /console/logout — destroy session
    if (urlPath === '/console/logout' && method === 'POST') {
      const sessionToken = getSessionToken(req.headers['cookie'])
      if (sessionToken) {
        await destroySession(redis, sessionToken)
      }
      res.writeHead(302, {
        Location: '/console/login?logout=1',
        'Set-Cookie': clearSessionCookie(),
      })
      res.end()
      return true
    }

    return false
  }
}
