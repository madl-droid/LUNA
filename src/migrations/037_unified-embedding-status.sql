-- Migration 037: Unified embedding status
-- Replaces boolean has_embedding with granular embedding_status + retry tracking
-- on both knowledge_chunks and session_memory_chunks tables.
-- PG is source of truth for embedding state; Redis/BullMQ is only dispatch.

-- ══════════════════════════════════════════════
-- 1. knowledge_chunks — add missing unified columns
-- ══════════════════════════════════════════════

-- Linking columns (session_memory_chunks already has these)
ALTER TABLE knowledge_chunks ADD COLUMN IF NOT EXISTS source_id TEXT;
ALTER TABLE knowledge_chunks ADD COLUMN IF NOT EXISTS chunk_total INT;
ALTER TABLE knowledge_chunks ADD COLUMN IF NOT EXISTS prev_chunk_id UUID;
ALTER TABLE knowledge_chunks ADD COLUMN IF NOT EXISTS next_chunk_id UUID;
ALTER TABLE knowledge_chunks ADD COLUMN IF NOT EXISTS content_type TEXT;
ALTER TABLE knowledge_chunks ADD COLUMN IF NOT EXISTS media_refs JSONB;
ALTER TABLE knowledge_chunks ADD COLUMN IF NOT EXISTS extra_metadata JSONB;
ALTER TABLE knowledge_chunks ADD COLUMN IF NOT EXISTS mime_type TEXT;

-- Embedding status columns
ALTER TABLE knowledge_chunks ADD COLUMN IF NOT EXISTS embedding_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE knowledge_chunks ADD COLUMN IF NOT EXISTS retry_count INT NOT NULL DEFAULT 0;
ALTER TABLE knowledge_chunks ADD COLUMN IF NOT EXISTS last_error TEXT;
ALTER TABLE knowledge_chunks ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ;

-- Migrate existing data: has_embedding = true → embedded, false → pending
UPDATE knowledge_chunks SET embedding_status = 'embedded' WHERE has_embedding = true AND embedding_status = 'pending';

-- Index for queue recovery scan (startup + periodic)
CREATE INDEX IF NOT EXISTS idx_kc_embedding_status ON knowledge_chunks(embedding_status) WHERE embedding_status != 'embedded';

-- Linking indexes
CREATE INDEX IF NOT EXISTS idx_kc_source ON knowledge_chunks(source_id) WHERE source_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_kc_linking ON knowledge_chunks(prev_chunk_id, next_chunk_id) WHERE prev_chunk_id IS NOT NULL OR next_chunk_id IS NOT NULL;

-- ══════════════════════════════════════════════
-- 2. session_memory_chunks — add embedding status columns
-- ══════════════════════════════════════════════

ALTER TABLE session_memory_chunks ADD COLUMN IF NOT EXISTS embedding_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE session_memory_chunks ADD COLUMN IF NOT EXISTS retry_count INT NOT NULL DEFAULT 0;
ALTER TABLE session_memory_chunks ADD COLUMN IF NOT EXISTS last_error TEXT;
ALTER TABLE session_memory_chunks ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ;

-- Migrate existing data
UPDATE session_memory_chunks SET embedding_status = 'embedded' WHERE has_embedding = true AND embedding_status = 'pending';

-- Index for queue recovery scan
CREATE INDEX IF NOT EXISTS idx_smc_embedding_status ON session_memory_chunks(embedding_status) WHERE embedding_status != 'embedded';
