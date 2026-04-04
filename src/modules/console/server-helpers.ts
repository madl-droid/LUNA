import * as fs from 'node:fs'
import * as path from 'node:path'
import { createRequire } from 'node:module'
import type * as http from 'node:http'
import type { Registry } from '../../kernel/registry.js'
import { jsonResponse } from '../../kernel/http-helpers.js'
import pino from 'pino'

const logger = pino({ name: 'console' })

async function checkSuperAdmin(registry: Registry, cookieHeader: string | undefined): Promise<boolean> {
  try {
    const { getSessionToken, validateSession } = await import('../../kernel/setup/auth.js')
    const token = getSessionToken(cookieHeader)
    const userId = token ? await validateSession(registry.getRedis(), token) : null
    if (!userId) return false
    const result = await registry.getDb().query(
      `SELECT source FROM users WHERE id = $1 AND is_active = true LIMIT 1`,
      [userId],
    )
    return result.rows[0]?.source === 'setup_wizard'
  } catch { return false }
}

/**
 * Purge all data tables, media files, and Redis.
 * Preserves: config_store, kernel_modules, user_list_config, schema_migrations,
 * and (optionally) super admin user + their contacts/credentials.
 */
async function purgeAllData(registry: Registry, opts: { preserveSuperAdmin: boolean }): Promise<void> {
  const db = registry.getDb()

  // All data tables to truncate (order matters for CASCADE but we use CASCADE anyway)
  const tables = [
    // Engine core
    'messages', 'sessions', 'session_summaries', 'session_summaries_v2', 'summary_chunks',
    'session_archives', 'session_memory_chunks', 'conversation_archives',
    'contacts', 'contact_channels', 'agent_contacts',
    'campaigns', 'commitments', 'pipeline_logs', 'ack_messages',
    // Memory v3
    'agents', 'companies', 'system_state',
    // Knowledge
    'knowledge_documents', 'knowledge_document_categories', 'knowledge_chunks',
    'knowledge_categories', 'knowledge_faqs', 'knowledge_gaps',
    'knowledge_sync_sources', 'knowledge_api_connectors', 'knowledge_web_sources',
    'knowledge_items', 'knowledge_item_tabs', 'knowledge_item_columns',
    // Cortex / Trace
    'trace_scenarios', 'trace_runs', 'trace_results', 'task_checkpoints',
    'cortex_pulse_events',
    // Subagents
    'subagent_types', 'subagent_usage',
    // HITL
    'hitl_tickets', 'hitl_ticket_log', 'hitl_rules',
    // LLM
    'llm_usage', 'llm_daily_stats', 'llm_descriptions',
    // Attachments
    'attachment_extractions',
    // Tools / Prompts
    'tools', 'tool_access_rules', 'tool_executions',
    'prompt_slots',
    // Scheduled tasks
    'scheduled_tasks', 'scheduled_task_executions',
    // Channels
    'voice_calls', 'voice_call_transcripts',
    'email_state', 'email_threads',
    'google_chat_spaces', 'google_chat_events',
    'whatsapp_auth_state',
    'twilio_call_metadata',
    // Google
    'google_oauth_tokens',
    // Medilink
    'medilink_audit_log', 'medilink_edit_requests', 'medilink_follow_ups',
    'medilink_professional_treatments', 'medilink_user_type_rules',
    'medilink_followup_templates', 'medilink_webhook_log',
    // Proactive
    'proactive_outreach_log', 'daily_reports',
  ]

  for (const t of tables) {
    try { await db.query(`TRUNCATE ${t} CASCADE`) } catch { /* table may not exist */ }
  }

  // Users: either full wipe or preserve super admin
  if (opts.preserveSuperAdmin) {
    await db.query(`DELETE FROM user_contacts WHERE user_id NOT IN (SELECT id FROM users WHERE source = 'setup_wizard')`)
      .catch(() => {})
    await db.query(`DELETE FROM user_lists WHERE user_id NOT IN (SELECT id FROM users WHERE source = 'setup_wizard')`)
      .catch(() => {})
    await db.query(`DELETE FROM user_credentials WHERE user_id NOT IN (SELECT id FROM users WHERE source = 'setup_wizard')`)
      .catch(() => {})
    await db.query(`DELETE FROM users WHERE source != 'setup_wizard'`)
      .catch(() => {})
  } else {
    for (const t of ['user_contacts', 'user_lists', 'user_credentials', 'users']) {
      try { await db.query(`TRUNCATE ${t} CASCADE`) } catch { /* ignore */ }
    }
  }

  // Flush Redis (preserve session keys so the current user stays logged in)
  await flushRedisExceptSessions(registry.getRedis())

  // Re-seed default agent — must exist for session creation to work
  await db.query(`
    INSERT INTO agents (slug, name, description, config_path)
    VALUES ('luna', 'LUNA', 'Agente principal de ventas', 'instance/config.json')
    ON CONFLICT (slug) DO NOTHING
  `).catch(() => {})

  // Delete media files (but keep the directory)
  const mediaDir = path.resolve(process.cwd(), 'instance', 'knowledge', 'media')
  try {
    const files = fs.readdirSync(mediaDir)
    for (const f of files) {
      const filePath = path.join(mediaDir, f)
      try { fs.rmSync(filePath, { recursive: true, force: true }) } catch { /* ignore */ }
    }
  } catch { /* directory may not exist */ }

  logger.info({ preserveSuperAdmin: opts.preserveSuperAdmin }, 'Full data purge completed')
}

