// LUNA — Module: email
// Canal de email via Gmail API. Recibe emails, los procesa por el engine, y envía respuestas.
// La firma se incluye directamente desde la cuenta de Google (no se genera por el sistema).

import { z } from 'zod'
import pino from 'pino'
import type { ModuleManifest, ApiRoute } from '../../kernel/types.js'
import type { Registry } from '../../kernel/registry.js'
import type { OAuthManager } from '../google-api/oauth-manager.js'
import { GmailAdapter } from './gmail-adapter.js'
import type { EmailConfig, EmailPollerState, EmailMessage } from './types.js'

const logger = pino({ name: 'email' })

let gmailAdapter: GmailAdapter | null = null
let _registry: Registry | null = null
let pollInterval: ReturnType<typeof setInterval> | null = null
let lastHistoryId: string | null = null

const pollerState: EmailPollerState = {
  status: 'stopped',
  lastPollAt: null,
  messagesProcessed: 0,
  errors: 0,
  lastError: null,
}

function jsonResponse(res: import('node:http').ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(data))
}

function parseBody(req: import('node:http').IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      try {
        const body = Buffer.concat(chunks).toString()
        resolve(body ? JSON.parse(body) : {})
      } catch (err) { reject(err) }
    })
    req.on('error', reject)
  })
}

// ─── Migrations ────────────────────────────

