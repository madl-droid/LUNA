// cortex/pulse/store.ts — PostgreSQL persistence for Pulse reports
// Table: pulse_reports. No TTL — reports are permanent health history.

import type { Pool } from 'pg'
import type { PulseReport, PulseReportMode, PulseReportRow } from '../types.js'

export async function saveReport(
  db: Pool,
  id: string,
  periodStart: Date,
  periodEnd: Date,
  mode: PulseReportMode,
  report: PulseReport,
  modelUsed: string,
  tokensUsed: number,
): Promise<void> {
  await db.query(
    `INSERT INTO pulse_reports (id, period_start, period_end, mode, report_json, model_used, tokens_used)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [id, periodStart, periodEnd, mode, JSON.stringify(report), modelUsed, tokensUsed],
  )
}

export async function getLatestReport(db: Pool): Promise<PulseReportRow | null> {
  const { rows } = await db.query(
    `SELECT id, period_start, period_end, mode, report_json, model_used, tokens_used, created_at
     FROM pulse_reports ORDER BY created_at DESC LIMIT 1`,
  )
  return (rows[0] as PulseReportRow | undefined) ?? null
}

export async function listReports(db: Pool, limit = 20, offset = 0): Promise<PulseReportRow[]> {
  const { rows } = await db.query(
    `SELECT id, period_start, period_end, mode, report_json, model_used, tokens_used, created_at
     FROM pulse_reports ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
    [limit, offset],
  )
  return rows as PulseReportRow[]
}

export async function getReportById(db: Pool, id: string): Promise<PulseReportRow | null> {
  const { rows } = await db.query(
    `SELECT id, period_start, period_end, mode, report_json, model_used, tokens_used, created_at
     FROM pulse_reports WHERE id = $1`,
    [id],
  )
  return (rows[0] as PulseReportRow | undefined) ?? null
}
