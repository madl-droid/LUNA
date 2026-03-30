-- Migration 016: Smart chunks — type-specific chunking with linking and multimodal support
-- Adds columns for chunk linking, content type dispatch, and media references.

ALTER TABLE knowledge_chunks ADD COLUMN IF NOT EXISTS source_id text;
ALTER TABLE knowledge_chunks ADD COLUMN IF NOT EXISTS chunk_total int;
ALTER TABLE knowledge_chunks ADD COLUMN IF NOT EXISTS prev_chunk_id uuid;
ALTER TABLE knowledge_chunks ADD COLUMN IF NOT EXISTS next_chunk_id uuid;
ALTER TABLE knowledge_chunks ADD COLUMN IF NOT EXISTS content_type text NOT NULL DEFAULT 'text';
ALTER TABLE knowledge_chunks ADD COLUMN IF NOT EXISTS media_refs jsonb;
ALTER TABLE knowledge_chunks ADD COLUMN IF NOT EXISTS extra_metadata jsonb;

-- Index for chunk linking traversal
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_source ON knowledge_chunks(source_id);
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_linking ON knowledge_chunks(prev_chunk_id, next_chunk_id);
