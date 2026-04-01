// LUNA Engine — Main Orchestrator
// Entry point del pipeline de procesamiento de mensajes.
// Conecta las 5 fases y expone la API pública del engine.

import pino from 'pino'
import type { Registry } from '../kernel/registry.js'
import type { IncomingMessage } from '../channels/types.js'
import type { PipelineResult, EngineConfig, ContextBundle, ReplanContext } from './types.js'
import { loadEngineConfig } from './config.js'
import { initLLMClients, setLLMGateway } from './utils/llm-client.js'
import { phase1Intake } from './phases/phase1-intake.js'
import { phase2Evaluate } from './phases/phase2-evaluate.js'
import { phase3Execute } from './phases/phase3-execute.js'
import { phase4Compose } from './phases/phase4-compose.js'
import { phase5Validate } from './phases/phase5-validate.js'
import { startProactiveRunner, stopProactiveRunner } from './proactive/proactive-runner.js'
import { loadProactiveConfig } from './proactive/proactive-config.js'
import { registerCreateCommitmentTool } from './proactive/tools/create-commitment.js'
import { generateAck, mapStepToAction } from './ack/ack-service.js'
import { pickErrorFallback } from './fallbacks/error-defaults.js'
import { PipelineSemaphore, ContactLock } from './concurrency/index.js'
import { CheckpointManager } from './checkpoints/checkpoint-manager.js'
import type { Phase3Options } from './phases/phase3-execute.js'

const logger = pino({ name: 'engine' })

let engineConfig: EngineConfig
let registry: Registry
let pipelineSemaphore: PipelineSemaphore
let contactLock: ContactLock
let checkpointMgr: CheckpointManager | null = null
/** Temporary stash for completed steps during checkpoint resume. Keyed by messageId. */
const pendingResumeSteps = new Map<string, import('./types.js').StepResult[]>()

/**
 * Initialize the engine. Call once at startup.
 */
