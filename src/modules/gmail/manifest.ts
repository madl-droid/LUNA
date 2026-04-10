// LUNA — Module: gmail
// Canal de email via Gmail API. Recibe emails, los procesa por el engine, y envía respuestas.
// La firma se incluye directamente desde la cuenta de Google (no se genera por el sistema).

import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import pino from 'pino'
import type { ModuleManifest, ApiRoute } from '../../kernel/types.js'
import type { Registry } from '../../kernel/registry.js'
import { jsonResponse, parseBody, buildBaseUrl } from '../../kernel/http-helpers.js'
import { numEnv, numEnvMin, boolEnv, floatEnvMin } from '../../kernel/config-helpers.js'
import type { OAuthManager } from '../google-apps/oauth-manager.js'
import { GmailAdapter } from './gmail-adapter.js'
import { EmailRateLimiter } from './rate-limiter.js'
import { cleanEmailBody, stripHtml } from './email-cleaner.js'
import type { EmailConfig, EmailPollerState, EmailMessage, LunaLabelIds, CustomLabel, ResolvedCustomLabel } from './types.js'

const logger = pino({ name: 'gmail' })

let gmailAdapter: GmailAdapter | null = null
let _registry: Registry | null = null
let pollInterval: ReturnType<typeof setInterval> | null = null
let lastHistoryId: string | null = null
let lunaLabels: LunaLabelIds = { agent: null, escalated: null, converted: null, humanLoop: null, ignored: null }
let resolvedCustomLabels: ResolvedCustomLabel[] = []
let detectedOwnAddress = ''
let rateLimiter: EmailRateLimiter | null = null

/** Parse custom labels from config JSON string */
function parseCustomLabels(json: string): CustomLabel[] {
  try {
    const arr = JSON.parse(json)
    if (!Array.isArray(arr)) return []
    return arr.filter((item: unknown) => {
      const obj = item as Record<string, unknown>
      return typeof obj?.name === 'string' && obj.name.trim() && typeof obj?.instruction === 'string'
    }) as CustomLabel[]
  } catch {
    return []
  }
}

/** Ensure all LUNA labels (default + custom) exist in Gmail. Called on connect and reconnect. */
async function ensureAllLabels(): Promise<void> {
  if (!gmailAdapter || !_registry) return

  const config = _registry.getConfig<EmailConfig>('gmail')

  try {
    // Race condition note: ensureLabel is idempotent (creates label if not exists, returns
    // existing ID if already present). Gmail API handles concurrent label creation safely,
    // so no mutex is needed here. The worst case is two concurrent calls both succeed.
    // Default labels — always present
    lunaLabels = {
      agent: await gmailAdapter.ensureLabel('LUNA/Agent'),
      escalated: await gmailAdapter.ensureLabel('LUNA/Escalated'),
      converted: await gmailAdapter.ensureLabel('LUNA/Converted'),
      humanLoop: await gmailAdapter.ensureLabel('LUNA/Human-Loop'),
      ignored: await gmailAdapter.ensureLabel('LUNA/Ignored'),
    }
    logger.info({ lunaLabels }, 'LUNA default Gmail labels ensured')

    // Custom labels from config
    const customs = parseCustomLabels(config.EMAIL_CUSTOM_LABELS)
    resolvedCustomLabels = []
    for (const custom of customs) {
      try {
        const labelName = custom.name.startsWith('LUNA/') ? custom.name : `LUNA/${custom.name}`
        const id = await gmailAdapter.ensureLabel(labelName)
        resolvedCustomLabels.push({ ...custom, name: labelName, id })
      } catch (err) {
        logger.warn({ label: custom.name, err }, 'Failed to ensure custom label')
      }
    }
    if (resolvedCustomLabels.length > 0) {
      logger.info({ count: resolvedCustomLabels.length, labels: resolvedCustomLabels.map((l) => l.name) }, 'Custom Gmail labels ensured')
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to ensure LUNA labels — label features disabled')
  }
}

// Batching: debounce per thread/sender — stores pending messages and timer handles
const pendingBatch = new Map<string, { messages: EmailMessage[]; timer: ReturnType<typeof setTimeout> }>()

const pollerState: EmailPollerState = {
  status: 'stopped',
  lastPollAt: null,
  messagesProcessed: 0,
  errors: 0,
  lastError: null,
}

// Exponential backoff state for polling error recovery
let pollBackoffMs = 0
let consecutivePollErrors = 0
const MAX_POLL_BACKOFF_MS = 5 * 60 * 1000 // 5 minutes

/** Build the shared OAuth redirect URI from the request */
function getRedirectUri(req: import('node:http').IncomingMessage): string {
  return `${buildBaseUrl(req)}/console/oauth/callback`
}

// ─── Polling logic ─────────────────────────

async function pollForEmails(): Promise<void> {
  if (!gmailAdapter || !_registry) return

  // If backing off from previous errors, skip this cycle
  if (pollBackoffMs > 0 && consecutivePollErrors > 0) {
    const skipUntil = (pollerState.lastPollAt?.getTime() ?? 0) + pollBackoffMs
    if (Date.now() < skipUntil) {
      logger.debug({ remainingMs: skipUntil - Date.now(), consecutivePollErrors }, 'Skipping poll cycle — backoff active')
      return
    }
  }

  pollerState.status = 'polling'
  try {
    // Reload config on each poll cycle to pick up console changes
    const config = _registry.getConfig<EmailConfig>('gmail')
    gmailAdapter.reloadConfig(config)

    let messages = await gmailAdapter.fetchNewMessages(lastHistoryId ?? undefined)

    // Actualizar history ID
    try {
      lastHistoryId = await gmailAdapter.getHistoryId()
    } catch { /* non-critical */ }
    if (config.EMAIL_ONLY_FIRST_IN_THREAD && messages.length > 1) {
      const byThread = new Map<string, EmailMessage>()
      for (const msg of messages) {
        const existing = byThread.get(msg.threadId)
        if (!existing || msg.date > existing.date) {
          byThread.set(msg.threadId, msg)
        }
      }
      messages = [...byThread.values()]
    }

    const batchWaitMs = config.EMAIL_BATCH_WAIT_MS
    if (batchWaitMs > 0) {
      // Batching mode: debounce per threadId
      for (const msg of messages) {
        const key = msg.threadId || msg.from
        const existing = pendingBatch.get(key)
        if (existing) {
          clearTimeout(existing.timer)
          existing.messages.push(msg)
        } else {
          pendingBatch.set(key, { messages: [msg], timer: null as unknown as ReturnType<typeof setTimeout> })
        }
        const batch = pendingBatch.get(key)!
        batch.timer = setTimeout(async () => {
          pendingBatch.delete(key)
          // Process only the most recent message in the batch
          const latest = batch.messages.sort((a, b) => b.date.getTime() - a.date.getTime())[0]!
          try {
            await processIncomingEmail(latest)
            pollerState.messagesProcessed++
          } catch (err) {
            pollerState.errors++
            pollerState.lastError = err instanceof Error ? err.message : String(err)
            logger.error({ messageId: latest.id, err }, 'Failed to process batched email')
          }
        }, batchWaitMs)
      }
    } else {
      // Immediate processing — up to EMAIL_POLL_CONCURRENCY concurrent
      const EMAIL_POLL_CONCURRENCY = 5
      for (let i = 0; i < messages.length; i += EMAIL_POLL_CONCURRENCY) {
        const chunk = messages.slice(i, i + EMAIL_POLL_CONCURRENCY)
        await Promise.all(chunk.map(async (msg) => {
          try {
            await processIncomingEmail(msg)
            pollerState.messagesProcessed++
          } catch (err) {
            pollerState.errors++
            pollerState.lastError = err instanceof Error ? err.message : String(err)
            logger.error({ messageId: msg.id, err }, 'Failed to process email')
          }
        }))
      }
    }

    pollerState.lastPollAt = new Date()
    pollerState.status = 'idle'
    // Reset backoff on success
    if (consecutivePollErrors > 0) {
      logger.info({ previousErrors: consecutivePollErrors }, 'Poll recovered — resetting backoff')
      consecutivePollErrors = 0
      pollBackoffMs = 0
    }

    // Persistir estado
    const db = _registry.getDb()
    await db.query(`
      INSERT INTO email_state (id, last_history_id, last_poll_at, messages_processed)
      VALUES ('primary', $1, now(), $2)
      ON CONFLICT (id) DO UPDATE SET
        last_history_id = $1, last_poll_at = now(), messages_processed = $2, updated_at = now()
    `, [lastHistoryId, pollerState.messagesProcessed]).catch(() => {})

  } catch (err) {
    const status = (err as { code?: number })?.code ?? (err as { status?: number })?.status ?? 0
    if (status === 401) {
      pollerState.status = 'error'
      pollerState.lastError = 'Authentication revoked (401) — reconnect from console'
      logger.error({ err }, 'Gmail auth revoked — stopping poller')
      stopPolling()
      return
    }
    pollerState.status = 'error'
    pollerState.errors++
    pollerState.lastError = err instanceof Error ? err.message : String(err)
    consecutivePollErrors++
    pollBackoffMs = Math.min(1000 * Math.pow(2, consecutivePollErrors - 1), MAX_POLL_BACKOFF_MS)
    logger.error({ err, consecutivePollErrors, nextRetryMs: pollBackoffMs }, 'Email poll cycle failed')
  }
}

/** A single gap message fetched from Gmail */
interface GapMessage {
  id: string
  from: string
  fromName: string
  date: Date
  body: string
}

/**
 * Detect gap messages in a thread when Luna was absent.
 * Compares last_message_gmail_id (our last known msg) with current msg position in Gmail thread.
 * Returns fetched gap messages or null if no gap.
 */
async function detectThreadGap(
  msg: EmailMessage, db: import('pg').Pool, config: EmailConfig,
): Promise<GapMessage[] | null> {
  if (config.EMAIL_GAP_CONTEXT_MAX === 0 || !msg.threadId || !gmailAdapter) return null

  // Get the last message ID we processed in this thread
  const row = await db.query<{ last_message_gmail_id: string | null }>(
    `SELECT last_message_gmail_id FROM email_threads WHERE thread_id = $1`,
    [msg.threadId],
  )
  const lastKnownId = row.rows[0]?.last_message_gmail_id
  if (!lastKnownId) return null // First message in thread or no record

  // Get all message IDs in the thread from Gmail (chronological order)
  const threadIds = await gmailAdapter.getThreadMessageIds(msg.threadId)
  const lastIdx = threadIds.indexOf(lastKnownId)
  const currentIdx = threadIds.indexOf(msg.id)

  if (lastIdx === -1 || currentIdx === -1 || currentIdx <= lastIdx + 1) return null // No gap

  // IDs between our last known and current (exclusive on both ends)
  const gapIds = threadIds.slice(lastIdx + 1, currentIdx)
  if (gapIds.length === 0) return null

  // Cap to configured max, take the most recent ones
  const toFetch = gapIds.slice(-config.EMAIL_GAP_CONTEXT_MAX)
  const timeoutMs = config.EMAIL_GAP_FETCH_TIMEOUT_S * 1000
  const deadline = Date.now() + timeoutMs

  const gaps: GapMessage[] = []
  for (const gapId of toFetch) {
    if (Date.now() >= deadline) {
      logger.warn({ fetched: gaps.length, remaining: toFetch.length - gaps.length }, 'Gap fetch timeout — returning partial results')
      break
    }
    try {
      const gapMsg = await Promise.race([
        gmailAdapter.getFullMessage(gapId),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 10_000)),
      ])
      if (!gapMsg) continue
      gaps.push({
        id: gapId,
        from: gapMsg.from,
        fromName: gapMsg.fromName,
        date: gapMsg.date,
        body: gapMsg.cleanBodyText || cleanEmailBody(gapMsg.bodyText) || '(sin contenido)',
      })
    } catch (err) {
      logger.warn({ gapId, err }, 'Failed to fetch gap message — skipping')
    }
  }

  return gaps.length > 0 ? gaps : null
}


