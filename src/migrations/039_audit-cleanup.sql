-- 039_audit-cleanup.sql
-- Limpieza post-auditoría: columnas obsoletas, índices duplicados, constraints faltantes

-- 1. Índice sobre metadata->>'fileId' en attachment_extractions
--    para queries de drive-capture.ts (AND metadata->>'fileId' = $2)
CREATE INDEX IF NOT EXISTS idx_ae_drive_file_id
  ON attachment_extractions ((metadata->>'fileId'))
  WHERE metadata->>'fileId' IS NOT NULL;

-- 2. Eliminar índices duplicados de knowledge_chunks
--    (migración 016 creó los full-scan; migración 037 creó los partial mejores)
DROP INDEX IF EXISTS idx_knowledge_chunks_source;
DROP INDEX IF EXISTS idx_knowledge_chunks_linking;

-- 3. Reemplazar el índice ivfflat de knowledge_chunks
--    El viejo filtraba por has_embedding; el nuevo filtra por embedding_status
DROP INDEX IF EXISTS idx_knowledge_chunks_embedding;
CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_embedding_v2
  ON knowledge_chunks USING ivfflat (embedding vector_cosine_ops)
  WHERE embedding_status = 'embedded';

-- 4. CHECK constraint en embedding_status para knowledge_chunks
--    (ADD CONSTRAINT IF NOT EXISTS no existe en PG — usar DO block)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_kc_embedding_status'
  ) THEN
    ALTER TABLE knowledge_chunks
      ADD CONSTRAINT chk_kc_embedding_status
      CHECK (embedding_status IN ('pending', 'queued', 'processing', 'embedded', 'done', 'failed', 'pending_review'));
  END IF;
END $$;

-- 5. CHECK constraint en embedding_status para session_memory_chunks
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chk_smc_embedding_status'
  ) THEN
    ALTER TABLE session_memory_chunks
      ADD CONSTRAINT chk_smc_embedding_status
      CHECK (embedding_status IN ('pending', 'queued', 'processing', 'embedded', 'done', 'failed', 'pending_review'));
  END IF;
END $$;

-- 6. Eliminar columna has_embedding de session_memory_chunks
--    (reemplazada por embedding_status; el código TS ya no la escribe)
ALTER TABLE session_memory_chunks
  DROP COLUMN IF EXISTS has_embedding;

-- 7. Eliminar columna has_embedding de knowledge_chunks
ALTER TABLE knowledge_chunks
  DROP COLUMN IF EXISTS has_embedding;
