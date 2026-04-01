-- Session Compression v2: legal archives, LLM summaries, multimodal memory chunks
-- Supports long-term memory with pgvector embeddings and FTS search.

-- ═══════════════════════════════════════════
-- 1. Legal archive of session messages
-- ═══════════════════════════════════════════

CREATE TABLE IF NOT EXISTS session_archives (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      text NOT NULL,
  contact_id      uuid NOT NULL,
  channel         text NOT NULL,
  started_at      timestamptz NOT NULL,
  closed_at       timestamptz NOT NULL,
  message_count   int NOT NULL,
  messages_json   jsonb NOT NULL,
  attachments_meta jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_session_archives_contact ON session_archives(contact_id);
CREATE INDEX IF NOT EXISTS idx_session_archives_session ON session_archives(session_id);

-- ═══════════════════════════════════════════
-- 2. LLM-generated session summaries (v2)
-- ═══════════════════════════════════════════

CREATE TABLE IF NOT EXISTS session_summaries_v2 (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      text NOT NULL UNIQUE,
  contact_id      uuid NOT NULL,
  title           text NOT NULL,
  description     text NOT NULL,
  full_summary    text NOT NULL,
  model_used      text,
  tokens_used     int,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_session_summaries_v2_contact ON session_summaries_v2(contact_id);

-- ═══════════════════════════════════════════
-- 3. Session memory chunks (long-term, multimodal)
-- ═══════════════════════════════════════════

CREATE TABLE IF NOT EXISTS session_memory_chunks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      text NOT NULL,
  contact_id      uuid NOT NULL,
  source_id       text NOT NULL,
  source_type     text NOT NULL,
  content_type    text NOT NULL,
  chunk_index     int NOT NULL,
  chunk_total     int NOT NULL,
  prev_chunk_id   uuid,
  next_chunk_id   uuid,
  content         text,
  media_ref       text,
  mime_type       text,
  extra_metadata  jsonb,
  has_embedding   boolean NOT NULL DEFAULT false,
  embedding       vector(1536),
  tsv             tsvector,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_smc_session ON session_memory_chunks(session_id);
CREATE INDEX IF NOT EXISTS idx_smc_contact ON session_memory_chunks(contact_id);
CREATE INDEX IF NOT EXISTS idx_smc_source ON session_memory_chunks(source_id);
CREATE INDEX IF NOT EXISTS idx_smc_embedding ON session_memory_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX IF NOT EXISTS idx_smc_tsv ON session_memory_chunks USING gin(tsv);

-- ═══════════════════════════════════════════
-- 4. Compression tracking on sessions table
-- ═══════════════════════════════════════════

ALTER TABLE sessions ADD COLUMN IF NOT EXISTS compression_status text DEFAULT NULL;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS compression_error text DEFAULT NULL;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS compressed_at timestamptz DEFAULT NULL;
