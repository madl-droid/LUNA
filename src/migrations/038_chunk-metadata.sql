-- Migration 038: Unified chunk metadata
-- Adds metadata JSONB column (ChunkMetadata) to both chunk tables.
-- Adds sub-chunk columns to knowledge_chunks for overflow handling.

-- ══════════════════════════════════════════════
-- 1. session_memory_chunks — add metadata JSONB
-- ══════════════════════════════════════════════

ALTER TABLE session_memory_chunks ADD COLUMN IF NOT EXISTS metadata JSONB;

-- ══════════════════════════════════════════════
-- 2. knowledge_chunks — add sub-chunk columns
-- ══════════════════════════════════════════════

ALTER TABLE knowledge_chunks ADD COLUMN IF NOT EXISTS parent_chunk_id UUID;
ALTER TABLE knowledge_chunks ADD COLUMN IF NOT EXISTS sub_chunk_index INT;
ALTER TABLE knowledge_chunks ADD COLUMN IF NOT EXISTS sub_chunk_total INT;

-- Index for sub-chunk lookups
CREATE INDEX IF NOT EXISTS idx_kc_parent_chunk ON knowledge_chunks(parent_chunk_id) WHERE parent_chunk_id IS NOT NULL;

-- ══════════════════════════════════════════════
-- 3. session_memory_chunks — add sub-chunk columns
-- ══════════════════════════════════════════════

ALTER TABLE session_memory_chunks ADD COLUMN IF NOT EXISTS parent_chunk_id UUID;
ALTER TABLE session_memory_chunks ADD COLUMN IF NOT EXISTS sub_chunk_index INT;
ALTER TABLE session_memory_chunks ADD COLUMN IF NOT EXISTS sub_chunk_total INT;

-- Index for sub-chunk lookups
CREATE INDEX IF NOT EXISTS idx_smc_parent_chunk ON session_memory_chunks(parent_chunk_id) WHERE parent_chunk_id IS NOT NULL;
