// LUNA Engine — Proactive Pipeline
// Simplified Phase 1 + reuses Phases 2-5 from reactive pipeline.
// Entry point for all proactive flows (follow-up, reminder, commitment, reactivation).

import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import type { Redis } from 'ioredis'
import pino from 'pino'
import type { Registry } from '../../kernel/registry.js'
import type { MemoryManager } from '../../modules/memory/memory-manager.js'
import type { IncomingMessage } from '../../channels/types.js'
import type {
  ProactiveCandidate,
  ProactiveContextBundle,
  ContextBundle,
  EngineConfig,
  PipelineResult,
  ProactiveConfig,
  OutreachLogEntry,
} from '../types.js'
import { phase5Validate } from '../phases/phase5-validate.js'
import { runGuards, setCooldown, incrementProactiveCount } from './guards.js'
// --- Agentic imports (v2.0) ---
import { classifyEffort, runAgenticLoop, postProcess } from '../agentic/index.js'
import {
  buildRunSubagentToolDef,
  filterAgenticTools,
  getAgenticSubagentCatalog,
} from '../agentic/subagent-delegation.js'
import { loadSkillCatalog, filterSkillsByTools } from '../prompts/skills.js'
import { buildSkillReadToolDef } from '../agentic/skill-delegation.js'
import { buildAgenticPrompt } from '../prompts/agentic.js'
import { updateCooldownState } from './smart-cooldown.js'
import { shouldSuppressProactive } from './conversation-guard.js'
import type { AgenticConfig } from '../agentic/types.js'

const logger = pino({ name: 'engine:proactive-pipeline' })

/**
 * Process a proactive candidate through the pipeline.
 * Simplified Phase 1 → Phase 2 (with NO_ACTION option) → Phase 3-5.
 */
export async function processProactive(
  candidate: ProactiveCandidate,
  db: Pool,
  redis: Redis,
  registry: Registry,
  engineConfig: EngineConfig,
  proactiveConfig: ProactiveConfig,
): Promise<PipelineResult> {
  const traceId = randomUUID()
  const totalStart = Date.now()

  logger.info({
    traceId,
    contactId: candidate.contactId,
    trigger: candidate.triggerType,
    isOverdue: candidate.isOverdue,
  }, 'Proactive pipeline start')

  try {
    // ═══ GUARDS ═══
    const guardResult = await runGuards(candidate, redis, db, proactiveConfig)
    if (!guardResult.passed) {
      await logOutreach(db, {
        contactId: candidate.contactId,
        triggerType: candidate.triggerType,
        triggerId: candidate.triggerId,
        channel: candidate.channel,
        actionTaken: 'blocked',
        guardBlocked: guardResult.blockedBy,
      })
      return {
        traceId,
        success: false,
        phase1DurationMs: 0, phase2DurationMs: 0, phase3DurationMs: 0,
        phase4DurationMs: 0, phase5DurationMs: 0,
        totalDurationMs: Date.now() - totalStart,
        error: `Blocked by guard: ${guardResult.blockedBy}`,
        replanAttempts: 0, subagentIterationsUsed: 0,
      }
    }

    // ═══ SIMPLIFIED PHASE 1 ═══
    const p1Start = Date.now()
    const ctx = await buildProactiveContext(candidate, db, redis, registry, engineConfig, traceId)
    const phase1DurationMs = Date.now() - p1Start

    logger.info({ traceId, phase: 1, durationMs: phase1DurationMs }, 'Proactive phase 1 done')

    return await runProactiveAgentic(
      ctx, db, redis, registry, engineConfig, proactiveConfig,
      candidate, traceId, totalStart, phase1DurationMs,
    )
  } catch (err) {
    const totalDurationMs = Date.now() - totalStart
    logger.error({ traceId, err, totalDurationMs }, 'Proactive pipeline error')

    await logOutreach(db, {
      contactId: candidate.contactId,
      triggerType: candidate.triggerType,
      triggerId: candidate.triggerId,
      channel: candidate.channel,
      actionTaken: 'error',
      metadata: { error: String(err) },
    }).catch(() => {})

    return {
      traceId, success: false,
      phase1DurationMs: 0, phase2DurationMs: 0, phase3DurationMs: 0,
      phase4DurationMs: 0, phase5DurationMs: 0,
      totalDurationMs,
      error: String(err),
      replanAttempts: 0, subagentIterationsUsed: 0,
    }
  }
}

