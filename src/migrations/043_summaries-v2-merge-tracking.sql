-- Add merged_to_memory_at to session_summaries_v2 so nightly batch
-- can track which v2 summaries have been merged to contact_memory.
ALTER TABLE session_summaries_v2
  ADD COLUMN IF NOT EXISTS merged_to_memory_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_session_summaries_v2_unmerged
  ON session_summaries_v2 (merged_to_memory_at) WHERE merged_to_memory_at IS NULL;
