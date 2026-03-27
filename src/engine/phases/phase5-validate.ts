// LUNA Engine — Phase 5: Validate + Send + Persist (v2)
// Receives pre-formatted + pre-TTS output from Phase 4.
// Validates, rate-limits, sends, persists, signals proactive guards.

import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import type { Redis } from 'ioredis'
import pino from 'pino'
import type { Registry } from '../../kernel/registry.js'
import type {
  ContextBundle,
  CompositorOutput,
  EvaluatorOutput,
  ValidationResult,
  DeliveryResult,
  EngineConfig,
} from '../types.js'
import type { MemoryManager } from '../../modules/memory/memory-manager.js'
import type { StoredMessage } from '../../modules/memory/types.js'
import { detectOutputInjection, detectSensitiveData } from '../utils/injection-detector.js'
import { calculateTypingDelay } from '../../channels/typing-delay.js'
import { markFarewell, setContactLock } from '../proactive/guards.js'
import { detectCommitments } from '../proactive/commitment-detector.js'
import { loadProactiveConfig } from '../proactive/proactive-config.js'
import { pickErrorFallback } from '../fallbacks/error-defaults.js'

const logger = pino({ name: 'engine:phase5' })

// Cache proactive config with TTL (reloaded every 5 minutes)
let cachedProactiveConfig: ReturnType<typeof loadProactiveConfig> | null = null
let proactiveConfigLoadedAt = 0
const PROACTIVE_CONFIG_TTL_MS = 5 * 60 * 1000

function getProactiveConfig() {
  const now = Date.now()
  if (!cachedProactiveConfig || (now - proactiveConfigLoadedAt) > PROACTIVE_CONFIG_TTL_MS) {
    cachedProactiveConfig = loadProactiveConfig()
    proactiveConfigLoadedAt = now
  }
  return cachedProactiveConfig
}

/** System-wide hard cap: no contact receives more than this per hour */
const SYSTEM_MAX_MESSAGES_PER_HOUR = 20

/**
 * Execute Phase 5: Validate, send pre-formatted output, persist.
 */
