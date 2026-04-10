// LUNA Engine — Main Orchestrator
// Entry point del pipeline de procesamiento de mensajes.
// Conecta las 5 fases y expone la API pública del engine.

import pino from 'pino'
import { logChannelMessage } from '../kernel/extreme-logger.js'
import type { Registry } from '../kernel/registry.js'
import type { IncomingMessage } from '../channels/types.js'
import type { PipelineResult, EngineConfig, ContextBundle } from './types.js'
import { loadEngineConfig } from './config.js'
import { initLLMClients, setLLMGateway } from './utils/llm-client.js'
import { intake } from './boundaries/intake.js'
import { isRateLimitedPreCheck } from './boundaries/delivery.js'
import { startProactiveRunner, stopProactiveRunner } from './proactive/proactive-runner.js'
import { loadProactiveConfig } from './proactive/proactive-config.js'
import { registerCreateCommitmentTool } from './proactive/tools/create-commitment.js'
import { registerUpdateCommitmentTool } from './proactive/tools/update-commitment.js'
import { registerQueryPendingItemsTool } from './proactive/tools/query-pending-items.js'
import { registerSetIntensityTool } from './proactive/tools/set-intensity.js'
import { pickErrorFallback } from './fallbacks/error-defaults.js'
import { PipelineSemaphore, ContactLock } from './concurrency/index.js'
// --- Agentic imports (v2.0) ---
import { runAgenticDelivery } from './agentic/index.js'
import { classifyEmailTriage } from './agentic/email-triage.js'

const logger = pino({ name: 'engine' })

let engineConfig: EngineConfig
let registry: Registry
let pipelineSemaphore: PipelineSemaphore
let contactLock: ContactLock
// FIX-E6: Graceful shutdown flag — set by stopEngine(), checked by processMessage()
let shuttingDown = false

// FIX-E1: In-memory dedup fallback (used when Redis is unavailable)
// LRU-capped at 10K entries — evicts oldest on overflow.
const DEDUP_MEMORY_MAX = 10_000
const dedupMemory = new Map<string, number>()

/**
 * Initialize the engine. Call once at startup.
 */
export function initEngine(reg: Registry): void {
  registry = reg

  // Load config
  engineConfig = loadEngineConfig(registry)

  // Initialize concurrency controls
  pipelineSemaphore = new PipelineSemaphore(engineConfig.maxConcurrentPipelines, engineConfig.maxQueueSize)
  contactLock = new ContactLock()

  // FIX-E10: Expose contact-lock check for orphan recovery (read-only, no circular dep)
  registry.provide('engine:contact-lock', {
    hasLock: (channelContactId: string) => contactLock.hasLock(channelContactId),
  })

  // Initialize LLM clients (direct SDK fallback)
  initLLMClients(engineConfig)

  // If LLM module is active, delegate all LLM calls through the gateway
  const gateway = reg.getOptional<unknown>('llm:gateway')
  if (gateway) {
    setLLMGateway(gateway as Parameters<typeof setLLMGateway>[0])
  } else {
    logger.warn('LLM module not active — using direct SDK calls (no circuit breaker, no tracking)')
  }

  // Register hook listener for incoming messages
  registry.addHook('engine', 'message:incoming', async (payload, _correlationId) => {
    // HITL: skip if message was consumed by HITL interceptor
    const hitlConsumed = await registry.getRedis().get(`hitl:consumed:${payload.id}`)
    if (hitlConsumed) return

    // HITL: skip if full handoff is active for this contact+channel (human has control)
    const hitlHandoff = await registry.getRedis().get(`hitl:handoff:${payload.channelName}:${payload.from}`)
    if (hitlHandoff) return

    const message: IncomingMessage = {
      id: payload.id,
      channelName: payload.channelName as IncomingMessage['channelName'],
      channelMessageId: payload.channelMessageId,
      from: payload.from,
      resolvedPhone: payload.resolvedPhone,
      senderName: payload.senderName,
      timestamp: payload.timestamp,
      content: {
        type: payload.content.type as IncomingMessage['content']['type'],
        text: payload.content.text,
        caption: payload.content.caption,
      },
      attachments: payload.attachments as IncomingMessage['attachments'],
      raw: payload.raw,
    }

    const result = await processMessage(message)
    if (!result.success) {
      logger.error({ traceId: result.traceId, error: result.error }, 'Pipeline failed')
    }
  })

  // Load proactive config and register tools
  const proactiveConfig = loadProactiveConfig()
  registerCreateCommitmentTool(registry, proactiveConfig).catch(err =>
    logger.warn({ err }, 'Failed to register create_commitment tool'),
  )
  registerUpdateCommitmentTool(registry).catch(err =>
    logger.warn({ err }, 'Failed to register update_commitment tool'),
  )
  registerQueryPendingItemsTool(registry).catch(err =>
    logger.warn({ err }, 'Failed to register query_pending_items tool'),
  )
  registerSetIntensityTool(registry).catch(err =>
    logger.warn({ err }, 'Failed to register set_follow_up_intensity tool'),
  )

  const db = registry.getDb()
  const redis = registry.getRedis()

  // Start proactive runner (BullMQ)
  startProactiveRunner(db, redis, engineConfig, registry).catch(err =>
    logger.error({ err }, 'Failed to start proactive runner'),
  )

  logger.info('Engine initialized')
}

