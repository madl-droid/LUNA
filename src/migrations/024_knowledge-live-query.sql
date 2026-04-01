-- Migration 024: Add live_query_enabled to knowledge_items
-- Allows the agent to query Google Sheets/Docs/Slides/Drive items live via API
-- instead of (or in addition to) relying on indexed embeddings.
-- Default false — set to true automatically on create for Google API source types.

ALTER TABLE knowledge_items
  ADD COLUMN IF NOT EXISTS live_query_enabled boolean NOT NULL DEFAULT false;