export function initEngine(reg: Registry): void {
  registry = reg

  // Load config
  engineConfig = loadEngineConfig()

  // Initialize concurrency controls
  pipelineSemaphore = new PipelineSemaphore(engineConfig.maxConcurrentPipelines, engineConfig.maxQueueSize)
  contactLock = new ContactLock()

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

  // Initialize checkpoint manager
  const db = registry.getDb()
  const redis = registry.getRedis()

  if (engineConfig.checkpointEnabled) {
    checkpointMgr = new CheckpointManager(db)

    // On startup: expire stale checkpoints, resume recent ones, cleanup old ones
    initCheckpoints().catch(err =>
      logger.error({ err }, 'Failed to initialize checkpoints'),
    )

    // Periodic cleanup every 6 hours
    setInterval(() => {
      checkpointMgr?.cleanup(engineConfig.checkpointCleanupDays).catch(err =>
        logger.warn({ err }, 'Periodic checkpoint cleanup failed'),
      )
    }, 6 * 60 * 60 * 1000)
  }

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
  const totalStart = Date.now()
  const db = registry.getDb()
  const redis = registry.getRedis()

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
      phase1DurationMs: 0, phase2DurationMs: 0, phase3DurationMs: 0,
      phase4DurationMs: 0, phase5DurationMs: 0,
      totalDurationMs: Date.now() - totalStart,
      replanAttempts: 0, subagentIterationsUsed: 0,
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
  // Check if this is a resumed message with pre-completed steps
  const resumeSteps = pendingResumeSteps.get(message.id)
  if (resumeSteps) pendingResumeSteps.delete(message.id)
  let traceId = ''
  let avisoTimer: ReturnType<typeof setTimeout> | null = null
  let checkpointId: string | undefined
  // Shared state so the ACK timer knows if the pipeline failed or completed
  const pipelineState = { failed: false, completed: false }

  try {
    // ═══ PHASE 1: Intake + Context Loading ═══
    const p1Start = Date.now()
    const ctx = await phase1Intake(message, db, redis, engineConfig, registry)
    traceId = ctx.traceId
    const phase1DurationMs = Date.now() - p1Start

    logger.info({
      traceId,
      phase: 1,
      durationMs: phase1DurationMs,
      userType: ctx.userType,
      attachments: ctx.attachmentMeta.length,
    }, 'Phase 1 done')

    // ═══ TEST MODE GATE ═══
    // Check DEBUG_ADMIN_ONLY from config_store (runtime, not just env)
    const adminOnly = await isAdminOnlyActive(registry)
    if (adminOnly && ctx.userType !== 'admin') {
      logger.info({ traceId, userType: ctx.userType, from: message.from }, 'Admin-only mode — ignoring non-admin')
      return {
        traceId,
        success: true,
        skipped: 'test_mode',
        phase1DurationMs, phase2DurationMs: 0, phase3DurationMs: 0,
        phase4DurationMs: 0, phase5DurationMs: 0,
        totalDurationMs: Date.now() - totalStart,
        replanAttempts: 0, subagentIterationsUsed: 0,
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
        phase1DurationMs, phase2DurationMs: 0, phase3DurationMs: 0,
        phase4DurationMs: 0, phase5DurationMs: 0,
        totalDurationMs: Date.now() - totalStart,
        replanAttempts: 0, subagentIterationsUsed: 0,
      }
    }

    // ═══ PHASE 2: Evaluate Situation ═══
    const p2Start = Date.now()
    let evaluation = await phase2Evaluate(ctx, engineConfig, undefined, registry)
    let phase2DurationMs = Date.now() - p2Start

    logger.info({
      traceId,
      phase: 2,
      durationMs: phase2DurationMs,
      intent: evaluation.intent,
      planSteps: evaluation.executionPlan.length,
    }, 'Phase 2 done')

    // Create checkpoint for the execution plan (non-blocking, resolves before Phase 3 steps run)
    let checkpointPromise: Promise<string> | undefined
    if (checkpointMgr && evaluation.executionPlan.length > 0
        && evaluation.executionPlan[0]?.type !== 'respond_only') {
      checkpointPromise = checkpointMgr.create({
        traceId,
        messageId: message.id,
        contactId: ctx.contactId,
        channel: message.channelName,
        messageFrom: message.from,
        senderName: message.senderName ?? '',
        channelMessageId: message.channelMessageId ?? '',
        messageText: message.content.text ?? null,
        executionPlan: evaluation.executionPlan,
      }).catch(cpErr => {
        logger.warn({ err: cpErr, traceId }, 'Checkpoint create failed — continuing without')
        return ''
      })
    }

    // ═══ PHASE 3+4: Execute + Compose (with aviso de proceso timer) ═══
    const avisoConfig = getAvisoConfig(ctx.message.channelName)
    let avisoSentAt: number | undefined = undefined

    // Resolve tone from channel config (avisoStyle) — single source of truth
    const channelTone = getChannelTone(ctx.message.channelName)

    // Determine action type for LLM ACK context
    const actionType = mapStepToAction(evaluation.executionPlan?.[0]?.type ?? 'respond_only')

    avisoTimer = avisoConfig.triggerMs > 0
      ? setTimeout(async () => {
          // Don't send ACK if pipeline already completed successfully
          if (pipelineState.completed) return

          // If pipeline failed, send error fallback instead of processing ACK
          if (pipelineState.failed) {
            try {
              const errorMsg = pickErrorFallback(channelTone)
              await sendAviso(ctx, errorMsg, registry)
            } catch (err) {
              logger.warn({ err, traceId }, 'Failed to send error fallback via aviso')
            }
            return
          }

          // Normal ACK: pipeline is still processing
          avisoSentAt = Date.now()
          try {
            const ackMsg = await generateAck({
              contactName: ctx.contact?.displayName ?? '',
              userMessage: (ctx.normalizedText ?? ctx.message.content.text ?? '').slice(0, 200),
              actionType,
              tone: channelTone,
            }, registry)
            await sendAviso(ctx, ackMsg, registry)
          } catch (err) {
            logger.warn({ err, traceId }, 'Failed to send aviso de proceso')
          }
        }, avisoConfig.triggerMs)
      : null

    // Resolve checkpoint ID (INSERT ~1-2ms, ran concurrently with aviso timer setup above)
    if (checkpointPromise) checkpointId = await checkpointPromise || undefined

    const p3Start = Date.now()
    const phase3Opts: Phase3Options = {
      checkpointManager: (checkpointId && checkpointMgr) ? checkpointMgr : undefined,
      checkpointId,
      completedSteps: resumeSteps,
    }
    let execution = await phase3Execute(ctx, evaluation, db, redis, engineConfig, registry, phase3Opts)

    // ═══ REPLANNING LOOP ═══
    let replanAttempts = 0
    const maxReplan = engineConfig.maxReplanAttempts

    while (
      !execution.allSucceeded &&
      replanAttempts < maxReplan &&
      execution.results.some(r => !r.success && r.type !== 'respond_only')
    ) {
      replanAttempts++

      const replanCtx: ReplanContext = {
        attempt: replanAttempts,
        previousPlan: evaluation.executionPlan,
        failedSteps: execution.results.filter(r => !r.success),
        partialData: execution.partialData,
      }

      logger.info({
        traceId,
        replanAttempt: replanAttempts,
        failedSteps: replanCtx.failedSteps.length,
      }, 'Replanning — re-evaluating after failed steps')

      const replanP2Start = Date.now()
      evaluation = await phase2Evaluate(ctx, engineConfig, replanCtx, registry)
      phase2DurationMs += Date.now() - replanP2Start

      // Clear completed steps from previous plan — new plan may have different steps
      phase3Opts.completedSteps = undefined

      execution = await phase3Execute(ctx, evaluation, db, redis, engineConfig, registry, phase3Opts)
    }

    const phase3DurationMs = Date.now() - p3Start

    // Collect subagent iterations from execution results
    let subagentIterationsUsed = 0
    for (const r of execution.results) {
      if (r.type === 'subagent' && r.data && typeof r.data === 'object' && 'iterations' in (r.data as Record<string, unknown>)) {
        subagentIterationsUsed += (r.data as { iterations: number }).iterations
      }
    }

    logger.info({
      traceId,
      phase: 3,
      durationMs: phase3DurationMs,
      allSucceeded: execution.allSucceeded,
      stepResults: execution.results.length,
      replanAttempts,
    }, 'Phase 3 done')

    // ═══ PHASE 4: Compose Response ═══
    const p4Start = Date.now()
    const composed = await phase4Compose(ctx, evaluation, execution, engineConfig, registry)
    const phase4DurationMs = Date.now() - p4Start

    pipelineState.completed = true
    if (avisoTimer) clearTimeout(avisoTimer)

    logger.info({
      traceId,
      phase: 4,
      durationMs: phase4DurationMs,
      responseLength: composed.responseText.length,
    }, 'Phase 4 done')

    // Si se envió aviso de proceso, retener la respuesta el tiempo configurado
    if (avisoSentAt !== undefined) {
      const elapsed = Date.now() - avisoSentAt
      const holdMs = avisoConfig.holdMs - elapsed
      if (holdMs > 0) {
        logger.info({ traceId, holdMs }, 'Reteniendo respuesta tras aviso de proceso')
        await new Promise(resolve => setTimeout(resolve, holdMs))
      }
    }

    // ═══ PHASE 5: Validate + Send ═══
    const p5Start = Date.now()
    const delivery = await phase5Validate(ctx, composed, evaluation, registry, db, redis, engineConfig)
    const phase5DurationMs = Date.now() - p5Start

    const totalDurationMs = Date.now() - totalStart

    logger.info({
      traceId,
      phase: 5,
      durationMs: phase5DurationMs,
      sent: delivery.sent,
      totalDurationMs,
    }, 'Phase 5 done — pipeline complete')

    // Mark checkpoint complete (awaited to prevent duplicate responses on resume)
    if (checkpointMgr && checkpointId) {
      await checkpointMgr.complete(checkpointId).catch(cpErr =>
        logger.warn({ err: cpErr, traceId }, 'Failed to complete checkpoint'),
      )
    }

    // Pipeline log (fire-and-forget via memory:manager)
    const memMgr = registry.getOptional<import('../modules/memory/memory-manager.js').MemoryManager>('memory:manager')
    if (memMgr && ctx.contactId) {
      memMgr.savePipelineLog({
        messageId: ctx.message.id,
        agentId: ctx.agentId,
        contactId: ctx.contactId,
        sessionId: ctx.session.id,
        phase1Ms: phase1DurationMs,
        phase2Ms: phase2DurationMs,
        phase3Ms: phase3DurationMs,
        phase4Ms: phase4DurationMs,
        phase5Ms: phase5DurationMs,
        totalMs: totalDurationMs,
        toolsCalled: evaluation.toolsNeeded,
        replanAttempts,
        subagentIterations: subagentIterationsUsed || null,
      }).catch(err => logger.warn({ err, traceId }, 'Failed to save pipeline log'))
    }

    return {
      traceId,
      success: delivery.sent,
      phase1DurationMs,
      phase2DurationMs,
      phase3DurationMs,
      phase4DurationMs,
      phase5DurationMs,
      totalDurationMs,
      evaluatorOutput: evaluation,
      executionOutput: execution,
      responseText: composed.responseText,
      deliveryResult: delivery,
      replanAttempts,
      subagentIterationsUsed,
    }
  } catch (err) {
    pipelineState.failed = true
    if (avisoTimer) clearTimeout(avisoTimer)
    const totalDurationMs = Date.now() - totalStart

    // Mark checkpoint failed
    if (checkpointMgr && checkpointId) {
      checkpointMgr.fail(checkpointId, String(err)).catch(cpErr =>
        logger.warn({ cpErr, traceId }, 'Failed to mark checkpoint as failed'),
      )
    }

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
      phase1DurationMs: 0,
      phase2DurationMs: 0,
      phase3DurationMs: 0,
      phase4DurationMs: 0,
      phase5DurationMs: 0,
      totalDurationMs,
      error: String(err),
      replanAttempts: 0,
      subagentIterationsUsed: 0,
    }
  }
}