/** Sanitize a sender display name to prevent prompt injection and XSS. */
function sanitizeSenderName(name: string): string {
  return name
    .replace(/<[^>]*>/g, '')          // strip HTML tags
    .replace(/[\x00-\x1F\x7F]/g, '') // remove control characters
    .replace(/[<>{}]/g, (c) => ({ '<': '‹', '>': '›', '{': '❴', '}': '❵' })[c]!)
    .slice(0, 100)
    .trim()
}

/** Format gap messages as a text preamble (fallback when session not found) */
function formatGapPreamble(gaps: GapMessage[]): string {
  const parts: string[] = ['[Contexto: mensajes en el hilo mientras estabas ausente]']
  for (const g of gaps) {
    const dateStr = g.date.toISOString().replace('T', ' ').substring(0, 16)
    parts.push(`---\nDe: ${sanitizeSenderName(g.fromName)} <${g.from}> | ${dateStr}\n${g.body}`)
  }
  parts.push('---')
  return parts.join('\n')
}

/** Persist gap messages into the session as individual system messages */
async function persistGapMessages(
  gaps: GapMessage[], sessionId: string, registry: Registry,
): Promise<void> {
  const memoryManager = registry.getOptional<{
    saveMessage(m: import('../memory/types.js').StoredMessage): Promise<void>
  }>('memory:manager')

  for (const g of gaps) {
    const dateStr = g.date.toISOString().replace('T', ' ').substring(0, 16)
    const contentText = `[Hilo] De: ${sanitizeSenderName(g.fromName)} <${g.from}> | ${dateStr}\n${g.body}`

    const msg = {
      id: randomUUID(),
      sessionId,
      channelName: 'email',
      senderType: 'user' as const,
      senderId: g.from,
      content: { type: 'text', text: contentText },
      role: 'system' as const,
      contentText,
      contentType: 'text' as const,
      metadata: { source: 'thread-gap', originalMessageId: g.id },
      createdAt: g.date, // Original date for chronological ordering
    }

    try {
      if (memoryManager) {
        await memoryManager.saveMessage(msg)
      } else {
        const db = registry.getDb()
        await db.query(
          `INSERT INTO messages (id, session_id, role, content_text, content_type, metadata, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (id) DO NOTHING`,
          [msg.id, msg.sessionId, msg.role, msg.contentText, msg.contentType,
           JSON.stringify(msg.metadata), msg.createdAt],
        )
      }
    } catch (err) {
      logger.warn({ gapId: g.id, sessionId, err }, 'Failed to persist gap message — skipping')
    }
  }
}

async function processIncomingEmail(msg: EmailMessage): Promise<void> {
  if (!_registry || !gmailAdapter) return

  const config = _registry.getConfig<EmailConfig>('gmail')
  const db = _registry.getDb()

  // Detect thread gap BEFORE updating last_message_gmail_id
  let gapPreamble = ''
  if (msg.threadId) {
    try {
      const gaps = await detectThreadGap(msg, db, config)
      if (gaps && gaps.length > 0) {
        // Try to persist into existing session
        const sessionRow = await db.query<{ id: string }>(
          `SELECT id FROM sessions WHERE thread_id = $1
           AND last_activity_at > now() - make_interval(hours => $2)
           ORDER BY last_activity_at DESC LIMIT 1`,
          [msg.threadId, config.EMAIL_SESSION_INACTIVITY_HOURS],
        )
        const sessionId = sessionRow.rows[0]?.id

        if (sessionId) {
          // Session active → persist individual gap messages
          await persistGapMessages(gaps, sessionId, _registry)
          logger.info({ messageId: msg.id, threadId: msg.threadId, gapCount: gaps.length, sessionId }, 'Thread gap messages persisted to session')
        } else {
          // Session expired → fallback to text preamble for this turn
          gapPreamble = formatGapPreamble(gaps) + '\n\n'
          logger.info({ messageId: msg.id, threadId: msg.threadId, gapCount: gaps.length }, 'Thread gap context injected as preamble (no active session)')
        }
      }
    } catch (err) {
      logger.warn({ err, messageId: msg.id }, 'Gap detection failed — continuing without')
    }
  }

  // Track thread (including Gmail message ID for label operations) — AFTER gap detection
  await db.query(`
    INSERT INTO email_threads (thread_id, contact_id, subject, last_message_at, message_count, last_message_gmail_id)
    VALUES ($1, $2, $3, $4, 1, $5)
    ON CONFLICT (thread_id) DO UPDATE SET
      last_message_at = $4, message_count = email_threads.message_count + 1, last_message_gmail_id = $5
  `, [msg.threadId, msg.from, msg.subject, msg.date, msg.id])

  // Min body length check (skip empty/trivial emails)
  const textContent = msg.bodyText || stripHtml(msg.bodyHtml)
  // Use cleaned body for the engine (quoted replies, signatures, disclaimers stripped)
  const cleanContent = msg.cleanBodyText || textContent
  if (textContent.trim().length < 2 && msg.attachments.length === 0) {
    logger.debug({ messageId: msg.id, from: msg.from }, 'Skipping email with empty body')
    return
  }

  // Build attachment metadata for engine processing (Phase 1 handles extraction now)
  const adapter = gmailAdapter
  const attachmentMetas = msg.attachments.length > 0
    ? msg.attachments.map((att) => ({
        id: att.id,
        filename: att.filename,
        mimeType: att.mimeType,
        size: att.size,
        getData: () => adapter.downloadAttachment(msg.id, att.id)
          .then((b) => b ?? Buffer.alloc(0))
          .catch((err: unknown) => {
            logger.warn({ messageId: msg.id, attachmentId: att.id, filename: att.filename, err }, 'Attachment download failed — skipping')
            return Buffer.alloc(0)
          }),
      }))
    : undefined

  const fullContent = `${gapPreamble}[Email] De: ${msg.fromName} <${msg.from}>\nAsunto: ${msg.subject}\n\n${cleanContent}`

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
    attachments: attachmentMetas,
    threadId: msg.threadId || undefined, // bind email to its Gmail thread → one thread = one session
    raw: msg,
  })

  // Marcar como leído si está configurado
  if (config.EMAIL_AUTO_MARK_READ) {
    await gmailAdapter.markAsRead(msg.id).catch((err) => {
      logger.warn({ messageId: msg.id, err }, 'Failed to mark email as read')
    })
  }

  // Apply LUNA/Agent label
  if (lunaLabels.agent) {
    await gmailAdapter.addLabels(msg.id, [lunaLabels.agent]).catch((err) => {
      logger.warn({ messageId: msg.id, err }, 'Failed to apply LUNA/Agent label')
    })
  }

  // Auto-create coworker if sender domain matches configured domains
  try {
    await autoCreateCoworkerFromDomain(msg.from, msg.fromName)
  } catch (err) {
    logger.warn({ err, from: msg.from }, 'Auto-create coworker from domain failed')
  }

  // Try to extract contact data from email signature (LLM-based, max 3 attempts)
  try {
    const { tryExtractSignature } = await import('./signature-parser.js')
    await tryExtractSignature(_registry, msg.from, textContent)
  } catch (err) {
    logger.warn({ err, from: msg.from }, 'Signature extraction failed')
  }

  logger.info({ messageId: msg.id, from: msg.from, subject: msg.subject }, 'Email processed')
}

