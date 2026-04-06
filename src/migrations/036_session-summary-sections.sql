-- Add sections column to session_summaries_v2 for thematic chunking
-- Each section = one topic discussed in the session, with its own summary and attachment references.
-- This enables the chunker to split by topic instead of by word count.

ALTER TABLE session_summaries_v2
  ADD COLUMN IF NOT EXISTS sections jsonb;
