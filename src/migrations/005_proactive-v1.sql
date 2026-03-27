-- ═══════════════════════════════════════════
-- LUNA Proactive System v1 — Migration
-- Extends commitments table + creates proactive_outreach_log
-- ═══════════════════════════════════════════

-- 1. Extend commitments table with proactive fields
ALTER TABLE commitments
  ADD COLUMN IF NOT EXISTS requires_tool     TEXT,
  ADD COLUMN IF NOT EXISTS auto_cancel_at    TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS created_via       TEXT DEFAULT 'tool' CHECK (created_via IN ('tool', 'auto_detect'));

-- Relax commitment_type check constraint to support dynamic types from proactive.json
ALTER TABLE commitments DROP CONSTRAINT IF EXISTS commitments_commitment_type_check;
-- No replacement constraint — types are validated at application level from proactive.json

-- Add failed status to allowed statuses
ALTER TABLE commitments DROP CONSTRAINT IF EXISTS commitments_status_check;
ALTER TABLE commitments ADD CONSTRAINT commitments_status_check
  CHECK (status IN ('pending', 'in_progress', 'waiting', 'done', 'overdue', 'no_show', 'cancelled', 'failed'));

-- Index for auto-cancel scanning
CREATE INDEX IF NOT EXISTS idx_commitments_auto_cancel
  ON commitments (auto_cancel_at)
  WHERE auto_cancel_at IS NOT NULL AND status IN ('pending', 'in_progress', 'overdue');

-- Index for proactive commitment scanner (due_at based)
CREATE INDEX IF NOT EXISTS idx_commitments_due
  ON commitments (due_at)
  WHERE due_at IS NOT NULL AND status IN ('pending', 'overdue');

-- 2. Create proactive_outreach_log table
CREATE TABLE IF NOT EXISTS proactive_outreach_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id      UUID NOT NULL REFERENCES contacts(id),
  trigger_type    TEXT NOT NULL CHECK (trigger_type IN ('follow_up', 'reminder', 'commitment', 'reactivation')),
  trigger_id      UUID,
  channel         TEXT NOT NULL CHECK (channel IN ('whatsapp', 'email')),
  action_taken    TEXT NOT NULL CHECK (action_taken IN ('sent', 'no_action', 'blocked', 'error')),
  guard_blocked   TEXT,
  message_id      UUID,
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_outreach_log_contact_time
  ON proactive_outreach_log (contact_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_outreach_log_dedup
  ON proactive_outreach_log (contact_id, trigger_type, created_at DESC)
  WHERE action_taken = 'sent';

-- 3. Update schema version
INSERT INTO system_state (key, value)
VALUES ('schema_version', 'proactive-v1')
ON CONFLICT (key) DO UPDATE SET value = 'proactive-v1', updated_at = now();
