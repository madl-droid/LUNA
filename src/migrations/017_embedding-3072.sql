-- Migration 017: Reset embeddings for gemini-embedding-2-preview model switch
-- Old model (gemini-embedding-exp-03-07) embeddings are incompatible.
-- Column stays at vector(1536) — model outputs 1536 via outputDimensionality param.

UPDATE knowledge_chunks SET has_embedding = false, embedding = NULL WHERE has_embedding = true;
