// LUNA — Module: prompts — PostgreSQL queries

import type { Pool } from 'pg'
import type { PromptRecord, PromptSlot } from './types.js'

// ─── prompt_slots table ─────────────────────

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

// Campaign management has been moved to the marketing-data module.
// See: src/modules/marketing-data/campaign-queries.ts
