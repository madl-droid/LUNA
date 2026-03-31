-- Migration 019: Add dual-result columns to attachment_extractions
-- Supports two extraction results per attachment:
--   1. extracted_text: code-processed text (for embeddings)
--   2. llm_text: LLM-enriched text (vision/STT/multimodal description)
-- Also adds category_label for conversation injection labels.

ALTER TABLE attachment_extractions ADD COLUMN IF NOT EXISTS llm_text TEXT;
ALTER TABLE attachment_extractions ADD COLUMN IF NOT EXISTS category_label TEXT NOT NULL DEFAULT '';
ALTER TABLE attachment_extractions ADD COLUMN IF NOT EXISTS file_path TEXT;
