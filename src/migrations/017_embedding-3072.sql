-- Migration 017: Upgrade embedding column from 1536 to 3072 dimensions
-- Required for gemini-embedding-2-preview which outputs 3072 dims by default.

-- Drop old index (dimension-specific)
DROP INDEX IF EXISTS idx_knowledge_chunks_embedding;

-- Alter column to new dimension
ALTER TABLE knowledge_chunks ALTER COLUMN embedding TYPE vector(3072);

-- Reset all existing embeddings (wrong dimension, need re-embed)
UPDATE knowledge_chunks SET has_embedding = false, embedding = NULL WHERE has_embedding = true;

-- Recreate index with new dimension
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_embedding ON knowledge_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100) WHERE has_embedding = true;