export async function phase5Validate(
  ctx: ContextBundle,
  composed: CompositorOutput,
  evaluation: EvaluatorOutput,
  registry: Registry,
  db: Pool,
  redis: Redis,
  config: EngineConfig,
): Promise<DeliveryResult> {
  const startMs = Date.now()

  logger.info({ traceId: ctx.traceId }, 'Phase 5 start')

  // 1. Validate output
  const validation = validateOutput(composed.responseText)
  let responseText = composed.responseText
  if (!validation.passed) {
    logger.warn({ traceId: ctx.traceId, issues: validation.issues }, 'Output validation issues')
    responseText = validation.sanitizedText
  }

  // 2. Check rate limits
  const rateLimitOk = await checkRateLimit(redis, ctx.message.from, ctx.message.channelName, config, registry)
  if (!rateLimitOk) {
    logger.warn({ traceId: ctx.traceId, to: ctx.message.from }, 'Rate limit exceeded')
    return { sent: false, error: 'Rate limit exceeded' }
  }

  // 3. Send attachment fallback messages (before main response)
  if (ctx.attachmentContext?.fallbackMessages.length) {
    await sendFallbackMessages(ctx, ctx.attachmentContext.fallbackMessages, registry)
  }

  // 4. Send response (Phase 4 already formatted + TTS'd)
  let deliveryResult: DeliveryResult

  if (composed.outputFormat === 'audio' && composed.audioBuffer) {
    deliveryResult = await sendAudioMessage(ctx, {
      audioBuffer: composed.audioBuffer,
      durationSeconds: composed.audioDurationSeconds ?? 0,
    }, registry)

    // If audio failed, fall through to text
    if (!deliveryResult.sent) {
      logger.warn({ traceId: ctx.traceId }, 'Audio send failed, falling through to text')
      deliveryResult = await sendMessages(ctx, composed.formattedParts, registry)
    }
  } else {
    deliveryResult = await sendMessages(ctx, composed.formattedParts, registry)
  }

  // 4b. If delivery failed after retries, send natural error fallback
  if (!deliveryResult.sent) {
    logger.warn({ traceId: ctx.traceId }, 'Delivery failed after retries, sending error fallback')
    try {
      // Resolve tone from channel config
      const channelSvc = registry.getOptional<{ get(): import('../../channels/types.js').ChannelRuntimeConfig }>(`channel-config:${ctx.message.channelName}`)
      const style = channelSvc?.get().avisoStyle ?? ''
      const tone = style === 'dynamic' ? 'casual' : style

      const errorMsg = pickErrorFallback(tone)
      let sendTo = ctx.message.from
      const rawMsg = ctx.message.raw as Record<string, Record<string, string>> | undefined
      const groupJid = rawMsg?.key?.remoteJid
      if (groupJid?.endsWith('@g.us')) sendTo = groupJid

      await registry.runHook('message:send', {
        channel: ctx.message.channelName,
        to: sendTo,
        content: { type: 'text', text: errorMsg },
        correlationId: ctx.traceId,
      })
      logger.info({ traceId: ctx.traceId, to: sendTo }, 'Error fallback sent to user')
    } catch (fallbackErr) {
      logger.error({ fallbackErr, traceId: ctx.traceId }, 'Failed to send error fallback — channel may be down')
    }
  }

  // 5. Post-send operations (parallel — all are independent)
  const memoryManager = registry.getOptional<MemoryManager>('memory:manager') ?? null
  await Promise.all([
    persistMessages(ctx, responseText, evaluation, db, memoryManager),
    updateLeadQualification(ctx, registry, db, memoryManager),
    updateSession(ctx, db),
  ])

  // 5b. Record campaign match (fire-and-forget)
  if (ctx.campaign && ctx.contactId) {
    type CQ = { recordMatch(contactId: string, campaignId: string, sessionId: string | null, channel: string | null, score: number | null): Promise<void> }
    const cq = registry.getOptional<CQ>('lead-scoring:campaign-queries')
    if (cq) {
      cq.recordMatch(
        ctx.contactId,
        ctx.campaign.id,
        ctx.session.id,
        ctx.message.channelName,
        ctx.campaign.matchScore ?? null,
      ).catch(err => logger.warn({ err, traceId: ctx.traceId }, 'Failed to record campaign match'))
    }
  }

  // 6. Proactive guard signals
  if (deliveryResult.sent && ctx.contactId) {
    if (evaluation.intent === 'farewell') {
      markFarewell(ctx.contactId, redis).catch(() => {})
    }

    const isProactive = 'isProactive' in ctx && (ctx as Record<string, unknown>).isProactive
    if (!isProactive) {
      setContactLock(ctx.contactId, redis, config.sessionTtlMs).catch(() => {})

      const proactiveConfig = getProactiveConfig()
      detectCommitments(
        responseText, ctx.contactId, ctx.agentId, ctx.session.id,
        registry, config, proactiveConfig,
      ).catch(() => {})
    }
  }

  const durationMs = Date.now() - startMs
  logger.info({
    traceId: ctx.traceId,
    durationMs,
    sent: deliveryResult.sent,
    format: composed.outputFormat,
    parts: composed.formattedParts.length,
  }, 'Phase 5 complete')

  return deliveryResult
}

// ─── Validation ──────────────────────────────

function validateOutput(text: string): ValidationResult {
  const issues: string[] = []

  const injectionIssues = detectOutputInjection(text)
  issues.push(...injectionIssues)

  const sensitiveIssues = detectSensitiveData(text)
  issues.push(...sensitiveIssues)

  if (issues.length === 0) {
    return { passed: true, issues: [], sanitizedText: text }
  }

  let sanitized = text
  // Anthropic API keys
  sanitized = sanitized.replace(/sk-ant-[a-zA-Z0-9]{20,}/g, '[REDACTED]')
  // Google API keys
  sanitized = sanitized.replace(/AIza[a-zA-Z0-9_-]{35}/g, '[REDACTED]')
  // Bearer tokens
  sanitized = sanitized.replace(/Bearer\s+[a-zA-Z0-9._-]{20,}/g, 'Bearer [REDACTED]')
  // Generic secrets (password=, secret=, token=)
  sanitized = sanitized.replace(/(?:password|secret|token)\s*[:=]\s*\S{8,}/gi, (match) => {
    const prefix = match.match(/^(?:password|secret|token)\s*[:=]\s*/i)?.[0] ?? ''
    return `${prefix}[REDACTED]`
  })

  return { passed: false, issues, sanitizedText: sanitized }
}

// ─── Rate Limiting ──────────────────────────────

