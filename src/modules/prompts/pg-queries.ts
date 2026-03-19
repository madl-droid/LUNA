// LUNA — Module: prompts — PostgreSQL queries

import type { Pool } from 'pg'
import type { PromptRecord, PromptSlot, CampaignRecord } from './types.js'

// ─── prompt_slots table ─────────────────────

export async function ensureTable(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS prompt_slots (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      slot TEXT NOT NULL,
      variant TEXT NOT NULL DEFAULT 'default',
      content TEXT NOT NULL DEFAULT '',
      is_generated BOOLEAN DEFAULT false,
      updated_at TIMESTAMPTZ DEFAULT now(),
      created_at TIMESTAMPTZ DEFAULT now(),
      UNIQUE (slot, variant)
    )
  `)
}

export async function getBySlotVariant(
  pool: Pool,
  slot: PromptSlot,
  variant: string,
): Promise<PromptRecord | null> {
  const result = await pool.query(
    `SELECT id, slot, variant, content, is_generated, updated_at
     FROM prompt_slots WHERE slot = $1 AND variant = $2 LIMIT 1`,
    [slot, variant],
  )
  const row = result.rows[0]
  if (!row) return null
  return {
    id: row.id,
    slot: row.slot,
    variant: row.variant,
    content: row.content,
    isGenerated: row.is_generated,
    updatedAt: row.updated_at,
  }
}

export async function upsert(
  pool: Pool,
  slot: PromptSlot,
  variant: string,
  content: string,
  isGenerated = false,
): Promise<void> {
  await pool.query(
    `INSERT INTO prompt_slots (slot, variant, content, is_generated, updated_at)
     VALUES ($1, $2, $3, $4, now())
     ON CONFLICT (slot, variant) DO UPDATE SET
       content = $3, is_generated = $4, updated_at = now()`,
    [slot, variant, content, isGenerated],
  )
}

export async function listAll(pool: Pool): Promise<PromptRecord[]> {
  const result = await pool.query(
    `SELECT id, slot, variant, content, is_generated, updated_at
     FROM prompt_slots ORDER BY slot, variant`,
  )
  return result.rows.map((row: Record<string, unknown>) => ({
    id: row.id as string,
    slot: row.slot as PromptSlot,
    variant: row.variant as string,
    content: row.content as string,
    isGenerated: row.is_generated as boolean,
    updatedAt: row.updated_at as Date,
  }))
}

export async function getBySlot(pool: Pool, slot: PromptSlot): Promise<PromptRecord[]> {
  const result = await pool.query(
    `SELECT id, slot, variant, content, is_generated, updated_at
     FROM prompt_slots WHERE slot = $1 ORDER BY variant`,
    [slot],
  )
  return result.rows.map((row: Record<string, unknown>) => ({
    id: row.id as string,
    slot: row.slot as PromptSlot,
    variant: row.variant as string,
    content: row.content as string,
    isGenerated: row.is_generated as boolean,
    updatedAt: row.updated_at as Date,
  }))
}

// ─── campaigns table (alter existing) ───────

export async function ensureCampaignColumns(pool: Pool): Promise<void> {
  await pool.query(`
    ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS match_phrases JSONB DEFAULT '[]'
  `).catch(() => {
    // Table may not exist yet — non-critical
  })
  await pool.query(`
    ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS match_threshold REAL DEFAULT 0.95
  `).catch(() => {})
  await pool.query(`
    ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS prompt_context TEXT DEFAULT ''
  `).catch(() => {})
}

export async function listCampaigns(pool: Pool): Promise<CampaignRecord[]> {
  try {
    const result = await pool.query(
      `SELECT id, name, match_phrases, match_threshold, prompt_context
       FROM campaigns WHERE active = true ORDER BY name`,
    )
    return result.rows.map((row: Record<string, unknown>) => ({
      id: row.id as string,
      name: row.name as string,
      matchPhrases: Array.isArray(row.match_phrases) ? row.match_phrases as string[] : [],
      matchThreshold: (row.match_threshold as number) ?? 0.95,
      promptContext: (row.prompt_context as string) ?? '',
    }))
  } catch {
    // campaigns table may not exist
    return []
  }
}

export async function listAllCampaigns(pool: Pool): Promise<CampaignRecord[]> {
  try {
    const result = await pool.query(
      `SELECT id, name, match_phrases, match_threshold, prompt_context
       FROM campaigns ORDER BY name`,
    )
    return result.rows.map((row: Record<string, unknown>) => ({
      id: row.id as string,
      name: row.name as string,
      matchPhrases: Array.isArray(row.match_phrases) ? row.match_phrases as string[] : [],
      matchThreshold: (row.match_threshold as number) ?? 0.95,
      promptContext: (row.prompt_context as string) ?? '',
    }))
  } catch {
    return []
  }
}

export async function updateCampaign(
  pool: Pool,
  id: string,
  matchPhrases: string[],
  matchThreshold: number,
  promptContext: string,
): Promise<void> {
  await pool.query(
    `UPDATE campaigns SET match_phrases = $2, match_threshold = $3, prompt_context = $4
     WHERE id = $1`,
    [id, JSON.stringify(matchPhrases), matchThreshold, promptContext],
  )
}

export async function createCampaign(
  pool: Pool,
  name: string,
  matchPhrases: string[],
  matchThreshold: number,
  promptContext: string,
): Promise<string> {
  const result = await pool.query(
    `INSERT INTO campaigns (name, match_phrases, match_threshold, prompt_context, active)
     VALUES ($1, $2, $3, $4, true) RETURNING id`,
    [name, JSON.stringify(matchPhrases), matchThreshold, promptContext],
  )
  return result.rows[0]!.id
}

export async function deleteCampaign(pool: Pool, id: string): Promise<void> {
  await pool.query(`DELETE FROM campaigns WHERE id = $1`, [id])
}
