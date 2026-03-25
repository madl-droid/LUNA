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
import { pickErrorFallback } from './ack/ack-defaults.js'
import { PipelineSemaphore, ContactLock } from './concurrency/index.js'

const logger = pino({ name: 'engine' })

let engineConfig: EngineConfig
let registry: Registry
let pipelineSemaphore: PipelineSemaphore
let contactLock: ContactLock

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
  registry.addHook('engine', 'message:incoming', async (payload, correlationId) => {
    const message: IncomingMessage = {
      id: payload.id,
      channelName: payload.channelName as IncomingMessage['channelName'],
      channelMessageId: payload.channelMessageId,
      from: payload.from,
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

  // Start proactive runner (BullMQ)
  const db = registry.getDb()
  const redis = registry.getRedis()
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
    return await contactLock.withLock(message.from, () =>
      processMessageInner(message, db, redis, totalStart),
    )
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
  let avisoTimer: ReturnType<typeof setTimeout> | null = null
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
    if (engineConfig.testMode && ctx.userType !== 'admin') {
      logger.info({ traceId, userType: ctx.userType, from: message.from }, 'Test mode — ignoring non-admin')
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

    // ═══ PHASE 2: Evaluate Situation ═══
    const p2Start = Date.now()
    let evaluation = await phase2Evaluate(ctx, engineConfig)
    let phase2DurationMs = Date.now() - p2Start

    logger.info({
      traceId,
      phase: 2,
      durationMs: phase2DurationMs,
      intent: evaluation.intent,
      planSteps: evaluation.executionPlan.length,
    }, 'Phase 2 done')

    // ═══ PHASE 3+4: Execute + Compose (with aviso de proceso timer) ═══
    const avisoConfig = getAvisoConfig(ctx.message.channelName)
    let avisoSentAt: number | undefined = undefined

    // Determine action type for LLM ACK context
    const actionType = mapStepToAction(evaluation.executionPlan?.[0]?.type ?? 'respond_only')
    const channelTone: 'casual' | 'formal' | 'neutral' =
      ctx.message.channelName === 'email' ? 'formal'
      : ctx.message.channelName === 'whatsapp' || ctx.message.channelName === 'google-chat' ? 'casual'
      : 'neutral'

    avisoTimer = avisoConfig.triggerMs > 0
      ? setTimeout(async () => {
          // Don't send ACK if pipeline already completed successfully
          if (pipelineState.completed) return

          // If pipeline failed, send error fallback instead of processing ACK
          if (pipelineState.failed) {
            try {
              const errorMsg = pickErrorFallback(ctx.message.channelName)
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

    const p3Start = Date.now()
    let execution = await phase3Execute(ctx, evaluation, db, redis, engineConfig, registry)

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
      evaluation = await phase2Evaluate(ctx, engineConfig, replanCtx)
      phase2DurationMs += Date.now() - replanP2Start

      execution = await phase3Execute(ctx, evaluation, db, redis, engineConfig, registry)
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
      }).catch(() => {})
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

    logger.error({
      traceId: traceId || 'unknown',
      err,
      totalDurationMs,
    }, 'Pipeline error')

    // Send a natural error fallback so the user doesn't get silence
    try {
      const errorMsg = pickErrorFallback(message.channelName)
      await registry.runHook('message:send', {
        channel: message.channelName,
        to: message.from,
        content: { type: 'text', text: errorMsg },
      })
      logger.info({ traceId: traceId || 'unknown', to: message.from }, 'Error fallback sent')
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
