// LUNA Engine — Main Orchestrator
// Entry point del pipeline de procesamiento de mensajes.
// Conecta las 5 fases y expone la API pública del engine.

import pino from 'pino'
import { logChannelMessage } from '../kernel/extreme-logger.js'
import type { Registry } from '../kernel/registry.js'
import type { IncomingMessage } from '../channels/types.js'
import type { PipelineResult, EngineConfig, ContextBundle, LLMToolDef } from './types.js'
import { loadEngineConfig } from './config.js'
import { initLLMClients, setLLMGateway } from './utils/llm-client.js'
import { phase1Intake } from './phases/phase1-intake.js'
import { phase5Validate } from './phases/phase5-validate.js'
import { startProactiveRunner, stopProactiveRunner } from './proactive/proactive-runner.js'
import { loadProactiveConfig } from './proactive/proactive-config.js'
import { registerCreateCommitmentTool } from './proactive/tools/create-commitment.js'
import { pickErrorFallback } from './fallbacks/error-defaults.js'
import { PipelineSemaphore, ContactLock } from './concurrency/index.js'
import { CheckpointManager } from './checkpoints/checkpoint-manager.js'
// --- Agentic imports (v2.0) ---
import { classifyEffort, runAgenticLoop, postProcess } from './agentic/index.js'
import {
  buildRunSubagentToolDef,
  filterAgenticTools,
  getAgenticSubagentCatalog,
} from './agentic/subagent-delegation.js'
import { loadSkillCatalog, filterSkillsByTools } from './prompts/skills.js'
import { buildSkillReadToolDef } from './agentic/skill-delegation.js'
import { buildAgenticPrompt } from './prompts/agentic.js'
import type { AgenticConfig, AgenticResult, EffortLevel } from './agentic/types.js'

const logger = pino({ name: 'engine' })

let engineConfig: EngineConfig
let registry: Registry
let pipelineSemaphore: PipelineSemaphore
let contactLock: ContactLock
let checkpointMgr: CheckpointManager | null = null

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

    // ═══ SIGNAL: READ (mark as read) — before agentic loop ═══
    registry.runHook('channel:read', {
      channel: message.channelName,
      to: signalTo,
      messageKeys,
      correlationId: traceId,
    }).catch(() => {})

    // ═══ SIGNAL: COMPOSING/RECORDING ═══
    registry.runHook('channel:composing', {
      channel: message.channelName,
      to: signalTo,
      mode: ctx.responseFormat === 'audio' ? 'recording' : 'composing',
      correlationId: traceId,
    }).catch(() => {})

    return await runAgenticPipeline(ctx, engineConfig, registry, db, redis, totalStart, phase1DurationMs)
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

// ═══════════════════════════════════════════════════════════
// Agentic pipeline
// ═══════════════════════════════════════════════════════════

/** Minimal ToolRegistry interface to avoid importing the full class */
interface ToolRegistryLike {
  getCatalog(contactType?: string): import('./types.js').ToolCatalogEntry[]
  getEnabledToolDefinitions(contactType?: string): import('./types.js').ToolDefinition[]
}

/** Select model/provider based on effort level */
function getModelForEffort(
  effort: EffortLevel,
  config: EngineConfig,
): { model: string; provider: import('./types.js').LLMProvider } {
  switch (effort) {
    case 'low':
      return { model: config.lowEffortModel, provider: config.lowEffortProvider }
    case 'high':
      return { model: config.highEffortModel, provider: config.highEffortProvider }
    default:
      return { model: config.mediumEffortModel, provider: config.mediumEffortProvider }
  }
}

/** Convert ToolDefinition[] → LLMToolDef[] (parameters → inputSchema rename) */
function toLLMToolDefs(defs: import('./types.js').ToolDefinition[]): LLMToolDef[] {
  return defs.map(d => ({ name: d.name, description: d.description, inputSchema: d.parameters }))
}

/**
 * Run the agentic pipeline for a reactive message.
 * Phase 1 → effort classification → agentic loop → post-process → Phase 5.
 * Called from processMessageInner().
 */
