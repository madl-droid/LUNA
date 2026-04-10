// LUNA — Contact Merge Logic
// Fusiona dos contactos que son la misma persona.
// Mantiene el keep_contact y absorbe canales, sesiones, mensajes y memoria del merge_contact.

import type { Pool, PoolClient } from 'pg'
import pino from 'pino'
import type { ContactMemory } from './types.js'

const logger = pino({ name: 'memory:contact-merge' })

export interface MergeResult {
  success: boolean
  channelsMoved: number
  sessionsMoved: number
  messagesMoved: number
  error?: string
}

/**
 * Merge merge_contact_id into keep_contact_id.
 * Transfers all channels, sessions, messages, and memory to the keep contact.
 * Soft-deletes the merge contact (sets merged_into = keep_contact_id, status = 'merged').
 */
export async function mergeContacts(
  db: Pool,
  keepContactId: string,
  mergeContactId: string,
  reason: string,
  mergedBy: 'agent' | 'system' | 'admin' = 'agent',
): Promise<MergeResult> {
  const client = await db.connect()

  try {
    await client.query('BEGIN')

    // 1. Verify both contacts exist and are different
    const verifyResult = await client.query<{ id: string; merged_into: string | null }>(
      `SELECT id, merged_into FROM contacts WHERE id = ANY($1)`,
      [[keepContactId, mergeContactId]],
    )

    if (verifyResult.rows.length !== 2) {
      await client.query('ROLLBACK')
      return { success: false, channelsMoved: 0, sessionsMoved: 0, messagesMoved: 0, error: 'One or both contacts not found' }
    }

    const keepRow = verifyResult.rows.find((r: { id: string; merged_into: string | null }) => r.id === keepContactId)
    const mergeRow = verifyResult.rows.find((r: { id: string; merged_into: string | null }) => r.id === mergeContactId)

    if (keepRow?.merged_into) {
      await client.query('ROLLBACK')
      return { success: false, channelsMoved: 0, sessionsMoved: 0, messagesMoved: 0, error: 'Keep contact is already merged into another contact' }
    }

    if (mergeRow?.merged_into) {
      await client.query('ROLLBACK')
      return { success: false, channelsMoved: 0, sessionsMoved: 0, messagesMoved: 0, error: 'Merge contact is already merged into another contact' }
    }

    // 2. Move contact_channels (skip duplicates that already exist on keep)
    // First, delete channels from merge that conflict with keep's existing channels
    await client.query(
      `DELETE FROM contact_channels
       WHERE contact_id = $1
         AND (channel_type, channel_identifier) IN (
           SELECT channel_type, channel_identifier FROM contact_channels WHERE contact_id = $2
         )`,
      [mergeContactId, keepContactId],
    )

    const channelsResult = await client.query(
      `UPDATE contact_channels SET contact_id = $1 WHERE contact_id = $2`,
      [keepContactId, mergeContactId],
    )
    const channelsMoved = channelsResult.rowCount ?? 0

    // 3. Move sessions
    const sessionsResult = await client.query(
      `UPDATE sessions SET contact_id = $1 WHERE contact_id = $2`,
      [keepContactId, mergeContactId],
    )
    const sessionsMoved = sessionsResult.rowCount ?? 0

    // 4. Messages inherit contact via sessions (no direct contact_id on messages)
    const messagesMoved = 0

    // FIX-07: Read ALL data first, then write, then delete.
    // Previously, mergeContactMemory deleted merge contact's agent_contacts row,
    // then mergeQualificationData tried to read it — resulting in a no-op.
    // 5. Merge contact_memory from agent_contacts (no longer deletes merge row)
    await mergeContactMemory(client, keepContactId, mergeContactId)

    // 6. Merge qualification data (keep wins on conflict, but take higher score)
    await mergeQualificationData(client, keepContactId, mergeContactId)

    // 6b. Delete merge contact's agent_contacts AFTER both merges complete
    await client.query(`DELETE FROM agent_contacts WHERE contact_id = $1`, [mergeContactId])

    // 7. Copy missing contact info fields (email, phone, display_name) to keep
    await backfillContactInfo(client, keepContactId, mergeContactId)

    // 8. Soft-delete merge contact
    await client.query(
      `UPDATE contacts SET merged_into = $1, updated_at = NOW()
       WHERE id = $2`,
      [keepContactId, mergeContactId],
    )

    // 9. Log the merge for audit
    await client.query(
      `INSERT INTO contact_merge_log (keep_contact_id, merge_contact_id, reason, merged_by)
       VALUES ($1, $2, $3, $4)`,
      [keepContactId, mergeContactId, reason, mergedBy],
    )

    await client.query('COMMIT')

    logger.info({
      keepContactId,
      mergeContactId,
      channelsMoved,
      sessionsMoved,
      messagesMoved,
      reason,
    }, 'Contact merge completed')

    return { success: true, channelsMoved, sessionsMoved, messagesMoved }
  } catch (err) {
    await client.query('ROLLBACK')
    const errorMsg = err instanceof Error ? err.message : String(err)
    logger.error({ err, keepContactId, mergeContactId }, 'Contact merge failed')
    return { success: false, channelsMoved: 0, sessionsMoved: 0, messagesMoved: 0, error: errorMsg }
  } finally {
    client.release()
  }
}