// Emergency in-memory rate limiter when Redis is down
const emergencyRateLimiter = new Map<string, { count: number; resetAt: number }>()
const EMERGENCY_LIMIT_PER_HOUR = 10

function checkEmergencyRateLimit(to: string, channel: string): boolean {
  const key = `${channel}:${to}`
  const now = Date.now()
  const entry = emergencyRateLimiter.get(key)

  if (!entry || now > entry.resetAt) {
    emergencyRateLimiter.set(key, { count: 1, resetAt: now + 3600_000 })
    return true
  }

  entry.count++
  if (entry.count > EMERGENCY_LIMIT_PER_HOUR) {
    logger.warn({ to, channel, count: entry.count }, 'Emergency in-memory rate limit reached (Redis down)')
    return false
  }
  return true
}

async function checkRateLimit(
  redis: Redis,
  to: string,
  channel: string,
  _config: EngineConfig,
  registry: Registry,
): Promise<boolean> {
  const channelSvc = registry.getOptional<{ get(): import('../../channels/types.js').ChannelRuntimeConfig }>(`channel-config:${channel}`)
  const cc = channelSvc?.get()
  const antiSpamMax = cc?.antiSpamMaxPerWindow ?? 0
  const antiSpamWindowMs = cc?.antiSpamWindowMs ?? 0

  const channelLimitHour = cc?.rateLimitHour ?? 0
  const limitHour = channelLimitHour > 0
    ? Math.min(channelLimitHour, SYSTEM_MAX_MESSAGES_PER_HOUR)
    : SYSTEM_MAX_MESSAGES_PER_HOUR
  const limitDay = cc?.rateLimitDay ?? 0

  try {
    // Anti-spam burst protection (atomic: INCR first, then check)
    if (antiSpamMax > 0 && antiSpamWindowMs > 0) {
      const spamKey = `antispam:${channel}:${to}`
      const pipeline = redis.pipeline()
      pipeline.incr(spamKey)
      pipeline.pexpire(spamKey, antiSpamWindowMs)
      const results = await pipeline.exec()
      const newCount = results?.[0]?.[1] as number | undefined
      if (newCount && newCount > antiSpamMax) {
        logger.warn({ to, channel, count: newCount, limit: antiSpamMax }, 'Anti-spam limit reached')
        return false
      }
    }

    // Standard rate limits
    const hourKey = `rate:${channel}:${to}:hour`
    const dayKey = `rate:${channel}:${to}:day`

    // FIX: SEC-8.2 — Atomic check+increment via Lua script (TOCTOU fix)
    const { atomicDualRateCheck } = await import('../../kernel/redis-rate-limiter.js')
    const allowed = await atomicDualRateCheck(
      redis,
      hourKey, limitHour, 3600,
      dayKey, limitDay, 86400,
    )
    if (!allowed) {
      logger.warn({ to, channel, limitHour, limitDay }, 'Rate limit reached')
      return false
    }

    return true
  } catch (err) {
    logger.error({ err, to, channel }, 'Redis rate limit check failed — using emergency in-memory limiter')
    return checkEmergencyRateLimit(to, channel)
  }
}

// ─── Retry helper ──────────────────────────────

const SEND_MAX_RETRIES = 2
const SEND_RETRY_BASE_DELAY_MS = 1000

/**
 * Retry a send operation with exponential backoff.
 * Only retries on transient errors (connection, timeout, internal).
 */
async function sendWithRetry(
  fn: () => Promise<void>,
  traceId: string,
  label: string,
): Promise<void> {
  let lastError: unknown
  for (let attempt = 0; attempt <= SEND_MAX_RETRIES; attempt++) {
    try {
      await fn()
      return
    } catch (err) {
      lastError = err
      if (attempt < SEND_MAX_RETRIES) {
        const delay = SEND_RETRY_BASE_DELAY_MS * Math.pow(2, attempt)
        logger.warn({ err, traceId, attempt: attempt + 1, maxRetries: SEND_MAX_RETRIES, delay, label }, 'Send failed, retrying')
        await new Promise(r => setTimeout(r, delay))
      }
    }
  }
  throw lastError
}

// ─── Sending ──────────────────────────────

