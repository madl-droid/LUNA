-- Migration 040: Unify embedding_status vocabulary — 'done' → 'embedded'
-- Part of fix-plan-audio-attachments-2 GRUPO I
-- Converts legacy 'done' values to the canonical 'embedded' status.

UPDATE knowledge_chunks SET embedding_status = 'embedded' WHERE embedding_status = 'done';
UPDATE knowledge_documents SET embedding_status = 'embedded' WHERE embedding_status = 'done';
UPDATE session_memory_chunks SET embedding_status = 'embedded' WHERE embedding_status = 'done';