// ─── Agentic proactive pipeline (v2.0) ──────

/** Minimal ToolRegistry interface (mirrors engine.ts pattern) */
interface ToolRegistryLike {
  getCatalog(contactType?: string): import('../types.js').ToolCatalogEntry[]
  getEnabledToolDefinitions(contactType?: string): import('../types.js').ToolDefinition[]
}

async function runProactiveAgentic(
  ctx: ProactiveContextBundle,
  db: Pool,
  redis: Redis,
  registry: Registry,
  engineConfig: EngineConfig,
  proactiveConfig: ProactiveConfig,
  candidate: ProactiveCandidate,
  traceId: string,
  totalStart: number,
  phase1DurationMs: number,
): Promise<PipelineResult> {
  const log = logger.child({ traceId, pipeline: 'proactive-agentic' })

  // Conversation guard: suppress if contact said goodbye recently
  if (proactiveConfig.conversation_guard?.enabled) {
    const guard = await shouldSuppressProactive(
      db, redis,
      candidate.contactId,
      candidate.channel,
      proactiveConfig.conversation_guard.cache_ttl_hours ?? 6,
    )
    if (guard.suppress && !(proactiveConfig.conversation_guard.skip_for_commitments && candidate.triggerType === 'commitment')) {
      log.info({ reason: guard.reason }, 'Proactive suppressed by conversation guard')
      await Promise.allSettled([
        updateCooldownState(redis, candidate.contactId, candidate.triggerType, 'blocked', proactiveConfig),
        logOutreach(db, {
          contactId: candidate.contactId,
          triggerType: candidate.triggerType,
          triggerId: candidate.triggerId,
          channel: candidate.channel,
          actionTaken: 'blocked',
          guardBlocked: guard.reason ?? 'conversation_guard',
        }),
      ])
      return {
        traceId, success: false,
        phase1DurationMs, phase2DurationMs: 0, phase3DurationMs: 0,
        phase4DurationMs: 0, phase5DurationMs: 0,
        totalDurationMs: Date.now() - totalStart,
        error: `Blocked by conversation guard: ${guard.reason}`,
        replanAttempts: 0, subagentIterationsUsed: 0,
      }
    }
  }

  // Proactive uses low effort (fewer turns, cheaper model)
  const effortLevel = classifyEffort(ctx) === 'high' ? 'medium' : 'low'
  const modelConfig = {
    model: effortLevel === 'low' ? engineConfig.lowEffortModel : engineConfig.mediumEffortModel,
    provider: (effortLevel === 'low' ? engineConfig.lowEffortProvider : engineConfig.mediumEffortProvider),
  }

  // Get tools
  const toolRegistry = registry.getOptional<ToolRegistryLike>('tools:registry')
  const subagentCatalog = getAgenticSubagentCatalog(ctx, registry)
  const toolCatalog = filterAgenticTools(toolRegistry?.getCatalog(ctx.userType) ?? [], subagentCatalog)
  const toolDefs = filterAgenticTools(toolRegistry?.getEnabledToolDefinitions(ctx.userType) ?? [], subagentCatalog)
  const llmToolDefs = toolDefs.map(d => ({ name: d.name, description: d.description, inputSchema: d.parameters }))
  const runSubagentTool = buildRunSubagentToolDef(subagentCatalog)
  if (runSubagentTool) {
    llmToolDefs.push(runSubagentTool)
  }

  // Add skill_read tool if skills are available
  const skillCatalog = await loadSkillCatalog(registry, ctx.userType)
  const activeToolNames = new Set(toolCatalog.map((t: { name: string }) => t.name))
  const filteredSkills = filterSkillsByTools(skillCatalog, activeToolNames)
  const skillReadTool = buildSkillReadToolDef(filteredSkills.map((s: { name: string }) => s.name))
  if (skillReadTool) {
    llmToolDefs.push(skillReadTool)
  }

  // Build prompt with proactive context
  const agenticPrompt = await buildAgenticPrompt(ctx, toolCatalog, registry, {
    isProactive: true,
    proactiveTrigger: ctx.proactiveTrigger,
    subagentCatalog,
  })

  // Agentic config — lower limits for proactive
  const agenticConfig: AgenticConfig = {
    maxToolTurns: Math.min(engineConfig.agenticMaxTurns, 5),
    maxConcurrentTools: engineConfig.maxConcurrentSteps,
    effort: effortLevel,
    model: modelConfig.model,
    provider: modelConfig.provider as import('../types.js').LLMProvider,
    fallbackModel: engineConfig.fallbackRespondModel,
    fallbackProvider: engineConfig.fallbackRespondProvider,
    temperature: engineConfig.temperatureRespond,
    maxOutputTokens: engineConfig.maxOutputTokens,
    criticizerMode: engineConfig.criticizerMode,
  }

  // Run agentic loop (pass full user message with context layers)
  const agenticResult = await runAgenticLoop(
    ctx,
    agenticPrompt.system,
    llmToolDefs,
    agenticConfig,
    registry,
    engineConfig,
    agenticPrompt.userMessage,
  )
  log.info({ turns: agenticResult.turns, stopReason: agenticResult.effortUsed }, 'Proactive agentic loop complete')

  // NO_ACTION check: if response is the sentinel, treat as no_action
  const isNoAction = agenticResult.responseText.trim() === '[NO_ACTION]'
  if (isNoAction) {
    log.info('Proactive agentic decided NO_ACTION')
    await Promise.allSettled([
      updateCooldownState(redis, candidate.contactId, candidate.triggerType, 'no_action', proactiveConfig),
      logOutreach(db, {
        contactId: candidate.contactId,
        triggerType: candidate.triggerType,
        triggerId: candidate.triggerId,
        channel: candidate.channel,
        actionTaken: 'no_action',
      }),
    ])
    return {
      traceId, success: true,
      phase1DurationMs, phase2DurationMs: 0, phase3DurationMs: 0,
      phase4DurationMs: 0, phase5DurationMs: 0,
      totalDurationMs: Date.now() - totalStart,
      agenticResult, effortLevel,
      replanAttempts: 0, subagentIterationsUsed: 0,
    }
  }

  // Post-process
  const compositorOutput = await postProcess(agenticResult, ctx, engineConfig, registry)

  // Phase 5
  const p5Start = Date.now()
  const delivery = await phase5Validate(ctx, compositorOutput, null, registry, db, redis, engineConfig)
  const phase5DurationMs = Date.now() - p5Start
  const totalDurationMs = Date.now() - totalStart

  // Post-send bookkeeping
  if (delivery.sent) {
    await Promise.allSettled([
      setCooldown(candidate.contactId, redis, proactiveConfig),
      incrementProactiveCount(candidate.contactId, redis),
      updateCooldownState(redis, candidate.contactId, candidate.triggerType, 'sent', proactiveConfig),
      logOutreach(db, {
        contactId: candidate.contactId,
        triggerType: candidate.triggerType,
        triggerId: candidate.triggerId,
        channel: candidate.channel,
        actionTaken: 'sent',
        messageId: delivery.channelMessageId,
      }),
    ])
  } else {
    await Promise.allSettled([
      updateCooldownState(redis, candidate.contactId, candidate.triggerType, 'error', proactiveConfig),
      logOutreach(db, {
        contactId: candidate.contactId,
        triggerType: candidate.triggerType,
        triggerId: candidate.triggerId,
        channel: candidate.channel,
        actionTaken: 'error',
        metadata: { error: delivery.error },
      }),
    ])
  }

  log.info({ totalDurationMs, sent: delivery.sent }, 'Proactive agentic pipeline complete')

  // Pipeline log (fire-and-forget)
  const memMgr = registry.getOptional<MemoryManager>('memory:manager')
  if (memMgr && candidate.contactId) {
    memMgr.savePipelineLog({
      messageId: traceId,
      contactId: candidate.contactId,
      sessionId: ctx.session.id,
      phase1Ms: phase1DurationMs,
      phase2Ms: 0, phase3Ms: 0, phase4Ms: 0,
      phase5Ms: phase5DurationMs,
      totalMs: totalDurationMs,
      toolsCalled: agenticResult.toolsUsed,
    }).catch(() => {})
  }

  return {
    traceId, success: delivery.sent,
    phase1DurationMs, phase2DurationMs: 0, phase3DurationMs: 0,
    phase4DurationMs: 0, phase5DurationMs,
    totalDurationMs,
    responseText: compositorOutput.responseText,
    deliveryResult: delivery,
    agenticResult, effortLevel,
    replanAttempts: 0, subagentIterationsUsed: 0,
  }
}

