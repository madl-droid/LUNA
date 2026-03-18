// LUNA — LLM Module PostgreSQL Store
// Tablas: llm_usage (registro de cada llamada), llm_daily_stats (agregados diarios).

import type { Pool } from 'pg'
import pino from 'pino'
import type { UsageRecord, UsageSummary, LLMProviderName } from './types.js'

const logger = pino({ name: 'llm:pg-store' })

/**
 * Create LLM module tables if they don't exist.
 */
export async function ensureTables(db: Pool): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS llm_usage (
      id            BIGSERIAL PRIMARY KEY,
      timestamp     TIMESTAMPTZ NOT NULL DEFAULT now(),
      provider      TEXT NOT NULL,
      model         TEXT NOT NULL,
      task          TEXT NOT NULL,
      input_tokens  INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      duration_ms   INTEGER NOT NULL DEFAULT 0,
      success       BOOLEAN NOT NULL DEFAULT true,
      error         TEXT,
      trace_id      TEXT,
      cost_usd      NUMERIC(10,6) NOT NULL DEFAULT 0,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE INDEX IF NOT EXISTS idx_llm_usage_timestamp ON llm_usage (timestamp);
    CREATE INDEX IF NOT EXISTS idx_llm_usage_provider ON llm_usage (provider, timestamp);
    CREATE INDEX IF NOT EXISTS idx_llm_usage_task ON llm_usage (task, timestamp);

    CREATE TABLE IF NOT EXISTS llm_daily_stats (
      id              SERIAL PRIMARY KEY,
      date            DATE NOT NULL,
      provider        TEXT NOT NULL,
      model           TEXT NOT NULL,
      task            TEXT NOT NULL,
      total_calls     INTEGER NOT NULL DEFAULT 0,
      total_input     BIGINT NOT NULL DEFAULT 0,
      total_output    BIGINT NOT NULL DEFAULT 0,
      total_errors    INTEGER NOT NULL DEFAULT 0,
      total_cost_usd  NUMERIC(10,6) NOT NULL DEFAULT 0,
      avg_duration_ms INTEGER NOT NULL DEFAULT 0,
      UNIQUE(date, provider, model, task)
    );
  `)

  logger.info('LLM tables ensured')
}

/**
 * Insert a single usage record.
 */
export async function insertUsage(db: Pool, record: UsageRecord): Promise<void> {
  try {
    await db.query(
      `INSERT INTO llm_usage (timestamp, provider, model, task, input_tokens, output_tokens,
        duration_ms, success, error, trace_id, cost_usd)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        record.timestamp,
        record.provider,
        record.model,
        record.task,
        record.inputTokens,
        record.outputTokens,
        record.durationMs,
        record.success,
        record.error ?? null,
        record.traceId ?? null,
        record.estimatedCostUsd,
      ],
    )
  } catch (err) {
    // Fire-and-forget — never block on tracking
    logger.error({ err, provider: record.provider, task: record.task }, 'Failed to insert usage record')
  }
}

/**
 * Get usage summary for a time period.
 */
