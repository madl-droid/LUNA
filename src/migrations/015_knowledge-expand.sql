-- Migration 015: Knowledge module expansion
-- Adds shareable flag, expands source types to support PDF and YouTube

-- Shareable flag: agent can share the source URL with users
ALTER TABLE knowledge_items ADD COLUMN IF NOT EXISTS shareable boolean NOT NULL DEFAULT false;
