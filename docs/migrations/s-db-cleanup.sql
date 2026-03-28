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
