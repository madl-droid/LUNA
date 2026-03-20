// LUNA Engine — Main Orchestrator
// Entry point del pipeline de procesamiento de mensajes.
// Conecta las 5 fases y expone la API pública del engine.

import pino from 'pino'
import type { Registry } from '../kernel/registry.js'
import type { IncomingMessage, ChannelName } from '../channels/types.js'
import type { PipelineResult, EngineConfig, ContextBundle } from './types.js'
import { loadEngineConfig } from './config.js'
import { initLLMClients, setLLMGateway } from './utils/llm-client.js'
import { phase1Intake } from './phases/phase1-intake.js'
import { phase2Evaluate } from './phases/phase2-evaluate.js'
import { phase3Execute } from './phases/phase3-execute.js'
import { phase4Compose } from './phases/phase4-compose.js'
import { phase5Validate } from './phases/phase5-validate.js'
import { startProactiveRunner, stopProactiveRunner } from './proactive/proactive-runner.js'

const logger = pino({ name: 'engine' })

let engineConfig: EngineConfig
let registry: Registry

/**
 * Initialize the engine. Call once at startup.
 */
export function initEngine(reg: Registry): void {
  registry = reg

  // Load config
  engineConfig = loadEngineConfig()

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
      raw: payload.raw,
    }

    const result = await processMessage(message)
    if (!result.success) {
      logger.error({ traceId: result.traceId, error: result.error }, 'Pipeline failed')
    }
  })

  // Start proactive runner
  const db = registry.getDb()
  const redis = registry.getRedis()
  startProactiveRunner(db, redis, engineConfig)

  logger.info('Engine initialized')
}

/**
 * Process an incoming message through the 5-phase pipeline.
 */
export async function processMessage(message: IncomingMessage): Promise<PipelineResult> {
  const totalStart = Date.now()
  const db = registry.getDb()
  const redis = registry.getRedis()

  let traceId = ''

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
      quickAction: ctx.quickAction?.type,
    }, 'Phase 1 done')

    // ═══ PHASE 2: Evaluate Situation ═══
    const p2Start = Date.now()
    const evaluation = await phase2Evaluate(ctx, engineConfig)
    const phase2DurationMs = Date.now() - p2Start

    logger.info({
      traceId,
      phase: 2,
      durationMs: phase2DurationMs,
      intent: evaluation.intent,
      planSteps: evaluation.executionPlan.length,
    }, 'Phase 2 done')

    // ═══ PHASE 3+4: Execute + Compose (with aviso de proceso timer) ═══
    let ackSentAt: number | undefined = undefined
    const ackTimer = setTimeout(() => {
      ackSentAt = Date.now()
      sendProcessingAck(ctx, registry).catch(err =>
        logger.warn({ err, traceId }, 'Failed to send aviso de proceso'),
      )
    }, engineConfig.ackTriggerMs)

    const p3Start = Date.now()
    const execution = await phase3Execute(ctx, evaluation, db, redis, engineConfig, registry)
    const phase3DurationMs = Date.now() - p3Start

    logger.info({
      traceId,
      phase: 3,
      durationMs: phase3DurationMs,
      allSucceeded: execution.allSucceeded,
      stepResults: execution.results.length,
    }, 'Phase 3 done')

    // ═══ PHASE 4: Compose Response ═══
    const p4Start = Date.now()
    const composed = await phase4Compose(ctx, evaluation, execution, engineConfig, registry)
    const phase4DurationMs = Date.now() - p4Start

    clearTimeout(ackTimer)

    logger.info({
      traceId,
      phase: 4,
      durationMs: phase4DurationMs,
      responseLength: composed.responseText.length,
    }, 'Phase 4 done')

    // Si se envió aviso de proceso, retener la respuesta el tiempo configurado
    if (ackSentAt !== undefined) {
      const elapsed = Date.now() - ackSentAt
      const holdMs = engineConfig.ackHoldResponseMs - elapsed
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
    }
  } catch (err) {
    const totalDurationMs = Date.now() - totalStart

    logger.error({
      traceId: traceId || 'unknown',
      err,
      totalDurationMs,
    }, 'Pipeline error')

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
    }
  }
}

/**
 * Stop the engine. Call on shutdown.
 */
export function stopEngine(): void {
  stopProactiveRunner()
  logger.info('Engine stopped')
}

/**
 * Get current engine config (for testing/debugging).
 */
export function getEngineConfig(): EngineConfig {
  return engineConfig
}

/**
 * Envía un aviso de proceso al canal del mensaje original.
 * Mensaje predefinido, nunca generado por LLM.
 */
async function sendProcessingAck(ctx: ContextBundle, reg: Registry): Promise<void> {
  const ackMessages: Partial<Record<ChannelName, string>> = {
    whatsapp: 'Un momento, estoy revisando eso...',
    email: 'Recibí tu mensaje, te respondo en breve.',
  }
  const text = ackMessages[ctx.message.channelName] ?? 'Un momento...'
  await reg.runHook('message:send', {
    channel: ctx.message.channelName,
    to: ctx.message.from,
    content: { type: 'text', text },
    correlationId: ctx.traceId,
  })
  logger.info({ traceId: ctx.traceId, to: ctx.message.from }, 'Aviso de proceso enviado')
}