async function runAgenticPipeline(
  ctx: ContextBundle,
  config: EngineConfig,
  reg: Registry,
  db: import('pg').Pool,
  redis: import('ioredis').Redis,
  totalStart: number,
  phase1DurationMs: number,
): Promise<PipelineResult> {
  const log = logger.child({ traceId: ctx.traceId, pipeline: 'agentic' })

  // 1. Classify effort level (deterministic, <5ms)
  const effortLevel: EffortLevel = config.effortRoutingEnabled
    ? classifyEffort(ctx)
    : 'medium'
  log.info({ effortLevel }, 'effort classified')

  // 2. Select model based on effort
  const modelConfig = getModelForEffort(effortLevel, config)

  // 3. Get tool catalog + definitions from registry
  const toolRegistry = reg.getOptional<ToolRegistryLike>('tools:registry')
  const subagentCatalog = getAgenticSubagentCatalog(ctx, reg)
  const toolCatalog = filterAgenticTools(toolRegistry?.getCatalog(ctx.userType) ?? [], subagentCatalog)
  const toolDefs = filterAgenticTools(toolRegistry?.getEnabledToolDefinitions(ctx.userType) ?? [], subagentCatalog)
  const llmToolDefs: LLMToolDef[] = toLLMToolDefs(toolDefs)
  const runSubagentTool = buildRunSubagentToolDef(subagentCatalog)
  if (runSubagentTool) {
    llmToolDefs.push(runSubagentTool)
  }

  // Add skill_read tool if skills are available
  const skillCatalog = await loadSkillCatalog(reg, ctx.userType)
  const activeToolNames = new Set(toolCatalog.map((t: { name: string }) => t.name))
  const filteredSkills = filterSkillsByTools(skillCatalog, activeToolNames)
  const skillReadTool = buildSkillReadToolDef(filteredSkills.map((s: { name: string }) => s.name))
  if (skillReadTool) {
    llmToolDefs.push(skillReadTool)
  }

  // 4. Build system prompt + user message (with full context layers)
  const agenticPrompt = await buildAgenticPrompt(ctx, toolCatalog, reg, {
    isProactive: false,
    subagentCatalog,
  })
  const systemPrompt = agenticPrompt.system

  // 5. Build agentic config
  const agenticConfig: AgenticConfig = {
    maxToolTurns: config.agenticMaxTurns,
    maxConcurrentTools: config.maxConcurrentSteps,
    effort: effortLevel,
    model: modelConfig.model,
    provider: modelConfig.provider,
    fallbackModel: config.fallbackRespondModel,
    fallbackProvider: config.fallbackRespondProvider,
    temperature: config.temperatureRespond,
    maxOutputTokens: config.maxOutputTokens,
    criticizerMode: config.criticizerMode,
  }

  // 6. Run the agentic loop (pass full user message with context layers)
  const agenticResult: AgenticResult = await runAgenticLoop(
    ctx,
    systemPrompt,
    llmToolDefs,
    agenticConfig,
    reg,
    config,
    agenticPrompt.userMessage,
  )
  log.info({
    turns: agenticResult.turns,
    toolCalls: agenticResult.toolCallsLog.length,
    effortUsed: agenticResult.effortUsed,
  }, 'agentic loop complete')

  // 7. Post-process (criticizer, formatting, TTS)
  const compositorOutput = await postProcess(agenticResult, ctx, config, reg)

  // 8. Phase 5: validate, send, persist
  const p5Start = Date.now()
  const delivery = await phase5Validate(ctx, compositorOutput, null, reg, db, redis, config)
  const phase5DurationMs = Date.now() - p5Start

  const totalDurationMs = Date.now() - totalStart

  log.info({
    phase: 5,
    durationMs: phase5DurationMs,
    sent: delivery.sent,
    totalDurationMs,
  }, 'Agentic pipeline complete')

  // 9. Pipeline log (fire-and-forget)
  const memMgr = reg.getOptional<import('../modules/memory/memory-manager.js').MemoryManager>('memory:manager')
  if (memMgr) {
    memMgr.savePipelineLog({
      messageId: ctx.message.id,
      agentId: ctx.agentId,
      contactId: ctx.contactId ?? null,
      sessionId: ctx.session.id,
      phase1Ms: phase1DurationMs,
      phase2Ms: 0,
      phase3Ms: 0,
      phase4Ms: 0,
      phase5Ms: phase5DurationMs,
      totalMs: totalDurationMs,
      toolsCalled: agenticResult.toolsUsed,
    }).catch(err => log.warn({ err }, 'Failed to save pipeline log'))
  }

  // 10. Extreme logging: outbound
  logChannelMessage({
    channel: ctx.message.channelName,
    direction: 'outbound',
    contactId: ctx.message.from,
    messageType: 'text',
    textPreview: compositorOutput.responseText,
    metadata: { traceId: ctx.traceId, totalDurationMs, sent: delivery.sent },
  }).catch(() => {})

  return {
    traceId: ctx.traceId,
    success: delivery.sent,
    phase1DurationMs,
    phase2DurationMs: 0,
    phase3DurationMs: 0,
    phase4DurationMs: 0,
    phase5DurationMs,
    totalDurationMs,
    responseText: compositorOutput.responseText,
    deliveryResult: delivery,
    replanAttempts: 0,
    subagentIterationsUsed: 0,
    agenticResult,
    effortLevel,
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
          `SELECT 1 FROM messages WHERE reply_to_message_id = $1 AND role = 'assistant' LIMIT 1`,
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
        await checkpointMgr.fail(cp.id, 'Resumed: re-processing via agentic pipeline')

        // Go through full processMessage for proper concurrency/timeout control
        const result = await processMessage(resumeMessage)

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
