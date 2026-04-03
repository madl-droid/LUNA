-- LUNA - Remove legacy agent_id columns after single-agent refactor
-- Drops physical columns now that all runtime code is contact-based.

BEGIN;

-- Drop old agent_id indexes explicitly when they exist.
DROP INDEX IF EXISTS idx_agent_contacts_agent;
DROP INDEX IF EXISTS idx_agent_contacts_lead_status;
DROP INDEX IF EXISTS idx_agent_contacts_follow_up;
DROP INDEX IF EXISTS idx_session_summaries_agent_contact;
DROP INDEX IF EXISTS idx_commitments_active;
DROP INDEX IF EXISTS idx_commitments_events;
DROP INDEX IF EXISTS idx_pipeline_logs_agent_created;

-- Recreate useful replacements without agent_id.
CREATE INDEX IF NOT EXISTS idx_agent_contacts_lead_status
  ON agent_contacts (lead_status);
CREATE INDEX IF NOT EXISTS idx_agent_contacts_follow_up
  ON agent_contacts (next_follow_up_at)
  WHERE next_follow_up_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_session_summaries_contact
  ON session_summaries (contact_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_commitments_active
  ON commitments (status, due_at)
  WHERE status IN ('pending', 'in_progress', 'waiting');
CREATE INDEX IF NOT EXISTS idx_commitments_events
  ON commitments (event_starts_at)
  WHERE commitment_type IN ('meeting', 'demo', 'call', 'appointment')
    AND status IN ('pending', 'in_progress');
CREATE INDEX IF NOT EXISTS idx_pipeline_logs_created
  ON pipeline_logs (created_at DESC);

ALTER TABLE sessions DROP COLUMN IF EXISTS agent_id CASCADE;
ALTER TABLE messages DROP COLUMN IF EXISTS agent_id CASCADE;
ALTER TABLE session_summaries DROP COLUMN IF EXISTS agent_id CASCADE;
ALTER TABLE commitments DROP COLUMN IF EXISTS agent_id CASCADE;
ALTER TABLE conversation_archives DROP COLUMN IF EXISTS agent_id CASCADE;
ALTER TABLE pipeline_logs DROP COLUMN IF EXISTS agent_id CASCADE;
ALTER TABLE agent_contacts DROP COLUMN IF EXISTS agent_id CASCADE;
ALTER TABLE voice_calls DROP COLUMN IF EXISTS agent_id CASCADE;
ALTER TABLE hitl_tickets DROP COLUMN IF EXISTS agent_id CASCADE;
ALTER TABLE medilink_audit_log DROP COLUMN IF EXISTS agent_id CASCADE;
ALTER TABLE medilink_edit_requests DROP COLUMN IF EXISTS agent_id CASCADE;
ALTER TABLE medilink_follow_ups DROP COLUMN IF EXISTS agent_id CASCADE;

COMMIT;
