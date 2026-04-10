// LUNA — Module: twilio-voice — PostgreSQL Store
// Tablas y operaciones CRUD para voice_calls y voice_call_transcripts.

import type { Pool } from 'pg'
import type { VoiceCallRow, VoiceCallTranscriptRow, CallStatus, CallDirection, TranscriptEntry } from './types.js'

// ═══════════════════════════════════════════
// voice_calls CRUD
// ═══════════════════════════════════════════

export async function insertCall(
  db: Pool,
  callSid: string,
  direction: CallDirection,
  from: string,
  to: string,
  geminiVoice: string,
): Promise<string> {
  const result = await db.query<{ id: string }>(
    `INSERT INTO voice_calls (call_sid, direction, from_number, to_number, gemini_voice)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [callSid, direction, from, to, geminiVoice],
  )
  return result.rows[0]!.id
}

export async function updateCallStatus(
  db: Pool,
  callSid: string,
  status: CallStatus,
  extra?: { connectedAt?: Date; contactId?: string },
): Promise<void> {
  if (extra?.connectedAt) {
    await db.query(
      `UPDATE voice_calls SET status = $1, connected_at = $2, contact_id = COALESCE($3, contact_id) WHERE call_sid = $4`,
      [status, extra.connectedAt, extra.contactId ?? null, callSid],
    )
  } else {
    await db.query(
      `UPDATE voice_calls SET status = $1, contact_id = COALESCE($2, contact_id) WHERE call_sid = $3`,
      [status, extra?.contactId ?? null, callSid],
    )
  }
}

export async function completeCall(
  db: Pool,
  callSid: string,
  endReason: string,
  modelUsed: string | null = null,
): Promise<void> {
  await db.query(
    `UPDATE voice_calls
     SET status = 'completed',
         ended_at = now(),
         duration_seconds = EXTRACT(EPOCH FROM (now() - COALESCE(connected_at, started_at)))::INTEGER,
         end_reason = $1,
         model_used = $2
     WHERE call_sid = $3`,
    [endReason, modelUsed, callSid],
  )
}

export async function getCall(db: Pool, callId: string): Promise<VoiceCallRow | null> {
  const result = await db.query<VoiceCallRow>(
    `SELECT * FROM voice_calls WHERE id = $1`,
    [callId],
  )
  return result.rows[0] ?? null
}

export async function listCalls(
  db: Pool,
  limit: number = 20,
  offset: number = 0,
  status?: string,
): Promise<{ calls: VoiceCallRow[]; total: number }> {
  const conditions: string[] = []
  const params: unknown[] = []
  let paramIndex = 1

  if (status) {
    conditions.push(`status = $${paramIndex++}`)
    params.push(status)
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

  const countResult = await db.query<{ count: string }>(
    `SELECT COUNT(*) as count FROM voice_calls ${where}`,
    params,
  )

  const dataResult = await db.query<VoiceCallRow>(
    `SELECT * FROM voice_calls ${where} ORDER BY started_at DESC LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
    [...params, limit, offset],
  )

  return {
    calls: dataResult.rows,
    total: parseInt(countResult.rows[0]!.count, 10),
  }
}

// ═══════════════════════════════════════════
// voice_call_transcripts CRUD
// ═══════════════════════════════════════════

export async function insertTranscriptBatch(
  db: Pool,
  callId: string,
  entries: TranscriptEntry[],
): Promise<void> {
  if (entries.length === 0) return

  const values: string[] = []
  const params: unknown[] = []
  let paramIndex = 1

  for (const entry of entries) {
    values.push(`($${paramIndex++}, $${paramIndex++}, $${paramIndex++}, $${paramIndex++})`)
    params.push(callId, entry.speaker, entry.text, entry.timestampMs)
  }

  await db.query(
    `INSERT INTO voice_call_transcripts (call_id, speaker, text, timestamp_ms)
     VALUES ${values.join(', ')}`,
    params,
  )
}

export async function getTranscript(db: Pool, callId: string): Promise<VoiceCallTranscriptRow[]> {
  const result = await db.query<VoiceCallTranscriptRow>(
    `SELECT * FROM voice_call_transcripts WHERE call_id = $1 ORDER BY timestamp_ms ASC`,
    [callId],
  )
  return result.rows
}

// ═══════════════════════════════════════════
// Rate limiting
// ═══════════════════════════════════════════

/**
 * Count recent outbound calls to a given phone number within the last N minutes.
 * Used for outbound rate limiting.
 */
export async function countRecentCalls(
  db: Pool,
  toNumber: string,
  direction: string,
  minutesBack: number,
): Promise<number> {
  const result = await db.query<{ count: string }>(
    `SELECT COUNT(*) as count FROM voice_calls
     WHERE to_number = $1 AND direction = $2
     AND started_at > NOW() - make_interval(mins => $3)`,
    [toNumber, direction, minutesBack],
  )
  return parseInt(result.rows[0]?.count ?? '0', 10)
}

// ═══════════════════════════════════════════
// Stats
// ═══════════════════════════════════════════

export async function getCallStats(
  db: Pool,
  periodStart: Date,
): Promise<{
  totalCalls: number
  completedCalls: number
  avgDurationSeconds: number
  inbound: number
  outbound: number
}> {
  const result = await db.query<{
    total_calls: string
    completed_calls: string
    avg_duration: string | null
    inbound: string
    outbound: string
  }>(
    `SELECT
       COUNT(*) as total_calls,
       COUNT(*) FILTER (WHERE status = 'completed') as completed_calls,
       AVG(duration_seconds) FILTER (WHERE status = 'completed') as avg_duration,
       COUNT(*) FILTER (WHERE direction = 'inbound') as inbound,
       COUNT(*) FILTER (WHERE direction = 'outbound') as outbound
     FROM voice_calls
     WHERE started_at >= $1`,
    [periodStart],
  )

  const row = result.rows[0]!
  return {
    totalCalls: parseInt(row.total_calls, 10),
    completedCalls: parseInt(row.completed_calls, 10),
    avgDurationSeconds: row.avg_duration ? parseFloat(row.avg_duration) : 0,
    inbound: parseInt(row.inbound, 10),
    outbound: parseInt(row.outbound, 10),
  }
}
