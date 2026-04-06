-- Migration 041: Add model_used column to voice_calls
-- Tracks which Gemini model was actually used for each call (primary or fallback)

ALTER TABLE voice_calls
  ADD COLUMN IF NOT EXISTS model_used TEXT;