/**
 * If sender's email domain matches a configured coworker domain,
 * auto-create the contact as a coworker with source 'inbound'.
 */
async function autoCreateCoworkerFromDomain(email: string, fromName: string): Promise<void> {
  if (!_registry) return

  const usersDb = _registry.getOptional<import('../users/db.js').UsersDb>('users:db')
  const usersCache = _registry.getOptional<import('../users/cache.js').UserCache>('users:cache')
  if (!usersDb || !usersCache) return

  // Extract domain from email
  const atIdx = email.indexOf('@')
  if (atIdx === -1) return
  const domain = email.slice(atIdx).toLowerCase() // e.g. '@empresa.com'

  // Get coworker config
  const coworkerCfg = await usersDb.getListConfig('coworker')
  if (!coworkerCfg?.isEnabled) return

  const configuredDomains: string[] = (coworkerCfg.syncConfig as Record<string, unknown>)?.domains as string[] ?? []
  if (configuredDomains.length === 0) return

  // Check if domain matches
  const normalizedDomains = configuredDomains.map(d => d.toLowerCase().startsWith('@') ? d.toLowerCase() : `@${d.toLowerCase()}`)
  if (!normalizedDomains.includes(domain)) return

  // Check if contact already exists
  const existing = await usersDb.resolveByContact(email, 'gmail')
  if (existing) return // already registered

  // Create coworker
  await usersDb.createUser({
    listType: 'coworker',
    displayName: fromName || undefined,
    contacts: [{ channel: 'gmail', senderId: email }],
    source: 'inbound',
  })
  await usersCache.invalidate(email)

  logger.info({ email, fromName }, 'Auto-created coworker from email domain match')
}


// ─── API Routes ────────────────────────────

