-- Knowledge optimization: LLM-generated descriptions + keywords for documents
-- Adds llm_description (auto-generated after content extraction) and keywords (for improved FTS).
-- Admin description preserved in existing 'description' column.

ALTER TABLE knowledge_documents ADD COLUMN IF NOT EXISTS llm_description TEXT;
ALTER TABLE knowledge_documents ADD COLUMN IF NOT EXISTS keywords TEXT[];

ALTER TABLE knowledge_items ADD COLUMN IF NOT EXISTS llm_description TEXT;
ALTER TABLE knowledge_items ADD COLUMN IF NOT EXISTS keywords TEXT[];
