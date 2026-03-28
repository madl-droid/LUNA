// cortex/pulse/store.ts — PostgreSQL persistence for Pulse reports
// Table: pulse_reports. No TTL — reports are permanent health history.

import type { Pool } from 'pg'
import type { PulseReport, PulseReportMode, PulseReportRow } from '../types.js'
import pino from 'pino'

const logger = pino({ name: 'cortex:pulse:store' })

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS pulse_reports (
  id            TEXT PRIMARY KEY,
  period_start  TIMESTAMPTZ NOT NULL,
  period_end    TIMESTAMPTZ NOT NULL,
  mode          TEXT NOT NULL,
  report_json   JSONB NOT NULL,
  model_used    TEXT NOT NULL DEFAULT '',
  tokens_used   INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
)`

const CREATE_INDEX = `
CREATE INDEX IF NOT EXISTS idx_pulse_reports_created ON pulse_reports(created_at DESC)`

export async function ensurePulseTable(db: Pool): Promise<void> {
  try {
    await db.query(CREATE_TABLE)
    await db.query(CREATE_INDEX)
    logger.debug('pulse_reports table ensured')
  } catch (err) {
    logger.error({ err }, 'Failed to create pulse_reports table')
    throw err
  }
}

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
