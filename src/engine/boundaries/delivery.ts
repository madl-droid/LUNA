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
  DeliveryResult,
  EngineConfig,
} from '../types.js'
import type { MemoryManager } from '../../modules/memory/memory-manager.js'
import type { StoredMessage } from '../../modules/memory/types.js'
import { checkAndCompressBuffer } from '../buffer-compressor.js'
import { calculateTypingDelay } from '../../channels/typing-delay.js'
import { setContactLock } from '../proactive/guards.js'
import { detectCommitments } from '../proactive/commitment-detector.js'
import { loadProactiveConfig } from '../proactive/proactive-config.js'
import { pickErrorFallback, pickTTSFailureFallback } from '../fallbacks/error-defaults.js'
import { sanitizeParts, validateOutput } from '../output-sanitizer.js'

const logger = pino({ name: 'engine:delivery' })

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
 * Execute delivery: validate, send pre-formatted output, and persist it.
 *
 */
export async function delivery(
  ctx: ContextBundle,
  composed: CompositorOutput,
  registry: Registry,
  db: Pool,
  redis: Redis,
  config: EngineConfig,
): Promise<DeliveryResult> {
  const startMs = Date.now()

  logger.info({ traceId: ctx.traceId }, 'Delivery start')

  // 1. Validate output
  const validation = validateOutput(composed.responseText)
  let responseText = composed.responseText
  let formattedParts = composed.formattedParts
  if (!validation.passed) {
    logger.warn({ traceId: ctx.traceId, issues: validation.issues }, 'Output validation issues')
    responseText = validation.sanitizedText
    const sanitizedParts = sanitizeParts(composed.formattedParts)
    formattedParts = sanitizedParts.parts
    await logLeakageEvent(ctx, db, {
      action: composed.outputFormat === 'audio' ? 'audio-blocked' : 'sanitized-text',
      issues: [...new Set([...validation.issues, ...sanitizedParts.issues])],
      outputFormat: composed.outputFormat,
    }).catch(() => {})
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

  // Resolve tone once for fallback messages
  const tone = resolveFallbackTone(ctx, registry)

  if (!validation.passed && composed.outputFormat === 'audio') {
    logger.warn({ traceId: ctx.traceId, issues: validation.issues }, 'Leakage detected in audio response, falling back to sanitized text')
    deliveryResult = await sendFallbackAndText(ctx, formattedParts, registry, tone)
  } else if (composed.outputFormat === 'audio' && composed.audioChunks && composed.audioChunks.length > 0) {
    // Multi-chunk audio: send each voice note with delay between them
    deliveryResult = await sendAudioChunks(ctx, composed.audioChunks, registry)

    // If audio send failed, send natural fallback + text
    if (!deliveryResult.sent) {
      logger.warn({ traceId: ctx.traceId }, 'Audio chunk send failed, falling through to text with TTS fallback')
      deliveryResult = await sendFallbackAndText(ctx, formattedParts, registry, tone)
    }
  } else if (composed.outputFormat === 'audio' && composed.audioBuffer) {
    // Backward compat: single audio buffer
    deliveryResult = await sendAudioMessage(ctx, {
      audioBuffer: composed.audioBuffer,
      durationSeconds: composed.audioDurationSeconds ?? 0,
    }, registry)

    if (!deliveryResult.sent) {
      logger.warn({ traceId: ctx.traceId }, 'Audio send failed, falling through to text with TTS fallback')
      deliveryResult = await sendFallbackAndText(ctx, formattedParts, registry, tone)
    }
  } else if (composed.ttsFailed && ctx.responseFormat === 'audio') {
    // TTS synthesis failed but user explicitly asked for audio — send natural fallback + text
    logger.info({ traceId: ctx.traceId }, 'TTS failed on explicit audio request, sending fallback + text')
    deliveryResult = await sendFallbackAndText(ctx, formattedParts, registry, tone)
  } else {
    deliveryResult = await sendMessages(ctx, formattedParts, registry)
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
      const sendTo = resolveSendTo(ctx)

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
    persistMessages(ctx, responseText, db, memoryManager),
    updateLeadQualification(ctx, registry, db, memoryManager),
    updateSession(ctx, db),
  ])

  // 5bis. Inline buffer compression — fire-and-forget, never blocks the pipeline
  // Only touches Redis buffer; PG messages remain intact for nightly batch summaries.
  if (memoryManager) {
    checkAndCompressBuffer(ctx.session.id, memoryManager, config, registry).catch(err =>
      logger.warn({ err, sessionId: ctx.session.id, traceId: ctx.traceId }, 'Inline buffer compression failed'),
    )
  }

  // 5b. Record campaign match (fire-and-forget)
  if (ctx.campaign && ctx.contactId) {
    type CQ = { recordMatch(contactId: string, campaignId: string, sessionId: string | null, channel: string | null, score: number | null): Promise<void> }
    const cq = registry.getOptional<CQ>('marketing-data:campaign-queries')
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
    const isProactive = 'isProactive' in ctx && (ctx as Record<string, unknown>).isProactive
    if (!isProactive) {
      setContactLock(ctx.contactId, redis, config.sessionTtlMs).catch(() => {})

      const proactiveConfig = getProactiveConfig()
      detectCommitments(
        responseText, ctx.contactId, ctx.session.id,
        registry, proactiveConfig,
      ).catch(() => {})
    }
  }

  const durationMs = Date.now() - startMs
  logger.info({
    traceId: ctx.traceId,
    durationMs,
    sent: deliveryResult.sent,
    format: composed.outputFormat,
    parts: formattedParts.length,
  }, 'Delivery complete')

  return deliveryResult
}