async function sendAudioMessage(
  ctx: ContextBundle,
  ttsResult: { audioBuffer: Buffer; durationSeconds: number },
  registry: Registry,
): Promise<DeliveryResult> {
  let sendTo = ctx.message.from
  const rawMsg = ctx.message.raw as Record<string, Record<string, string>> | undefined
  if (rawMsg?.key?.remoteJid?.endsWith('@g.us')) {
    sendTo = rawMsg.key.remoteJid
  }

  await registry.runHook('channel:composing', {
    channel: ctx.message.channelName,
    to: sendTo,
    correlationId: ctx.traceId,
  }).catch(() => {})

  try {
    await sendWithRetry(
      () => registry.runHook('message:send', {
        channel: ctx.message.channelName,
        to: sendTo,
        content: {
          type: 'audio',
          audioBuffer: ttsResult.audioBuffer,
          audioDurationSeconds: ttsResult.durationSeconds,
          ptt: true,
        },
        correlationId: ctx.traceId,
      }),
      ctx.traceId,
      'audio',
    )

    await registry.runHook('channel:send_complete', {
      channel: ctx.message.channelName,
      to: sendTo,
      messageCount: 1,
      correlationId: ctx.traceId,
    }).catch(() => {})

    return { sent: true, channelMessageId: undefined }
  } catch (err) {
    logger.error({ err, traceId: ctx.traceId }, 'Failed to send audio message after retries')
    return { sent: false, error: String(err) }
  }
}

async function sendMessages(
  ctx: ContextBundle,
  parts: string[],
  registry: Registry,
): Promise<DeliveryResult> {
  let lastMessageId: string | undefined

  let sendTo = ctx.message.from
  const rawMsg = ctx.message.raw as Record<string, Record<string, string>> | undefined
  const groupJid = rawMsg?.key?.remoteJid
  const isGroupReply = groupJid?.endsWith('@g.us') ?? false
  if (isGroupReply && groupJid) {
    sendTo = groupJid
  }

  // Resolve channel config once (outside loop)
  const channelSvc = registry.getOptional<{ get(): import('../../channels/types.js').ChannelRuntimeConfig }>(`channel-config:${ctx.message.channelName}`)
  const cc = channelSvc?.get()
  const isInstantWithDelay = cc && cc.channelType === 'instant' && cc.typingDelayMsPerChar > 0

  // Fire composing before first message
  await registry.runHook('channel:composing', {
    channel: ctx.message.channelName,
    to: sendTo,
    correlationId: ctx.traceId,
  }).catch(() => {})

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!

    // Typing delay between bubbles for instant channels
    if (i > 0 && isInstantWithDelay) {
      await registry.runHook('channel:composing', {
        channel: ctx.message.channelName,
        to: sendTo,
        correlationId: ctx.traceId,
      }).catch(() => {})

      const delay = calculateTypingDelay(part, cc!.typingDelayMsPerChar, cc!.typingDelayMinMs, cc!.typingDelayMaxMs)
      await new Promise(resolve => setTimeout(resolve, delay))
    }

    try {
      await sendWithRetry(
        () => registry.runHook('message:send', {
          channel: ctx.message.channelName,
          to: sendTo,
          content: { type: 'text', text: part },
          quotedRaw: (isGroupReply && i === 0) ? ctx.message.raw : undefined,
          correlationId: ctx.traceId,
        }),
        ctx.traceId,
        `text-part-${i}`,
      )
      lastMessageId = randomUUID()
    } catch (err) {
      logger.error({ err, traceId: ctx.traceId, part: i }, 'Failed to send message part after retries')
      return { sent: false, error: String(err) }
    }
  }

  // Fire send_complete after all parts sent
  await registry.runHook('channel:send_complete', {
    channel: ctx.message.channelName,
    to: sendTo,
    messageCount: parts.length,
    correlationId: ctx.traceId,
  }).catch(() => {})

  return { sent: true, channelMessageId: lastMessageId }
}

// ─── Persistence ──────────────────────────────