/**
 * Process an incoming message through the 5-phase pipeline.
 * Protected by pipeline semaphore (global concurrency) and contact lock (per-contact serialization).
 */
export async function processMessage(message: IncomingMessage): Promise<PipelineResult> {
  // Extreme logging: inbound message
  logChannelMessage({
    channel: message.channelName,
    direction: 'inbound',
    contactId: message.from,
    messageType: message.content.type,
    textPreview: message.content.text ?? message.content.caption,
  }).catch(() => {})

  const totalStart = Date.now()
  const db = registry.getDb()
  const redis = registry.getRedis()

  // FIX-E6: Reject incoming messages during graceful shutdown
  if (shuttingDown) {
    logger.warn({ from: message.from, channel: message.channelName }, 'Engine shutting down — rejecting new message')
    return {
      traceId: 'shutdown',
      success: true,
      skipped: 'shutdown',
      intakeDurationMs: 0,
      deliveryDurationMs: 0,
      totalDurationMs: Date.now() - totalStart,
    }
  }

  // FIX-E1: Dedup — reject duplicate channelMessageId within 5 minutes.
  // WhatsApp often re-delivers webhooks. Processing the same message twice → double response.
  const channelMsgId = message.channelMessageId
  if (channelMsgId) {
    const dedupKey = `dedup:msg:${channelMsgId}`
    try {
      // SET PX NX — atomic: only sets if key doesn't exist, returns 'OK' or null
      const set = await redis.set(dedupKey, '1', 'PX', 300_000, 'NX')
      if (set === null) {
        // Key already existed — duplicate message
        logger.warn({ channelMsgId, from: message.from, channel: message.channelName }, 'Duplicate message — skipping (Redis dedup)')
        return {
          traceId: 'dedup',
          success: true,
          skipped: 'duplicate',
          intakeDurationMs: 0,
          deliveryDurationMs: 0,
          totalDurationMs: Date.now() - totalStart,
        }
      }
    } catch {
      // Redis unavailable — fall through to in-memory dedup
      const now = Date.now()
      const seenAt = dedupMemory.get(channelMsgId)
      if (seenAt && now - seenAt < 300_000) {
        logger.warn({ channelMsgId, from: message.from, channel: message.channelName }, 'Duplicate message — skipping (memory dedup)')
        return {
          traceId: 'dedup',
          success: true,
          skipped: 'duplicate',
          intakeDurationMs: 0,
          deliveryDurationMs: 0,
          totalDurationMs: Date.now() - totalStart,
        }
      }
      // Evict oldest entry if over cap
      if (dedupMemory.size >= DEDUP_MEMORY_MAX) {
        const firstKey = dedupMemory.keys().next().value
        if (firstKey !== undefined) dedupMemory.delete(firstKey)
      }
      dedupMemory.set(channelMsgId, now)
    }
  }

  // FIX-LAB18: Rate limit pre-check — skip LLM processing if contact is already over limit.
  // Saves tokens when a spammy user sends many messages in quick succession.
  try {
    const limited = await isRateLimitedPreCheck(redis, message.from, message.channelName, registry)
    if (limited) {
      logger.warn({ from: message.from, channel: message.channelName }, 'Rate limit pre-check exceeded — skipping pipeline')
      return {
        traceId: 'rate-limited',
        success: true,
        skipped: 'rate_limited',
        intakeDurationMs: 0,
        deliveryDurationMs: 0,
        totalDurationMs: Date.now() - totalStart,
      }
    }
  } catch (err) {
    logger.warn({ err, from: message.from }, 'Rate limit pre-check threw — continuing with pipeline')
  }

  // ═══ CONCURRENCY LAYER 1: Pipeline Semaphore ═══
  const acquireResult = await pipelineSemaphore.acquire(message.from)
  if (acquireResult === 'rejected') {
    logger.warn({ from: message.from, channel: message.channelName }, 'Backpressure — sending busy message')
    try {
      await registry.runHook('message:send', {
        channel: message.channelName,
        to: message.from,
        content: { type: 'text', text: engineConfig.backpressureMessage },
      })
    } catch (err) {
      logger.error({ err }, 'Failed to send backpressure message')
    }
    return {
      traceId: 'backpressure',
      success: true,
      skipped: 'backpressure',
      intakeDurationMs: 0,
      deliveryDurationMs: 0,
      totalDurationMs: Date.now() - totalStart,
    }
  }

  try {
    // ═══ CONCURRENCY LAYER 2: Per-Contact Serialization ═══
    return await contactLock.withLock(message.from, () => {
      // FIX: E-1 — Pipeline global timeout to prevent zombie pipelines
      const timeoutMs = engineConfig.pipelineTimeoutMs
      return Promise.race([
        processMessageInner(message, db, redis, totalStart),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Pipeline timeout after ${timeoutMs}ms`)), timeoutMs),
        ),
      ])
    })
  } finally {
    pipelineSemaphore.release()
  }
}

async function processMessageInner(
  message: IncomingMessage,
  db: import('pg').Pool,
  redis: import('ioredis').Redis,
  totalStart: number,
): Promise<PipelineResult> {
  let traceId = ''

  try {
    // ═══ PHASE 1: Intake + Context Loading ═══
    const p1Start = Date.now()
    const ctx = await intake(message, db, redis, engineConfig, registry)
    traceId = ctx.traceId
    const intakeDurationMs = Date.now() - p1Start

    logger.info({
      traceId,
      phase: 1,
      durationMs: intakeDurationMs,
      userType: ctx.userType,
      attachments: ctx.attachmentMeta.length,
    }, 'Phase 1 done')

    // ═══ SIGNAL: ACK (delivery confirmation) — after Phase 1 ═══
    // Resolve send target — use remoteJid from raw message (preserves correct JID suffix: @lid, @s.whatsapp.net, @g.us)
    const rawMsgSignal = message.raw as Record<string, Record<string, string>> | undefined
    const signalTo = rawMsgSignal?.key?.remoteJid ?? message.from
    const messageKeys = message.raw
      ? [{
          remoteJid: rawMsgSignal?.key?.remoteJid,
          id: message.channelMessageId,
          fromMe: false,
          participant: rawMsgSignal?.key?.participant ?? undefined,
        }]
      : undefined

    registry.runHook('channel:ack', {
      channel: message.channelName,
      to: signalTo,
      messageKeys,
      correlationId: traceId,
    }).catch(() => {})

    // ═══ TEST MODE GATE ═══
    // Check DEBUG_ADMIN_ONLY from config_store (runtime, not just env)
    const adminOnly = await isAdminOnlyActive(registry)
    if (adminOnly && ctx.userType !== 'admin') {
      logger.info({ traceId, userType: ctx.userType, from: message.from }, 'Admin-only mode — ignoring non-admin')
      return {
        traceId,
        success: true,
        skipped: 'test_mode',
        intakeDurationMs,
        deliveryDurationMs: 0,
        totalDurationMs: Date.now() - totalStart,
      }
    }

    // ═══ UNREGISTERED CONTACT GATE ═══
    // Resolver returns _unregistered:{behavior} based on lead config:
    // - ignore: Luna doesn't activate (no registration, no response)
    // - silence: Lead was registered by resolver (source='engine'), no response
    // - message: Lead was registered, send a static auto-message (no LLM)
    // - 'attend' never reaches here — resolver returns 'lead' for attend
    if (ctx.userType.startsWith('_unregistered:')) {
      const behavior = ctx.userType.split(':')[1] || 'ignore'
      logger.info({ traceId, behavior, from: message.from }, 'Unregistered contact — skipping pipeline')

      if (behavior === 'message') {
        // Send configured static message (no LLM call)
        try {
          const usersDb = registry.getOptional<{ getListConfig(lt: string): Promise<{ unregisteredMessage: string | null } | null> }>('users:db')
          const leadCfg = usersDb ? await usersDb.getListConfig('lead') : null
          const msg = leadCfg?.unregisteredMessage || 'Gracias por tu mensaje. Te contactaremos pronto.'
          await registry.runHook('message:send', {
            channel: message.channelName,
            to: message.from,
            content: { type: 'text', text: msg },
            correlationId: traceId,
          })
        } catch (err) {
          logger.warn({ err, traceId }, 'Failed to send auto-message to unregistered contact')
        }
      }

      // All _unregistered behaviors skip the pipeline (no LLM cost).
      return {
        traceId,
        success: true,
        skipped: `unregistered:${behavior}`,
        intakeDurationMs,
        deliveryDurationMs: 0,
        totalDurationMs: Date.now() - totalStart,
      }
    }

    // ═══ EMAIL TRIAGE GATE ═══
    // Deterministic pre-filter for email channel. Decides RESPOND/OBSERVE/IGNORE before LLM.
    if (ctx.message.channelName === 'email') {
      const triageConfig = registry.getOptional<{
        getTriageConfig(): { enabled: boolean; ownAddress: string }
      }>('gmail:triage-config')
      if (triageConfig) {
        const { enabled, ownAddress } = triageConfig.getTriageConfig()
        if (enabled) {
          const triage = classifyEmailTriage(ctx, ownAddress)
          if (triage.decision !== 'respond') {
            logger.info({ traceId, decision: triage.decision, reason: triage.reason, from: message.from }, 'Email triage — skipping pipeline')

            if (triage.decision === 'observe') {
              await persistObservedMessage(ctx, db)
            }

            // Mark as read
            registry.runHook('channel:read', {
              channel: message.channelName,
              to: signalTo,
              messageKeys,
              correlationId: traceId,
            }).catch(() => {})

            return {
              traceId,
              success: true,
              skipped: `triage:${triage.decision}:${triage.reason}`,
              intakeDurationMs,
              deliveryDurationMs: 0,
              totalDurationMs: Date.now() - totalStart,
            }
          }
        }
      }
    }

    // ═══ SIGNAL: READ (mark as read) — before agentic loop ═══
    registry.runHook('channel:read', {
      channel: message.channelName,
      to: signalTo,
      messageKeys,
      correlationId: traceId,
    }).catch(() => {})

    // ═══ SIGNAL: COMPOSING/RECORDING ═══
    // 'audio' → always recording. 'auto' with audio input → likely recording.
    // Otherwise → composing (typing indicator).
    const composingMode = ctx.responseFormat === 'audio'
      || (ctx.responseFormat === 'auto' && ctx.messageType === 'audio')
      ? 'recording' : 'composing'
    registry.runHook('channel:composing', {
      channel: message.channelName,
      to: signalTo,
      mode: composingMode,
      correlationId: traceId,
    }).catch(() => {})

    return await runAgenticPipeline(ctx, engineConfig, registry, db, redis, totalStart, intakeDurationMs)
  } catch (err) {
    const totalDurationMs = Date.now() - totalStart

    logger.error({
      traceId: traceId || 'unknown',
      err,
      totalDurationMs,
    }, 'Pipeline error')

    // Send a natural error fallback so the user doesn't get silence
    try {
      const tone = getChannelTone(message.channelName)
      const errorMsg = pickErrorFallback(tone)
      // Resolve group JID if applicable
      const rawMsg = message.raw as Record<string, Record<string, string>> | undefined
      const groupJid = rawMsg?.key?.remoteJid
      const sendTo = groupJid?.endsWith('@g.us') ? groupJid : message.from

      await registry.runHook('message:send', {
        channel: message.channelName,
        to: sendTo,
        content: { type: 'text', text: errorMsg },
      })
      logger.info({ traceId: traceId || 'unknown', to: sendTo }, 'Error fallback sent')
    } catch (sendErr) {
      logger.error({ sendErr, traceId: traceId || 'unknown' }, 'Failed to send error fallback')
    }

    return {
      traceId: traceId || 'unknown',
      success: false,
      intakeDurationMs: 0,
      deliveryDurationMs: 0,
      totalDurationMs,
      error: String(err),
    }
  }
}

// ═══════════════════════════════════════════════════════════
// Email triage — OBSERVE persistence
// ═══════════════════════════════════════════════════════════

/**
 * Persist an incoming message to memory without generating an LLM response.
 * Used by the OBSERVE triage path to keep context for future conversations.
 */
async function persistObservedMessage(
  ctx: ContextBundle,
  db: import('pg').Pool,
): Promise<void> {
  try {
    const memoryManager = registry.getOptional<{
      saveMessage(m: import('../modules/memory/types.js').StoredMessage): Promise<void>
    }>('memory:manager')

    const msg = {
      id: ctx.message.id,
      sessionId: ctx.session.id,
      channelName: ctx.message.channelName,
      senderType: 'user' as const,
      senderId: ctx.message.from,
      content: { type: ctx.messageType, text: ctx.normalizedText },
      role: 'user' as const,
      contentText: ctx.normalizedText,
      contentType: (ctx.messageType ?? 'text') as 'text',
      createdAt: ctx.message.timestamp,
    }

    if (memoryManager) {
      await memoryManager.saveMessage(msg)
    } else {
      await db.query(
        `INSERT INTO messages (id, session_id, role, content_text, content_type, created_at)
         VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING`,
        [msg.id, msg.sessionId, 'user', msg.contentText, msg.contentType ?? 'text', msg.createdAt],
      )
    }
  } catch (err) {
    logger.warn({ err, traceId: ctx.traceId }, 'Failed to persist observed email message')
  }
}

// ═══════════════════════════════════════════════════════════
// Pipeline Retry — error classification
// ═══════════════════════════════════════════════════════════

const PIPELINE_MAX_RETRIES = 2
const PIPELINE_RETRY_BASE_MS = 1500  // backoff: 1.5s, 3s

function isRetriableError(err: unknown): boolean {
  if (!(err instanceof Error)) return true  // Unknown — try again

  const msg = err.message.toLowerCase()

  // NOT retriable — permanent errors
  if (msg.includes('authentication') || msg.includes('unauthorized')) return false
  if (msg.includes('not found') || msg.includes('no existe')) return false
  if (msg.includes('invalid config') || msg.includes('schema')) return false
  if (msg.includes('permission denied') || msg.includes('forbidden')) return false

  // Retriable — transient errors
  if (msg.includes('timeout') || msg.includes('timed out')) return true
  if (msg.includes('rate limit') || msg.includes('429')) return true
  if (msg.includes('econnreset') || msg.includes('econnrefused')) return true
  if (msg.includes('socket hang up') || msg.includes('network')) return true
  if (msg.includes('overloaded') || msg.includes('529')) return true
  if (msg.includes('pool') || msg.includes('connection')) return true

  // Default: retriable (better to try too much than too little)
  return true
}

// ═══════════════════════════════════════════════════════════
// Agentic pipeline
// ═══════════════════════════════════════════════════════════

/**
 * Run the agentic pipeline for a reactive message.
 * Phase 1 → effort classification → agentic loop → post-process → Phase 5.
 * Called from processMessageInner().
 * Retries up to PIPELINE_MAX_RETRIES times on transient errors (backoff: 1.5s, 3s).
 */
async function runAgenticPipeline(
  ctx: ContextBundle,
  config: EngineConfig,
  reg: Registry,
  db: import('pg').Pool,
  redis: import('ioredis').Redis,
  totalStart: number,
  intakeDurationMs: number,
): Promise<PipelineResult> {
  const log = logger.child({ traceId: ctx.traceId, pipeline: 'agentic' })
  const traceId = ctx.traceId

  let lastError: Error | null = null
  let runResult: Awaited<ReturnType<typeof runAgenticDelivery>> | undefined

  for (let attempt = 0; attempt <= PIPELINE_MAX_RETRIES; attempt++) {
    try {
      if (attempt > 0) {
        const delayMs = PIPELINE_RETRY_BASE_MS * Math.pow(2, attempt - 1)
        log.warn({ traceId, attempt, delayMs }, 'Pipeline retry — backing off')
        await new Promise(r => setTimeout(r, delayMs))
      }
      runResult = await runAgenticDelivery({
        ctx,
        mode: 'reactive',
        registry: reg,
        db,
        redis,
        engineConfig: config,
        totalStart,
        intakeDurationMs,
      })
      log.info({ traceId, attempt, totalAttempts: attempt + 1 }, 'Pipeline completed')
      break  // Success — exit retry loop
    } catch (err) {
      lastError = err as Error
      if (!isRetriableError(err)) {
        log.warn({ traceId, err, attempt }, 'Pipeline failed with non-retriable error — no retry')
        break
      }
      if (attempt < PIPELINE_MAX_RETRIES) {
        log.warn({ traceId, err, attempt }, 'Pipeline failed — will retry')
      } else {
        log.error({ traceId, err, attempt }, 'Pipeline failed — all retries exhausted')
      }
    }
  }

  if (!runResult) {
    throw lastError
  }

  const { pipelineResult, agenticResult, deliveryResult, responseText } = runResult
  const totalDurationMs = pipelineResult.totalDurationMs
  const deliveryDurationMs = pipelineResult.deliveryDurationMs

  log.info({
    phase: 5,
    durationMs: deliveryDurationMs,
    sent: deliveryResult?.sent,
    totalDurationMs,
  }, 'Agentic pipeline complete')

  // 8b. Auto-HITL: if response promises human escalation but request_human_help was never called
  if (deliveryResult?.sent && ctx.contactId) {
    const hitlAlreadyCalled = agenticResult.toolCallsLog.some(t => t.name === 'request_human_help' && t.success)
    if (!hitlAlreadyCalled) {
      const text = (responseText ?? '').toLowerCase()
      const escalationPhrases = [
        'alguien del equipo',
        'un miembro del equipo',
        'el equipo te',
        'el equipo se',
        'nuestro equipo',
        'te contactar',
        'se comunicar',
        'se pondr',
        'nos comunicaremos',
        'te escribir',
        'te llamar',
        'comunique el equipo',
        'contacte el equipo',
      ]
      const matchedPhrase = escalationPhrases.find(p => text.includes(p))
      if (matchedPhrase) {
        log.info({ traceId: ctx.traceId, matchedPhrase }, 'Auto-HITL: response promises human contact but tool was not called')
        try {
          type ToolRegistry = { executeTool(name: string, input: Record<string, unknown>, ctx: Record<string, unknown>): Promise<unknown> }
          const toolsRegistry = reg.getOptional<ToolRegistry>('tools:registry')
          if (toolsRegistry) {
            await toolsRegistry.executeTool('request_human_help', {
              target_role: 'admin',
              request_type: 'escalation',
              summary: `El agente prometió contacto humano ("${matchedPhrase}") pero no creó ticket HITL. Respuesta enviada al cliente. Requiere seguimiento manual.`,
              urgency: 'high',
              context: (responseText ?? '').slice(0, 500),
            }, {
              contactId: ctx.contactId,
              channelName: ctx.message.channelName,
              senderId: ctx.message.from,
              sessionId: ctx.session.id,
            })
            log.info({ traceId: ctx.traceId }, 'Auto-HITL ticket created')
          }
        } catch (err) {
          log.warn({ err, traceId: ctx.traceId }, 'Auto-HITL ticket creation failed')
        }
      }
    }
  }

  // 9. Extreme logging: outbound
  logChannelMessage({
    channel: ctx.message.channelName,
    direction: 'outbound',
    contactId: ctx.message.from,
    messageType: 'text',
    textPreview: responseText ?? undefined,
    metadata: { traceId: ctx.traceId, totalDurationMs, sent: deliveryResult?.sent },
  }).catch(() => {})

  return pipelineResult
}

/**
 * Stop the engine. Call on shutdown.
 * FIX-E6: Graceful drain — waits up to 30s for active pipelines to finish before forcing stop.
 */
export async function stopEngine(): Promise<void> {
  // 1. Signal: no new messages accepted
  shuttingDown = true
  logger.info('Engine shutdown initiated — rejecting new messages')

  // 2. Stop proactive runner (no new proactive jobs)
  await stopProactiveRunner()

  // 3. Drain: wait for active pipelines to finish (up to 30s)
  const DRAIN_TIMEOUT_MS = 30_000
  const DRAIN_POLL_MS = 250
  const drainStart = Date.now()

  const stats = pipelineSemaphore.stats()
  if (stats.running > 0) {
    logger.info({ activePipelines: stats.running }, 'Waiting for active pipelines to drain...')

    while (Date.now() - drainStart < DRAIN_TIMEOUT_MS) {
      await new Promise(r => setTimeout(r, DRAIN_POLL_MS))
      const current = pipelineSemaphore.stats()
      if (current.running === 0) {
        logger.info({ drainMs: Date.now() - drainStart }, 'All pipelines drained — clean shutdown')
        break
      }
    }

    const remaining = pipelineSemaphore.stats().running
    if (remaining > 0) {
      logger.error({ remaining, drainMs: Date.now() - drainStart }, 'DRAIN TIMEOUT — forcing shutdown with active pipelines')
    }
  }

  logger.info('Engine stopped')
}

/**
 * Get current engine config (for testing/debugging).
 */
export function getEngineConfig(): EngineConfig {
  return engineConfig
}

/**
 * Hot-reload engine config from process.env (called after console save + reloadKernelConfig).
 * Re-initializes concurrency controls if limits changed.
 */
export function reloadEngineConfig(): void {
  const prev = engineConfig
  engineConfig = loadEngineConfig(registry)

  // FIX-F1: Update semaphore limits in-place (avoids abandoning queued waiters)
  if (prev.maxConcurrentPipelines !== engineConfig.maxConcurrentPipelines
    || prev.maxQueueSize !== engineConfig.maxQueueSize) {
    pipelineSemaphore.updateLimits(
      engineConfig.maxConcurrentPipelines,
      engineConfig.maxQueueSize,
    )
  }

  logger.info({
    maxPipelines: engineConfig.maxConcurrentPipelines,
    maxQueue: engineConfig.maxQueueSize,
    testMode: engineConfig.testMode,
  }, 'Engine config hot-reloaded from console')
}

/**
 * Get concurrency stats for monitoring.
 */
export function getEngineStats(): {
  semaphore: ReturnType<PipelineSemaphore['stats']>
  activeContacts: number
} {
  return {
    semaphore: pipelineSemaphore.stats(),
    activeContacts: contactLock.activeCount(),
  }
}

/**
 * Resolve the tone/style for a channel from its runtime config (avisoStyle).
 * Used for error fallback messages.
 */
function getChannelTone(channel: string): string {
  const channelSvc = registry.getOptional<{ get(): import('../channels/types.js').ChannelRuntimeConfig }>(`channel-config:${channel}`)
  if (channelSvc) {
    const style = channelSvc.get().avisoStyle
    // 'dynamic' rotates among styles — for one-off picks, default to casual
    return style === 'dynamic' ? 'casual' : style
  }
  return ''
}

async function isAdminOnlyActive(registry: Registry): Promise<boolean> {
  try {
    const db = registry.getDb()
    const result = await db.query(
      `SELECT key, value FROM config_store WHERE key IN ('DEBUG_ADMIN_ONLY', 'ENGINE_TEST_MODE')`,
    )
    const configs: Record<string, string> = {}
    for (const row of result.rows) configs[row.key as string] = row.value as string

    // If DEBUG_ADMIN_ONLY is explicitly set, use it
    if (configs['DEBUG_ADMIN_ONLY'] !== undefined) {
      return configs['DEBUG_ADMIN_ONLY'] === 'true'
    }
    // Fallback: use ENGINE_TEST_MODE (legacy behavior)
    return configs['ENGINE_TEST_MODE'] === 'true'
  } catch {
    return engineConfig.testMode
  }
}