const apiRoutes: ApiRoute[] = [
  {
    method: 'GET',
    path: 'rate-limits',
    handler: async (_req, res) => {
      if (!rateLimiter) {
        jsonResponse(res, 200, { hourly: 0, daily: 0, limits: { perHour: 0, perDay: 0 }, canSend: false })
        return
      }
      const usage = await rateLimiter.getUsage()
      jsonResponse(res, 200, usage)
    },
  },
  {
    method: 'GET',
    path: 'status',
    handler: async (_req, res) => {
      const oauthManager = _registry?.getOptional<OAuthManager>('google:oauth-manager')
      const connected = oauthManager?.isConnected() ?? false
      const email = oauthManager?.getState().email ?? null

      jsonResponse(res, 200, {
        ...pollerState,
        connected,
        email,
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
  // ─── Labels routes ──────────────────────────
  {
    method: 'GET',
    path: 'labels',
    handler: async (_req, res) => {
      const defaultLabels = Object.entries(lunaLabels)
        .filter(([, id]) => id !== null)
        .map(([key, id]) => ({ key, name: `LUNA/${key.charAt(0).toUpperCase() + key.slice(1).replace(/([A-Z])/g, '-$1')}`, id, type: 'default' as const }))
      const customLabelsOut = resolvedCustomLabels.map((l) => ({ key: l.name, name: l.name, id: l.id, type: 'custom' as const, instruction: l.instruction }))
      jsonResponse(res, 200, { labels: [...defaultLabels, ...customLabelsOut] })
    },
  },
  {
    method: 'GET',
    path: 'label-instructions',
    handler: async (_req, res) => {
      // Returns label instructions for the agent/engine to know when to apply each label
      const instructions = resolvedCustomLabels.map((l) => ({
        name: l.name,
        id: l.id,
        instruction: l.instruction,
      }))
      jsonResponse(res, 200, { customLabels: instructions })
    },
  },
  {
    method: 'POST',
    path: 'apply-label',
    handler: async (req, res) => {
      if (!gmailAdapter) {
        jsonResponse(res, 400, { error: 'Gmail adapter not initialized' })
        return
      }
      try {
        const body = await parseBody<{ messageId: string; labelId: string }>(req)
        if (!body.messageId || !body.labelId) {
          jsonResponse(res, 400, { error: 'Missing messageId or labelId' })
          return
        }
        await gmailAdapter.addLabels(body.messageId, [body.labelId])
        jsonResponse(res, 200, { ok: true })
      } catch (err) {
        jsonResponse(res, 500, { error: 'Failed to apply label: ' + String(err) })
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
  // ─── Auth status route ──────────────────────
  {
    method: 'GET',
    path: 'auth-status',
    handler: async (req, res) => {
      const redirectUri = getRedirectUri(req)
      const oauthManager = _registry?.getOptional<OAuthManager>('google:oauth-manager')
      if (!oauthManager) {
        jsonResponse(res, 200, { connected: false, status: 'google_apps_not_active', email: null, hasCredentials: false, redirectUri })
        return
      }
      const state = oauthManager.getState()
      jsonResponse(res, 200, { connected: oauthManager.isConnected(), hasCredentials: oauthManager.hasCredentials(), redirectUri, ...state })
    },
  },
]

// ─── Manifest ──────────────────────────────

const manifest: ModuleManifest = {
  name: 'gmail',
  version: '1.1.0',
  description: {
    es: 'Canal de email via Gmail API. Recibe, responde, reenvía y envía correos.',
    en: 'Email channel via Gmail API. Receives, replies, forwards and sends emails.',
  },
  type: 'channel',
  channelType: 'async',
  removable: true,
  activateByDefault: false,
  depends: ['google-apps'], // Gmail SIEMPRE usa el OAuth compartido de google-apps

  configSchema: z.object({
    EMAIL_POLL_INTERVAL_MS: numEnv(60000),
    EMAIL_MAX_ATTACHMENT_SIZE_MB: floatEnvMin(0, 16),
    EMAIL_NOREPLY_ADDRESSES: z.string().default(''),
    EMAIL_NOREPLY_PATTERNS: z.string().default(''),
    EMAIL_PROCESS_LABELS: z.string().default('INBOX'),
    EMAIL_SKIP_LABELS: z.string().default('SPAM,TRASH'),
    EMAIL_AUTO_MARK_READ: boolEnv(true),
    EMAIL_INCLUDE_SIGNATURE: boolEnv(true),
    EMAIL_MAX_HISTORY_FETCH: numEnv(20),
    // Reply & footer
    EMAIL_REPLY_MODE: z.string().default('reply-sender'),
    EMAIL_FOOTER_ENABLED: boolEnv(false),
    EMAIL_FOOTER_TEXT: z.string().default('Respondido por L.U.N.A - Agente de atencion al cliente'),
    // Filtering
    EMAIL_ONLY_FIRST_IN_THREAD: boolEnv(true),
    EMAIL_IGNORE_SUBJECTS: z.string().default('Out of Office,Automatic reply,Fuera de oficina,Respuesta automatica'),
    EMAIL_ALLOWED_DOMAINS: z.string().default(''),
    EMAIL_BLOCKED_DOMAINS: z.string().default(''),
    // Rate limiting
    EMAIL_ACCOUNT_TYPE: z.string().default('workspace'),
    EMAIL_RATE_LIMIT_PER_HOUR: numEnv(0),  // 0 = use defaults per account type
    EMAIL_RATE_LIMIT_PER_DAY: numEnv(0),   // 0 = use defaults per account type
    // Always CC
    EMAIL_ALWAYS_CC: z.string().default(''),
    // Custom labels (JSON array of { name, instruction })
    EMAIL_CUSTOM_LABELS: z.string().default('[]'),
    // Batching
    EMAIL_BATCH_WAIT_MS: numEnv(0),
    // Session management
    EMAIL_SESSION_INACTIVITY_HOURS: numEnvMin(1, 48),
    EMAIL_PRECLOSE_FOLLOWUP_HOURS: numEnv(0),
    EMAIL_PRECLOSE_FOLLOWUP_TEXT: z.string().default(''),
    // Naturalidad — avisos automaticos cuando la respuesta tarda
    ACK_EMAIL_TRIGGER_MS: numEnv(0),
    ACK_EMAIL_HOLD_MS: numEnv(2000),
    ACK_EMAIL_MESSAGE: z.string().default(''),
    ACK_EMAIL_STYLE: z.string().default('formal'),
    // Response format (form builder — same pattern as WhatsApp)
    EMAIL_FORMAT_ADVANCED: boolEnv(false),
    FORMAT_INSTRUCTIONS_EMAIL: z.string().default(''),
    EMAIL_FORMAT_TONE: z.string().default('profesional'),
    EMAIL_FORMAT_MAX_SENTENCES: numEnv(4),
    EMAIL_FORMAT_MAX_PARAGRAPHS: numEnv(4),
    EMAIL_FORMAT_EMOJI_LEVEL: z.string().default('nunca'),
    // Firma de email
    EMAIL_SIGNATURE_MODE: z.string().default('gmail'),    // gmail | custom | auto
    EMAIL_SIGNATURE_TEXT: z.string().default(''),          // only used if mode = 'custom'
    // Triage — pre-agentic classification
    EMAIL_TRIAGE_ENABLED: boolEnv(true),
    // Thread gap detection — max messages to recover when Luna is re-added to a thread
    EMAIL_GAP_CONTEXT_MAX: numEnv(5),
    EMAIL_GAP_FETCH_TIMEOUT_S: numEnvMin(5, 30),
    // Attachment processing — which file types to process on email channel
    // Email supports all categories
    EMAIL_ATT_IMAGES: boolEnv(true),
    EMAIL_ATT_DOCUMENTS: boolEnv(true),
    EMAIL_ATT_SPREADSHEETS: boolEnv(true),
    EMAIL_ATT_PRESENTATIONS: boolEnv(true),
    EMAIL_ATT_TEXT: boolEnv(true),
    EMAIL_ATT_AUDIO: boolEnv(true),
    EMAIL_ATT_MAX_SIZE_MB: numEnvMin(1, 25),
    EMAIL_ATT_MAX_PER_MSG: numEnvMin(1, 10),
  }),

  console: {
    title: { es: 'Gmail', en: 'Gmail' },
    info: {
      es: 'Canal de correo electrónico via Gmail API. Requiere Google API conectado. Los emails se procesan por el engine como mensajes.',
      en: 'Email channel via Gmail API. Requires Google API connected. Emails are processed by the engine as messages.',
    },
    order: 12,
    group: 'channels',
    icon: '&#9993;',
    fields: [
      // ── General ──
      {
        key: 'EMAIL_POLL_INTERVAL_MS',
        type: 'number',
        width: 'half',
        label: { es: 'Intervalo de polling (ms)', en: 'Poll interval (ms)' },
        info: { es: 'Cada cuantos milisegundos revisar nuevos emails (default: 60000 = 1 min)', en: 'How often to check for new emails in ms (default: 60000 = 1 min)' },
      },
      {
        key: 'EMAIL_MAX_HISTORY_FETCH',
        type: 'number',
        width: 'half',
        label: { es: 'Max emails por poll', en: 'Max emails per poll' },
        info: { es: 'Maximo de emails a obtener por ciclo de polling (default: 20)', en: 'Maximum emails to fetch per poll cycle (default: 20)' },
      },
      {
        key: 'EMAIL_PROCESS_LABELS',
        type: 'text',
        width: 'half',
        label: { es: 'Labels a procesar', en: 'Labels to process' },
        info: { es: 'Labels de Gmail a monitorear (default: INBOX)', en: 'Gmail labels to monitor (default: INBOX)' },
      },
      {
        key: 'EMAIL_SKIP_LABELS',
        type: 'text',
        width: 'half',
        label: { es: 'Labels a ignorar', en: 'Labels to skip' },
        info: { es: 'Labels que se ignoran (default: SPAM,TRASH)', en: 'Labels to ignore (default: SPAM,TRASH)' },
      },
      {
        key: 'EMAIL_AUTO_MARK_READ',
        type: 'boolean',
        label: { es: 'Marcar como leido automaticamente', en: 'Auto mark as read' },
        description: { es: 'Marcar emails como leidos despues de procesarlos', en: 'Mark emails as read after processing' },
      },
      {
        key: 'EMAIL_INCLUDE_SIGNATURE',
        type: 'boolean',
        label: { es: 'Incluir firma', en: 'Include signature' },
        description: { es: 'Incluir firma de Gmail al enviar emails', en: 'Include Gmail signature when sending emails' },
      },
      {
        key: 'EMAIL_MAX_ATTACHMENT_SIZE_MB',
        type: 'number',
        label: { es: 'Tamano max. adjunto (MB)', en: 'Max attachment size (MB)' },
        info: { es: 'Tamano maximo permitido por adjunto en MB (default: 16)', en: 'Maximum allowed attachment size in MB (default: 16)' },
      },
      // ── Respuestas ──
      { key: '_divider_replies', type: 'divider', label: { es: 'Respuestas', en: 'Replies' } },
      {
        key: 'EMAIL_REPLY_MODE',
        type: 'select',
        width: 'half',
        label: { es: 'Modo de respuesta', en: 'Reply mode' },
        info: { es: 'A quien responder: solo al remitente, a todos, o que el agente decida', en: 'Who to reply to: sender only, all, or let the agent decide' },
        options: [
          { value: 'reply-sender', label: 'Reply sender' },
          { value: 'reply-all', label: 'Reply all' },
          { value: 'agent-decides', label: 'Agent decides' },
        ],
      },
      {
        key: 'EMAIL_ALWAYS_CC',
        type: 'text',
        width: 'half',
        label: { es: 'Siempre copiar a (CC)', en: 'Always CC to' },
        info: { es: 'Direcciones separadas por coma que recibiran copia de todos los emails enviados por el agente.', en: 'Comma-separated addresses that receive a copy of all emails sent by the agent.' },
        placeholder: 'supervisor@empresa.com, ventas@empresa.com',
      },
      {
        key: 'EMAIL_BATCH_WAIT_MS',
        type: 'number',
        width: 'half',
        label: { es: 'Espera antes de procesar (ms)', en: 'Wait before processing (ms)' },
        info: { es: 'Tiempo de espera para agrupar correcciones rapidas antes de procesar. 0 = procesar inmediatamente.', en: 'Wait time to batch quick corrections before processing. 0 = process immediately.' },
      },
      {
        key: 'EMAIL_ONLY_FIRST_IN_THREAD',
        type: 'boolean',
        label: { es: 'Solo ultimo email por hilo', en: 'Only latest email per thread' },
        description: { es: 'Si hay varios emails sin leer en un hilo, procesar solo el mas reciente', en: 'If multiple unread emails in a thread, only process the most recent' },
      },
      // ── Pie de email ──
      { key: '_divider_footer', type: 'divider', label: { es: 'Pie de email', en: 'Email footer' } },
      {
        key: 'EMAIL_FOOTER_ENABLED',
        type: 'boolean',
        label: { es: 'Agregar pie de email', en: 'Add email footer' },
        description: { es: 'Agregar un texto al final de cada email enviado por el agente', en: 'Append text at the end of every email sent by the agent' },
      },
      {
        key: 'EMAIL_FOOTER_TEXT',
        type: 'text',
        label: { es: 'Texto del pie', en: 'Footer text' },
        info: { es: 'Texto que aparece al final de cada email (solo si el pie esta habilitado)', en: 'Text shown at the end of each email (only if footer is enabled)' },
      },
      // ── Firma de email ──
      { key: '_divider_signature', type: 'divider', label: { es: 'Firma', en: 'Signature' } },
      {
        key: 'EMAIL_SIGNATURE_MODE',
        type: 'select',
        width: 'half',
        label: { es: 'Modo de firma', en: 'Signature mode' },
        info: {
          es: 'gmail: usa la firma de la cuenta de Gmail. custom: usa el texto personalizado de abajo. auto: gmail si existe, sino custom.',
          en: 'gmail: use Gmail account signature. custom: use custom text below. auto: gmail if available, otherwise custom.',
        },
        options: [
          { value: 'gmail', label: 'Gmail' },
          { value: 'custom', label: 'Custom' },
          { value: 'auto', label: 'Auto' },
        ],
      },
      {
        key: 'EMAIL_SIGNATURE_TEXT',
        type: 'textarea',
        rows: 4,
        label: { es: 'Firma personalizada', en: 'Custom signature' },
        info: {
          es: 'Texto de firma personalizada. Solo se usa cuando el modo es "custom" o "auto" (si Gmail no tiene firma).',
          en: 'Custom signature text. Only used when mode is "custom" or "auto" (if Gmail has no signature).',
        },
      },
      // ── Filtrado ──
      { key: '_divider_filtering', type: 'divider', label: { es: 'Filtrado', en: 'Filtering' } },
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
        key: 'EMAIL_IGNORE_SUBJECTS',
        type: 'tags',
        separator: ',',
        label: { es: 'Asuntos a ignorar', en: 'Subjects to ignore' },
        info: { es: 'Asuntos que se ignoran automaticamente (ej: Out of Office, Respuesta automatica)', en: 'Subjects automatically ignored (e.g. Out of Office, Automatic reply)' },
      },
      {
        key: 'EMAIL_ALLOWED_DOMAINS',
        type: 'tags',
        separator: ',',
        label: { es: 'Dominios permitidos', en: 'Allowed domains' },
        info: { es: 'Solo procesar emails de estos dominios (vacio = todos)', en: 'Only process emails from these domains (empty = all)' },
      },
      {
        key: 'EMAIL_BLOCKED_DOMAINS',
        type: 'tags',
        separator: ',',
        label: { es: 'Dominios bloqueados', en: 'Blocked domains' },
        info: { es: 'Ignorar emails de estos dominios', en: 'Ignore emails from these domains' },
      },
      // ── Limites de envio ──
      { key: '_divider_ratelimit', type: 'divider', label: { es: 'Limites de envio', en: 'Send limits' } },
      {
        key: 'EMAIL_ACCOUNT_TYPE',
        type: 'select',
        width: 'half',
        label: { es: 'Tipo de cuenta', en: 'Account type' },
        info: { es: 'Controla los limites de envio por defecto. Workspace: 80/h, 1500/dia. Free: 20/h, 400/dia.', en: 'Controls default send limits. Workspace: 80/h, 1500/day. Free: 20/h, 400/day.' },
        options: [
          { value: 'workspace', label: 'Google Workspace' },
          { value: 'free', label: 'Gmail (free)' },
        ],
      },
      {
        key: 'EMAIL_RATE_LIMIT_PER_HOUR',
        type: 'number',
        width: 'half',
        label: { es: 'Limite por hora (custom)', en: 'Hourly limit (custom)' },
        info: { es: 'Sobreescribe el limite por hora. 0 = usar default del tipo de cuenta.', en: 'Override hourly limit. 0 = use account type default.' },
      },
      {
        key: 'EMAIL_RATE_LIMIT_PER_DAY',
        type: 'number',
        width: 'half',
        label: { es: 'Limite por dia (custom)', en: 'Daily limit (custom)' },
        info: { es: 'Sobreescribe el limite diario. 0 = usar default del tipo de cuenta.', en: 'Override daily limit. 0 = use account type default.' },
      },
      // ── Triage (pre-procesamiento) ──
      { key: '_divider_triage', type: 'divider', label: { es: 'Triage (pre-procesamiento)', en: 'Triage (pre-processing)' } },
      {
        key: 'EMAIL_TRIAGE_ENABLED',
        type: 'boolean',
        label: { es: 'Activar triage de emails', en: 'Enable email triage' },
        description: {
          es: 'Clasifica emails antes del pipeline: RESPOND (responder), OBSERVE (guardar sin responder), IGNORE (descartar). Filtra auto-replies, DSN, CC-only, etc.',
          en: 'Classify emails before pipeline: RESPOND, OBSERVE (save without replying), IGNORE (discard). Filters auto-replies, DSN, CC-only, etc.',
        },
      },
      // ── Etiquetas personalizadas ──
      { key: '_divider_labels', type: 'divider', label: { es: 'Etiquetas personalizadas', en: 'Custom labels' } },
      {
        key: 'EMAIL_CUSTOM_LABELS',
        type: 'textarea',
        rows: 5,
        label: { es: 'Etiquetas personalizadas (JSON)', en: 'Custom labels (JSON)' },
        info: {
          es: 'Array JSON de etiquetas extra. Cada una tiene "name" (nombre en Gmail) e "instruction" (instruccion para el agente). Las etiquetas default (Agent, Escalated, Converted, Human-Loop, Ignored) siempre existen. Ejemplo: [{"name":"Hot-Lead","instruction":"Aplicar cuando el lead muestra interes fuerte de compra"}]',
          en: 'JSON array of extra labels. Each has "name" (Gmail label name) and "instruction" (instruction for the agent). Default labels (Agent, Escalated, Converted, Human-Loop, Ignored) always exist. Example: [{"name":"Hot-Lead","instruction":"Apply when lead shows strong buying intent"}]',
        },
        placeholder: '[{"name":"Hot-Lead","instruction":"Apply when lead shows strong buying intent"}]',
      },
      // ── Sesiones ──
      { key: '_divider_sessions', type: 'divider', label: { es: 'Sesiones', en: 'Sessions' } },
      {
        key: 'EMAIL_SESSION_INACTIVITY_HOURS',
        type: 'number',
        width: 'half',
        label: { es: 'Inactividad para cerrar (h)', en: 'Inactivity to close (h)' },
        info: { es: 'Horas de inactividad antes de cerrar la sesion de email (min: 1, max: 336 = 2 semanas)', en: 'Hours of inactivity before closing email session (min: 1, max: 336 = 2 weeks)' },
      },
      {
        key: 'EMAIL_PRECLOSE_FOLLOWUP_HOURS',
        type: 'number',
        width: 'half',
        label: { es: 'Seguimiento pre-cierre (h)', en: 'Pre-close follow-up (h)' },
        info: { es: 'Horas antes del cierre para enviar seguimiento. 0 = desactivado.', en: 'Hours before close to send follow-up. 0 = disabled.' },
      },
      {
        key: 'EMAIL_PRECLOSE_FOLLOWUP_TEXT',
        type: 'textarea',
        rows: 3,
        label: { es: 'Mensaje de seguimiento', en: 'Follow-up message' },
        info: { es: 'Texto del email de seguimiento antes de cerrar la sesion', en: 'Follow-up email text before closing the session' },
      },
      {
        key: 'EMAIL_GAP_CONTEXT_MAX',
        type: 'number',
        width: 'half',
        label: { es: 'Contexto de hilo faltante (msgs)', en: 'Thread gap context (msgs)' },
        info: { es: 'Max mensajes a recuperar cuando Luna es re-agregada a un hilo del que estuvo ausente. 0 = desactivado.', en: 'Max messages to recover when Luna is re-added to a thread she was absent from. 0 = disabled.' },
      },
      {
        key: 'EMAIL_GAP_FETCH_TIMEOUT_S',
        type: 'number',
        width: 'half',
        label: { es: 'Timeout recuperación hilo (s)', en: 'Thread gap fetch timeout (s)' },
        info: { es: 'Tiempo máximo en segundos para recuperar mensajes faltantes de un hilo. Min: 5.', en: 'Maximum time in seconds to fetch missing thread messages. Min: 5.' },
      },
      // ── Naturalidad ──
      { key: '_divider_naturalidad', type: 'divider', label: { es: 'Naturalidad', en: 'Naturalness' } },
      {
        key: 'ACK_EMAIL_TRIGGER_MS',
        type: 'number',
        width: 'half',
        label: { es: 'Tiempo para aviso (ms)', en: 'Acknowledgment trigger (ms)' },
        info: { es: 'Si la respuesta tarda mas de este tiempo, se envia un aviso automatico por email. 0 = desactivado.', en: 'If the response takes longer than this, an automatic email ack is sent. 0 = disabled.' },
      },
      {
        key: 'ACK_EMAIL_HOLD_MS',
        type: 'number',
        width: 'half',
        label: { es: 'Pausa antes de respuesta (ms)', en: 'Hold before response (ms)' },
        info: { es: 'Tiempo que se retiene la respuesta real despues del aviso por email.', en: 'Time the real response is held after the email ack.' },
      },
      {
        key: 'ACK_EMAIL_MESSAGE',
        type: 'text',
        label: { es: 'Mensaje de aviso', en: 'Acknowledgment message' },
        info: { es: 'Texto del aviso de email. Se envia automaticamente si la respuesta tarda.', en: 'Email ack text. Sent automatically if the response is slow.' },
      },
      {
        key: 'ACK_EMAIL_STYLE',
        type: 'select',
        width: 'half',
        label: { es: 'Estilo de aviso', en: 'Ack style' },
        info: { es: 'formal/casual/express: elige al azar. dynamic: rota secuencialmente.', en: 'formal/casual/express: random pick. dynamic: sequential rotation.' },
        options: [
          { value: 'formal', label: 'Formal' },
          { value: 'casual', label: 'Casual' },
          { value: 'express', label: 'Express' },
          { value: 'dynamic', label: 'Dynamic' },
        ],
      },
      { key: '_divider_format', type: 'divider', label: { es: 'Formato de respuesta', en: 'Response format' } },
      { key: 'EMAIL_FORMAT_ADVANCED', type: 'boolean', label: { es: 'Prompting avanzado', en: 'Advanced prompting' }, info: { es: 'Activa el editor de texto para personalizar el prompt de formato manualmente', en: 'Enable text editor to manually customize the format prompt' } },
      { key: 'FORMAT_INSTRUCTIONS_EMAIL', type: 'textarea', label: { es: 'Instrucciones de formato', en: 'Format instructions' }, rows: 8, visibleWhen: { key: 'EMAIL_FORMAT_ADVANCED', value: 'true' }, fieldType: 'code-editor' as never },
      { key: 'EMAIL_FORMAT_TONE', type: 'select', label: { es: 'Tono', en: 'Tone' }, visibleWhen: { key: 'EMAIL_FORMAT_ADVANCED', value: 'false' }, options: [{ value: 'ninguno', label: { es: 'Sin especificar', en: 'None' } }, { value: 'formal', label: { es: 'Formal', en: 'Formal' } }, { value: 'profesional', label: { es: 'Profesional', en: 'Professional' } }, { value: 'amigable', label: { es: 'Amigable', en: 'Friendly' } }, { value: 'directo', label: { es: 'Directo', en: 'Direct' } }] },
      { key: 'EMAIL_FORMAT_MAX_SENTENCES', type: 'number', label: { es: 'Max oraciones por parrafo', en: 'Max sentences per paragraph' }, min: 1, max: 15, width: 'half', visibleWhen: { key: 'EMAIL_FORMAT_ADVANCED', value: 'false' } },
      { key: 'EMAIL_FORMAT_MAX_PARAGRAPHS', type: 'number', label: { es: 'Max parrafos por respuesta', en: 'Max paragraphs per response' }, min: 1, max: 15, width: 'half', visibleWhen: { key: 'EMAIL_FORMAT_ADVANCED', value: 'false' } },
      { key: 'EMAIL_FORMAT_EMOJI_LEVEL', type: 'select', label: { es: 'Uso de emojis', en: 'Emoji usage' }, visibleWhen: { key: 'EMAIL_FORMAT_ADVANCED', value: 'false' }, options: [{ value: 'nunca', label: { es: 'Nunca', en: 'Never' } }, { value: 'bajo', label: { es: 'Bajo', en: 'Low' } }, { value: 'moderado', label: { es: 'Moderado', en: 'Moderate' } }] },
      { key: '_divider_attachments', type: 'divider', label: { es: 'Adjuntos', en: 'Attachments' } },
      {
        key: 'EMAIL_ATT_IMAGES',
        type: 'boolean',
        label: { es: 'Procesar imagenes', en: 'Process images' },
        description: { es: 'Imagenes adjuntas en correos (JPEG, PNG, WebP, GIF)', en: 'Image attachments in emails (JPEG, PNG, WebP, GIF)' },
        icon: '&#128247;',
      },
      {
        key: 'EMAIL_ATT_DOCUMENTS',
        type: 'boolean',
        label: { es: 'Procesar documentos', en: 'Process documents' },
        description: { es: 'PDF, Word (.docx, .doc)', en: 'PDF, Word (.docx, .doc)' },
        icon: '&#128196;',
      },
      {
        key: 'EMAIL_ATT_SPREADSHEETS',
        type: 'boolean',
        label: { es: 'Procesar hojas de calculo', en: 'Process spreadsheets' },
        description: { es: 'Excel (.xlsx, .xls) y CSV', en: 'Excel (.xlsx, .xls) and CSV' },
        icon: '&#128202;',
      },
      {
        key: 'EMAIL_ATT_PRESENTATIONS',
        type: 'boolean',
        label: { es: 'Procesar presentaciones', en: 'Process presentations' },
        description: { es: 'PowerPoint (.pptx, .ppt)', en: 'PowerPoint (.pptx, .ppt)' },
        icon: '&#128218;',
      },
      {
        key: 'EMAIL_ATT_TEXT',
        type: 'boolean',
        label: { es: 'Procesar archivos de texto', en: 'Process text files' },
        description: { es: 'Archivos .txt, .md, .json', en: '.txt, .md, .json files' },
        icon: '&#128221;',
      },
      {
        key: 'EMAIL_ATT_AUDIO',
        type: 'boolean',
        label: { es: 'Procesar audio', en: 'Process audio' },
        description: { es: 'Archivos de audio adjuntos (MP3, WAV, OGG)', en: 'Audio file attachments (MP3, WAV, OGG)' },
        icon: '&#127908;',
      },
      {
        key: 'EMAIL_ATT_MAX_SIZE_MB',
        type: 'number',
        label: { es: 'Tamano max (MB)', en: 'Max size (MB)' },
        info: { es: 'Tamano maximo de adjunto a procesar (limite Gmail: 25 MB)', en: 'Maximum attachment size to process (Gmail limit: 25 MB)' },
        min: 1,
        max: 50,
        unit: 'MB',
        width: 'half',
      },
      {
        key: 'EMAIL_ATT_MAX_PER_MSG',
        type: 'number',
        label: { es: 'Max adjuntos por email', en: 'Max attachments per email' },
        info: { es: 'Maximo de adjuntos a procesar por correo', en: 'Maximum attachments to process per email' },
        min: 1,
        max: 15,
        width: 'half',
      },
    ],
    apiRoutes,
    connectionWizard: {
      title: { es: 'Conectar Gmail', en: 'Connect Gmail' },
      steps: [
        {
          title: { es: 'Autenticacion via Google Apps', en: 'Authentication via Google Apps' },
          instructions: {
            es: '<p>Gmail utiliza la autenticacion OAuth2 compartida del modulo <strong>Google Apps</strong>. Para conectar Gmail:</p><ol><li>Ve a <strong>Canales &gt; Google Apps</strong> en el panel de control.</li><li>Haz clic en <strong>Conectar</strong> y sigue el flujo OAuth2.</li><li>Los scopes de Gmail ya estan incluidos en la autorizacion de Google Apps.</li><li>Una vez conectado, regresa aqui y activa el polling.</li></ol>',
            en: '<p>Gmail uses the shared OAuth2 authentication from the <strong>Google Apps</strong> module. To connect Gmail:</p><ol><li>Go to <strong>Channels &gt; Google Apps</strong> in the control panel.</li><li>Click <strong>Connect</strong> and follow the OAuth2 flow.</li><li>Gmail scopes are already included in the Google Apps authorization.</li><li>Once connected, return here and enable polling.</li></ol>',
          },
        },
      ],
      verifyEndpoint: 'auth-status',
      operationParams: {
        autoReconnect: { es: 'Refresco automatico de token OAuth (gestionado por Google Apps)', en: 'Automatic OAuth token refresh (managed by Google Apps)' },
        maxRetries: { es: 'Reintentos de polling ante error', en: 'Polling retries on error' },
        retryIntervalMs: { es: 'Intervalo de polling de emails (ms)', en: 'Email polling interval (ms)' },
        custom: [
          { key: 'EMAIL_AUTO_MARK_READ', label: { es: 'Marcar como leido al procesar', en: 'Mark as read on process' }, type: 'boolean', defaultValue: 'true' },
        ],
      },
    },
  },

  async init(registry: Registry) {
    _registry = registry
    const db = registry.getDb()
    const config = registry.getConfig<EmailConfig>('gmail')

    // Config coherence checks
    const validReplyModes = ['reply-sender', 'reply-all', 'new-thread']
    if (config.EMAIL_REPLY_MODE && !validReplyModes.includes(config.EMAIL_REPLY_MODE)) {
      logger.warn({ configured: config.EMAIL_REPLY_MODE, valid: validReplyModes }, 'EMAIL_REPLY_MODE is not a recognized value — defaulting to reply-sender')
    }

    // ─── OAuth: always use shared OAuth from google-apps ───
    const sharedOAuth = registry.get<OAuthManager>('google:oauth-manager')
    const authClient = sharedOAuth.getClient()
    const oauthConnected = sharedOAuth.isConnected()
    logger.info('Email using shared OAuth from google-apps module')

    // Crear Gmail adapter si tenemos auth client
    if (authClient) {
      gmailAdapter = new GmailAdapter(authClient, config)
      registry.provide('email:adapter', gmailAdapter)

      // Fetch workspace signature for injection in outgoing emails
      await gmailAdapter.fetchWorkspaceSignature()

      // Register email tools (proactive inbox access for the agent)
      const { registerEmailTools } = await import('./tools.js')
      await registerEmailTools(registry, gmailAdapter)
    }

    // Expose label accessor so engine/tools can read custom label instructions
    registry.provide('gmail:label-instructions', () => resolvedCustomLabels)

    // ── Triage Config Service (engine reads this for pre-agentic classification) ──
    // Auto-detect own address from OAuth profile
    try {
      detectedOwnAddress = sharedOAuth.getState().email ?? ''
    } catch { /* ignore — will use empty string */ }
    registry.provide('gmail:triage-config', {
      getTriageConfig: () => ({
        enabled: config.EMAIL_TRIAGE_ENABLED,
        ownAddress: detectedOwnAddress,
      }),
    })

    // ── Channel Config Service (standard pattern — engine reads this) ──
    registry.provide('channel-config:email', {
      get: (): import('../../channels/types.js').ChannelRuntimeConfig => {
        const bufferTurns = registry.getOptional<{ get(): { instant: number; async: number; voice: number } }>('memory:buffer-turns')?.get()
        return {
          rateLimitHour: config.EMAIL_RATE_LIMIT_PER_HOUR,
          rateLimitDay: config.EMAIL_RATE_LIMIT_PER_DAY,
          avisoTriggerMs: config.ACK_EMAIL_TRIGGER_MS,
          avisoHoldMs: config.ACK_EMAIL_HOLD_MS,
          avisoMessages: config.ACK_EMAIL_MESSAGE ? [config.ACK_EMAIL_MESSAGE] : [],
          avisoStyle: (config.ACK_EMAIL_STYLE || 'formal') as import('../../channels/types.js').AvisoStyle,
          sessionTimeoutMs: config.EMAIL_SESSION_INACTIVITY_HOURS * 3600000,
          batchWaitSeconds: config.EMAIL_BATCH_WAIT_MS / 1000,
          precloseFollowupMs: config.EMAIL_PRECLOSE_FOLLOWUP_HOURS * 3600000,
          precloseFollowupMessage: config.EMAIL_PRECLOSE_FOLLOWUP_TEXT,
          typingDelayMsPerChar: 0,
          typingDelayMinMs: 0,
          typingDelayMaxMs: 0,
          channelType: 'async',
          supportsTypingIndicator: false,
          ttsEnabled: false,
          antiSpamMaxPerWindow: 0,
          antiSpamWindowMs: 0,
          floodThreshold: 0,
          historyTurns: bufferTurns?.async ?? 10,
          attachments: buildEmailAttachmentConfig(config),
        }
      },
    })

    // Cargar estado previo
    const stateRow = await db.query(
      `SELECT last_history_id, messages_processed FROM email_state WHERE id = 'primary'`,
    ).catch(() => ({ rows: [] }))
    if (stateRow.rows[0]) {
      lastHistoryId = stateRow.rows[0].last_history_id
      pollerState.messagesProcessed = stateRow.rows[0].messages_processed ?? 0
    }

    // Initialize rate limiter with optional custom limits
    const redis = registry.getRedis()
    const accountType = (config.EMAIL_ACCOUNT_TYPE === 'free' ? 'free' : 'workspace') as 'workspace' | 'free'
    const customLimits = {
      perHour: config.EMAIL_RATE_LIMIT_PER_HOUR || undefined,
      perDay: config.EMAIL_RATE_LIMIT_PER_DAY || undefined,
    }
    rateLimiter = new EmailRateLimiter(accountType, redis, customLimits)

    // Hook: cuando el engine quiere enviar email
    registry.addHook('gmail', 'message:send', async (payload) => {
      if (payload.channel !== 'email') return
      if (!gmailAdapter || !_registry) return

      // Read fresh config for hot-reloadable params
      const freshConfig = _registry.getConfig<EmailConfig>('gmail')

      // Sync rate limiter account type and custom limits if changed
      if (rateLimiter) {
        const freshAccountType = (freshConfig.EMAIL_ACCOUNT_TYPE === 'free' ? 'free' : 'workspace') as 'workspace' | 'free'
        rateLimiter.updateAccountType(freshAccountType, {
          perHour: freshConfig.EMAIL_RATE_LIMIT_PER_HOUR || undefined,
          perDay: freshConfig.EMAIL_RATE_LIMIT_PER_DAY || undefined,
        })
      }

      // Rate limit check
      if (rateLimiter && !(await rateLimiter.canSend())) {
        logger.warn({ to: payload.to }, 'Email rate limit reached — skipping send')
        await registry.runHook('message:sent', {
          channel: 'email',
          to: payload.to,
          success: false,
        })
        return
      }

      // Reload adapter config so footer picks up changes
      gmailAdapter.reloadConfig(freshConfig)

      const bodyHtml = payload.content.text ?? ''
      const to = payload.to
      const sendDb = _registry.getDb()

      try {
        let result: { messageId: string; threadId: string }

        // Try to reply to existing thread instead of sending new email
        const threadRow = await sendDb.query(
          `SELECT thread_id, last_message_gmail_id FROM email_threads WHERE contact_id = $1 AND closed_at IS NULL ORDER BY last_message_at DESC LIMIT 1`,
          [to],
        ).catch(() => ({ rows: [] }))

        const existingThread = threadRow.rows[0] as { thread_id: string; last_message_gmail_id: string } | undefined

        if (existingThread?.last_message_gmail_id) {
          // Reply to existing thread — read fresh reply mode
          const replyAll = freshConfig.EMAIL_REPLY_MODE === 'reply-all'
          result = await gmailAdapter.reply({
            originalMessageId: existingThread.last_message_gmail_id,
            bodyHtml,
            replyAll,
          })
        } else {
          // New email (no existing thread)
          result = await gmailAdapter.sendEmail({
            to: [to],
            subject: '',
            bodyHtml,
          })
        }

        // Record send for rate limiting
        if (rateLimiter) await rateLimiter.recordSend()

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

    // Initialize LUNA labels if connected (default + custom)
    if (oauthConnected && gmailAdapter) {
      await ensureAllLabels()
    }

    // Hook: react to contact status changes (escalation, conversion, etc.)
    registry.addHook('gmail', 'contact:status_changed', async (payload) => {
      if (!gmailAdapter || !_registry) return

      const db = _registry.getDb()
      // Find the email thread for this contact
      const threadRow = await db.query(
        `SELECT thread_id, last_message_gmail_id FROM email_threads WHERE contact_id = $1 ORDER BY last_message_at DESC LIMIT 1`,
        [payload.contactId],
      ).catch(() => ({ rows: [] }))

      const row = threadRow.rows[0] as { thread_id: string; last_message_gmail_id: string } | undefined
      if (!row?.last_message_gmail_id) return

      const msgId = row.last_message_gmail_id
      const newStatus = payload.to as string

      try {
        // Escalation to human
        if (newStatus === 'human_handoff' || newStatus === 'escalated') {
          const labelsToAdd = [lunaLabels.escalated, lunaLabels.humanLoop].filter(Boolean) as string[]
          if (labelsToAdd.length > 0) await gmailAdapter.addLabels(msgId, labelsToAdd)
          if (lunaLabels.agent) await gmailAdapter.removeLabels(msgId, [lunaLabels.agent]).catch(() => {})
          await gmailAdapter.markAsUnread(msgId).catch(() => {})
          await gmailAdapter.starMessage(msgId).catch(() => {})
          await gmailAdapter.markAsImportant(msgId).catch(() => {})
          logger.info({ contactId: payload.contactId, msgId }, 'Email escalated — labels + star + unread applied')
        }

        // Agent takes back from human
        if (newStatus === 'active' && payload.from === 'human_handoff') {
          if (lunaLabels.humanLoop) await gmailAdapter.removeLabels(msgId, [lunaLabels.humanLoop]).catch(() => {})
          if (lunaLabels.agent) await gmailAdapter.addLabels(msgId, [lunaLabels.agent]).catch(() => {})
          await gmailAdapter.unstarMessage(msgId).catch(() => {})
          await gmailAdapter.removeImportant(msgId).catch(() => {})
          logger.info({ contactId: payload.contactId, msgId }, 'Email de-escalated — human loop labels removed')
        }

        // Converted lead
        if (newStatus === 'qualified' || newStatus === 'scheduled') {
          const labelsToAdd = [lunaLabels.converted].filter(Boolean) as string[]
          if (labelsToAdd.length > 0) await gmailAdapter.addLabels(msgId, labelsToAdd)
          if (lunaLabels.agent) await gmailAdapter.removeLabels(msgId, [lunaLabels.agent]).catch(() => {})
          logger.info({ contactId: payload.contactId, newStatus }, 'Email contact converted — label applied')
        }

        // Blocked / not interested
        if (newStatus === 'blocked' || newStatus === 'not_interested') {
          if (lunaLabels.agent) await gmailAdapter.removeLabels(msgId, [lunaLabels.agent]).catch(() => {})
          logger.info({ contactId: payload.contactId, newStatus }, 'Email contact disengaged — agent label removed')
        }
      } catch (err) {
        logger.warn({ contactId: payload.contactId, newStatus, err }, 'Failed to update Gmail labels on status change')
      }
    })

    // Hook: full config hot-reload when console applies changes
    registry.addHook('gmail', 'console:config_applied', async () => {
      const fresh = registry.getConfig<EmailConfig>('gmail')
      Object.assign(config, fresh)
      if (gmailAdapter) {
        gmailAdapter.reloadConfig(fresh)
        // Refresh workspace signature (mode may have changed)
        await gmailAdapter.fetchWorkspaceSignature()
        logger.info('Config applied — re-ensuring Gmail labels')
        await ensureAllLabels()
      }
      if (rateLimiter) {
        rateLimiter.updateAccountType(fresh.EMAIL_ACCOUNT_TYPE as 'workspace' | 'free', {
          perHour: fresh.EMAIL_RATE_LIMIT_PER_HOUR || undefined,
          perDay: fresh.EMAIL_RATE_LIMIT_PER_DAY || undefined,
        })
      }
      logger.info('Gmail config hot-reloaded')
    })

    // Register session management jobs (read fresh config inside handlers for hot reload)
    await registry.runHook('job:register', {
      jobName: 'email-preclose-followup',
      intervalMs: 15 * 60 * 1000, // scan every 15 min
      handler: async () => {
        if (!_registry) return
        const freshCfg = _registry.getConfig<EmailConfig>('gmail')
        if (freshCfg.EMAIL_SESSION_INACTIVITY_HOURS <= 0) return
        if (freshCfg.EMAIL_PRECLOSE_FOLLOWUP_HOURS <= 0 || !freshCfg.EMAIL_PRECLOSE_FOLLOWUP_TEXT) return
        const followupThreshold = freshCfg.EMAIL_SESSION_INACTIVITY_HOURS - freshCfg.EMAIL_PRECLOSE_FOLLOWUP_HOURS
        if (followupThreshold <= 0) return

        const jdb = _registry.getDb()
        const candidates = await jdb.query(
          `SELECT thread_id, contact_id FROM email_threads
           WHERE closed_at IS NULL
             AND followup_sent_at IS NULL
             AND last_message_at < NOW() - make_interval(hours => $1)
             AND last_message_at > NOW() - make_interval(hours => $2)`,
          [followupThreshold, freshCfg.EMAIL_SESSION_INACTIVITY_HOURS],
        )
        for (const row of candidates.rows as Array<{ thread_id: string; contact_id: string }>) {
          await _registry.runHook('message:send', {
            channel: 'email',
            to: row.contact_id,
            content: { type: 'text', text: freshCfg.EMAIL_PRECLOSE_FOLLOWUP_TEXT },
          })
          await jdb.query('UPDATE email_threads SET followup_sent_at = NOW() WHERE thread_id = $1', [row.thread_id])
          logger.info({ threadId: row.thread_id, contactId: row.contact_id }, 'Pre-close follow-up sent')
        }
      },
    })

    await registry.runHook('job:register', {
      jobName: 'email-session-close',
      intervalMs: 30 * 60 * 1000, // scan every 30 min
      handler: async () => {
        if (!_registry) return
        const freshCfg = _registry.getConfig<EmailConfig>('gmail')
        if (freshCfg.EMAIL_SESSION_INACTIVITY_HOURS <= 0) return

        const jdb = _registry.getDb()
        const result = await jdb.query(
          `UPDATE email_threads SET closed_at = NOW()
           WHERE closed_at IS NULL
             AND last_message_at < NOW() - make_interval(hours => $1)
           RETURNING thread_id`,
          [freshCfg.EMAIL_SESSION_INACTIVITY_HOURS],
        )
        if (result.rowCount && result.rowCount > 0) {
          logger.info({ closed: result.rowCount }, 'Email sessions closed due to inactivity')
        }
      },
    })

    // Iniciar polling si OAuth está conectado
    if (oauthConnected && gmailAdapter) {
      startPolling(config.EMAIL_POLL_INTERVAL_MS)
    } else {
      logger.info('OAuth not connected yet — email polling will start when authenticated')
    }

    logger.info({ pollInterval: config.EMAIL_POLL_INTERVAL_MS }, 'Email module initialized')
  },

  async stop() {
    stopPolling()
    // Clear pending batch timers
    for (const [, batch] of pendingBatch) {
      clearTimeout(batch.timer)
    }
    pendingBatch.clear()
    gmailAdapter = null
    _registry = null
    lunaLabels = { agent: null, escalated: null, converted: null, humanLoop: null, ignored: null }
    resolvedCustomLabels = []
    rateLimiter = null
  },
}

function startPolling(intervalMs: number): void {
  if (pollInterval) return

  pollerState.status = 'idle'
  // Primera poll inmediata
  pollForEmails().catch((err: unknown) => {
    logger.error({ err }, 'Unexpected error in initial email poll')
  })

  pollInterval = setInterval(() => {
    pollForEmails().catch((err: unknown) => {
      logger.error({ err }, 'Unexpected error in email poll cycle')
    })
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

/** Build per-channel attachment config from email config fields */
function buildEmailAttachmentConfig(cfg: EmailConfig): import('../../engine/attachments/types.js').ChannelAttachmentConfig {
  const categories: import('../../engine/attachments/types.js').AttachmentCategory[] = []
  if (cfg.EMAIL_ATT_IMAGES) categories.push('images')
  if (cfg.EMAIL_ATT_DOCUMENTS) categories.push('documents')
  if (cfg.EMAIL_ATT_SPREADSHEETS) categories.push('spreadsheets')
  if (cfg.EMAIL_ATT_PRESENTATIONS) categories.push('presentations')
  if (cfg.EMAIL_ATT_TEXT) categories.push('text')
  if (cfg.EMAIL_ATT_AUDIO) categories.push('audio')
  return {
    enabledCategories: categories,
    maxFileSizeMb: cfg.EMAIL_ATT_MAX_SIZE_MB,
    maxAttachmentsPerMessage: cfg.EMAIL_ATT_MAX_PER_MSG,
  }
}

export default manifest
