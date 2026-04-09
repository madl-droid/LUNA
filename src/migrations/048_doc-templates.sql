-- doc_templates + doc_generated for templates module
CREATE TABLE IF NOT EXISTS doc_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  doc_type TEXT NOT NULL,
  drive_file_id TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL,
  keys JSONB NOT NULL DEFAULT '[]',
  folder_pattern TEXT NOT NULL DEFAULT '',
  sharing_mode TEXT NOT NULL DEFAULT 'anyone_with_link',
  enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS doc_generated (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID NOT NULL REFERENCES doc_templates(id),
  contact_id UUID,
  requester_sender_id TEXT,
  requester_channel TEXT,
  drive_file_id TEXT NOT NULL,
  drive_folder_id TEXT,
  web_view_link TEXT NOT NULL,
  doc_name TEXT NOT NULL,
  key_values JSONB NOT NULL DEFAULT '{}',
  doc_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'created',
  tags JSONB NOT NULL DEFAULT '{}',
  version INT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_doc_generated_template ON doc_generated(template_id);
CREATE INDEX IF NOT EXISTS idx_doc_generated_contact ON doc_generated(contact_id);
CREATE INDEX IF NOT EXISTS idx_doc_generated_doc_type ON doc_generated(doc_type);
