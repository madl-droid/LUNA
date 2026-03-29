// LUNA Engine — Checkpoint Manager
// Persists pipeline execution state to DB so pipelines can resume after crashes.

import pino from 'pino'
import type { Pool } from 'pg'
import type { StepResult } from '../types.js'
import type { TaskCheckpoint, CheckpointStatus, Phase1Snapshot } from './types.js'

const logger = pino({ name: 'engine:checkpoints' })

export class CheckpointManager {
  constructor(private readonly db: Pool) {}

  // ─── Create ─────────────────────────────

  /**
   * Create a new checkpoint when a pipeline starts.
   * Returns the checkpoint ID.
   */
  async create(params: {
    traceId: string
    messageId: string
    contactId: string | null
    agentId: string
    channel: string
    messagePayload: unknown
  }): Promise<string> {
    const { rows } = await this.db.query<{ id: string }>(
      `INSERT INTO task_checkpoints
         (trace_id, message_id, contact_id, agent_id, channel, current_phase, status, message_payload)
       VALUES ($1, $2, $3, $4, $5, 1, 'running', $6)
       ON CONFLICT (message_id, status) DO NOTHING
       RETURNING id`,
      [
        params.traceId,
        params.messageId,
        params.contactId,
        params.agentId,
        params.channel,
        JSON.stringify(params.messagePayload),
      ],
    )

    const id = rows[0]?.id
    if (!id) {
      // Conflict — checkpoint already exists for this message
      const existing = await this.db.query<{ id: string }>(
        `SELECT id FROM task_checkpoints WHERE message_id = $1 AND status = 'running' LIMIT 1`,
        [params.messageId],
      )
      return existing.rows[0]?.id ?? ''
    }

    logger.debug({ checkpointId: id, traceId: params.traceId }, 'Checkpoint created')
    return id
  }

  // ─── Phase updates ──────────────────────

  /**
   * Save Phase 1 result and advance to phase 2.
   */
  async savePhase1(checkpointId: string, snapshot: Phase1Snapshot): Promise<void> {
    await this.db.query(
      `UPDATE task_checkpoints
       SET current_phase = 2, phase1_result = $2, updated_at = now()
       WHERE id = $1 AND status IN ('running', 'resuming')`,
      [checkpointId, JSON.stringify(snapshot)],
    )
  }

  /**
   * Save Phase 2 result (EvaluatorOutput) and advance to phase 3.
   */
  async savePhase2(checkpointId: string, evaluatorOutput: unknown): Promise<void> {
    await this.db.query(
      `UPDATE task_checkpoints
       SET current_phase = 3, phase2_result = $2, updated_at = now()
       WHERE id = $1 AND status IN ('running', 'resuming')`,
      [checkpointId, JSON.stringify(evaluatorOutput)],
    )
  }

  /**
   * Save a completed step result within Phase 3.
   * Appends to the step_results array.
   */
  async saveStepResult(checkpointId: string, stepResult: StepResult): Promise<void> {
    await this.db.query(
      `UPDATE task_checkpoints
       SET step_results = step_results || $2::jsonb, updated_at = now()
       WHERE id = $1 AND status IN ('running', 'resuming')`,
      [checkpointId, JSON.stringify([stepResult])],
    )
  }

  /**
   * Save Phase 3 complete result and advance to phase 4.
   */
  async savePhase3(checkpointId: string, executionOutput: unknown, replanAttempt: number): Promise<void> {
    await this.db.query(
      `UPDATE task_checkpoints
       SET current_phase = 4, phase3_result = $2, replan_attempt = $3, updated_at = now()
       WHERE id = $1 AND status IN ('running', 'resuming')`,
      [checkpointId, JSON.stringify(executionOutput), replanAttempt],
    )
  }

  /**
   * Save Phase 4 result and advance to phase 5.
   */
  async savePhase4(checkpointId: string, compositorOutput: unknown): Promise<void> {
    await this.db.query(
      `UPDATE task_checkpoints
       SET current_phase = 5, phase4_result = $2, updated_at = now()
       WHERE id = $1 AND status IN ('running', 'resuming')`,
      [checkpointId, JSON.stringify(compositorOutput)],
    )
  }

