-- Follow-up intensity per contact
-- Values: 'aggressive' (2h/5), 'normal' (4h/3), 'gentle' (12h/2), 'minimal' (24h/1)
-- Default 'normal' preserves existing behaviour for all contacts.
ALTER TABLE agent_contacts ADD COLUMN IF NOT EXISTS follow_up_intensity TEXT NOT NULL DEFAULT 'normal';
