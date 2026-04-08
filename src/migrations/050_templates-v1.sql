-- Migration 048: Document Templates v1
-- Plantillas de documentos y documentos generados desde plantillas.

-- Tabla de plantillas registradas por el admin
CREATE TABLE IF NOT EXISTS doc_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT DEFAULT '',
  doc_type TEXT NOT NULL CHECK (doc_type IN ('comparativo', 'cotizacion', 'presentacion', 'otro')),
  drive_file_id TEXT NOT NULL,
  mime_type TEXT NOT NULL CHECK (mime_type IN ('document', 'spreadsheet', 'presentation')),
  keys JSONB NOT NULL DEFAULT '[]',
  folder_pattern TEXT DEFAULT '',
  sharing_mode TEXT NOT NULL DEFAULT 'anyone_with_link'
    CHECK (sharing_mode IN ('anyone_with_link', 'requester_only')),
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Tabla de documentos generados desde plantillas
CREATE TABLE IF NOT EXISTS doc_generated (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID NOT NULL REFERENCES doc_templates(id),
  contact_id TEXT,
  requester_sender_id TEXT,
  requester_channel TEXT,
  drive_file_id TEXT NOT NULL,
  drive_folder_id TEXT,
  web_view_link TEXT NOT NULL,
  doc_name TEXT NOT NULL,
  key_values JSONB NOT NULL DEFAULT '{}',
  doc_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'created'
    CHECK (status IN ('created', 'shared', 'archived')),
  tags JSONB DEFAULT '{}',
  version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Índices para búsqueda eficiente
CREATE INDEX IF NOT EXISTS idx_doc_generated_template ON doc_generated(template_id);
CREATE INDEX IF NOT EXISTS idx_doc_generated_contact ON doc_generated(contact_id);
CREATE INDEX IF NOT EXISTS idx_doc_generated_type ON doc_generated(doc_type);
CREATE INDEX IF NOT EXISTS idx_doc_generated_tags ON doc_generated USING gin(tags);
CREATE INDEX IF NOT EXISTS idx_doc_templates_type ON doc_templates(doc_type);
CREATE INDEX IF NOT EXISTS idx_doc_templates_enabled ON doc_templates(enabled) WHERE enabled = true;
