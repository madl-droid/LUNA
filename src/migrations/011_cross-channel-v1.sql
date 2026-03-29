-- Migration 011: Cross-channel follow-up support
-- ═══════════════════════════════════════════
-- Relaxes channel constraint on proactive_outreach_log to support all channels.

-- 1. Drop old constraint (only allowed whatsapp, email)
ALTER TABLE proactive_outreach_log DROP CONSTRAINT IF EXISTS proactive_outreach_log_channel_check;

-- 2. Add relaxed constraint to support all current and future channels
ALTER TABLE proactive_outreach_log ADD CONSTRAINT proactive_outreach_log_channel_check
  CHECK (channel IN ('whatsapp', 'email', 'google-chat', 'voice', 'instagram', 'messenger'));