async function runMigrations(db: import('pg').Pool): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS email_state (
      id TEXT PRIMARY KEY DEFAULT 'primary',
      last_history_id TEXT,
      last_poll_at TIMESTAMPTZ,
      messages_processed INTEGER DEFAULT 0,
      updated_at TIMESTAMPTZ DEFAULT now()
    )
  `)
  await db.query(`
    CREATE TABLE IF NOT EXISTS email_threads (
      thread_id TEXT PRIMARY KEY,
      contact_id TEXT,
      subject TEXT,
      last_message_at TIMESTAMPTZ,
      message_count INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT now()
    )
  `)
  logger.info('Email migrations complete')
}

// ─── Polling logic ─────────────────────────

async function pollForEmails(): Promise<void> {
  if (!gmailAdapter || !_registry) return

  pollerState.status = 'polling'
  try {
    const messages = await gmailAdapter.fetchNewMessages(lastHistoryId ?? undefined)

    // Actualizar history ID
    try {
      lastHistoryId = await gmailAdapter.getHistoryId()
    } catch { /* non-critical */ }

    for (const msg of messages) {
      try {
        await processIncomingEmail(msg)
        pollerState.messagesProcessed++
      } catch (err) {
        pollerState.errors++
        pollerState.lastError = err instanceof Error ? err.message : String(err)
        logger.error({ messageId: msg.id, err }, 'Failed to process email')
      }
    }

    pollerState.lastPollAt = new Date()
    pollerState.status = 'idle'

    // Persistir estado
    const db = _registry.getDb()
    await db.query(`
      INSERT INTO email_state (id, last_history_id, last_poll_at, messages_processed)
      VALUES ('primary', $1, now(), $2)
      ON CONFLICT (id) DO UPDATE SET
        last_history_id = $1, last_poll_at = now(), messages_processed = $2, updated_at = now()
    `, [lastHistoryId, pollerState.messagesProcessed]).catch(() => {})

  } catch (err) {
    pollerState.status = 'error'
    pollerState.errors++
    pollerState.lastError = err instanceof Error ? err.message : String(err)
    logger.error({ err }, 'Email poll cycle failed')
  }
}

async function processIncomingEmail(msg: EmailMessage): Promise<void> {
  if (!_registry || !gmailAdapter) return

  const config = _registry.getConfig<EmailConfig>('email')

  // Track thread
  const db = _registry.getDb()
  await db.query(`
    INSERT INTO email_threads (thread_id, contact_id, subject, last_message_at, message_count)
    VALUES ($1, $2, $3, $4, 1)
    ON CONFLICT (thread_id) DO UPDATE SET
      last_message_at = $4, message_count = email_threads.message_count + 1
  `, [msg.threadId, msg.from, msg.subject, msg.date])

  // Construir contenido para el engine
  const attachmentSummary = msg.attachments.length > 0
    ? `\n[Adjuntos: ${msg.attachments.map((a) => `${a.filename} (${a.mimeType})`).join(', ')}]`
    : ''

  const textContent = msg.bodyText || stripHtml(msg.bodyHtml)
  const fullContent = `[Email] De: ${msg.fromName} <${msg.from}>\nAsunto: ${msg.subject}\n\n${textContent}${attachmentSummary}`

  // Fire message:incoming hook para que el engine lo procese
  await _registry.runHook('message:incoming', {
    id: msg.id,
    channelName: 'email',
    channelMessageId: msg.id,
    from: msg.from,
    timestamp: msg.date,
    content: {
      type: 'text',
      text: fullContent,
    },
    raw: msg,
  })

  // Marcar como leído si está configurado
  if (config.EMAIL_AUTO_MARK_READ) {
    await gmailAdapter.markAsRead(msg.id).catch((err) => {
      logger.warn({ messageId: msg.id, err }, 'Failed to mark email as read')
    })
  }

  logger.info({ messageId: msg.id, from: msg.from, subject: msg.subject }, 'Email processed')
}

function stripHtml(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

// ─── API Routes ────────────────────────────

const apiRoutes: ApiRoute[] = [
  {
    method: 'GET',
    path: 'status',
    handler: async (_req, res) => {
      const oauthManager = _registry?.getOptional<OAuthManager>('google:oauth-manager')
      jsonResponse(res, 200, {
        ...pollerState,
        connected: oauthManager?.isConnected() ?? false,
        email: oauthManager?.getState().email ?? null,
        adapterReady: gmailAdapter !== null,
      })
    },
  },
  {
    method: 'POST',
    path: 'poll-now',
    handler: async (_req, res) => {
      if (!gmailAdapter) {
        jsonResponse(res, 400, { error: 'Gmail adapter not initialized' })
        return
      }
      pollForEmails().catch(() => {})
      jsonResponse(res, 200, { ok: true, message: 'Poll triggered' })
    },
  },
  {
    method: 'POST',
    path: 'send',
    handler: async (req, res) => {
      if (!gmailAdapter) {
        jsonResponse(res, 400, { error: 'Gmail adapter not initialized' })
        return
      }
      try {
        const body = await parseBody(req)
        const result = await gmailAdapter.sendEmail({
          to: body.to as string[],
          cc: body.cc as string[] | undefined,
          subject: body.subject as string,
          bodyHtml: body.bodyHtml as string,
          bodyText: body.bodyText as string | undefined,
        })
        jsonResponse(res, 200, { ok: true, ...result })
      } catch (err) {
        jsonResponse(res, 500, { error: 'Send failed: ' + String(err) })
      }
    },
  },
  {
    method: 'POST',
    path: 'reply',
    handler: async (req, res) => {
      if (!gmailAdapter) {
        jsonResponse(res, 400, { error: 'Gmail adapter not initialized' })
        return
      }
      try {
        const body = await parseBody(req)
        const result = await gmailAdapter.reply({
          originalMessageId: body.originalMessageId as string,
          bodyHtml: body.bodyHtml as string,
          bodyText: body.bodyText as string | undefined,
          replyAll: (body.replyAll as boolean) ?? false,
        })
        jsonResponse(res, 200, { ok: true, ...result })
      } catch (err) {
        jsonResponse(res, 500, { error: 'Reply failed: ' + String(err) })
      }
    },
  },
  {
    method: 'POST',
    path: 'check-noreply',
    handler: async (req, res) => {
      if (!gmailAdapter) {
        jsonResponse(res, 400, { error: 'Gmail adapter not initialized' })
        return
      }
      const body = await parseBody(req)
      const email = body.email as string
      jsonResponse(res, 200, { email, isNoReply: gmailAdapter.isNoReply(email) })
    },
  },
]

// ─── Manifest ──────────────────────────────

const manifest: ModuleManifest = {
  name: 'email',
  version: '1.0.0',
  description: {
    es: 'Canal de email via Gmail API. Recibe, responde, reenvía y envía correos.',
    en: 'Email channel via Gmail API. Receives, replies, forwards and sends emails.',
  },
  type: 'channel',
  removable: true,
  activateByDefault: false,
  depends: ['google-api'],

  configSchema: z.object({
    EMAIL_POLL_INTERVAL_MS: z.string().transform(Number).pipe(z.number().int().positive()).default('60000'),
    EMAIL_MAX_ATTACHMENT_SIZE_MB: z.string().transform(Number).pipe(z.number().positive()).default('16'),
    EMAIL_NOREPLY_ADDRESSES: z.string().default(''),
    EMAIL_NOREPLY_PATTERNS: z.string().default(''),
    EMAIL_PROCESS_LABELS: z.string().default('INBOX'),
    EMAIL_SKIP_LABELS: z.string().default('SPAM,TRASH'),
    EMAIL_AUTO_MARK_READ: z.string().transform((v) => v === 'true').default('true'),
    EMAIL_INCLUDE_SIGNATURE: z.string().transform((v) => v === 'true').default('true'),
    EMAIL_MAX_HISTORY_FETCH: z.string().transform(Number).pipe(z.number().int().positive()).default('20'),
  }),

  oficina: {
    title: { es: 'Email (Gmail)', en: 'Email (Gmail)' },
    info: {
      es: 'Canal de correo electrónico via Gmail API. Requiere Google API conectado. Los emails se procesan por el engine como mensajes.',
      en: 'Email channel via Gmail API. Requires Google API connected. Emails are processed by the engine as messages.',
    },
    order: 12,
    fields: [
      {
        key: 'EMAIL_POLL_INTERVAL_MS',
        type: 'number',
        label: { es: 'Intervalo de polling (ms)', en: 'Poll interval (ms)' },
        info: { es: 'Cada cuántos milisegundos revisar nuevos emails (default: 60000 = 1 min)', en: 'How often to check for new emails in ms (default: 60000 = 1 min)' },
      },
      {
        key: 'EMAIL_NOREPLY_ADDRESSES',
        type: 'text',
        label: { es: 'Direcciones no-reply', en: 'No-reply addresses' },
        info: { es: 'Emails separados por coma que no se responden (ej: noreply@empresa.com)', en: 'Comma-separated emails that should not be replied to' },
      },
      {
        key: 'EMAIL_NOREPLY_PATTERNS',
        type: 'text',
        label: { es: 'Patrones no-reply (regex)', en: 'No-reply patterns (regex)' },
        info: { es: 'Patrones regex separados por coma para detectar no-reply', en: 'Comma-separated regex patterns to detect no-reply addresses' },
      },
      {
        key: 'EMAIL_PROCESS_LABELS',
        type: 'text',
        label: { es: 'Labels a procesar', en: 'Labels to process' },
        info: { es: 'Labels de Gmail a monitorear (default: INBOX)', en: 'Gmail labels to monitor (default: INBOX)' },
      },
      {
        key: 'EMAIL_SKIP_LABELS',
        type: 'text',
        label: { es: 'Labels a ignorar', en: 'Labels to skip' },
        info: { es: 'Labels que se ignoran (default: SPAM,TRASH)', en: 'Labels to ignore (default: SPAM,TRASH)' },
      },
      {
        key: 'EMAIL_AUTO_MARK_READ',
        type: 'boolean',
        label: { es: 'Marcar como leído automáticamente', en: 'Auto mark as read' },
        info: { es: 'Marcar emails como leídos después de procesarlos', en: 'Mark emails as read after processing' },
      },
      {
        key: 'EMAIL_MAX_HISTORY_FETCH',
        type: 'number',
        label: { es: 'Max emails por poll', en: 'Max emails per poll' },
        info: { es: 'Máximo de emails a obtener por ciclo de polling (default: 20)', en: 'Maximum emails to fetch per poll cycle (default: 20)' },
      },
    ],
    apiRoutes,
  },

  async init(registry: Registry) {
    _registry = registry
    const db = registry.getDb()
    const config = registry.getConfig<EmailConfig>('email')

    // Run migrations
    await runMigrations(db)

    // Obtener OAuth client del módulo google-api
    const oauthManager = registry.getOptional<OAuthManager>('google:oauth-manager')
    if (!oauthManager) {
      logger.warn('Google OAuth not available — email module cannot start')
      return
    }

    const authClient = oauthManager.getClient()

    // Crear Gmail adapter
    gmailAdapter = new GmailAdapter(authClient, config)
    registry.provide('email:adapter', gmailAdapter)

    // Cargar estado previo
    const stateRow = await db.query(
      `SELECT last_history_id, messages_processed FROM email_state WHERE id = 'primary'`,
    ).catch(() => ({ rows: [] }))
    if (stateRow.rows[0]) {
      lastHistoryId = stateRow.rows[0].last_history_id
      pollerState.messagesProcessed = stateRow.rows[0].messages_processed ?? 0
    }

    // Hook: cuando el engine quiere enviar email
    registry.addHook('email', 'message:send', async (payload) => {
      if (payload.channel !== 'email') return
      if (!gmailAdapter) return

      // El contenido puede ser text/html
      const bodyHtml = payload.content.text ?? ''
      const to = payload.to

      try {
        const result = await gmailAdapter.sendEmail({
          to: [to],
          subject: '', // El subject se maneja por thread
          bodyHtml,
        })

        await registry.runHook('message:sent', {
          channel: 'email',
          to,
          channelMessageId: result.messageId,
          success: true,
        })
      } catch (err) {
        logger.error({ to, err }, 'Failed to send email response')
        await registry.runHook('message:sent', {
          channel: 'email',
          to,
          success: false,
        })
      }
    })

    // Iniciar polling si OAuth está conectado
    if (oauthManager.isConnected()) {
      startPolling(config.EMAIL_POLL_INTERVAL_MS)
    } else {
      logger.info('Google OAuth not connected yet — email polling will start when connected')
    }

    logger.info({ pollInterval: config.EMAIL_POLL_INTERVAL_MS }, 'Email module initialized')
  },

  async stop() {
    stopPolling()
    gmailAdapter = null
    _registry = null
  },
}

function startPolling(intervalMs: number): void {
  if (pollInterval) return

  pollerState.status = 'idle'
  // Primera poll inmediata
  pollForEmails().catch(() => {})

  pollInterval = setInterval(() => {
    pollForEmails().catch(() => {})
  }, intervalMs)

  logger.info({ intervalMs }, 'Email polling started')
}

function stopPolling(): void {
  if (pollInterval) {
    clearInterval(pollInterval)
    pollInterval = null
  }
  pollerState.status = 'stopped'
  logger.info('Email polling stopped')
}

export default manifest
