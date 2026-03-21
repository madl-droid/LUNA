// scheduled-tasks/store.ts — PostgreSQL CRUD for scheduled tasks

import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import type { ScheduledTask, CreateTaskInput, UpdateTaskInput, TaskExecution, TaskRecipient, TaskAction } from './types.js'

const DEFAULT_RECIPIENT: TaskRecipient = { type: 'none' }

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS scheduled_tasks (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  prompt         TEXT NOT NULL,
  cron           TEXT NOT NULL,
  enabled        BOOLEAN NOT NULL DEFAULT true,
  trigger_type   TEXT NOT NULL DEFAULT 'cron',
  trigger_event  TEXT,
  recipient      JSONB NOT NULL DEFAULT '{"type":"none"}',
  actions        JSONB NOT NULL DEFAULT '[]',
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_run_at    TIMESTAMPTZ,
  last_result    TEXT,
  last_status    TEXT
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

// Migration: add new columns to existing tables
const MIGRATIONS = [
  `ALTER TABLE scheduled_tasks ADD COLUMN IF NOT EXISTS trigger_type TEXT NOT NULL DEFAULT 'cron'`,
  `ALTER TABLE scheduled_tasks ADD COLUMN IF NOT EXISTS trigger_event TEXT`,
  `ALTER TABLE scheduled_tasks ADD COLUMN IF NOT EXISTS recipient JSONB NOT NULL DEFAULT '{"type":"none"}'`,
  `ALTER TABLE scheduled_tasks ADD COLUMN IF NOT EXISTS actions JSONB NOT NULL DEFAULT '[]'`,
]

export async function ensureTables(db: Pool): Promise<void> {
  await db.query(CREATE_TABLE)
  await db.query(CREATE_EXECUTIONS_TABLE)
  await db.query(CREATE_INDEX)
  // Run migrations (safe: ADD COLUMN IF NOT EXISTS)
  for (const sql of MIGRATIONS) {
    await db.query(sql)
  }
}

function parseRow(row: Record<string, unknown>): ScheduledTask {
  return {
    ...row,
    recipient: (typeof row.recipient === 'string' ? JSON.parse(row.recipient) : row.recipient) as TaskRecipient ?? DEFAULT_RECIPIENT,
    actions: (typeof row.actions === 'string' ? JSON.parse(row.actions) : row.actions) as TaskAction[] ?? [],
    trigger_type: (row.trigger_type as string) ?? 'cron',
  } as ScheduledTask
}

export async function listTasks(db: Pool): Promise<ScheduledTask[]> {
  const { rows } = await db.query('SELECT * FROM scheduled_tasks ORDER BY created_at DESC')
  return (rows as Record<string, unknown>[]).map(r => parseRow(r))
}

export async function getTask(db: Pool, id: string): Promise<ScheduledTask | null> {
  const { rows } = await db.query('SELECT * FROM scheduled_tasks WHERE id = $1', [id])
  const row = rows[0] as Record<string, unknown> | undefined
  return row ? parseRow(row) : null
}

export async function createTask(db: Pool, input: CreateTaskInput): Promise<ScheduledTask> {
  const id = randomUUID()
  const recipient = input.recipient ?? DEFAULT_RECIPIENT
  const actions = input.actions ?? []
  const triggerType = input.trigger_type ?? 'cron'
  const triggerEvent = input.trigger_event ?? null

  const { rows } = await db.query(
    `INSERT INTO scheduled_tasks (id, name, prompt, cron, enabled, trigger_type, trigger_event, recipient, actions)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING *`,
    [id, input.name, input.prompt, input.cron, input.enabled ?? true,
     triggerType, triggerEvent, JSON.stringify(recipient), JSON.stringify(actions)],
  )
  return parseRow(rows[0]! as Record<string, unknown>)
}

export async function updateTask(db: Pool, id: string, input: UpdateTaskInput): Promise<ScheduledTask | null> {
  const sets: string[] = []
  const values: unknown[] = []
  let idx = 1

  if (input.name !== undefined) { sets.push(`name = $${idx++}`); values.push(input.name) }
  if (input.prompt !== undefined) { sets.push(`prompt = $${idx++}`); values.push(input.prompt) }
  if (input.cron !== undefined) { sets.push(`cron = $${idx++}`); values.push(input.cron) }
  if (input.enabled !== undefined) { sets.push(`enabled = $${idx++}`); values.push(input.enabled) }
  if (input.trigger_type !== undefined) { sets.push(`trigger_type = $${idx++}`); values.push(input.trigger_type) }
  if (input.trigger_event !== undefined) { sets.push(`trigger_event = $${idx++}`); values.push(input.trigger_event) }
  if (input.recipient !== undefined) { sets.push(`recipient = $${idx++}`); values.push(JSON.stringify(input.recipient)) }
  if (input.actions !== undefined) { sets.push(`actions = $${idx++}`); values.push(JSON.stringify(input.actions)) }

  if (sets.length === 0) return getTask(db, id)

  sets.push(`updated_at = now()`)
  values.push(id)

  const { rows } = await db.query(
    `UPDATE scheduled_tasks SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
    values,
  )
  const row = rows[0] as Record<string, unknown> | undefined
  return row ? parseRow(row) : null
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

/** Get tasks that listen to a specific event hook */
export async function getTasksByEvent(db: Pool, eventName: string): Promise<ScheduledTask[]> {
  const { rows } = await db.query(
    `SELECT * FROM scheduled_tasks WHERE trigger_type = 'event' AND trigger_event = $1 AND enabled = true`,
    [eventName],
  )
  return (rows as Record<string, unknown>[]).map(r => parseRow(r))
}
