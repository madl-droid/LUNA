// cortex/trace/store.ts — PostgreSQL persistence for Trace
// Tables: trace_scenarios, trace_runs, trace_results
// Pattern follows pulse/store.ts

import type { Pool } from 'pg'
import type {
  ScenarioConfig, ScenarioRow, RunRow, ResultRow,
  RunStatus, RunProgress, RunSummary, SandboxToolResult,
} from './types.js'
// ═══════════════════════════════════════════
// Scenarios CRUD
// ═══════════════════════════════════════════

export async function createScenario(
  db: Pool, name: string, description: string | null, config: ScenarioConfig,
): Promise<ScenarioRow> {
  const { rows } = await db.query(
    `INSERT INTO trace_scenarios (name, description, config)
     VALUES ($1, $2, $3)
     RETURNING id, name, description, config, created_at, updated_at`,
    [name, description, JSON.stringify(config)],
  )
  return rows[0]! as ScenarioRow
}

export async function listScenarios(db: Pool, limit = 20, offset = 0): Promise<ScenarioRow[]> {
  const { rows } = await db.query(
    `SELECT id, name, description, config, created_at, updated_at
     FROM trace_scenarios ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
    [limit, offset],
  )
  return rows as ScenarioRow[]
}

export async function getScenario(db: Pool, id: string): Promise<ScenarioRow | null> {
  const { rows } = await db.query(
    `SELECT id, name, description, config, created_at, updated_at
     FROM trace_scenarios WHERE id = $1`,
    [id],
  )
  return (rows[0] as ScenarioRow | undefined) ?? null
}

export async function updateScenario(
  db: Pool, id: string, name: string, description: string | null, config: ScenarioConfig,
): Promise<void> {
  await db.query(
    `UPDATE trace_scenarios SET name = $2, description = $3, config = $4, updated_at = now()
     WHERE id = $1`,
    [id, name, description, JSON.stringify(config)],
  )
}

export async function deleteScenario(db: Pool, id: string): Promise<void> {
  await db.query(`DELETE FROM trace_scenarios WHERE id = $1`, [id])
}

// ═══════════════════════════════════════════
// Runs CRUD
// ═══════════════════════════════════════════

export async function createRun(
  db: Pool,
  scenarioId: string,
  variantName: string,
  simCount: number,
  adminContext: string,
  config?: Record<string, unknown>,
): Promise<RunRow> {
  const { rows } = await db.query(
    `INSERT INTO trace_runs (scenario_id, variant_name, sim_count, admin_context, config,
       progress)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [scenarioId, variantName, simCount, adminContext,
      config ? JSON.stringify(config) : null,
      JSON.stringify({ completed: 0, total: simCount, analyzing: 0 })],
  )
  return rows[0]! as RunRow
}

export async function updateRunStatus(
  db: Pool,
  id: string,
  status: RunStatus,
  extra?: {
    progress?: RunProgress
    summary?: RunSummary
    synthesis?: string
    synthesisModel?: string
    tokensInput?: number
    tokensOutput?: number
    error?: string
  },
): Promise<void> {
  const sets: string[] = ['status = $2']
  const params: unknown[] = [id, status]
  let idx = 3

  if (status === 'running') {
    sets.push(`started_at = COALESCE(started_at, now())`)
  }
  if (status === 'completed' || status === 'failed' || status === 'cancelled') {
    sets.push(`completed_at = now()`)
  }
  if (extra?.progress) {
    sets.push(`progress = $${idx}`)
    params.push(JSON.stringify(extra.progress))
    idx++
  }
  if (extra?.summary) {
    sets.push(`summary = $${idx}`)
    params.push(JSON.stringify(extra.summary))
    idx++
  }
  if (extra?.synthesis !== undefined) {
    sets.push(`synthesis = $${idx}`)
    params.push(extra.synthesis)
    idx++
  }
  if (extra?.synthesisModel) {
    sets.push(`synthesis_model = $${idx}`)
    params.push(extra.synthesisModel)
    idx++
  }
  if (extra?.tokensInput !== undefined) {
    sets.push(`tokens_input = $${idx}`)
    params.push(extra.tokensInput)
    idx++
  }
  if (extra?.tokensOutput !== undefined) {
    sets.push(`tokens_output = $${idx}`)
    params.push(extra.tokensOutput)
    idx++
  }
  if (extra?.error) {
    sets.push(`error = $${idx}`)
    params.push(extra.error)
    idx++
  }

  await db.query(`UPDATE trace_runs SET ${sets.join(', ')} WHERE id = $1`, params)
}

