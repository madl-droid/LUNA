-- Migration 014: Email thread-based sessions (Phase 4)
-- Adds thread_id to sessions so Gmail threads map 1:1 to Luna sessions.
-- Phase 1 uses thread_id to find/create the session for a Gmail thread,
-- ensuring all emails in a thread share the same conversation context.

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS thread_id TEXT;

CREATE INDEX IF NOT EXISTS idx_sessions_thread_id
  ON sessions(thread_id)
  WHERE thread_id IS NOT NULL;