// ─── Validation ──────────────────────────────

async function logLeakageEvent(
  ctx: ContextBundle,
  db: Pool,
  details: {
    action: 'sanitized-text' | 'audio-blocked'
    issues: string[]
    outputFormat: CompositorOutput['outputFormat']
  },
): Promise<void> {
  try {
    await db.query(
      `INSERT INTO pipeline_logs (trace_id, contact_id, session_id, event_type, payload, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [
        ctx.traceId,
        ctx.contactId,
        ctx.session.id,
        'output_leakage',
        JSON.stringify({
          ...details,
          channel: ctx.message.channelName,
          responseFormat: ctx.responseFormat,
        }),
      ],
    )
  } catch (err) {
    logger.warn({ err, traceId: ctx.traceId }, 'Failed to log leakage event')
  }
}

// ─── Rate Limiting ──────────────────────────────

/**
 * FIX-LAB18: Read-only pre-check: returns true if the contact is already over the rate limit.
 * Does NOT increment counters — only checks current values.
 * Used by engine.ts to skip LLM processing for rate-limited contacts.
 */
export async function isRateLimitedPreCheck(
  redis: Redis,
  to: string,
  channel: string,
  registry: Registry,
): Promise<boolean> {
  try {
    const channelSvc = registry.getOptional<{ get(): import('../../channels/types.js').ChannelRuntimeConfig }>(`channel-config:${channel}`)
    const cc = channelSvc?.get()

    const channelLimitHour = cc?.rateLimitHour ?? 0
    const limitHour = channelLimitHour > 0
      ? Math.min(channelLimitHour, SYSTEM_MAX_MESSAGES_PER_HOUR)
      : SYSTEM_MAX_MESSAGES_PER_HOUR
    const limitDay = cc?.rateLimitDay ?? 0

    const hourKey = `rate:${channel}:${to}:hour`
    const dayKey = `rate:${channel}:${to}:day`

    const [hourVal, dayVal] = await Promise.all([
      redis.get(hourKey),
      dayKey ? redis.get(dayKey) : Promise.resolve(null),
    ])

    const hourCount = hourVal ? parseInt(hourVal, 10) : 0
    if (limitHour > 0 && hourCount >= limitHour) return true

    const dayCount = dayVal ? parseInt(dayVal, 10) : 0
    if (limitDay > 0 && dayCount >= limitDay) return true

    return false
  } catch {
    // Redis down or other error — don't block on pre-check, let delivery handle it
    return false
  }
}

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

// ─── Helpers ──────────────────────────────

/** Resolve the JID to send to — uses group JID if message came from a group, else contact JID */
function resolveSendTo(ctx: ContextBundle): string {
  const rawMsg = ctx.message.raw as Record<string, Record<string, string>> | undefined
  const groupJid = rawMsg?.key?.remoteJid
  if (groupJid?.endsWith('@g.us')) return groupJid
  return ctx.message.from
}

function resolveFallbackTone(ctx: ContextBundle, registry: Registry): string {
  const channelSvc = registry.getOptional<{ get(): import('../../channels/types.js').ChannelRuntimeConfig }>(`channel-config:${ctx.message.channelName}`)
  const style = channelSvc?.get()?.avisoStyle ?? ''
  return style === 'dynamic' ? 'casual' : style
}

// ─── Sending ──────────────────────────────

async function sendAudioMessage(
  ctx: ContextBundle,
  ttsResult: { audioBuffer: Buffer; durationSeconds: number },
  registry: Registry,
): Promise<DeliveryResult> {
  const sendTo = resolveSendTo(ctx)

  await registry.runHook('channel:composing', {
    channel: ctx.message.channelName,
    to: sendTo,
    mode: 'recording',
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

async function sendAudioChunks(
  ctx: ContextBundle,
  chunks: Array<{ audioBuffer: Buffer; durationSeconds: number }>,
  registry: Registry,
): Promise<DeliveryResult> {
  if (chunks.length === 0) return { sent: false, error: 'No audio chunks to send' }
  const sendTo = resolveSendTo(ctx)

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]!

    // Show "recording" indicator before each chunk
    await registry.runHook('channel:composing', {
      channel: ctx.message.channelName,
      to: sendTo,
      mode: 'recording',
      correlationId: ctx.traceId,
    }).catch(() => {})

    // Delay between chunks (not before first) — reuse typing delay calculator
    if (i > 0) {
      // Natural pause between voice notes (same range as typing delay between text bubbles)
      const INTER_CHUNK_DELAY_MS = 1500
      await new Promise(resolve => setTimeout(resolve, INTER_CHUNK_DELAY_MS))
    }

    try {
      await sendWithRetry(
        () => registry.runHook('message:send', {
          channel: ctx.message.channelName,
          to: sendTo,
          content: {
            type: 'audio',
            audioBuffer: chunk.audioBuffer,
            audioDurationSeconds: chunk.durationSeconds,
            ptt: true,
          },
          correlationId: ctx.traceId,
        }),
        ctx.traceId,
        `audio-chunk-${i}`,
      )
    } catch (err) {
      logger.error({ err, traceId: ctx.traceId, chunk: i }, 'Failed to send audio chunk after retries')
      return { sent: false, error: String(err) }
    }
  }

  // Clear presence after all chunks sent
  await registry.runHook('channel:send_complete', {
    channel: ctx.message.channelName,
    to: sendTo,
    messageCount: chunks.length,
    correlationId: ctx.traceId,
  }).catch(() => {})

  return { sent: true, channelMessageId: undefined }
}

async function sendFallbackAndText(
  ctx: ContextBundle,
  parts: string[],
  registry: Registry,
  tone: string,
): Promise<DeliveryResult> {
  const fallbackMsg = pickTTSFailureFallback(tone)
  await sendMessages(ctx, [fallbackMsg], registry).catch(() => {})
  return sendMessages(ctx, parts, registry)
}

async function sendMessages(
  ctx: ContextBundle,
  parts: string[],
  registry: Registry,
): Promise<DeliveryResult> {
  let lastMessageId: string | undefined

  const sendTo = resolveSendTo(ctx)
  const rawMsg = ctx.message.raw as Record<string, Record<string, string>> | undefined
  const isGroupReply = rawMsg?.key?.remoteJid?.endsWith('@g.us') ?? false

  // Resolve channel config once (outside loop)
  const channelSvc = registry.getOptional<{ get(): import('../../channels/types.js').ChannelRuntimeConfig }>(`channel-config:${ctx.message.channelName}`)
  const cc = channelSvc?.get()
  const isInstantWithDelay = cc && cc.channelType === 'instant' && cc.typingDelayMsPerChar > 0

  // Fire composing before first message
  await registry.runHook('channel:composing', {
    channel: ctx.message.channelName,
    to: sendTo,
    mode: 'composing',
    correlationId: ctx.traceId,
  }).catch(() => {})

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!

    // Typing delay between bubbles for instant channels
    if (i > 0 && isInstantWithDelay) {
      await registry.runHook('channel:composing', {
        channel: ctx.message.channelName,
        to: sendTo,
        mode: 'composing',
        correlationId: ctx.traceId,
      }).catch(() => {})

      const delay = calculateTypingDelay(part, cc!.typingDelayMsPerChar, cc!.typingDelayMinMs, cc!.typingDelayMaxMs)
      await new Promise(resolve => setTimeout(resolve, delay))
    }

    // Also quote in individual chats when the incoming message was itself a quote/reply
    const rawIncoming = ctx.message.raw as Record<string, unknown> | undefined
    const incomingHasQuote = !!(
      (rawIncoming?.message as Record<string, unknown> | undefined)
        ?.extendedTextMessage as Record<string, unknown> | undefined
    )?.contextInfo

    try {
      await sendWithRetry(
        () => registry.runHook('message:send', {
          channel: ctx.message.channelName,
          to: sendTo,
          content: { type: 'text', text: part },
          quotedRaw: ((isGroupReply || incomingHasQuote) && i === 0) ? ctx.message.raw : undefined,
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
  db: Pool,
  memoryManager: MemoryManager | null,
): Promise<void> {
  const now = new Date()

  if (memoryManager) {
    const incomingMsg: StoredMessage = {
      id: ctx.message.id,
      sessionId: ctx.session.id,
      channelName: ctx.message.channelName,
      senderType: 'user',
      senderId: ctx.message.from,
      content: { type: ctx.messageType, text: ctx.normalizedText },
      role: 'user',
      contentText: ctx.normalizedText,
      contentType: (ctx.messageType as StoredMessage['contentType']) ?? 'text',
      createdAt: ctx.message.timestamp,
    }

    const outgoingMsg: StoredMessage = {
      id: randomUUID(),
      sessionId: ctx.session.id,
      channelName: ctx.message.channelName,
      senderType: 'agent',
      senderId: 'assistant',
      content: { type: 'text', text: responseText },
      role: 'assistant',
      contentText: responseText,
      contentType: 'text',
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
        'agent', 'assistant',
        JSON.stringify({ type: 'text', text: responseText }),
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
        await memoryManager.updateLeadStatus(ctx.contactId, 'qualifying')
      } else {
        await db.query(
          `UPDATE agent_contacts SET lead_status = 'qualifying', updated_at = NOW()
           WHERE contact_id = $1 AND lead_status = 'new'`,
          [ctx.contactId],
        )
      }
      await registry.runHook('contact:status_changed', {
        contactId: ctx.contactId,
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
  const sendTo = resolveSendTo(ctx)

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
