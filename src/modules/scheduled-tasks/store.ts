// scheduled-tasks/store.ts — PostgreSQL CRUD for scheduled tasks

import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import type { ScheduledTask, CreateTaskInput, UpdateTaskInput, TaskExecution } from './types.js'

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS scheduled_tasks (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  prompt      TEXT NOT NULL,
  cron        TEXT NOT NULL,
  enabled     BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_run_at TIMESTAMPTZ,
  last_result TEXT,
  last_status TEXT
)`

const CREATE_EXECUTIONS_TABLE = `
CREATE TABLE IF NOT EXISTS scheduled_task_executions (
  id          TEXT PRIMARY KEY,
  task_id     TEXT NOT NULL REFERENCES scheduled_tasks(id) ON DELETE CASCADE,
  started_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  status      TEXT NOT NULL DEFAULT 'running',
  result      TEXT,
  error       TEXT
)`

const CREATE_INDEX = `
CREATE INDEX IF NOT EXISTS idx_task_executions_task_id ON scheduled_task_executions(task_id)`

export async function ensureTables(db: Pool): Promise<void> {
  await db.query(CREATE_TABLE)
  await db.query(CREATE_EXECUTIONS_TABLE)
  await db.query(CREATE_INDEX)
}

export async function listTasks(db: Pool): Promise<ScheduledTask[]> {
  const { rows } = await db.query<ScheduledTask>(
    'SELECT * FROM scheduled_tasks ORDER BY created_at DESC',
  )
  return rows
}

export async function getTask(db: Pool, id: string): Promise<ScheduledTask | null> {
  const { rows } = await db.query<ScheduledTask>(
    'SELECT * FROM scheduled_tasks WHERE id = $1',
    [id],
  )
  return rows[0] ?? null
}

export async function createTask(db: Pool, input: CreateTaskInput): Promise<ScheduledTask> {
  const id = randomUUID()
  const { rows } = await db.query<ScheduledTask>(
    `INSERT INTO scheduled_tasks (id, name, prompt, cron, enabled)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [id, input.name, input.prompt, input.cron, input.enabled ?? true],
  )
  return rows[0]!
}

export async function updateTask(db: Pool, id: string, input: UpdateTaskInput): Promise<ScheduledTask | null> {
  const sets: string[] = []
  const values: unknown[] = []
  let idx = 1

  if (input.name !== undefined) { sets.push(`name = $${idx++}`); values.push(input.name) }
  if (input.prompt !== undefined) { sets.push(`prompt = $${idx++}`); values.push(input.prompt) }
  if (input.cron !== undefined) { sets.push(`cron = $${idx++}`); values.push(input.cron) }
  if (input.enabled !== undefined) { sets.push(`enabled = $${idx++}`); values.push(input.enabled) }

  if (sets.length === 0) return getTask(db, id)

  sets.push(`updated_at = now()`)
  values.push(id)

  const { rows } = await db.query<ScheduledTask>(
    `UPDATE scheduled_tasks SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
    values,
  )
  return rows[0] ?? null
}

export async function deleteTask(db: Pool, id: string): Promise<boolean> {
  const { rowCount } = await db.query('DELETE FROM scheduled_tasks WHERE id = $1', [id])
  return (rowCount ?? 0) > 0
}

export async function updateLastRun(
  db: Pool,
  id: string,
  status: 'success' | 'error',
  result: string | null,
): Promise<void> {
  await db.query(
    `UPDATE scheduled_tasks SET last_run_at = now(), last_status = $2, last_result = $3, updated_at = now()
     WHERE id = $1`,
    [id, status, result],
  )
}

// --- Executions ---

export async function createExecution(db: Pool, taskId: string): Promise<string> {
  const id = randomUUID()
  await db.query(
    'INSERT INTO scheduled_task_executions (id, task_id) VALUES ($1, $2)',
    [id, taskId],
  )
  return id
}

export async function finishExecution(
  db: Pool,
  execId: string,
  status: 'success' | 'error',
  result: string | null,
  error: string | null,
): Promise<void> {
  await db.query(
    `UPDATE scheduled_task_executions
     SET finished_at = now(), status = $2, result = $3, error = $4
     WHERE id = $1`,
    [execId, status, result, error],
  )
}

export async function listExecutions(db: Pool, taskId: string, limit = 20): Promise<TaskExecution[]> {
  const { rows } = await db.query<TaskExecution>(
    'SELECT * FROM scheduled_task_executions WHERE task_id = $1 ORDER BY started_at DESC LIMIT $2',
    [taskId, limit],
  )
  return rows
}
