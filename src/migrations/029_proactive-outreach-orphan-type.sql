-- Migration 029: Add orphan_recovery to proactive_outreach_log trigger_type constraint
-- ═══════════════════════════════════════════
-- Allows logging of orphan recovery re-dispatches to the outreach log for dedup tracking.

-- 1. Drop old constraint (only allowed: follow_up, reminder, commitment, reactivation)
ALTER TABLE proactive_outreach_log DROP CONSTRAINT IF EXISTS proactive_outreach_log_trigger_type_check;

-- 2. Add relaxed constraint including orphan_recovery
ALTER TABLE proactive_outreach_log ADD CONSTRAINT proactive_outreach_log_trigger_type_check
  CHECK (trigger_type IN ('follow_up', 'reminder', 'commitment', 'reactivation', 'orphan_recovery'));
