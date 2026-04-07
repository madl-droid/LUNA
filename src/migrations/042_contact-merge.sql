-- Migration 042: Contact merge support
-- contact_merge_log para auditoría de merges
-- merged_into column en contacts para soft-delete de contactos mergeados

-- Soft-delete field: contacto absorbido apunta al contacto que lo absorbió
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS merged_into UUID REFERENCES contacts(id);

-- Log de merges para auditoría
CREATE TABLE IF NOT EXISTS contact_merge_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  keep_contact_id UUID NOT NULL REFERENCES contacts(id),
  merge_contact_id UUID NOT NULL,
  reason TEXT,
  merged_by TEXT DEFAULT 'agent',
  merged_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_contact_merge_log_keep ON contact_merge_log(keep_contact_id);
CREATE INDEX IF NOT EXISTS idx_contact_merge_log_merge ON contact_merge_log(merge_contact_id);
CREATE INDEX IF NOT EXISTS idx_contacts_merged_into ON contacts(merged_into) WHERE merged_into IS NOT NULL;
