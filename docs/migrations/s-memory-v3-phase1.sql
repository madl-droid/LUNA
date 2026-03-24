-- LUNA Memory V3 — Phase 1: Additive migrations
-- Only ADD columns and CREATE tables. No DROP. Safe to run on live DB.
-- Run AFTER phase0.

-- ═══════════════════════════════════════════
-- contacts — ADD new columns
-- ═══════════════════════════════════════════
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS first_name TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS last_name TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS email TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS phone TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS company_id UUID REFERENCES companies(id);
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS job_title TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS country TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS city TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS timezone TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS preferred_language TEXT DEFAULT 'es';
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS preferred_channel TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS preferred_hours JSONB;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS contact_origin TEXT;
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS custom_data JSONB NOT NULL DEFAULT '{}';
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS first_seen_at TIMESTAMPTZ DEFAULT now();
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS last_interaction_at TIMESTAMPTZ;

-- Update contact_type CHECK to new values (drop old, add new)
-- Note: we use a DO block because ALTER TABLE ... DROP CONSTRAINT IF EXISTS is not standard
DO $$
BEGIN
  ALTER TABLE contacts DROP CONSTRAINT IF EXISTS contacts_contact_type_check;
  ALTER TABLE contacts ADD CONSTRAINT contacts_contact_type_check
    CHECK (contact_type IN ('unknown', 'lead', 'client_active', 'client_former', 'team_internal', 'provider', 'blocked'));
EXCEPTION WHEN OTHERS THEN
  NULL; -- ignore if constraint doesn't exist
END $$;

-- Indexes for new columns
CREATE INDEX IF NOT EXISTS idx_contacts_email ON contacts (email) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_phone ON contacts (phone) WHERE phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contacts_company_id ON contacts (company_id) WHERE company_id IS NOT NULL;

-- Ensure updated_at trigger exists on contacts
DROP TRIGGER IF EXISTS trg_contacts_updated_at ON contacts;
CREATE TRIGGER trg_contacts_updated_at
  BEFORE UPDATE ON contacts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ═══════════════════════════════════════════
-- contact_channels — ADD new columns, backfill
-- ═══════════════════════════════════════════
ALTER TABLE contact_channels ADD COLUMN IF NOT EXISTS channel_type TEXT;
ALTER TABLE contact_channels ADD COLUMN IF NOT EXISTS channel_identifier TEXT;
ALTER TABLE contact_channels ADD COLUMN IF NOT EXISTS last_used_at TIMESTAMPTZ;
ALTER TABLE contact_channels ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';

-- Backfill new columns from old
UPDATE contact_channels
SET channel_type = channel_name,
    channel_identifier = channel_contact_id
WHERE channel_type IS NULL;

-- ═══════════════════════════════════════════
-- sessions — ADD new columns
-- ═══════════════════════════════════════════
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS agent_id UUID REFERENCES agents(id);
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS channel_type TEXT;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS channel_identifier TEXT;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'active'
  CHECK (status IN ('active', 'closed', 'compressed'));
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS email_thread_id TEXT;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS call_sid TEXT;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS call_duration_seconds INTEGER;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS campaign_id TEXT;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS last_message_at TIMESTAMPTZ;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS compressed_at TIMESTAMPTZ;

-- Backfill agent_id with default luna agent
UPDATE sessions
SET agent_id = (SELECT id FROM agents WHERE slug = 'luna' LIMIT 1)
WHERE agent_id IS NULL;

-- Backfill channel_type, channel_identifier, last_message_at
UPDATE sessions
SET channel_type = channel_name,
    channel_identifier = channel_contact_id,
    last_message_at = last_activity_at
WHERE channel_type IS NULL;

-- ═══════════════════════════════════════════
-- messages — ADD new columns (dual-write period)
-- ═══════════════════════════════════════════
ALTER TABLE messages ADD COLUMN IF NOT EXISTS agent_id UUID REFERENCES agents(id);
ALTER TABLE messages ADD COLUMN IF NOT EXISTS role TEXT CHECK (role IN ('user', 'assistant', 'system'));
ALTER TABLE messages ADD COLUMN IF NOT EXISTS content_text TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS content_type TEXT DEFAULT 'text'
  CHECK (content_type IN ('text', 'image', 'audio', 'document', 'location', 'sticker', 'video'));
ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_path TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_mime TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS media_analysis TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS intent TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS emotion TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS tokens_used INTEGER;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS latency_ms INTEGER;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS model_used TEXT;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS token_count INTEGER;
ALTER TABLE messages ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';

-- Backfill agent_id, role, content_text from old columns
UPDATE messages
SET agent_id = (SELECT id FROM agents WHERE slug = 'luna' LIMIT 1)
WHERE agent_id IS NULL;

UPDATE messages
SET role = CASE
  WHEN sender_type = 'agent' THEN 'assistant'
  WHEN sender_type = 'user' THEN 'user'
  ELSE 'user'
END
WHERE role IS NULL;

