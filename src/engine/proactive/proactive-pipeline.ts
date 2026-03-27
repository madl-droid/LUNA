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
  EvaluatorOutput,
  ProactiveConfig,
  OutreachLogEntry,
} from '../types.js'
import { phase2Evaluate } from '../phases/phase2-evaluate.js'
import { phase3Execute } from '../phases/phase3-execute.js'
import { phase4Compose } from '../phases/phase4-compose.js'
import { phase5Validate } from '../phases/phase5-validate.js'
import { runGuards, setCooldown, incrementProactiveCount } from './guards.js'

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

    // ═══ PHASE 2: Evaluate (may return NO_ACTION) ═══
    const p2Start = Date.now()
    const evaluation = await phase2Evaluate(ctx, engineConfig, undefined, registry)
    const phase2DurationMs = Date.now() - p2Start

    if (evaluation.intent === 'no_action') {
      logger.info({ traceId }, 'Proactive evaluator decided NO_ACTION')
      await logOutreach(db, {
        contactId: candidate.contactId,
        triggerType: candidate.triggerType,
        triggerId: candidate.triggerId,
        channel: candidate.channel,
        actionTaken: 'no_action',
      })
      return {
        traceId, success: true,
        phase1DurationMs, phase2DurationMs,
        phase3DurationMs: 0, phase4DurationMs: 0, phase5DurationMs: 0,
        totalDurationMs: Date.now() - totalStart,
        evaluatorOutput: evaluation,
        replanAttempts: 0, subagentIterationsUsed: 0,
      }
    }

    logger.info({ traceId, phase: 2, durationMs: phase2DurationMs, intent: evaluation.intent }, 'Proactive phase 2 done')

    // ═══ PHASE 3: Execute Plan ═══
    const p3Start = Date.now()
    const execution = await phase3Execute(ctx, evaluation, db, redis, engineConfig, registry)
    const phase3DurationMs = Date.now() - p3Start

    logger.info({ traceId, phase: 3, durationMs: phase3DurationMs }, 'Proactive phase 3 done')

    // ═══ PHASE 4: Compose Response ═══
    const p4Start = Date.now()
    const composed = await phase4Compose(ctx, evaluation, execution, engineConfig, registry)
    const phase4DurationMs = Date.now() - p4Start

    logger.info({ traceId, phase: 4, durationMs: phase4DurationMs }, 'Proactive phase 4 done')

    // ═══ PHASE 5: Validate + Send + Persist ═══
    const p5Start = Date.now()
    const delivery = await phase5Validate(ctx, composed, evaluation, registry, db, redis, engineConfig)
    const phase5DurationMs = Date.now() - p5Start

    const totalDurationMs = Date.now() - totalStart

    // Post-send bookkeeping
    if (delivery.sent) {
      await Promise.allSettled([
        setCooldown(candidate.contactId, redis, proactiveConfig),
        incrementProactiveCount(candidate.contactId, redis),
        logOutreach(db, {
          contactId: candidate.contactId,
          triggerType: candidate.triggerType,
          triggerId: candidate.triggerId,
          channel: candidate.channel,
          actionTaken: 'sent',
          messageId: delivery.channelMessageId,
        }),
        updateCommitmentIfNeeded(candidate, evaluation, registry),
      ])
    } else {
      await logOutreach(db, {
        contactId: candidate.contactId,
        triggerType: candidate.triggerType,
        triggerId: candidate.triggerId,
        channel: candidate.channel,
        actionTaken: 'error',
        metadata: { error: delivery.error },
      })
    }

    logger.info({ traceId, totalDurationMs, sent: delivery.sent }, 'Proactive pipeline complete')

    // Pipeline log (fire-and-forget)
    const memMgr = registry.getOptional<MemoryManager>('memory:manager')
    if (memMgr && candidate.contactId) {
      memMgr.savePipelineLog({
        messageId: traceId,
        agentId: ctx.agentId,
        contactId: candidate.contactId,
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
      traceId, success: delivery.sent,
      phase1DurationMs, phase2DurationMs, phase3DurationMs, phase4DurationMs, phase5DurationMs,
      totalDurationMs,
      evaluatorOutput: evaluation,
      executionOutput: execution,
      responseText: composed.responseText,
      deliveryResult: delivery,
      replanAttempts: 0, subagentIterationsUsed: 0,
    }
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
  // FIX: E-30 — Use agent slug from config instead of hardcoded 'luna'
  const agentId = config.agentSlug

  // Load contact info
  const contactResult = await db.query(
    `SELECT c.id, c.display_name, c.contact_type, c.qualification_status,
            c.qualification_score, c.qualification_data, c.created_at,
            cc.channel_contact_id, cc.channel_name
     FROM contacts c
     JOIN contact_channels cc ON cc.contact_id = c.id
     WHERE c.id = $1 AND cc.channel_name = $2
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
    channelContactId: contactRow.channel_contact_id,
    channel: contactRow.channel_name,
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
    memoryManager ? loadContactMemory(memoryManager, agentId, candidate.contactId) : Promise.resolve(null),
    memoryManager ? memoryManager.getPendingCommitments(agentId, candidate.contactId) : Promise.resolve([]),
    memoryManager ? memoryManager.getLeadStatus(candidate.contactId, agentId) : Promise.resolve(null),
  ])

  const history = historyResult.status === 'fulfilled' ? historyResult.value : []
  const contactMemory = memoryResult.status === 'fulfilled' ? memoryResult.value : null
  const pendingCommitments = commitmentsResult.status === 'fulfilled' ? commitmentsResult.value : []
  const leadStatus = leadStatusResult.status === 'fulfilled' ? leadStatusResult.value : null

  // Find or create session
  const session = await findOrCreateSession(db, candidate.contactId, candidate.channelContactId, candidate.channel, agentId, config.sessionReopenWindowMs)

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
    agentId,
    contact,
    session,
    isNewContact: false,
    campaign: null,
    knowledgeMatches: [],
    knowledgeInjection: null,
    freshdeskMatches: [],
    history,
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
      `SELECT sender_type, content, created_at FROM messages
       WHERE session_id = $1 ORDER BY created_at DESC LIMIT $2`,
      [sessionId, limit],
    )
    return result.rows.reverse().map((row: Record<string, unknown>) => ({
      role: row.sender_type === 'agent' ? 'assistant' as const : 'user' as const,
      content: typeof row.content === 'object' ? ((row.content as Record<string, string>)?.text ?? '') : String(row.content),
      timestamp: row.created_at as Date,
    }))
  } catch {
    return []
  }
}

async function loadContactMemory(
  memoryManager: MemoryManager,
  agentId: string,
  contactId: string,
): Promise<import('../../modules/memory/types.js').ContactMemory | null> {
  try {
    const ac = await memoryManager.getAgentContact(agentId, contactId)
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
  agentId: string,
  reopenWindowMs: number,
): Promise<ContextBundle['session']> {
  const cutoff = new Date(Date.now() - reopenWindowMs)

  try {
    const result = await db.query(
      `SELECT id, contact_id, agent_id, channel_name, started_at, last_activity_at,
              message_count, compressed_summary
       FROM sessions
       WHERE contact_id = $1 AND channel_name = $2 AND last_activity_at > $3
       ORDER BY last_activity_at DESC LIMIT 1`,
      [contactId, channel, cutoff],
    )

    if (result.rows.length > 0) {
      const row = result.rows[0]!
      return {
        id: row.id, contactId: row.contact_id, agentId: row.agent_id ?? agentId,
        channel: row.channel_name, startedAt: row.started_at, lastActivityAt: row.last_activity_at,
        messageCount: row.message_count, compressedSummary: row.compressed_summary, isNew: false,
      }
    }
  } catch { /* create new */ }

  const sessionId = randomUUID()
  const now = new Date()

  try {
    await db.query(
      `INSERT INTO sessions (id, contact_id, channel_contact_id, channel_name, agent_id, started_at, last_activity_at, message_count)
       VALUES ($1, $2, $3, $4, $5, $6, $6, 0)`,
      [sessionId, contactId, channelContactId, channel, agentId, now],
    )
  } catch { /* session table might not exist */ }

  return {
    id: sessionId, contactId, agentId,
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

async function updateCommitmentIfNeeded(
  candidate: ProactiveCandidate,
  evaluation: EvaluatorOutput,
  registry: Registry,
): Promise<void> {
  if (candidate.triggerType !== 'commitment' || !candidate.commitmentData) return

  const memMgr = registry.getOptional<MemoryManager>('memory:manager')
  if (!memMgr) return

  const newStatus = evaluation.intent === 'cancel_commitment' ? 'cancelled' : 'done'
  const actionTaken = evaluation.intent === 'cancel_commitment'
    ? 'Cancelled by evaluator'
    : `Fulfilled proactively. Intent: ${evaluation.intent}`

  await memMgr.updateCommitmentStatus(
    candidate.commitmentData.id,
    newStatus as import('../../modules/memory/types.js').CommitmentStatus,
    actionTaken,
  )
}
