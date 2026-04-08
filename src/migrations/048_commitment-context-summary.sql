-- Commitment context summary: stores conversation context at creation time
-- so the proactive pipeline has rich context when fulfilling the commitment.
ALTER TABLE commitments ADD COLUMN IF NOT EXISTS context_summary TEXT;

-- Follow-up intensity per contact (used by Plan 3, created here for single migration)
-- Values: 'aggressive', 'normal', 'gentle', 'minimal'
ALTER TABLE agent_contacts ADD COLUMN IF NOT EXISTS follow_up_intensity TEXT NOT NULL DEFAULT 'normal';
