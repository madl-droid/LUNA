-- Migration 042: Drive Folder Index
-- Índice recursivo de archivos en carpetas de Google Drive para knowledge items.
-- Permite crawl completo, detección de cambios y sync incremental.

CREATE TABLE IF NOT EXISTS knowledge_folder_index (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id        UUID NOT NULL REFERENCES knowledge_items(id) ON DELETE CASCADE,
  file_id        TEXT NOT NULL,              -- Google Drive file/folder ID
  name           TEXT NOT NULL,
  mime_type      TEXT NOT NULL,
  path           TEXT NOT NULL,             -- ruta relativa desde raíz: "Subcarpeta/archivo.pdf"
  parent_id      TEXT,                      -- Drive parent folder ID
  is_folder      BOOLEAN NOT NULL DEFAULT false,
  modified_time  TIMESTAMPTZ,
  web_view_link  TEXT,
  content_hash   TEXT,                      -- md5Checksum del archivo (para detección de cambios)
  document_id    UUID REFERENCES knowledge_documents(id) ON DELETE SET NULL,
  status         TEXT NOT NULL DEFAULT 'pending',  -- pending, processed, error, skipped
  error_message  TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),

  UNIQUE(item_id, file_id)                  -- un archivo/carpeta aparece una sola vez por item
);

CREATE INDEX IF NOT EXISTS idx_folder_index_item    ON knowledge_folder_index(item_id);
CREATE INDEX IF NOT EXISTS idx_folder_index_status  ON knowledge_folder_index(item_id, status);
CREATE INDEX IF NOT EXISTS idx_folder_index_doc     ON knowledge_folder_index(document_id) WHERE document_id IS NOT NULL;
