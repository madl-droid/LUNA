-- LUNA Memory V3 — Phase 3: Cleanup (DROP old columns)
-- Run ONLY after all code reads from new columns (Phase 2 fully deployed).
-- This is destructive — backup before running.

-- ═══════════════════════════════════════════
-- contacts — DROP migrated qualification columns
-- ═══════════════════════════════════════════
ALTER TABLE contacts DROP COLUMN IF EXISTS qualification_status;
ALTER TABLE contacts DROP COLUMN IF EXISTS qualification_score;
ALTER TABLE contacts DROP COLUMN IF EXISTS qualification_data;

DROP INDEX IF EXISTS idx_contacts_qualification_status;

-- ═══════════════════════════════════════════
-- sessions — DROP old columns, SET NOT NULL on new
-- ═══════════════════════════════════════════
ALTER TABLE sessions DROP COLUMN IF EXISTS compressed_summary;

-- Set NOT NULL on agent_id (backfilled in phase1)
ALTER TABLE sessions ALTER COLUMN agent_id SET NOT NULL;

-- ═══════════════════════════════════════════
-- messages — DROP old columns, SET NOT NULL on new
-- ═══════════════════════════════════════════
ALTER TABLE messages DROP COLUMN IF EXISTS sender_type;
ALTER TABLE messages DROP COLUMN IF EXISTS sender_id;
-- Drop old JSONB content column (renamed to content_text TEXT in phase1)
ALTER TABLE messages DROP COLUMN IF EXISTS content;

-- Set NOT NULL on new required columns
ALTER TABLE messages ALTER COLUMN role SET NOT NULL;
ALTER TABLE messages ALTER COLUMN content_text SET NOT NULL;
ALTER TABLE messages ALTER COLUMN agent_id SET NOT NULL;

-- ═══════════════════════════════════════════
-- contact_channels — DROP old columns
-- ═══════════════════════════════════════════
ALTER TABLE contact_channels DROP COLUMN IF EXISTS channel_name;
ALTER TABLE contact_channels DROP COLUMN IF EXISTS channel_contact_id;

-- Add NOT NULL and unique constraint on new columns
ALTER TABLE contact_channels ALTER COLUMN channel_type SET NOT NULL;
ALTER TABLE contact_channels ALTER COLUMN channel_identifier SET NOT NULL;

-- Replace unique constraint
ALTER TABLE contact_channels DROP CONSTRAINT IF EXISTS contact_channels_channel_name_channel_contact_id_key;
ALTER TABLE contact_channels ADD CONSTRAINT contact_channels_channel_type_identifier_key
  UNIQUE (channel_type, channel_identifier);

-- ═══════════════════════════════════════════
-- Update schema version
-- ═══════════════════════════════════════════
UPDATE system_state SET value = 'memory-v3-phase3', updated_at = now() WHERE key = 'schema_version';
