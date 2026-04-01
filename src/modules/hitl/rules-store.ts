// hitl/rules-store.ts — CRUD for HITL rules (natural language conditions for LLM evaluator)

import type { Pool } from 'pg'
import type { HitlRule, CreateRuleInput } from './types.js'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToRule(r: any): HitlRule {
  return {
    id: r.id,
    name: r.name,
    condition: r.condition,
    targetRole: r.target_role,
    requestType: r.request_type,
    urgency: r.urgency,
    handoff: r.handoff,
    enabled: r.enabled,
    sortOrder: r.sort_order,
    createdAt: new Date(r.created_at),
    updatedAt: new Date(r.updated_at),
  }
}

export class RulesStore {
  constructor(private readonly db: Pool) {}

  async list(): Promise<HitlRule[]> {
    const { rows } = await this.db.query(
      'SELECT * FROM hitl_rules ORDER BY sort_order ASC, created_at ASC',
    )
    return rows.map(rowToRule)
  }

  async getEnabled(): Promise<HitlRule[]> {
    const { rows } = await this.db.query(
      'SELECT * FROM hitl_rules WHERE enabled = true ORDER BY sort_order ASC',
    )
    return rows.map(rowToRule)
  }

  async getById(id: string): Promise<HitlRule | null> {
    const { rows } = await this.db.query('SELECT * FROM hitl_rules WHERE id = $1', [id])
    return rows[0] ? rowToRule(rows[0]) : null
  }

  async create(input: CreateRuleInput): Promise<HitlRule> {
    const { rows } = await this.db.query(
      `INSERT INTO hitl_rules (name, condition, target_role, request_type, urgency, handoff, enabled)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [
        input.name,
        input.condition,
        input.targetRole,
        input.requestType ?? 'custom',
        input.urgency ?? 'normal',
        input.handoff ?? false,
        input.enabled ?? true,
      ],
    )
    return rowToRule(rows[0]!)
  }

  async update(id: string, fields: Partial<CreateRuleInput & { sortOrder: number }>): Promise<HitlRule | null> {
    const sets: string[] = []
    const params: unknown[] = []
    let idx = 1

    if (fields.name !== undefined) { sets.push(`name = $${idx++}`); params.push(fields.name) }
    if (fields.condition !== undefined) { sets.push(`condition = $${idx++}`); params.push(fields.condition) }
    if (fields.targetRole !== undefined) { sets.push(`target_role = $${idx++}`); params.push(fields.targetRole) }
    if (fields.requestType !== undefined) { sets.push(`request_type = $${idx++}`); params.push(fields.requestType) }
    if (fields.urgency !== undefined) { sets.push(`urgency = $${idx++}`); params.push(fields.urgency) }
    if (fields.handoff !== undefined) { sets.push(`handoff = $${idx++}`); params.push(fields.handoff) }
    if (fields.enabled !== undefined) { sets.push(`enabled = $${idx++}`); params.push(fields.enabled) }
    if (fields.sortOrder !== undefined) { sets.push(`sort_order = $${idx++}`); params.push(fields.sortOrder) }

    if (sets.length === 0) return this.getById(id)

    sets.push('updated_at = NOW()')
    params.push(id)

    const { rows } = await this.db.query(
      `UPDATE hitl_rules SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      params,
    )
    return rows[0] ? rowToRule(rows[0]) : null
  }

  async remove(id: string): Promise<boolean> {
    const { rowCount } = await this.db.query('DELETE FROM hitl_rules WHERE id = $1', [id])
    return (rowCount ?? 0) > 0
  }

  /**
   * Format enabled rules as bullet points for LLM evaluator injection.
   * Returns empty string if no rules are enabled.
   */
  async getRulesForEvaluator(): Promise<string> {
    const rules = await this.getEnabled()
    if (rules.length === 0) return ''

    const lines = rules.map(r => {
      const parts = [`- ${r.condition}`]
      parts.push(`→ request_human_help(target_role="${r.targetRole}", request_type="${r.requestType}", urgency="${r.urgency}")`)
      if (r.handoff) parts.push('[HANDOFF]')
      return parts.join(' ')
    })

    return `HITL RULES:\n${lines.join('\n')}`
  }
}