async function mergeContactMemory(
  client: PoolClient,
  keepContactId: string,
  mergeContactId: string,
): Promise<void> {
  // Load both contact memories from agent_contacts
  const result = await client.query<{
    contact_id: string
    contact_memory: ContactMemory
  }>(
    `SELECT contact_id, contact_memory FROM agent_contacts WHERE contact_id = ANY($1)`,
    [[keepContactId, mergeContactId]],
  )

  const keepRow = result.rows.find((r: { contact_id: string; contact_memory: ContactMemory }) => r.contact_id === keepContactId)
  const mergeRow = result.rows.find((r: { contact_id: string; contact_memory: ContactMemory }) => r.contact_id === mergeContactId)

  if (!mergeRow) return  // Nothing to merge from

  const keepMemory: ContactMemory = keepRow?.contact_memory ?? {
    summary: '',
    key_facts: [],
    preferences: {},
    important_dates: [],
    relationship_notes: '',
  }

  const mergeMemory: ContactMemory = mergeRow.contact_memory

  // Merge key_facts (dedup by fact text)
  const existingFacts = new Set(keepMemory.key_facts.map(f => f.fact.toLowerCase()))
  for (const fact of mergeMemory.key_facts) {
    if (!existingFacts.has(fact.fact.toLowerCase())) {
      keepMemory.key_facts.push(fact)
      existingFacts.add(fact.fact.toLowerCase())
    }
  }

  // Merge preferences (keep wins on conflict)
  for (const [key, value] of Object.entries(mergeMemory.preferences ?? {})) {
    if (!(key in keepMemory.preferences)) {
      keepMemory.preferences[key] = value
    }
  }

  // Merge important_dates (dedup by date+what)
  const existingDates = new Set(
    keepMemory.important_dates.map(d => `${d.date}::${d.what}`)
  )
  for (const d of mergeMemory.important_dates ?? []) {
    const key = `${d.date}::${d.what}`
    if (!existingDates.has(key)) {
      keepMemory.important_dates.push(d)
      existingDates.add(key)
    }
  }

  // Merge summaries (append if keep has no summary)
  if (!keepMemory.summary && mergeMemory.summary) {
    keepMemory.summary = mergeMemory.summary
  } else if (keepMemory.summary && mergeMemory.summary) {
    keepMemory.summary = `${keepMemory.summary}\n\n[Historial fusionado]: ${mergeMemory.summary}`
  }

  // Update keep contact's memory (upsert)
  if (keepRow) {
    await client.query(
      `UPDATE agent_contacts SET contact_memory = $1, updated_at = NOW() WHERE contact_id = $2`,
      [JSON.stringify(keepMemory), keepContactId],
    )
  } else {
    await client.query(
      `INSERT INTO agent_contacts (contact_id, contact_memory) VALUES ($1, $2)
       ON CONFLICT (contact_id) DO UPDATE SET contact_memory = $2, updated_at = NOW()`,
      [keepContactId, JSON.stringify(keepMemory)],
    )
  }

  // Note: deletion of merge contact's agent_contacts row is handled by the caller
  // after both mergeContactMemory and mergeQualificationData complete (FIX-07).
}