UPDATE messages
SET content_text = COALESCE(content->>'text', content::text)
WHERE content_text IS NULL;

-- ═══════════════════════════════════════════
-- agent_contacts — Datos privados agente↔contacto
-- ═══════════════════════════════════════════
CREATE TABLE IF NOT EXISTS agent_contacts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id            UUID NOT NULL REFERENCES agents(id),
  contact_id          UUID NOT NULL REFERENCES contacts(id),
  lead_status         TEXT NOT NULL DEFAULT 'unknown'
                      CHECK (lead_status IN ('unknown', 'new', 'qualifying', 'qualified', 'scheduled',
                             'attended', 'converted', 'out_of_zone', 'not_interested', 'cold', 'blocked')),
  qualification_data  JSONB NOT NULL DEFAULT '{}',
  qualification_score NUMERIC(5,2) DEFAULT 0,
  agent_data          JSONB NOT NULL DEFAULT '{}',
  assigned_to         TEXT,
  assigned_at         TIMESTAMPTZ,
  follow_up_count     INTEGER NOT NULL DEFAULT 0,
  last_follow_up_at   TIMESTAMPTZ,
  next_follow_up_at   TIMESTAMPTZ,
  source_campaign     TEXT,
  source_channel      TEXT,
  contact_memory      JSONB NOT NULL DEFAULT '{"summary":"","key_facts":[],"preferences":{},"important_dates":[],"relationship_notes":""}',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (agent_id, contact_id)
);