// ─── Simplified Phase 1 ────────────────────

async function buildProactiveContext(
  candidate: ProactiveCandidate,
  db: Pool,
  _redis: Redis,
  registry: Registry,
  config: EngineConfig,
  traceId: string,
): Promise<ProactiveContextBundle> {
  const memoryManager = registry.getOptional<MemoryManager>('memory:manager') ?? null

  // Load contact info
  const contactResult = await db.query(
    `SELECT c.id, c.display_name, c.contact_type,
            ac.lead_status AS qualification_status,
            COALESCE(ac.qualification_score, 0) AS qualification_score,
            COALESCE(ac.qualification_data, '{}') AS qualification_data,
            c.created_at,
            cc.channel_identifier, cc.channel_type
     FROM contacts c
     JOIN contact_channels cc ON cc.contact_id = c.id
     LEFT JOIN agent_contacts ac ON ac.contact_id = c.id
     WHERE c.id = $1 AND cc.channel_type = $2
     LIMIT 1`,
    [candidate.contactId, candidate.channel],
  )

  // FIX: E-29 — Guard against deleted contact (no non-null assertion)
  const contactRow = contactResult.rows[0]
  if (!contactRow) {
    throw new Error(`Contact ${candidate.contactId} not found (may have been deleted)`)
  }
  const contact = contactRow ? {
    id: contactRow.id,
    channelContactId: contactRow.channel_identifier,
    channel: contactRow.channel_type,
    displayName: contactRow.display_name,
    contactType: contactRow.contact_type,
    qualificationStatus: contactRow.qualification_status,
    qualificationScore: contactRow.qualification_score,
    qualificationData: contactRow.qualification_data,
    createdAt: contactRow.created_at,
  } : null

  // Load history + memory in parallel
  const [historyResult, memoryResult, commitmentsResult, leadStatusResult] = await Promise.allSettled([
    loadRecentHistory(memoryManager, db, candidate.contactId, candidate.channel, 5),
    memoryManager ? loadContactMemory(memoryManager, candidate.contactId) : Promise.resolve(null),
    memoryManager ? memoryManager.getPendingCommitments(candidate.contactId) : Promise.resolve([]),
    memoryManager ? memoryManager.getLeadStatus(candidate.contactId) : Promise.resolve(null),
  ])

  const history = historyResult.status === 'fulfilled' ? historyResult.value : []
  const contactMemory = memoryResult.status === 'fulfilled' ? memoryResult.value : null
  const pendingCommitments = commitmentsResult.status === 'fulfilled' ? commitmentsResult.value : []
  const leadStatus = leadStatusResult.status === 'fulfilled' ? leadStatusResult.value : null

  // Find or create session
  const session = await findOrCreateSession(db, candidate.contactId, candidate.channelContactId, candidate.channel, config.sessionReopenWindowMs)

  // Build synthetic incoming message for pipeline compat
  const syntheticMessage: IncomingMessage = {
    id: traceId,
    channelName: candidate.channel,
    channelMessageId: `proactive-${traceId}`,
    from: candidate.channelContactId,
    timestamp: new Date(),
    content: { type: 'text', text: '' },
  }

  const ctx: ProactiveContextBundle = {
    message: syntheticMessage,
    traceId,
    userType: 'lead',
    userPermissions: { tools: [], skills: [], subagents: false, canReceiveProactive: true, knowledgeCategories: [] },
    contactId: candidate.contactId,
    contact,
    session,
    isNewContact: false,
    campaign: null,
    knowledgeMatches: [],
    knowledgeInjection: null,
    freshdeskMatches: [],
    history,
    bufferSummary: null, // proactive pipelines don't load buffer summary
    contactMemory,
    pendingCommitments,
    relevantSummaries: [],
    leadStatus,
    sheetsData: null,
    normalizedText: '',
    messageType: 'text',
    attachmentMeta: [],
    assignmentRules: null,
    attachmentContext: null,
    responseFormat: 'text',
    possibleInjection: false,
    hitlPendingContext: null,
    isProactive: true,
    proactiveTrigger: {
      type: candidate.triggerType,
      triggerId: candidate.triggerId,
      reason: candidate.reason,
      commitmentData: candidate.commitmentData,
      isOverdue: candidate.isOverdue,
    },
  }

  return ctx
}

