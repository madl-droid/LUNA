-- Migration 041: Add model_used column to voice_calls
-- Tracks which Gemini model was actually used for each call (primary or fallback)
-- Note: voice_calls is created by twilio-voice module init(), which may not have run yet.
-- Guard with IF EXISTS to avoid aborting all migrations.

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'voice_calls') THEN
    ALTER TABLE voice_calls ADD COLUMN IF NOT EXISTS model_used TEXT;
  END IF;
END $$;
