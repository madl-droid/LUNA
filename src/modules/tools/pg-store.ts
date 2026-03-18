// LUNA — Module: tools — PostgreSQL store
// Tablas: tools (registro + settings), tool_access_rules, tool_executions (log)

import type { Pool } from 'pg'
import pino from 'pino'
import type {
  ToolSettings,
  ToolAccessRule,
  ToolExecutionLog,
  ToolDefinition,
  ToolParameterSchema,
} from './types.js'

const logger = pino({ name: 'tools:pg-store' })

const CREATE_TABLES_SQL = `
CREATE TABLE IF NOT EXISTS tools (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT UNIQUE NOT NULL,
  display_name  TEXT NOT NULL,
  description   TEXT NOT NULL,
  category      TEXT NOT NULL DEFAULT 'general',
  source_module TEXT NOT NULL,
  enabled       BOOLEAN NOT NULL DEFAULT true,
  max_retries   INTEGER NOT NULL DEFAULT 2,
  max_uses_per_loop INTEGER NOT NULL DEFAULT 3,
  parameters    JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tools_name ON tools(name);
CREATE INDEX IF NOT EXISTS idx_tools_enabled ON tools(enabled);
CREATE INDEX IF NOT EXISTS idx_tools_source ON tools(source_module);

CREATE TABLE IF NOT EXISTS tool_access_rules (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_name     TEXT NOT NULL REFERENCES tools(name) ON DELETE CASCADE,
  contact_type  TEXT NOT NULL,
  allowed       BOOLEAN NOT NULL DEFAULT true,
  UNIQUE(tool_name, contact_type)
);

CREATE TABLE IF NOT EXISTS tool_executions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tool_name     TEXT NOT NULL,
  message_id    TEXT,
  contact_id    TEXT,
  input         JSONB,
  output        JSONB,
  status        TEXT NOT NULL CHECK (status IN ('running', 'success', 'failed', 'timeout')),
  error         TEXT,
  duration_ms   INTEGER,
  retries       INTEGER DEFAULT 0,
  created_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tool_exec_tool ON tool_executions(tool_name);
CREATE INDEX IF NOT EXISTS idx_tool_exec_created ON tool_executions(created_at);
`

export class PgStore {
  constructor(private pool: Pool) {}

  async ensureTable(): Promise<void> {
    const client = await this.pool.connect()
    try {
      await client.query(CREATE_TABLES_SQL)
      logger.info('PostgreSQL tools tables ensured')
    } finally {
      client.release()
    }
  }

  async upsertTool(
    name: string,
    displayName: string,
    description: string,
    category: string,
    sourceModule: string,
    parameters: ToolParameterSchema,
  ): Promise<void> {
    await this.pool.query(
      `INSERT INTO tools (name, display_name, description, category, source_module, parameters)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (name) DO UPDATE SET
         display_name = EXCLUDED.display_name,
         description = EXCLUDED.description,
         category = EXCLUDED.category,
         parameters = EXCLUDED.parameters,
         updated_at = NOW()`,
      [name, displayName, description, category, sourceModule, JSON.stringify(parameters)],
    )
  }

  async getToolSettings(name: string): Promise<ToolSettings | null> {
    const result = await this.pool.query(
      `SELECT name, enabled, max_retries, max_uses_per_loop
       FROM tools WHERE name = $1`,
      [name],
    )
    if (result.rows.length === 0) return null
    const row = result.rows[0]
    return {
      toolName: row.name,
      enabled: row.enabled,
      maxRetries: row.max_retries,
      maxUsesPerLoop: row.max_uses_per_loop,
    }
  }

  async listToolsByModule(sourceModule: string): Promise<Array<{
    name: string
    displayName: string
    description: string
    category: string
    enabled: boolean
    maxRetries: number
    maxUsesPerLoop: number
  }>> {
    const result = await this.pool.query(
      `SELECT name, display_name, description, category, enabled, max_retries, max_uses_per_loop
       FROM tools WHERE source_module = $1 ORDER BY name`,
      [sourceModule],
    )
    return result.rows.map((row) => ({
      name: row.name,
      displayName: row.display_name,
      description: row.description,
      category: row.category,
      enabled: row.enabled,
      maxRetries: row.max_retries,
      maxUsesPerLoop: row.max_uses_per_loop,
    }))
  }

