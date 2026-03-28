-- LUNA — Database cleanup migration
-- Safe, idempotent operations: drop unused tables, add missing indexes.
-- Run AFTER all prior migrations (s-memory-v3-phase0/1, s-proactive-v1, etc.)

-- ═══════════════════════════════════════════════════════
-- 1. Drop unused tables
-- ═══════════════════════════════════════════════════════

-- system_state: created in phase0, never used in application code
DROP TABLE IF EXISTS system_state;

-- user_lists_backup: remnant from users module migration (user_lists → users + user_contacts)
DROP TABLE IF EXISTS user_lists_backup;

-- ═══════════════════════════════════════════════════════
-- 2. Missing indexes for frequently-used query patterns
-- ═══════════════════════════════════════════════════════

-- Composite index for lead-scoring filters: WHERE contact_type = 'lead' AND qualification_status = ...
CREATE INDEX IF NOT EXISTS idx_contacts_type_status
  ON contacts (contact_type, qualification_status);

-- Commitments lookup by contact_id (proactive cross-agent query, guards)
CREATE INDEX IF NOT EXISTS idx_commitments_contact_status
  ON commitments (contact_id, status)
  WHERE status IN ('pending', 'in_progress', 'waiting');

-- Pipeline logs purge: DELETE WHERE created_at < ... (no agent_id in WHERE)
CREATE INDEX IF NOT EXISTS idx_pipeline_logs_created
  ON pipeline_logs (created_at);

-- Conversation archives purge: DELETE WHERE archived_at < ...
CREATE INDEX IF NOT EXISTS idx_conversation_archives_archived
  ON conversation_archives (archived_at);

-- Sessions by contact + status (lead detail, proactive session lookup)
CREATE INDEX IF NOT EXISTS idx_sessions_contact_status
  ON sessions (contact_id, status);

-- ═══════════════════════════════════════════════════════
-- 3. Drop deprecated columns (code migrated to new columns)
-- ═══════════════════════════════════════════════════════

-- 3a. messages: old columns replaced by role, content_text, agent_id
ALTER TABLE messages DROP COLUMN IF EXISTS sender_type;
ALTER TABLE messages DROP COLUMN IF EXISTS sender_id;
ALTER TABLE messages DROP COLUMN IF EXISTS content;
ALTER TABLE messages DROP COLUMN IF EXISTS channel_name;

-- 3b. contact_channels: old columns replaced by channel_type, channel_identifier
ALTER TABLE contact_channels DROP COLUMN IF EXISTS channel_name;
ALTER TABLE contact_channels DROP COLUMN IF EXISTS channel_contact_id;

-- Enforce NOT NULL on new columns
ALTER TABLE contact_channels ALTER COLUMN channel_type SET NOT NULL;
ALTER TABLE contact_channels ALTER COLUMN channel_identifier SET NOT NULL;

-- Replace old unique constraint with new one
ALTER TABLE contact_channels DROP CONSTRAINT IF EXISTS contact_channels_channel_name_channel_contact_id_key;
ALTER TABLE contact_channels ADD CONSTRAINT contact_channels_channel_type_identifier_key
  UNIQUE (channel_type, channel_identifier);

-- 3c. sessions: compressed_summary replaced by session_summaries table
ALTER TABLE sessions DROP COLUMN IF EXISTS compressed_summary;

-- ═══════════════════════════════════════════════════════
-- NOTE: contacts.qualification_* columns NOT dropped here.
-- Lead-scoring still writes directly to contacts table.
-- Requires future refactor to unify with agent_contacts.
-- ═══════════════════════════════════════════════════════
