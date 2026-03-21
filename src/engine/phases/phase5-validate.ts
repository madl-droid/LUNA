// LUNA Engine — Phase 5: Validate + Send + Persist (v3)
// Validates output, formats, rate limits, sends, persists via memory:manager.

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
import { formatForChannel, calculateTypingDelay } from '../utils/message-formatter.js'
import { markFarewell, setContactLock } from '../proactive/guards.js'
import { detectCommitments } from '../proactive/commitment-detector.js'
import { loadProactiveConfig } from '../proactive/proactive-config.js'

const logger = pino({ name: 'engine:phase5' })

/**
 * Execute Phase 5: Validate, format, send, persist.
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
  const rateLimitOk = await checkRateLimit(redis, ctx.message.from, ctx.message.channelName, config)
  if (!rateLimitOk) {
    logger.warn({ traceId: ctx.traceId, to: ctx.message.from }, 'Rate limit exceeded')
    return { sent: false, error: 'Rate limit exceeded' }
  }

  // 3. Format for channel
  const parts = formatForChannel(responseText, ctx.message.channelName)

  // 4. Send via channel adapter
  const deliveryResult = await sendMessages(ctx, parts, registry)

  // 5. Persist messages via memory:manager (or fallback to direct DB)
  const memoryManager = registry.getOptional<MemoryManager>('memory:manager') ?? null
  await persistMessages(ctx, responseText, evaluation, db, memoryManager)

  // 6. Update lead qualification
  await updateLeadQualification(ctx, registry, db, memoryManager)

  // 7. Update session
  await updateSession(ctx, db)

  // 8. Enqueue sheets sync
  enqueueSheetsSync(ctx, redis)

  // 9. Proactive guard signals: farewell detection + contact lock
  if (deliveryResult.sent && ctx.contactId) {
    // If evaluation intent is farewell, mark for conversation guard
    if (evaluation.intent === 'farewell') {
      markFarewell(ctx.contactId, redis).catch(() => {})
    }
    // Set contact lock for reactive conversations (auto-expires after session TTL)
    const isProactive = 'isProactive' in ctx && (ctx as Record<string, unknown>).isProactive
    if (!isProactive) {
      setContactLock(ctx.contactId, redis, config.sessionTtlMs).catch(() => {})
    }

    // 10. Commitment auto-detection (Via B) — fire-and-forget, only for reactive
    if (!isProactive) {
      const proactiveConfig = loadProactiveConfig()
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
    parts: parts.length,
  }, 'Phase 5 complete')

  return deliveryResult
}

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
  sanitized = sanitized.replace(/sk-[a-zA-Z0-9]{20,}/g, '[REDACTED]')
  sanitized = sanitized.replace(/sk-ant-[a-zA-Z0-9]{20,}/g, '[REDACTED]')
  sanitized = sanitized.replace(/AIza[a-zA-Z0-9_-]{35}/g, '[REDACTED]')
  sanitized = sanitized.replace(/Bearer\s+[a-zA-Z0-9._-]{20,}/g, 'Bearer [REDACTED]')

  return { passed: false, issues, sanitizedText: sanitized }
}

async function checkRateLimit(
  redis: Redis,
  to: string,
  channel: string,
  config: EngineConfig,
): Promise<boolean> {
  if (channel !== 'whatsapp') return true

  const hourKey = `rate:${to}:hour`
  const dayKey = `rate:${to}:day`

  try {
    const [hourCount, dayCount] = await Promise.all([
      redis.get(hourKey),
      redis.get(dayKey),
    ])

    if (hourCount && parseInt(hourCount) >= config.waRateLimitHour) return false
    if (dayCount && parseInt(dayCount) >= config.waRateLimitDay) return false

    const pipeline = redis.pipeline()
    pipeline.incr(hourKey)
    pipeline.expire(hourKey, 3600)
    pipeline.incr(dayKey)
    pipeline.expire(dayKey, 86400)
    await pipeline.exec()

    return true
  } catch (err) {
    logger.warn({ err, to }, 'Rate limit check failed, allowing')
    return true
  }
}

async function sendMessages(
  ctx: ContextBundle,
  parts: string[],
  registry: Registry,
): Promise<DeliveryResult> {
  let lastMessageId: string | undefined

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!

    if (ctx.message.channelName === 'whatsapp' && i > 0) {
      const delay = calculateTypingDelay(part)
      await new Promise(resolve => setTimeout(resolve, delay))
    }

    try {
      await registry.runHook('message:send', {
        channel: ctx.message.channelName,
        to: ctx.message.from,
        content: { type: 'text', text: part },
        correlationId: ctx.traceId,
      })
      lastMessageId = randomUUID()
    } catch (err) {
      logger.error({ err, traceId: ctx.traceId, part: i }, 'Failed to send message part')
      return { sent: false, error: String(err) }
    }
  }

  return { sent: true, channelMessageId: lastMessageId }
}

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

function enqueueSheetsSync(ctx: ContextBundle, _redis: Redis): void {
  logger.debug({ traceId: ctx.traceId, contactId: ctx.contactId }, 'Sheets sync enqueued (noop)')
}