  async updateToolSettings(
    name: string,
    updates: { enabled?: boolean; maxRetries?: number; maxUsesPerLoop?: number },
  ): Promise<void> {
    const sets: string[] = []
    const values: unknown[] = []
    let idx = 1

    if (updates.enabled !== undefined) {
      sets.push(`enabled = $${idx++}`)
      values.push(updates.enabled)
    }
    if (updates.maxRetries !== undefined) {
      sets.push(`max_retries = $${idx++}`)
      values.push(updates.maxRetries)
    }
    if (updates.maxUsesPerLoop !== undefined) {
      sets.push(`max_uses_per_loop = $${idx++}`)
      values.push(updates.maxUsesPerLoop)
    }

    if (sets.length === 0) return

    sets.push(`updated_at = NOW()`)
    values.push(name)

    await this.pool.query(
      `UPDATE tools SET ${sets.join(', ')} WHERE name = $${idx}`,
      values,
    )
  }

  async listEnabledTools(): Promise<ToolDefinition[]> {
    const result = await this.pool.query(
      `SELECT name, display_name, description, category, source_module, parameters
       FROM tools WHERE enabled = true ORDER BY name`,
    )
    return result.rows.map((row) => ({
      name: row.name,
      displayName: row.display_name,
      description: row.description,
      category: row.category,
      sourceModule: row.source_module,
      parameters: row.parameters as ToolParameterSchema,
    }))
  }

  async getAccessRules(toolName: string): Promise<ToolAccessRule[]> {
    const result = await this.pool.query(
      `SELECT tool_name, contact_type, allowed
       FROM tool_access_rules WHERE tool_name = $1`,
      [toolName],
    )
    return result.rows.map((row) => ({
      toolName: row.tool_name,
      contactType: row.contact_type,
      allowed: row.allowed,
    }))
  }

  async setAccessRule(toolName: string, contactType: string, allowed: boolean): Promise<void> {
    await this.pool.query(
      `INSERT INTO tool_access_rules (tool_name, contact_type, allowed)
       VALUES ($1, $2, $3)
       ON CONFLICT (tool_name, contact_type) DO UPDATE SET allowed = EXCLUDED.allowed`,
      [toolName, contactType, allowed],
    )
  }

  async deleteAccessRule(toolName: string, contactType: string): Promise<void> {
    await this.pool.query(
      `DELETE FROM tool_access_rules WHERE tool_name = $1 AND contact_type = $2`,
      [toolName, contactType],
    )
  }

  logExecution(data: {
    toolName: string
    messageId?: string
    contactId?: string
    input?: Record<string, unknown>
    output?: unknown
    status: 'running' | 'success' | 'failed' | 'timeout'
    error?: string
    durationMs?: number
    retries?: number
  }): void {
    // Fire-and-forget — no bloquea pipeline
    this.pool.query(
      `INSERT INTO tool_executions (tool_name, message_id, contact_id, input, output, status, error, duration_ms, retries)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        data.toolName,
        data.messageId ?? null,
        data.contactId ?? null,
        data.input ? JSON.stringify(data.input) : null,
        data.output ? JSON.stringify(data.output) : null,
        data.status,
        data.error ?? null,
        data.durationMs ?? null,
        data.retries ?? 0,
      ],
    ).catch((err) => {
      logger.error({ err, toolName: data.toolName }, 'Failed to log tool execution')
    })
  }

  async getRecentExecutions(toolName?: string, limit = 50): Promise<ToolExecutionLog[]> {
    let query: string
    let params: unknown[]

    if (toolName) {
      query = `SELECT id, tool_name, message_id, contact_id, input, output, status, error, duration_ms, retries, created_at
               FROM tool_executions WHERE tool_name = $1 ORDER BY created_at DESC LIMIT $2`
      params = [toolName, limit]
    } else {
      query = `SELECT id, tool_name, message_id, contact_id, input, output, status, error, duration_ms, retries, created_at
               FROM tool_executions ORDER BY created_at DESC LIMIT $1`
      params = [limit]
    }

    const result = await this.pool.query(query, params)
    return result.rows.map((row) => ({
      id: row.id,
      toolName: row.tool_name,
      messageId: row.message_id,
      contactId: row.contact_id,
      input: row.input,
      output: row.output,
      status: row.status,
      error: row.error,
      durationMs: row.duration_ms,
      retries: row.retries,
      createdAt: new Date(row.created_at),
    }))
  }

  async cleanupOldTools(activeToolNames: string[]): Promise<number> {
    if (activeToolNames.length === 0) {
      const result = await this.pool.query(`DELETE FROM tools`)
      return result.rowCount ?? 0
    }

    const placeholders = activeToolNames.map((_, i) => `$${i + 1}`).join(', ')
    const result = await this.pool.query(
      `DELETE FROM tools WHERE name NOT IN (${placeholders})`,
      activeToolNames,
    )
    const deleted = result.rowCount ?? 0
    if (deleted > 0) {
      logger.info({ deleted }, 'Cleaned up stale tools from DB')
    }
    return deleted
  }
}