CREATE INDEX IF NOT EXISTS idx_agent_contacts_agent ON agent_contacts (agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_contacts_contact ON agent_contacts (contact_id);
CREATE INDEX IF NOT EXISTS idx_agent_contacts_lead_status ON agent_contacts (agent_id, lead_status);
CREATE INDEX IF NOT EXISTS idx_agent_contacts_follow_up ON agent_contacts (agent_id, next_follow_up_at)
  WHERE next_follow_up_at IS NOT NULL;

CREATE TRIGGER trg_agent_contacts_updated_at
  BEFORE UPDATE ON agent_contacts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Backfill agent_contacts from contacts qualification data
INSERT INTO agent_contacts (agent_id, contact_id, lead_status, qualification_data, qualification_score)
SELECT
  (SELECT id FROM agents WHERE slug = 'luna' LIMIT 1),
  c.id,
  COALESCE(c.qualification_status, 'new'),
  COALESCE(c.qualification_data, '{}'),
  COALESCE(c.qualification_score, 0)
FROM contacts c
WHERE c.contact_type = 'lead'
ON CONFLICT (agent_id, contact_id) DO NOTHING;

-- ═══════════════════════════════════════════
-- session_summaries — Nivel Tibio (compressed sessions)
-- ═══════════════════════════════════════════
CREATE TABLE IF NOT EXISTS session_summaries (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id              UUID NOT NULL REFERENCES sessions(id),
  agent_id                UUID NOT NULL REFERENCES agents(id),
  contact_id              UUID NOT NULL REFERENCES contacts(id),
  channel_identifier      TEXT,
  summary_text            TEXT NOT NULL,
  summary_language        TEXT NOT NULL DEFAULT 'es',
  key_facts               JSONB NOT NULL DEFAULT '[]',
  structured_data         JSONB NOT NULL DEFAULT '{}',
  search_vector           TSVECTOR,
  embedding               vector(1536),
  original_message_count  INTEGER NOT NULL,
  model_used              TEXT NOT NULL,
  compression_tokens      INTEGER,
  interaction_started_at  TIMESTAMPTZ NOT NULL,
  interaction_closed_at   TIMESTAMPTZ NOT NULL,
  merged_to_memory_at     TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_session_summaries_contact_created
  ON session_summaries (contact_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_session_summaries_agent_contact
  ON session_summaries (agent_id, contact_id);
CREATE INDEX IF NOT EXISTS idx_session_summaries_unmerged
  ON session_summaries (merged_to_memory_at) WHERE merged_to_memory_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_session_summaries_search_vector
  ON session_summaries USING GIN (search_vector);
CREATE INDEX IF NOT EXISTS idx_session_summaries_embedding
  ON session_summaries USING hnsw (embedding vector_cosine_ops);

-- FTS dynamic trigger: maps language to PG dictionary
CREATE OR REPLACE FUNCTION session_summaries_fts_trigger()
RETURNS TRIGGER AS $$
DECLARE
  pg_dict REGCONFIG;
BEGIN
  pg_dict := CASE NEW.summary_language
    WHEN 'es' THEN 'spanish'::regconfig
    WHEN 'en' THEN 'english'::regconfig
    WHEN 'pt' THEN 'portuguese'::regconfig
    WHEN 'fr' THEN 'french'::regconfig
    WHEN 'de' THEN 'german'::regconfig
    WHEN 'it' THEN 'italian'::regconfig
    ELSE 'simple'::regconfig
  END;
  NEW.search_vector := to_tsvector(pg_dict, COALESCE(NEW.summary_text, ''));
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_session_summaries_fts ON session_summaries;
CREATE TRIGGER trg_session_summaries_fts
  BEFORE INSERT OR UPDATE OF summary_text, summary_language ON session_summaries
  FOR EACH ROW EXECUTE FUNCTION session_summaries_fts_trigger();

-- Backfill session_summaries from sessions.compressed_summary
INSERT INTO session_summaries (
  session_id, agent_id, contact_id, channel_identifier,
  summary_text, original_message_count, model_used,
  interaction_started_at, interaction_closed_at
)
SELECT
  s.id,
  COALESCE(s.agent_id, (SELECT id FROM agents WHERE slug = 'luna' LIMIT 1)),
  s.contact_id,
  s.channel_contact_id,
  s.compressed_summary,
  s.message_count,
  'legacy-backfill',
  s.started_at,
  s.last_activity_at
FROM sessions s
WHERE s.compressed_summary IS NOT NULL
  AND s.contact_id IS NOT NULL
ON CONFLICT DO NOTHING;

-- ═══════════════════════════════════════════
-- commitments — Compromisos y seguimiento
-- ═══════════════════════════════════════════
CREATE TABLE IF NOT EXISTS commitments (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id          UUID NOT NULL REFERENCES agents(id),
  contact_id        UUID NOT NULL REFERENCES contacts(id),
  session_id        UUID REFERENCES sessions(id),
  commitment_by     TEXT NOT NULL CHECK (commitment_by IN ('agent', 'contact')),
  description       TEXT NOT NULL,
  category          TEXT,
  priority          TEXT DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  commitment_type   TEXT NOT NULL DEFAULT 'action'
                    CHECK (commitment_type IN ('action', 'meeting', 'demo', 'call', 'appointment',
                           'follow_up', 'send_material', 'wait_response')),
  due_at            TIMESTAMPTZ,
  scheduled_at      TIMESTAMPTZ,
  event_starts_at   TIMESTAMPTZ,
  event_ends_at     TIMESTAMPTZ,
  external_id       TEXT,
  external_provider TEXT,
  assigned_to       TEXT,
  status            TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'in_progress', 'waiting', 'done', 'overdue',
                           'no_show', 'cancelled')),
  attempt_count     INTEGER NOT NULL DEFAULT 0,
  last_attempt_at   TIMESTAMPTZ,
  next_check_at     TIMESTAMPTZ,
  blocked_reason    TEXT,
  wait_type         TEXT,
  action_taken      TEXT,
  parent_id         UUID REFERENCES commitments(id),
  sort_order        INTEGER DEFAULT 0,
  watch_metadata    JSONB,
  reminder_sent     BOOLEAN NOT NULL DEFAULT false,
  metadata          JSONB DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_commitments_active
  ON commitments (agent_id, status, due_at)
  WHERE status IN ('pending', 'in_progress', 'waiting');
CREATE INDEX IF NOT EXISTS idx_commitments_contact
  ON commitments (contact_id);
CREATE INDEX IF NOT EXISTS idx_commitments_next_check
  ON commitments (next_check_at)
  WHERE next_check_at IS NOT NULL AND status IN ('pending', 'in_progress', 'waiting');
CREATE INDEX IF NOT EXISTS idx_commitments_events
  ON commitments (agent_id, event_starts_at)
  WHERE commitment_type IN ('meeting', 'demo', 'call', 'appointment')
    AND status IN ('pending', 'in_progress');

CREATE TRIGGER trg_commitments_updated_at
  BEFORE UPDATE ON commitments
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ═══════════════════════════════════════════
-- conversation_archives — Backup legal
-- ═══════════════════════════════════════════
CREATE TABLE IF NOT EXISTS conversation_archives (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id              UUID NOT NULL REFERENCES sessions(id),
  contact_id              UUID NOT NULL REFERENCES contacts(id),
  agent_id                UUID NOT NULL REFERENCES agents(id),
  channel_identifier      TEXT,
  channel_type            TEXT,
  contact_snapshot        JSONB NOT NULL,
  messages                JSONB NOT NULL,
  message_count           INTEGER NOT NULL,
  interaction_started_at  TIMESTAMPTZ NOT NULL,
  interaction_closed_at   TIMESTAMPTZ NOT NULL,
  archived_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_conversation_archives_session
  ON conversation_archives (session_id);
CREATE INDEX IF NOT EXISTS idx_conversation_archives_contact
  ON conversation_archives (contact_id);
CREATE INDEX IF NOT EXISTS idx_conversation_archives_archived_at
  ON conversation_archives (archived_at);

-- ═══════════════════════════════════════════
-- Update schema version
-- ═══════════════════════════════════════════
INSERT INTO system_state (key, value)
VALUES ('schema_version', 'memory-v3-phase1')
ON CONFLICT (key) DO UPDATE SET value = 'memory-v3-phase1', updated_at = now();
