// LUNA Engine — Commitment Scanner Job
// Finds commitments with due_at reached (pending/overdue) and auto-cancel expired ones.
// Enqueues each to the proactive pipeline for the evaluator to decide: fulfill, escalate, or cancel.

import pino from 'pino'
import type { ProactiveJobContext, ProactiveCandidate } from '../../types.js'
import type { ChannelName } from '../../../channels/types.js'
import { processProactive } from '../proactive-pipeline.js'

const logger = pino({ name: 'engine:job:commitment-check' })

export async function runCommitmentCheck(ctx: ProactiveJobContext): Promise<void> {
  const config = ctx.proactiveConfig
  if (!config.commitments.enabled) return

  logger.info({ traceId: ctx.traceId }, 'Commitment scanner starting')

  try {
    // 1. Auto-cancel expired commitments
    await autoCancel(ctx)

    // 2. Mark overdue commitments
    await markOverdue(ctx)

    // 3. Find actionable commitments (due_at reached, pending or overdue)
    const result = await ctx.db.query(
      `SELECT cm.id, cm.contact_id, cm.description, cm.commitment_type,
              cm.due_at, cm.status, cm.attempt_count, cm.requires_tool, cm.priority,
              cm.context_summary, cm.assigned_to, cm.metadata,
              c.display_name,
              cc.channel_identifier, cc.channel_type
       FROM commitments cm
       JOIN contacts c ON c.id = cm.contact_id
       JOIN contact_channels cc ON cc.contact_id = cm.contact_id AND cc.is_primary = true
       WHERE cm.status IN ('pending', 'overdue')
         AND cm.due_at IS NOT NULL
         AND cm.due_at <= now()
         AND (cm.scheduled_at IS NULL OR cm.scheduled_at <= now())
         AND cm.attempt_count < $1
       ORDER BY
         CASE cm.status WHEN 'overdue' THEN 0 ELSE 1 END,
         CASE cm.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
         cm.due_at ASC
       LIMIT 20`,
      [config.commitments.max_attempts],
    )

    let processed = 0

    for (const row of result.rows) {
      // If commitment is assigned to a human, notify the human — not the contact
      if (row.assigned_to) {
        await notifyAssignedHuman(ctx, row)
        processed++
        continue
      }

      // Build commitment data directly from the query row (avoids N+1 re-fetch)
      const commitmentData: import('../../../modules/memory/types.js').Commitment = {
        id: row.id,
        contactId: row.contact_id,
        commitmentBy: 'agent',
        description: row.description,
        commitmentType: row.commitment_type,
        priority: row.priority,
        dueAt: row.due_at ? new Date(row.due_at) : null,
        status: row.status,
        attemptCount: row.attempt_count ?? 0,
        requiresTool: row.requires_tool ?? null,
        contextSummary: row.context_summary ?? null,
        sortOrder: 0,
        reminderSent: false,
        metadata: {},
        createdAt: new Date(),
        updatedAt: new Date(),
      }

      const candidate: ProactiveCandidate = {
        contactId: row.contact_id,
        channelContactId: row.channel_identifier,
        channel: row.channel_type as ChannelName,
        displayName: row.display_name,
        triggerType: 'commitment',
        triggerId: row.id,
        reason: `Commitment due: "${row.description}" (${row.commitment_type}, ${row.status})`,
        commitmentData,
        isOverdue: row.status === 'overdue',
      }

      try {
        // Mark as in_progress before pipeline
        await ctx.db.query(
          `UPDATE commitments SET status = 'in_progress' WHERE id = $1 AND status IN ('pending', 'overdue')`,
          [row.id],
        )

        const pipelineResult = await processProactive(
          candidate, ctx.db, ctx.redis, ctx.registry, ctx.engineConfig, config,
        )

        if (!pipelineResult.success) {
          // Revert to previous status if pipeline failed
          await ctx.db.query(
            `UPDATE commitments SET status = $1, attempt_count = attempt_count + 1, last_attempt_at = now()
             WHERE id = $2`,
            [row.status, row.id],
          )

          // If max attempts reached, mark as failed
          if ((row.attempt_count as number) + 1 >= config.commitments.max_attempts) {
            await ctx.db.query(
              `UPDATE commitments SET status = 'failed' WHERE id = $1`,
              [row.id],
            )
            logger.warn({ commitmentId: row.id, traceId: ctx.traceId }, 'Commitment failed after max attempts')
          }
        } else {
          processed++
        }
      } catch (err) {
        logger.error({ err, commitmentId: row.id, traceId: ctx.traceId }, 'Commitment pipeline failed')
      }
    }

    logger.info({ traceId: ctx.traceId, checked: result.rows.length, processed }, 'Commitment scanner complete')
  } catch (err) {
    logger.error({ traceId: ctx.traceId, err }, 'Commitment scanner failed')
  }
}