/**
 * Stop the engine. Call on shutdown.
 */
export async function stopEngine(): Promise<void> {
  await stopProactiveRunner()
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
  engineConfig = loadEngineConfig()

  // Re-init semaphore if concurrency limits changed
  if (prev.maxConcurrentPipelines !== engineConfig.maxConcurrentPipelines
    || prev.maxQueueSize !== engineConfig.maxQueueSize) {
    pipelineSemaphore = new PipelineSemaphore(
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
 * Returns per-channel aviso config from the channel's runtime config service.
 * Each channel module provides 'channel-config:{name}' via registry.
 * If the channel doesn't provide a config service, aviso is disabled.
 */
function getAvisoConfig(channel: string): { triggerMs: number; holdMs: number } {
  const channelSvc = registry.getOptional<{ get(): import('../channels/types.js').ChannelRuntimeConfig }>(`channel-config:${channel}`)
  if (channelSvc) {
    const cc = channelSvc.get()
    return { triggerMs: cc.avisoTriggerMs, holdMs: cc.avisoHoldMs }
  }
  // No channel-config service → aviso disabled for this channel
  return { triggerMs: 0, holdMs: 0 }
}

/**
 * Resolve the tone/style for a channel from its runtime config (avisoStyle).
 * This is the single source of truth — ACKs and error fallbacks both use this.
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

/**
 * Envía un aviso de proceso al canal del mensaje original.
 * Message is now LLM-generated with fallback to predefined pool.
 */
async function sendAviso(ctx: ContextBundle, text: string, reg: Registry): Promise<void> {
  await reg.runHook('message:send', {
    channel: ctx.message.channelName,
    to: ctx.message.from,
    content: { type: 'text', text },
    correlationId: ctx.traceId,
  })
  logger.info({ traceId: ctx.traceId, to: ctx.message.from, text }, 'Aviso de proceso enviado')
}

// ═══════════════════════════════════════════
// Checkpoint resume & cleanup (startup only)
// ═══════════════════════════════════════════

/**
 * On startup: expire stale, resume recent incomplete pipelines, cleanup old.
 * Simple approach: re-process the message through the full pipeline,
 * passing completed steps so Phase 3 skips them.
 */
async function initCheckpoints(): Promise<void> {
  if (!checkpointMgr) return
  const db = registry.getDb()

  await checkpointMgr.expireStale(engineConfig.checkpointResumeWindowMs)

  const incomplete = await checkpointMgr.findIncomplete(engineConfig.checkpointResumeWindowMs)

  if (incomplete.length > 0) {
    logger.info({ count: incomplete.length }, 'Found incomplete checkpoints — resuming')

    for (const cp of incomplete) {
      // Skip if no steps were completed (nothing to salvage)
      if (cp.stepResults.length === 0) {
        await checkpointMgr.fail(cp.id, 'No steps completed — not worth resuming')
        continue
      }

      // Idempotency check: skip if a response was already sent for this message
      try {
        const alreadySent = await db.query(
          `SELECT 1 FROM messages WHERE reply_to_message_id = $1 AND direction = 'outbound' LIMIT 1`,
          [cp.messageId],
        )
        if (alreadySent.rows.length > 0) {
          logger.info({ checkpointId: cp.id, messageId: cp.messageId }, 'Response already sent — skipping resume')
          await checkpointMgr.complete(cp.id)
          continue
        }
      } catch (idempErr) {
        logger.warn({ err: idempErr, checkpointId: cp.id }, 'Idempotency check failed — resuming anyway')
      }

      logger.info({
        checkpointId: cp.id,
        traceId: cp.traceId,
        completedSteps: cp.stepResults.length,
        totalSteps: cp.executionPlan.length,
      }, 'Resuming from checkpoint')

      try {
        // Reconstruct a minimal IncomingMessage from checkpoint data
        const resumeMessage: IncomingMessage = {
          id: cp.messageId,
          channelName: cp.channel as IncomingMessage['channelName'],
          channelMessageId: cp.channelMessageId || cp.messageId,
          from: cp.messageFrom,
          senderName: cp.senderName || '',
          timestamp: cp.createdAt,
          content: { type: 'text', text: cp.messageText ?? '' },
          attachments: [],
        }

        // Mark old checkpoint as failed (new pipeline run creates its own)
        await checkpointMgr.fail(cp.id, 'Resumed: new pipeline run with completed steps')

        // Stash completed steps so processMessageInner can pick them up
        pendingResumeSteps.set(cp.messageId, cp.stepResults)

        // Go through full processMessage for proper concurrency/timeout control
        const result = await processMessage(resumeMessage)

        // Clean up stash (in case it wasn't consumed)
        pendingResumeSteps.delete(cp.messageId)

        if (!result.success) {
          logger.warn({ checkpointId: cp.id, error: result.error }, 'Checkpoint resume pipeline failed')
        }
      } catch (err) {
        logger.error({ err, checkpointId: cp.id }, 'Checkpoint resume failed')
        await checkpointMgr.fail(cp.id, `Resume error: ${String(err)}`).catch(() => {})
      }
    }
  }

  await checkpointMgr.cleanup(engineConfig.checkpointCleanupDays)
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
