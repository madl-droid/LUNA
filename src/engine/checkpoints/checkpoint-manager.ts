// LUNA Engine — Checkpoint Manager
// Lightweight checkpoint persistence for Phase 3 execution plans.
// All writes are designed to be fire-and-forget — never block the pipeline.

import pino from 'pino'
import type { Pool } from 'pg'
import type { ExecutionStep, StepResult } from '../types.js'
import type { TaskCheckpoint, CheckpointStatus } from './types.js'

const logger = pino({ name: 'engine:checkpoints' })

export class CheckpointManager {
  constructor(private readonly db: Pool) {}

  // ─── Create (after Phase 2, when we have the plan) ──

  /**
   * Create a checkpoint for this execution plan.
   * Designed to be called fire-and-forget from engine.ts.
   */
  async create(params: {
    traceId: string
    messageId: string
    contactId: string | null
    channel: string
    messageFrom: string
    senderName: string
    channelMessageId: string
    messageText: string | null
    executionPlan: ExecutionStep[]
  }): Promise<string> {
    const { rows } = await this.db.query<{ id: string }>(
      `INSERT INTO task_checkpoints
         (trace_id, message_id, contact_id, channel, message_from, sender_name, channel_message_id, message_text, execution_plan)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        params.traceId,
        params.messageId,
        params.contactId,
        params.channel,
        params.messageFrom,
        params.senderName,
        params.channelMessageId,
        params.messageText?.slice(0, 1000) ?? null,
        JSON.stringify(params.executionPlan),
      ],
    )
    const id = rows[0]?.id ?? ''
    logger.debug({ checkpointId: id, traceId: params.traceId, steps: params.executionPlan.length }, 'Checkpoint created')
    return id
  }

  // ─── Step tracking ──────────────────────

  /**
   * Append a completed step result. Fire-and-forget.
   * Uses atomic JSONB append — safe for concurrent steps.
   */
  async appendStep(checkpointId: string, stepResult: StepResult): Promise<void> {
    await this.db.query(
      `UPDATE task_checkpoints
       SET step_results = step_results || $2::jsonb, updated_at = now()
       WHERE id = $1 AND status = 'running'`,
      [checkpointId, JSON.stringify([stepResult])],
    )
  }

  // ─── Completion ─────────────────────────

  async complete(checkpointId: string): Promise<void> {
    await this.db.query(
      `UPDATE task_checkpoints SET status = 'completed', updated_at = now() WHERE id = $1`,
      [checkpointId],
    )
  }

  async fail(checkpointId: string, error: string): Promise<void> {
    await this.db.query(
      `UPDATE task_checkpoints SET status = 'failed', error = $2, updated_at = now() WHERE id = $1`,
      [checkpointId, error.slice(0, 2000)],
    )
  }

  // ─── Resume (startup only) ──────────────

  /**
   * Find checkpoints still 'running' within the resume window.
   * These are pipelines that crashed before completing.
   */
  async findIncomplete(maxAgeMs: number): Promise<TaskCheckpoint[]> {
    const { rows } = await this.db.query<Record<string, unknown>>(
      `SELECT * FROM task_checkpoints
       WHERE status = 'running'
         AND created_at > now() - ($1 || ' milliseconds')::interval
       ORDER BY created_at ASC`,
      [String(maxAgeMs)],
    )
    return rows.map(rowToCheckpoint)
  }

  /**
   * Expire checkpoints too old to resume — mark them failed.
   */
  async expireStale(maxAgeMs: number): Promise<number> {
    const { rowCount } = await this.db.query(
      `UPDATE task_checkpoints
       SET status = 'failed', error = 'Expired: beyond resume window', updated_at = now()
       WHERE status = 'running'
         AND created_at < now() - ($1 || ' milliseconds')::interval`,
      [String(maxAgeMs)],
    )
    const count = rowCount ?? 0
    if (count > 0) logger.info({ expired: count }, 'Expired stale checkpoints')
    return count
  }

  /**
   * Delete old completed/failed checkpoints.
   */
  async cleanup(maxAgeDays: number): Promise<number> {
    const { rowCount } = await this.db.query(
      `DELETE FROM task_checkpoints
       WHERE status IN ('completed', 'failed')
         AND created_at < now() - ($1 || ' days')::interval`,
      [String(maxAgeDays)],
    )
    const count = rowCount ?? 0
    if (count > 0) logger.info({ deleted: count }, 'Checkpoint cleanup')
    return count
  }
}

// ─── Row mapper ─────────────────────────

function rowToCheckpoint(row: Record<string, unknown>): TaskCheckpoint {
  return {
    id: row.id as string,
    traceId: row.trace_id as string,
    messageId: row.message_id as string,
    contactId: row.contact_id as string | null,
    channel: row.channel as string,
    status: row.status as CheckpointStatus,
    messageFrom: row.message_from as string,
    senderName: (row.sender_name as string) ?? '',
    channelMessageId: (row.channel_message_id as string) ?? '',
    messageText: row.message_text as string | null,
    executionPlan: (row.execution_plan ?? []) as ExecutionStep[],
    stepResults: (row.step_results ?? []) as StepResult[],
    error: row.error as string | null,
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
  }
}
