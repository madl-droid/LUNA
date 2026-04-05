// LUNA — Module: subagents — Repository
// CRUD para subagent_types + tracking de uso (subagent_usage).

import type { Pool } from 'pg'
import type {
  SubagentTypeRow,
  CreateSubagentType,
  UpdateSubagentType,
  SubagentUsageSummary,
  RecordSubagentUsage,
} from './types.js'

// ═══════════════════════════════════════════
// subagent_types CRUD
// ═══════════════════════════════════════════

function mapTypeRow(r: Record<string, unknown>): SubagentTypeRow {
  return {
    id: r.id as string,
    slug: r.slug as string,
    name: r.name as string,
    description: (r.description as string) ?? '',
    enabled: r.enabled as boolean,
    modelTier: r.model_tier as 'normal' | 'complex',
    tokenBudget: r.token_budget as number,
    verifyResult: r.verify_result as boolean,
    canSpawnChildren: r.can_spawn_children as boolean,
    allowedTools: (r.allowed_tools as string[]) ?? [],
    exclusiveTools: (r.exclusive_tools as string[]) ?? [],
    allowedKnowledgeCategories: (r.allowed_knowledge_categories as string[]) ?? [],
    systemPrompt: (r.system_prompt as string) ?? '',
    isSystem: (r.is_system as boolean) ?? false,
    googleSearchGrounding: (r.google_search_grounding as boolean) ?? false,
    sortOrder: (r.sort_order as number) ?? 0,
    createdAt: (r.created_at as Date)?.toISOString() ?? '',
    updatedAt: (r.updated_at as Date)?.toISOString() ?? '',
  }
}

export async function listTypes(db: Pool): Promise<SubagentTypeRow[]> {
  const { rows } = await db.query(`SELECT * FROM subagent_types ORDER BY sort_order, name`)
  return rows.map((r: Record<string, unknown>) => mapTypeRow(r))
}

export async function getTypeById(db: Pool, id: string): Promise<SubagentTypeRow | null> {
  const { rows } = await db.query(`SELECT * FROM subagent_types WHERE id = $1`, [id])
  return rows[0] ? mapTypeRow(rows[0] as Record<string, unknown>) : null
}

export async function getTypeBySlug(db: Pool, slug: string): Promise<SubagentTypeRow | null> {
  const { rows } = await db.query(`SELECT * FROM subagent_types WHERE slug = $1`, [slug])
  return rows[0] ? mapTypeRow(rows[0] as Record<string, unknown>) : null
}

export async function getEnabledTypes(db: Pool): Promise<SubagentTypeRow[]> {
  const { rows } = await db.query(
    `SELECT * FROM subagent_types WHERE enabled = true ORDER BY sort_order, name`,
  )
  return rows.map((r: Record<string, unknown>) => mapTypeRow(r))
}

export async function createType(db: Pool, data: CreateSubagentType): Promise<SubagentTypeRow> {
  const { rows } = await db.query(
    `INSERT INTO subagent_types (slug, name, description, enabled, model_tier, token_budget,
      verify_result, can_spawn_children, allowed_tools, exclusive_tools, allowed_knowledge_categories,
      system_prompt, google_search_grounding)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING *`,
    [
      data.slug,
      data.name,
      data.description ?? '',
      data.enabled ?? true,
      data.modelTier ?? 'normal',
      data.tokenBudget ?? 100000,
      data.verifyResult ?? true,
      data.canSpawnChildren ?? false,
      data.allowedTools ?? [],
      data.exclusiveTools ?? [],
      data.allowedKnowledgeCategories ?? [],
      data.systemPrompt ?? '',
      data.googleSearchGrounding ?? false,
    ],
  )
  if (!rows[0]) throw new Error('INSERT INTO subagent_types returned no rows')
  return mapTypeRow(rows[0] as Record<string, unknown>)
}