async function autoCancel(ctx: ProactiveJobContext): Promise<void> {
  try {
    const result = await ctx.db.query(
      `UPDATE commitments
       SET status = 'cancelled', action_taken = 'Auto-cancelled: deadline exceeded'
       WHERE status IN ('pending', 'in_progress', 'overdue')
         AND auto_cancel_at IS NOT NULL
         AND auto_cancel_at <= now()
       RETURNING id, contact_id`,
    )

    if (result.rowCount && result.rowCount > 0) {
      logger.info({ count: result.rowCount, traceId: ctx.traceId }, 'Auto-cancelled expired commitments')
    }
  } catch (err) {
    logger.warn({ err, traceId: ctx.traceId }, 'Auto-cancel query failed')
  }
}

async function markOverdue(ctx: ProactiveJobContext): Promise<void> {
  try {
    await ctx.db.query(
      `UPDATE commitments
       SET status = 'overdue'
       WHERE status = 'pending'
         AND due_at IS NOT NULL
         AND due_at < now()`,
    )
  } catch (err) {
    logger.warn({ err, traceId: ctx.traceId }, 'Mark overdue query failed')
  }
}

/**
 * Notify the assigned human that their commitment is due/overdue.
 * Uses message:send hook to contact the human directly.
 */
async function notifyAssignedHuman(ctx: ProactiveJobContext, row: Record<string, unknown>): Promise<void> {
  const assignedTo = row.assigned_to as string
  const metadata = (row.metadata ?? {}) as Record<string, unknown>
  const channel = (metadata.assigned_channel as string) || 'whatsapp'
  const description = row.description as string
  const status = row.status as string
  const commitmentId = row.id as string
  const contactName = row.display_name as string | null
  const attemptCount = (row.attempt_count as number) ?? 0

  const maxAttempts = ctx.proactiveConfig.commitments.max_attempts

  const overdueTag = status === 'overdue' ? ' ⚠ VENCIDO' : ''
  const message = `📋 Recordatorio de compromiso${overdueTag}\n\nContacto: ${contactName ?? 'Sin nombre'}\nCompromiso: ${description}\nID: ${commitmentId}\nIntento: ${attemptCount + 1}/${maxAttempts}\n\nPor favor atiende este compromiso. Cuando lo hayas resuelto, responde en este chat para que el sistema lo cierre automáticamente.`

  try {
    await ctx.registry.runHook('message:send', {
      channel,
      to: assignedTo,
      content: { type: 'text', text: message },
      correlationId: ctx.traceId,
    }, ctx.traceId)

    await ctx.db.query(
      `UPDATE commitments SET attempt_count = attempt_count + 1, last_attempt_at = now()
       WHERE id = $1`,
      [commitmentId],
    )

    logger.info({ commitmentId, assignedTo, attempt: attemptCount + 1 }, 'Notified assigned human about commitment')

    // Check max attempts AFTER successful notification + DB update
    if (attemptCount + 1 >= maxAttempts) {
      await ctx.db.query(
        `UPDATE commitments SET status = 'failed', action_taken = 'Human did not respond after max attempts'
         WHERE id = $1`,
        [commitmentId],
      )
      logger.warn({ commitmentId, assignedTo }, 'Human commitment failed after max attempts')

      const hitlManager = ctx.registry.getOptional<{
        createTicket(params: Record<string, unknown>): Promise<unknown>
      }>('hitl:manager')
      if (hitlManager) {
        try {
          await hitlManager.createTicket({
            requestType: 'escalation',
            requestSummary: `Compromiso no atendido por ${assignedTo}: "${description}"`,
            requesterContactId: row.contact_id as string,
            urgency: 'high',
            targetRole: 'admin',
            metadata: { commitmentId, originalAssignee: assignedTo },
          })
        } catch (err) {
          logger.warn({ err, commitmentId }, 'Failed to create escalation ticket for unattended commitment')
        }
      }
    }
  } catch (err) {
    logger.warn({ err, commitmentId, assignedTo }, 'Failed to notify assigned human — will retry on next scan')
  }
}
