-- 041_binary-lifecycle.sql
-- Binary lifecycle tracking for knowledge_documents.
-- Attachments: binaries are safe to delete once all chunks reach a terminal
-- embedding state (embedded or max-retry-failed).
-- Knowledge: binaries persist while the document exists (deleted on doc delete).

ALTER TABLE knowledge_documents
  ADD COLUMN IF NOT EXISTS binary_cleanup_ready BOOLEAN NOT NULL DEFAULT FALSE;

-- Fast lookup for nightly cleanup job
CREATE INDEX IF NOT EXISTS idx_kd_binary_cleanup
  ON knowledge_documents (binary_cleanup_ready)
  WHERE binary_cleanup_ready = TRUE;