export async function getUsageSummary(
  db: Pool,
  period: 'hour' | 'day' | 'week' | 'month',
): Promise<UsageSummary> {
  const intervals: Record<string, string> = {
    hour: '1 hour',
    day: '1 day',
    week: '7 days',
    month: '30 days',
  }

  const interval = intervals[period]

  const { rows } = await db.query<{
    provider: string
    task: string
    calls: string
    input_tokens: string
    output_tokens: string
    errors: string
    cost_usd: string
  }>(`
    SELECT
      provider,
      task,
      COUNT(*) as calls,
      COALESCE(SUM(input_tokens), 0) as input_tokens,
      COALESCE(SUM(output_tokens), 0) as output_tokens,
      COALESCE(SUM(CASE WHEN NOT success THEN 1 ELSE 0 END), 0) as errors,
      COALESCE(SUM(cost_usd), 0) as cost_usd
    FROM llm_usage
    WHERE timestamp >= now() - interval '${interval}'
    GROUP BY provider, task
  `)

  const summary: UsageSummary = {
    period,
    totalCalls: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalErrors: 0,
    estimatedCostUsd: 0,
    byProvider: {},
    byTask: {},
  }

  for (const row of rows) {
    const calls = parseInt(row.calls, 10)
    const inputTokens = parseInt(row.input_tokens, 10)
    const outputTokens = parseInt(row.output_tokens, 10)
    const errors = parseInt(row.errors, 10)
    const costUsd = parseFloat(row.cost_usd)

    summary.totalCalls += calls
    summary.totalInputTokens += inputTokens
    summary.totalOutputTokens += outputTokens
    summary.totalErrors += errors
    summary.estimatedCostUsd += costUsd

    // By provider
    if (!summary.byProvider[row.provider]) {
      summary.byProvider[row.provider] = { calls: 0, inputTokens: 0, outputTokens: 0, errors: 0, costUsd: 0 }
    }
    const prov = summary.byProvider[row.provider]!
    prov.calls += calls
    prov.inputTokens += inputTokens
    prov.outputTokens += outputTokens
    prov.errors += errors
    prov.costUsd += costUsd

    // By task
    if (!summary.byTask[row.task]) {
      summary.byTask[row.task] = { calls: 0, inputTokens: 0, outputTokens: 0, costUsd: 0 }
    }
    const taskEntry = summary.byTask[row.task]!
    taskEntry.calls += calls
    taskEntry.inputTokens += inputTokens
    taskEntry.outputTokens += outputTokens
    taskEntry.costUsd += costUsd
  }

  return summary
}

/**
 * Get recent errors for a provider.
 */
export async function getRecentErrors(
  db: Pool,
  provider: LLMProviderName,
  limit = 20,
): Promise<Array<{ timestamp: Date; model: string; task: string; error: string }>> {
  const { rows } = await db.query(
    `SELECT timestamp, model, task, error
     FROM llm_usage
     WHERE provider = $1 AND NOT success AND error IS NOT NULL
     ORDER BY timestamp DESC
     LIMIT $2`,
    [provider, limit],
  )
  return rows as Array<{ timestamp: Date; model: string; task: string; error: string }>
}

/**
 * Get average latency for a provider in the last hour.
 */
export async function getAvgLatency(db: Pool, provider: LLMProviderName): Promise<number> {
  const { rows } = await db.query<{ avg: string }>(
    `SELECT COALESCE(AVG(duration_ms), 0) as avg
     FROM llm_usage
     WHERE provider = $1 AND success AND timestamp >= now() - interval '1 hour'`,
    [provider],
  )
  return Math.round(parseFloat(rows[0]?.avg ?? '0'))
}

/**
 * Get today's total cost.
 */
export async function getTodayCost(db: Pool): Promise<number> {
  const { rows } = await db.query<{ total: string }>(
    `SELECT COALESCE(SUM(cost_usd), 0) as total
     FROM llm_usage
     WHERE timestamp >= CURRENT_DATE`,
  )
  return parseFloat(rows[0]?.total ?? '0')
}

/**
 * Get this month's total cost.
 */
export async function getMonthCost(db: Pool): Promise<number> {
  const { rows } = await db.query<{ total: string }>(
    `SELECT COALESCE(SUM(cost_usd), 0) as total
     FROM llm_usage
     WHERE timestamp >= date_trunc('month', CURRENT_DATE)`,
  )
  return parseFloat(rows[0]?.total ?? '0')
}

/**
 * Clean up old usage records.
 */
export async function cleanupOldRecords(db: Pool, retentionDays: number): Promise<number> {
  const { rowCount } = await db.query(
    `DELETE FROM llm_usage WHERE timestamp < now() - interval '1 day' * $1`,
    [retentionDays],
  )
  const deleted = rowCount ?? 0
  if (deleted > 0) {
    logger.info({ deleted, retentionDays }, 'Cleaned up old LLM usage records')
  }
  return deleted
}