export async function updateType(db: Pool, id: string, data: UpdateSubagentType, isSystem = false): Promise<SubagentTypeRow | null> {
  const sets: string[] = []
  const params: unknown[] = []
  let idx = 1

  // System subagents: only allow enabled, tokenBudget, description, sortOrder, allowedKnowledgeCategories
  if (data.name !== undefined && !isSystem) { sets.push(`name = $${idx++}`); params.push(data.name) }
  if (data.description !== undefined) { sets.push(`description = $${idx++}`); params.push(data.description) }
  if (data.enabled !== undefined) { sets.push(`enabled = $${idx++}`); params.push(data.enabled) }
  if (data.modelTier !== undefined && !isSystem) { sets.push(`model_tier = $${idx++}`); params.push(data.modelTier) }
  if (data.tokenBudget !== undefined) { sets.push(`token_budget = $${idx++}`); params.push(Math.max(5000, data.tokenBudget)) }
  if (data.verifyResult !== undefined && !isSystem) { sets.push(`verify_result = $${idx++}`); params.push(data.verifyResult) }
  if (data.canSpawnChildren !== undefined && !isSystem) { sets.push(`can_spawn_children = $${idx++}`); params.push(data.canSpawnChildren) }
  if (data.allowedTools !== undefined && !isSystem) { sets.push(`allowed_tools = $${idx++}`); params.push(data.allowedTools) }
  if (data.exclusiveTools !== undefined) { sets.push(`exclusive_tools = $${idx++}`); params.push(data.exclusiveTools) }
  if (data.allowedKnowledgeCategories !== undefined) { sets.push(`allowed_knowledge_categories = $${idx++}`); params.push(data.allowedKnowledgeCategories) }
  if (data.systemPrompt !== undefined && !isSystem) { sets.push(`system_prompt = $${idx++}`); params.push(data.systemPrompt) }
  if (data.googleSearchGrounding !== undefined && !isSystem) { sets.push(`google_search_grounding = $${idx++}`); params.push(data.googleSearchGrounding) }
  if (data.sortOrder !== undefined) { sets.push(`sort_order = $${idx++}`); params.push(data.sortOrder) }

  if (sets.length === 0) return getTypeById(db, id)

  sets.push('updated_at = now()')
  params.push(id)

  const { rows } = await db.query(
    `UPDATE subagent_types SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
    params,
  )
  return rows[0] ? mapTypeRow(rows[0] as Record<string, unknown>) : null
}

export async function deleteType(db: Pool, id: string): Promise<{ deleted: boolean; isSystem?: boolean }> {
  // Check if system subagent — cannot delete
  const { rows: checkRows } = await db.query('SELECT is_system FROM subagent_types WHERE id = $1', [id])
  if (checkRows[0] && (checkRows[0] as Record<string, unknown>).is_system === true) {
    return { deleted: false, isSystem: true }
  }
  const { rowCount } = await db.query('DELETE FROM subagent_types WHERE id = $1', [id])
  return { deleted: (rowCount ?? 0) > 0 }
}

// ═══════════════════════════════════════════
// subagent_usage tracking
// ═══════════════════════════════════════════

export async function recordUsage(db: Pool, data: RecordSubagentUsage): Promise<void> {
  await db.query(
    `INSERT INTO subagent_usage (subagent_type_id, subagent_slug, trace_id, iterations,
      tokens_used, duration_ms, success, verified, verification_verdict, child_spawned, cost_usd, error)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      data.subagentTypeId,
      data.subagentSlug,
      data.traceId ?? null,
      data.iterations,
      data.tokensUsed,
      data.durationMs,
      data.success,
      data.verified ?? false,
      data.verificationVerdict ?? null,
      data.childSpawned ?? false,
      data.costUsd,
      data.error ?? null,
    ],
  )
}

export async function getUsageSummary(
  db: Pool,
  period: 'hour' | 'day' | 'week' | 'month',
): Promise<SubagentUsageSummary> {
  const intervals: Record<string, string> = {
    hour: '1 hour',
    day: '1 day',
    week: '7 days',
    month: '30 days',
  }

  const interval = intervals[period]!

  // Get per-subagent breakdown (interval is from hardcoded whitelist, cast via $1::interval)
  const { rows } = await db.query<{
    subagent_slug: string
    executions: string
    total_tokens: string
    total_cost: string
    total_errors: string
    avg_iterations: string
    avg_duration: string
    success_count: string
  }>(`
    SELECT
      u.subagent_slug,
      COUNT(*)::text AS executions,
      COALESCE(SUM(u.tokens_used), 0)::text AS total_tokens,
      COALESCE(SUM(u.cost_usd), 0)::text AS total_cost,
      COALESCE(SUM(CASE WHEN NOT u.success THEN 1 ELSE 0 END), 0)::text AS total_errors,
      COALESCE(AVG(u.iterations), 0)::text AS avg_iterations,
      COALESCE(AVG(u.duration_ms), 0)::text AS avg_duration,
      COALESCE(SUM(CASE WHEN u.success THEN 1 ELSE 0 END), 0)::text AS success_count
    FROM subagent_usage u
    WHERE u.created_at >= now() - $1::interval
    GROUP BY u.subagent_slug
  `, [interval])

  // Get subagent names for display
  const { rows: typeRows } = await db.query(`SELECT slug, name FROM subagent_types`)
  const nameMap = new Map<string, string>()
  for (const r of typeRows) {
    nameMap.set(r.slug as string, r.name as string)
  }

  const summary: SubagentUsageSummary = {
    period,
    totalExecutions: 0,
    totalTokens: 0,
    totalCostUsd: 0,
    totalErrors: 0,
    avgIterations: 0,
    avgDurationMs: 0,
    bySubagent: {},
  }

  let totalIterationsWeighted = 0
  let totalDurationWeighted = 0

  for (const row of rows) {
    const executions = parseInt(row.executions, 10)
    const tokens = parseInt(row.total_tokens, 10)
    const cost = parseFloat(row.total_cost)
    const errors = parseInt(row.total_errors, 10)
    const avgIter = parseFloat(row.avg_iterations)
    const avgDur = parseFloat(row.avg_duration)
    const successCount = parseInt(row.success_count, 10)

    summary.totalExecutions += executions
    summary.totalTokens += tokens
    summary.totalCostUsd += cost
    summary.totalErrors += errors
    totalIterationsWeighted += avgIter * executions
    totalDurationWeighted += avgDur * executions

    summary.bySubagent[row.subagent_slug] = {
      name: nameMap.get(row.subagent_slug) ?? row.subagent_slug,
      executions,
      tokens,
      costUsd: cost,
      errors,
      avgIterations: Math.round(avgIter * 10) / 10,
      avgDurationMs: Math.round(avgDur),
      successRate: executions > 0 ? Math.round((successCount / executions) * 100) : 0,
    }
  }

  if (summary.totalExecutions > 0) {
    summary.avgIterations = Math.round((totalIterationsWeighted / summary.totalExecutions) * 10) / 10
    summary.avgDurationMs = Math.round(totalDurationWeighted / summary.totalExecutions)
  }

  return summary
}