async function loadRecentHistory(
  memoryManager: MemoryManager | null,
  db: Pool,
  contactId: string,
  channel: string,
  limit: number,
): Promise<Array<{ role: 'user' | 'assistant'; content: string; timestamp: Date }>> {
  // Find most recent session for this contact+channel
  try {
    const sessResult = await db.query(
      `SELECT id FROM sessions
       WHERE contact_id = $1 AND channel_name = $2
       ORDER BY last_activity_at DESC LIMIT 1`,
      [contactId, channel],
    )
    if (sessResult.rows.length === 0) return []
    const sessionId = sessResult.rows[0]!.id as string

    if (memoryManager) {
      try {
        const messages = await memoryManager.getSessionMessages(sessionId)
        return messages.slice(-limit).map(m => ({
          role: m.role === 'assistant' ? 'assistant' as const : 'user' as const,
          content: m.contentText || m.content?.text || '',
          timestamp: m.createdAt,
        }))
      } catch { /* fallback below */ }
    }

    const result = await db.query(
      `SELECT role, content_text, created_at FROM messages
       WHERE session_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [sessionId, limit],
    )
    return result.rows.reverse().map((row: Record<string, unknown>) => ({
      role: row.role === 'assistant' ? 'assistant' as const : 'user' as const,
      content: (row.content_text as string) ?? '',
      timestamp: row.created_at as Date,
    }))
  } catch {
    return []
  }
}

async function loadContactMemory(
  memoryManager: MemoryManager,
  contactId: string,
): Promise<import('../../modules/memory/types.js').ContactMemory | null> {
  try {
    const ac = await memoryManager.getAgentContact(contactId)
    return ac?.contactMemory ?? null
  } catch {
    return null
  }
}

async function findOrCreateSession(
  db: Pool,
  contactId: string,
  channelContactId: string,
  channel: string,
  reopenWindowMs: number,
): Promise<ContextBundle['session']> {
  const cutoff = new Date(Date.now() - reopenWindowMs)

  try {
    const result = await db.query(
      `SELECT s.id, s.contact_id, s.channel_name, s.started_at, s.last_activity_at,
              s.message_count, ss.summary_text AS compressed_summary
       FROM sessions s
       LEFT JOIN LATERAL (
         SELECT summary_text FROM session_summaries
         WHERE session_id = s.id ORDER BY created_at DESC LIMIT 1
       ) ss ON true
       WHERE s.contact_id = $1 AND s.channel_name = $2 AND s.last_activity_at > $3
       ORDER BY s.last_activity_at DESC LIMIT 1`,
      [contactId, channel, cutoff],
    )

    if (result.rows.length > 0) {
      const row = result.rows[0]!
      return {
        id: row.id, contactId: row.contact_id,
        channel: row.channel_name, startedAt: row.started_at, lastActivityAt: row.last_activity_at,
        messageCount: row.message_count, compressedSummary: row.compressed_summary ?? null, isNew: false,
      }
    }
  } catch { /* create new */ }

  const sessionId = randomUUID()
  const now = new Date()

  try {
    await db.query(
      `INSERT INTO sessions (id, contact_id, channel_contact_id, channel_name, started_at, last_activity_at, message_count)
       VALUES ($1, $2, $3, $4, $5, $5, 0)`,
      [sessionId, contactId, channelContactId, channel, now],
    )
  } catch { /* session table might not exist */ }

  return {
    id: sessionId, contactId,
    channel: channel as ContextBundle['session']['channel'],
    startedAt: now, lastActivityAt: now,
    messageCount: 0, compressedSummary: null, isNew: true,
  }
}

// ─── Post-send helpers ──────────────────────

async function logOutreach(db: Pool, entry: OutreachLogEntry): Promise<void> {
  try {
    await db.query(
      `INSERT INTO proactive_outreach_log (contact_id, trigger_type, trigger_id, channel, action_taken, guard_blocked, message_id, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        entry.contactId, entry.triggerType, entry.triggerId ?? null,
        entry.channel, entry.actionTaken, entry.guardBlocked ?? null,
        entry.messageId ?? null, JSON.stringify(entry.metadata ?? {}),
      ],
    )
  } catch (err) {
    logger.warn({ err }, 'Failed to log proactive outreach')
  }
}

