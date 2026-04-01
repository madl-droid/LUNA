-- Knowledge optimization: dedup tracking, value evaluation, full video, pending_review

-- Attachment dedup + value tracking
ALTER TABLE attachment_extractions ADD COLUMN IF NOT EXISTS content_hash TEXT;
ALTER TABLE attachment_extractions ADD COLUMN IF NOT EXISTS knowledge_match_id UUID;
ALTER TABLE attachment_extractions ADD COLUMN IF NOT EXISTS is_valuable BOOLEAN DEFAULT false;
ALTER TABLE attachment_extractions ADD COLUMN IF NOT EXISTS value_confidence REAL;
ALTER TABLE attachment_extractions ADD COLUMN IF NOT EXISTS value_signals TEXT[];
CREATE INDEX IF NOT EXISTS idx_ae_content_hash ON attachment_extractions(content_hash);

-- YouTube full video embed toggle
ALTER TABLE knowledge_items ADD COLUMN IF NOT EXISTS full_video_embed BOOLEAN DEFAULT false;