  // ─── Completion ─────────────────────────

  /**
   * Mark checkpoint as completed.
   */
  async complete(checkpointId: string): Promise<void> {
    await this.db.query(
      `UPDATE task_checkpoints
       SET status = 'completed', completed_at = now(), updated_at = now()
       WHERE id = $1`,
      [checkpointId],
    )
    logger.debug({ checkpointId }, 'Checkpoint completed')
  }

  /**
   * Mark checkpoint as failed with error.
   */
  async fail(checkpointId: string, error: string): Promise<void> {
    await this.db.query(
      `UPDATE task_checkpoints
       SET status = 'failed', error = $2, updated_at = now()
       WHERE id = $1`,
      [checkpointId, error.slice(0, 2000)],
    )
    logger.debug({ checkpointId, error: error.slice(0, 200) }, 'Checkpoint failed')
  }

  // ─── Resume ─────────────────────────────

  /**
   * Find all incomplete checkpoints (crashed pipelines).
   * These are checkpoints still in 'running' status that were never completed.
   * Called on startup to detect pipelines that crashed mid-execution.
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
   * Mark a checkpoint as resuming (prevents duplicate resumes).
   */
  async markResuming(checkpointId: string): Promise<boolean> {
    const { rowCount } = await this.db.query(
      `UPDATE task_checkpoints
       SET status = 'resuming', updated_at = now()
       WHERE id = $1 AND status = 'running'`,
      [checkpointId],
    )
    return (rowCount ?? 0) > 0
  }

  /**
   * Get a checkpoint by ID.
   */
  async get(checkpointId: string): Promise<TaskCheckpoint | null> {
    const { rows } = await this.db.query<Record<string, unknown>>(
      `SELECT * FROM task_checkpoints WHERE id = $1`,
      [checkpointId],
    )
    const row = rows[0]
    return row ? rowToCheckpoint(row) : null
  }

  // ─── Cleanup ────────────────────────────

  /**
   * Purge old completed/failed checkpoints.
   * Returns number of rows deleted.
   */
  async cleanup(maxAgeDays: number): Promise<number> {
    const { rowCount } = await this.db.query(
      `DELETE FROM task_checkpoints
       WHERE status IN ('completed', 'failed')
         AND created_at < now() - ($1 || ' days')::interval`,
      [String(maxAgeDays)],
    )
    const count = rowCount ?? 0
    if (count > 0) {
      logger.info({ deleted: count, maxAgeDays }, 'Checkpoint cleanup')
    }
    return count
  }

  /**
   * Mark stale running checkpoints as failed.
   * Called on startup to clean up checkpoints from a previous crash
   * that are too old to resume.
   */
  async expireStale(maxAgeMs: number): Promise<number> {
    const { rowCount } = await this.db.query(
      `UPDATE task_checkpoints
       SET status = 'failed', error = 'Expired: system restart beyond resume window', updated_at = now()
       WHERE status = 'running'
         AND created_at < now() - ($1 || ' milliseconds')::interval`,
      [String(maxAgeMs)],
    )
    const count = rowCount ?? 0
    if (count > 0) {
      logger.info({ expired: count }, 'Expired stale checkpoints')
    }
    return count
  }
}

// ─── Helpers ────────────────────────────

function rowToCheckpoint(row: Record<string, unknown>): TaskCheckpoint {
  return {
    id: row.id as string,
    traceId: row.trace_id as string,
    messageId: row.message_id as string,
    contactId: row.contact_id as string | null,
    agentId: row.agent_id as string,
    channel: row.channel as string,
    currentPhase: row.current_phase as number,
    status: row.status as CheckpointStatus,
    messagePayload: row.message_payload,
    phase1Result: row.phase1_result,
    phase2Result: row.phase2_result,
    phase3Result: row.phase3_result,
    phase4Result: row.phase4_result,
    stepResults: (row.step_results ?? []) as StepResult[],
    replanAttempt: row.replan_attempt as number,
    error: row.error as string | null,
    createdAt: row.created_at as Date,
    updatedAt: row.updated_at as Date,
    completedAt: row.completed_at as Date | null,
  }
}
