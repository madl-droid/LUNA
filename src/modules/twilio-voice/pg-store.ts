// LUNA — Module: twilio-voice — PostgreSQL Store
// Tablas y operaciones CRUD para voice_calls y voice_call_transcripts.

import type { Pool } from 'pg'
import type { VoiceCallRow, VoiceCallTranscriptRow, CallStatus, CallDirection, TranscriptEntry } from './types.js'

// ═══════════════════════════════════════════
// Table creation
// ═══════════════════════════════════════════

export async function createTables(db: Pool): Promise<void> {
  await db.query(`
    CREATE TABLE IF NOT EXISTS voice_calls (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      call_sid TEXT UNIQUE NOT NULL,
      direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
      from_number TEXT NOT NULL,
      to_number TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'initiated'
        CHECK (status IN ('initiated', 'ringing', 'connecting', 'active', 'completed', 'failed', 'no-answer', 'busy')),
      agent_id TEXT,
      contact_id TEXT,
      started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      connected_at TIMESTAMPTZ,
      ended_at TIMESTAMPTZ,
      duration_seconds INTEGER,
      end_reason TEXT,
      gemini_voice TEXT,
      summary TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)

  await db.query(`
    CREATE TABLE IF NOT EXISTS voice_call_transcripts (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      call_id UUID NOT NULL REFERENCES voice_calls(id) ON DELETE CASCADE,
      speaker TEXT NOT NULL CHECK (speaker IN ('caller', 'agent', 'system')),
      text TEXT NOT NULL,
      timestamp_ms INTEGER NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `)

  // Indexes (IF NOT EXISTS not supported for indexes on all PG versions, use DO block)
  await db.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_voice_calls_contact') THEN
        CREATE INDEX idx_voice_calls_contact ON voice_calls(contact_id);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_voice_calls_started') THEN
        CREATE INDEX idx_voice_calls_started ON voice_calls(started_at);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_voice_calls_status') THEN
        CREATE INDEX idx_voice_calls_status ON voice_calls(status);
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE indexname = 'idx_voice_transcripts_call') THEN
        CREATE INDEX idx_voice_transcripts_call ON voice_call_transcripts(call_id);
      END IF;
    END $$
  `)
}

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
  summary: string | null,
): Promise<void> {
  await db.query(
    `UPDATE voice_calls
     SET status = 'completed',
         ended_at = now(),
         duration_seconds = EXTRACT(EPOCH FROM (now() - COALESCE(connected_at, started_at)))::INTEGER,
         end_reason = $1,
         summary = $2
     WHERE call_sid = $3`,
    [endReason, summary, callSid],
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