/**
 * Flush Redis cache while preserving active console sessions (keys with prefix "session:").
 * Using flushdb() would log out the current user mid-operation, causing subsequent
 * requests (e.g. clear-memory right after clear-cache) to return 401.
 */
async function flushRedisExceptSessions(redis: import('ioredis').Redis): Promise<void> {
  const SESSION_PREFIX = 'session:'
  let cursor = '0'
  do {
    const [nextCursor, keys] = await redis.scan(cursor, 'COUNT', 200)
    cursor = nextCursor
    const toDelete = keys.filter((k: string) => !k.startsWith(SESSION_PREFIX))
    if (toDelete.length > 0) await redis.del(...(toDelete as [string, ...string[]]))
  } while (cursor !== '0')
}

/** Gate a debug API endpoint: requires test mode + super admin. Returns true if blocked. */
async function guardDebugEndpoint(req: http.IncomingMessage, res: http.ServerResponse, registry: Registry): Promise<boolean> {
  const db = registry.getDb()
  // Read ENGINE_TEST_MODE using DB > .env cascade (same as fetchSectionData)
  // so that values set in .env but not yet written to config_store are honoured.
  const tmResult = await db.query(`SELECT value FROM config_store WHERE key = 'ENGINE_TEST_MODE'`)
  let testMode = tmResult.rows[0]?.value as string | undefined
  if (!testMode) {
    const envValues = parseEnvFile(findEnvFile())
    testMode = envValues['ENGINE_TEST_MODE']
  }
  if (testMode !== 'true') { jsonResponse(res, 403, { error: 'Test mode not active' }); return true }
  const isSA = await checkSuperAdmin(registry, req.headers['cookie'])
  if (!isSA) { jsonResponse(res, 403, { error: 'Super admin required' }); return true }
  return false
}

// Read package.json version once at import time
let packageJsonVersion = 'dev'
try {
  const require = createRequire(import.meta.url)
  const pkg = require('../../../package.json') as { version?: string }
  packageJsonVersion = pkg.version ?? 'dev'
} catch { /* fallback to dev */ }

