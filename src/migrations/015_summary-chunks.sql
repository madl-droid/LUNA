-- Migration 015: Summary chunks for semantic search (Phase 6)
-- Splits session summaries into semantic chunks with individual embeddings.
-- Enables precise vector search: instead of 1 diluted vector per session,
-- each chunk (paragraph/fact) gets its own embedding for high-precision recall.

CREATE TABLE IF NOT EXISTS summary_chunks (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  summary_id  UUID NOT NULL REFERENCES session_summaries(id) ON DELETE CASCADE,
  contact_id  UUID NOT NULL,
  chunk_text  TEXT NOT NULL,
  chunk_index INTEGER NOT NULL DEFAULT 0,
  embedding   vector(1536),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_summary_chunks_contact
  ON summary_chunks(contact_id);

CREATE INDEX IF NOT EXISTS idx_summary_chunks_summary
  ON summary_chunks(summary_id);

-- HNSW index for vector cosine search (same as session_summaries)
CREATE INDEX IF NOT EXISTS idx_summary_chunks_embedding
  ON summary_chunks USING hnsw (embedding vector_cosine_ops)
  WHERE embedding IS NOT NULL;
