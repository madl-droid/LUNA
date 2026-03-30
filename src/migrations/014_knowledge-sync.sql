-- 014_knowledge-sync.sql
-- Adds per-item sync frequency, change-detection state, ignore flags,
-- and subagent knowledge category access control.

-- Per-item sync frequency (6h, 12h, 24h, 1w, 1m — default 24h)
ALTER TABLE knowledge_items ADD COLUMN IF NOT EXISTS update_frequency text NOT NULL DEFAULT '24h';

-- Last time we checked Drive for changes (null = never checked)
ALTER TABLE knowledge_items ADD COLUMN IF NOT EXISTS last_sync_checked_at timestamptz;

-- Last known Drive modifiedTime string for change detection
ALTER TABLE knowledge_items ADD COLUMN IF NOT EXISTS last_modified_time text;

-- Ignore flag for tabs — ignored tabs are skipped during embedding
ALTER TABLE knowledge_item_tabs ADD COLUMN IF NOT EXISTS ignored boolean NOT NULL DEFAULT false;

-- Ignore flag for columns — ignored columns are excluded from row text
ALTER TABLE knowledge_item_columns ADD COLUMN IF NOT EXISTS ignored boolean NOT NULL DEFAULT false;

-- Subagent knowledge category access (empty = no knowledge injection)
ALTER TABLE subagent_types ADD COLUMN IF NOT EXISTS allowed_knowledge_categories text[] NOT NULL DEFAULT '{}';