async function persistMessages(
  ctx: ContextBundle,
  responseText: string,
  evaluation: EvaluatorOutput,
  db: Pool,
  memoryManager: MemoryManager | null,
): Promise<void> {
  const now = new Date()

  if (memoryManager) {
    const incomingMsg: StoredMessage = {
      id: ctx.message.id,
      sessionId: ctx.session.id,
      agentId: ctx.agentId,
      channelName: ctx.message.channelName,
      senderType: 'user',
      senderId: ctx.message.from,
      content: { type: ctx.messageType, text: ctx.normalizedText },
      role: 'user',
      contentText: ctx.normalizedText,
      contentType: (ctx.messageType as StoredMessage['contentType']) ?? 'text',
      intent: evaluation.intent,
      emotion: evaluation.emotion,
      createdAt: ctx.message.timestamp,
    }

    const outgoingMsg: StoredMessage = {
      id: randomUUID(),
      sessionId: ctx.session.id,
      agentId: ctx.agentId,
      channelName: ctx.message.channelName,
      senderType: 'agent',
      senderId: ctx.agentId,
      content: { type: 'text', text: responseText },
      role: 'assistant',
      contentText: responseText,
      contentType: 'text',
      intent: evaluation.intent,
      createdAt: now,
    }

    try {
      await Promise.all([
        memoryManager.saveMessage(incomingMsg),
        memoryManager.saveMessage(outgoingMsg),
      ])
      return
    } catch (err) {
      logger.warn({ err, traceId: ctx.traceId }, 'memory:manager persist failed, falling back to direct DB')
    }
  }

  // Legacy: direct DB
  try {
    await db.query(
      `INSERT INTO messages (id, session_id, channel_name, sender_type, sender_id, content, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO NOTHING`,
      [
        ctx.message.id, ctx.session.id, ctx.message.channelName,
        'user', ctx.message.from,
        JSON.stringify({ type: ctx.messageType, text: ctx.normalizedText }),
        ctx.message.timestamp,
      ],
    )

    await db.query(
      `INSERT INTO messages (id, session_id, channel_name, sender_type, sender_id, content, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (id) DO NOTHING`,
      [
        randomUUID(), ctx.session.id, ctx.message.channelName,
        'agent', ctx.agentId,
        JSON.stringify({ type: 'text', text: responseText, intent: evaluation.intent }),
        now,
      ],
    )
  } catch (err) {
    logger.warn({ err, traceId: ctx.traceId }, 'Failed to persist messages')
  }
}

// ─── Session & Lead ──────────────────────────────

async function updateSession(ctx: ContextBundle, db: Pool): Promise<void> {
  try {
    await db.query(
      `UPDATE sessions
       SET last_activity_at = now(), message_count = message_count + 2
       WHERE id = $1`,
      [ctx.session.id],
    )
  } catch (err) {
    logger.warn({ err, sessionId: ctx.session.id }, 'Failed to update session')
  }
}

async function updateLeadQualification(
  ctx: ContextBundle,
  registry: Registry,
  db: Pool,
  memoryManager: MemoryManager | null,
): Promise<void> {
  if (!ctx.contactId || ctx.contact?.contactType !== 'lead') return

  const currentStatus = ctx.leadStatus ?? ctx.contact?.qualificationStatus
  if (currentStatus === 'new') {
    try {
      if (memoryManager) {
        await memoryManager.updateLeadStatus(ctx.agentId, ctx.contactId, 'qualifying')
      } else {
        await db.query(
          `UPDATE contacts SET qualification_status = 'qualifying', updated_at = NOW() WHERE id = $1 AND qualification_status = 'new'`,
          [ctx.contactId],
        )
      }
      await registry.runHook('contact:status_changed', {
        contactId: ctx.contactId,
        agentId: ctx.agentId,
        from: 'new',
        to: 'qualifying',
      })
      logger.info({ contactId: ctx.contactId, traceId: ctx.traceId }, 'Lead transitioned new → qualifying')
    } catch (err) {
      logger.warn({ err, contactId: ctx.contactId }, 'Failed to transition lead to qualifying')
    }
  }
}

// ─── Fallback Messages ──────────────────────────────

async function sendFallbackMessages(
  ctx: ContextBundle,
  messages: string[],
  registry: Registry,
): Promise<void> {
  let sendTo = ctx.message.from
  const rawMsg = ctx.message.raw as Record<string, Record<string, string>> | undefined
  const groupJid = rawMsg?.key?.remoteJid
  if (groupJid?.endsWith('@g.us')) {
    sendTo = groupJid
  }

  for (const msg of messages) {
    try {
      await registry.runHook('message:send', {
        channel: ctx.message.channelName,
        to: sendTo,
        content: { type: 'text', text: msg },
        correlationId: ctx.traceId,
      })
    } catch (err) {
      logger.warn({ err, traceId: ctx.traceId }, 'Failed to send attachment fallback message')
    }
  }
}