/** Render a styled 404 page with biblical-flavored wandering metaphor */
function render404Page(lang: string): string {
  const isEs = lang === 'es'
  const title = isEs ? 'En el desierto' : 'In the wilderness'
  const subtitle = isEs
    ? 'Parece que este camino no lleva a ningun lugar conocido.'
    : 'It seems this path leads to no known place.'
  const hint = isEs
    ? 'Pero no te preocupes — hasta los mas grandes caminantes se han perdido antes de encontrar su destino.'
    : 'But do not worry — even the greatest wanderers have been lost before finding their destiny.'
  const btnText = isEs ? 'Volver al inicio' : 'Return home'

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Luna — 404</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;500;600;700&display=swap" rel="stylesheet">
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{
      font-family:'Montserrat',sans-serif;
      min-height:100vh;
      display:flex;align-items:center;justify-content:center;
      background:linear-gradient(135deg,#1a1a2e 0%,#16213e 40%,#0f3460 100%);
      color:#e1e1e1;overflow:hidden;position:relative;
    }
    .stars{position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:0}
    .star{position:absolute;background:#fff;border-radius:50%;animation:twinkle var(--d,3s) ease-in-out infinite alternate}
    @keyframes twinkle{0%{opacity:0.2;transform:scale(0.8)}100%{opacity:1;transform:scale(1.2)}}
    .container{text-align:center;z-index:1;max-width:520px;padding:40px 24px}
    .num{font-size:8rem;font-weight:700;line-height:1;background:linear-gradient(135deg,#FF5E0E,#FFB800);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;margin-bottom:8px;text-shadow:0 0 60px rgba(255,94,14,0.3)}
    .title{font-size:1.4rem;font-weight:600;margin-bottom:24px;color:#FFB800}
    .subtitle{font-size:0.95rem;color:rgba(225,225,225,0.6);margin-bottom:12px;line-height:1.5}
    .hint{font-size:0.85rem;color:rgba(225,225,225,0.45);margin-bottom:36px;line-height:1.5}
    .btn{
      display:inline-flex;align-items:center;gap:8px;
      padding:12px 28px;border-radius:50px;border:none;
      background:linear-gradient(135deg,#FF5E0E,#e04a00);
      color:#fff;font-family:inherit;font-size:0.9rem;font-weight:600;
      cursor:pointer;transition:transform 0.2s,box-shadow 0.2s;
      text-decoration:none;
    }
    .btn:hover{transform:translateY(-2px);box-shadow:0 8px 24px rgba(255,94,14,0.4)}
    .compass{animation:spin 8s linear infinite;display:inline-block}
    @keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
    .footprint{position:fixed;bottom:20px;right:20px;opacity:0.15;font-size:2rem;z-index:0}
  </style>
</head>
<body>
  <div class="stars" id="stars"></div>
  <div class="container">
    <div class="num">404</div>
    <div class="title">${title}</div>
    <div class="subtitle">${subtitle}</div>
    <div class="hint">${hint}</div>
    <a href="/console?lang=${lang}" class="btn">
      <span class="compass"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/></svg></span>
      ${btnText}
    </a>
  </div>
  <script>
  (function(){
    var s=document.getElementById('stars');
    for(var i=0;i<60;i++){
      var d=document.createElement('div');d.className='star';
      d.style.cssText='width:'+(.5+Math.random()*2)+'px;height:'+(.5+Math.random()*2)+'px;top:'+Math.random()*100+'%;left:'+Math.random()*100+'%;--d:'+(2+Math.random()*4)+'s;animation-delay:-'+Math.random()*4+'s';
      s.appendChild(d);
    }
  })();
  </script>
</body>
</html>`
}

function findEnvFile(): string {
  const candidates = [
    path.resolve(process.cwd(), '.env'),
    path.resolve(process.cwd(), '..', '.env'),
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }
  return candidates[0]!
}

function parseEnvFile(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) return {}
  const content = fs.readFileSync(filePath, 'utf-8')
  const result: Record<string, string> = {}
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eqIndex = trimmed.indexOf('=')
    if (eqIndex === -1) continue
    const key = trimmed.slice(0, eqIndex).trim()
    const value = trimmed.slice(eqIndex + 1).trim()
    result[key] = value
  }
  return result
}

function writeEnvFile(filePath: string, values: Record<string, string>): void {
  let content = ''
  if (fs.existsSync(filePath)) {
    content = fs.readFileSync(filePath, 'utf-8')
  }

  for (const [key, value] of Object.entries(values)) {
    // Multi-line values cannot be represented safely in .env format — skip them.
    // DB (config_store) is the primary store; .env is a single-line fallback backup.
    if (value.includes('\n') || value.includes('\r')) continue

    // Remove existing entry (including any leftover continuation lines) before writing.
    // The regex replaces KEY=... and any following non-KEY lines as a block.
    const blockRegex = new RegExp(`^${key}=.*(?:\\n(?![A-Za-z_][A-Za-z0-9_]*=)[^\\n]*)*`, 'm')
    if (blockRegex.test(content)) {
      content = content.replace(blockRegex, `${key}=${value}`)
    } else {
      content += `\n${key}=${value}`
    }
  }

  fs.writeFileSync(filePath, content, 'utf-8')
}

// Parse form body (application/x-www-form-urlencoded)
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

// Fetch section data server-side (no HTTP round-trips)

export { logger, checkSuperAdmin, purgeAllData, flushRedisExceptSessions, guardDebugEndpoint, render404Page, findEnvFile, parseEnvFile, writeEnvFile, parseFormBody, packageJsonVersion }