export async function listRuns(
  db: Pool, filters?: { scenarioId?: string; status?: RunStatus }, limit = 20, offset = 0,
): Promise<RunRow[]> {
  const wheres: string[] = []
  const params: unknown[] = []
  let idx = 1

  if (filters?.scenarioId) {
    wheres.push(`scenario_id = $${idx++}`)
    params.push(filters.scenarioId)
  }
  if (filters?.status) {
    wheres.push(`status = $${idx++}`)
    params.push(filters.status)
  }

  const where = wheres.length > 0 ? `WHERE ${wheres.join(' AND ')}` : ''
  params.push(limit, offset)

  const { rows } = await db.query(
    `SELECT * FROM trace_runs ${where} ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx}`,
    params,
  )
  return rows as RunRow[]
}

export async function getRun(db: Pool, id: string): Promise<RunRow | null> {
  const { rows } = await db.query(`SELECT * FROM trace_runs WHERE id = $1`, [id])
  return (rows[0] as RunRow | undefined) ?? null
}

export async function deleteRun(db: Pool, id: string): Promise<void> {
  await db.query(`DELETE FROM trace_runs WHERE id = $1`, [id])
}

// ═══════════════════════════════════════════
// Results CRUD
// ═══════════════════════════════════════════

export async function insertResult(
  db: Pool,
  r: {
    runId: string; simIndex: number; messageIndex: number; messageText: string
    intent?: string; emotion?: string; toolsPlanned?: string[]
    executionPlan?: unknown; injectionRisk?: boolean; onScope?: boolean
    toolsExecuted?: SandboxToolResult[]; responseText?: string
    classifyMs?: number; agenticMs?: number; postprocessMs?: number; totalMs?: number
    tokensInput?: number; tokensOutput?: number
    rawClassify?: unknown; rawPostprocess?: string
  },
): Promise<string> {
  const { rows } = await db.query(
    `INSERT INTO trace_results (
       run_id, sim_index, message_index, message_text,
       intent, emotion, tools_planned, execution_plan, injection_risk, on_scope,
       tools_executed, response_text,
       classify_ms, agentic_ms, postprocess_ms, total_ms,
       tokens_input, tokens_output, raw_classify, raw_postprocess
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20
     ) RETURNING id`,
    [
      r.runId, r.simIndex, r.messageIndex, r.messageText,
      r.intent ?? null, r.emotion ?? null, r.toolsPlanned ?? [], r.executionPlan ? JSON.stringify(r.executionPlan) : null,
      r.injectionRisk ?? null, r.onScope ?? null,
      r.toolsExecuted ? JSON.stringify(r.toolsExecuted) : null, r.responseText ?? null,
      r.classifyMs ?? null, r.agenticMs ?? null, r.postprocessMs ?? null, r.totalMs ?? null,
      r.tokensInput ?? 0, r.tokensOutput ?? 0,
      r.rawClassify ? JSON.stringify(r.rawClassify) : null, r.rawPostprocess ?? null,
    ],
  )
  return (rows[0]! as { id: string }).id
}

export async function updateResultAnalysis(
  db: Pool, id: string, analysis: string, model: string, tokens: number,
): Promise<void> {
  await db.query(
    `UPDATE trace_results SET analysis = $2, analysis_model = $3, analysis_tokens = $4 WHERE id = $1`,
    [id, analysis, model, tokens],
  )
}

export async function getResults(db: Pool, runId: string, simIndex?: number): Promise<ResultRow[]> {
  if (simIndex !== undefined) {
    const { rows } = await db.query(
      `SELECT * FROM trace_results WHERE run_id = $1 AND sim_index = $2 ORDER BY message_index`,
      [runId, simIndex],
    )
    return rows as ResultRow[]
  }
  const { rows } = await db.query(
    `SELECT * FROM trace_results WHERE run_id = $1 ORDER BY sim_index, message_index`,
    [runId],
  )
  return rows as ResultRow[]
}

export async function getResultById(db: Pool, id: string): Promise<ResultRow | null> {
  const { rows } = await db.query(`SELECT * FROM trace_results WHERE id = $1`, [id])
  return (rows[0] as ResultRow | undefined) ?? null
}
