// LUNA Engine — Attachment Extractions Table Migration
// Creates the attachment_extractions table for persisting processed attachments.

import type { Pool } from 'pg'
import pino from 'pino'

const logger = pino({ name: 'engine:attachments:migration' })

/**
 * Run the attachment_extractions table migration.
 * Safe to call multiple times (IF NOT EXISTS).
 */
export async function runAttachmentMigration(db: Pool): Promise<void> {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS attachment_extractions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        session_id UUID NOT NULL,
        contact_id UUID,
        message_id TEXT NOT NULL DEFAULT '',
        channel TEXT NOT NULL DEFAULT '',
        filename TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        size_bytes INTEGER NOT NULL DEFAULT 0,
        category TEXT NOT NULL,
        source_type TEXT NOT NULL,
        extracted_text TEXT,
        llm_text TEXT,
        category_label TEXT NOT NULL DEFAULT '',
        token_estimate INTEGER DEFAULT 0,
        status TEXT NOT NULL,
        injection_risk BOOLEAN DEFAULT false,
        source_ref TEXT,
        created_at TIMESTAMPTZ DEFAULT now()
      )
    `)
    await db.query(`CREATE INDEX IF NOT EXISTS idx_ae_session ON attachment_extractions(session_id)`)
    await db.query(`CREATE INDEX IF NOT EXISTS idx_ae_contact ON attachment_extractions(contact_id)`)
    logger.info('Attachment extractions table migration complete')
  } catch (err) {
    logger.warn({ err }, 'Attachment extractions migration failed (may already exist)')
  }
}