async function mergeQualificationData(
  client: PoolClient,
  keepContactId: string,
  mergeContactId: string,
): Promise<void> {
  const result = await client.query<{
    contact_id: string
    lead_status: string
    qualification_data: Record<string, unknown>
    qualification_score: number
  }>(
    `SELECT contact_id, lead_status, qualification_data, qualification_score
     FROM agent_contacts WHERE contact_id = ANY($1)`,
    [[keepContactId, mergeContactId]],
  )

  type QualRow = { contact_id: string; lead_status: string; qualification_data: Record<string, unknown>; qualification_score: number }
  const keepRow = result.rows.find((r: QualRow) => r.contact_id === keepContactId)
  const mergeRow = result.rows.find((r: QualRow) => r.contact_id === mergeContactId)

  if (!keepRow || !mergeRow) return

  // Take higher qualification score
  const bestScore = Math.max(keepRow.qualification_score ?? 0, mergeRow.qualification_score ?? 0)

  // Merge qualification_data (keep wins on conflict)
  const mergedData = { ...(mergeRow.qualification_data ?? {}), ...(keepRow.qualification_data ?? {}) }

  await client.query(
    `UPDATE agent_contacts
     SET qualification_score = $1, qualification_data = $2, updated_at = NOW()
     WHERE contact_id = $3`,
    [bestScore, JSON.stringify(mergedData), keepContactId],
  )
}

async function backfillContactInfo(
  client: PoolClient,
  keepContactId: string,
  mergeContactId: string,
): Promise<void> {
  // Copy display_name, email, phone from merge to keep if keep is missing them
  // Use CASE instead of COALESCE to also handle empty strings
  await client.query(
    `UPDATE contacts AS k
     SET
       display_name = CASE WHEN k.display_name IS NULL OR k.display_name = '' THEN m.display_name ELSE k.display_name END,
       email = CASE WHEN k.email IS NULL OR k.email = '' THEN m.email ELSE k.email END,
       phone = CASE WHEN k.phone IS NULL OR k.phone = '' THEN m.phone ELSE k.phone END
     FROM contacts AS m
     WHERE k.id = $1 AND m.id = $2`,
    [keepContactId, mergeContactId],
  )
}

/**
 * Find contacts with a matching channel identifier that differ from current contact.
 * Used by save_contact_data to detect potential duplicates.
 */
export async function findMergeCandidates(
  db: Pool,
  contactId: string,
  channelIdentifier: string,
): Promise<Array<{ contactId: string; displayName: string | null; channelType: string }>> {
  try {
    const result = await db.query<{
      contact_id: string
      display_name: string | null
      channel_type: string
    }>(
      `SELECT c.id AS contact_id, c.display_name, cc.channel_type
       FROM contacts c
       JOIN contact_channels cc ON cc.contact_id = c.id
       WHERE cc.channel_identifier = $1
         AND c.id != $2
         AND c.merged_into IS NULL
       LIMIT 3`,
      [channelIdentifier, contactId],
    )

    return result.rows.map((r: { contact_id: string; display_name: string | null; channel_type: string }) => ({
      contactId: r.contact_id,
      displayName: r.display_name,
      channelType: r.channel_type,
    }))
  } catch {
    return []
  }
}
