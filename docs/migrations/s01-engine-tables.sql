-- LUNA Engine — Database Migration S01
-- Creates core domain tables: contacts, contact_channels, sessions, messages.
-- Run against PostgreSQL. All tables use UUID primary keys.

-- ═══════════════════════════════════════════
-- Contacts — unified contact identity
-- ═══════════════════════════════════════════
CREATE TABLE IF NOT EXISTS contacts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name    TEXT,
  contact_type    TEXT DEFAULT 'lead',  -- lead, client, provider, team
  qualification_status TEXT DEFAULT 'new',  -- new, qualifying, qualified, scheduled, attended, converted, out_of_zone, not_interested, cold, blocked
  qualification_score  INTEGER DEFAULT 0,
  qualification_data   JSONB DEFAULT '{}',
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contacts_qualification_status ON contacts (qualification_status);
CREATE INDEX IF NOT EXISTS idx_contacts_contact_type ON contacts (contact_type);

-- ═══════════════════════════════════════════
-- Contact Channels — links contact to channel-specific IDs
-- ═══════════════════════════════════════════
CREATE TABLE IF NOT EXISTS contact_channels (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id          UUID NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  channel_name        TEXT NOT NULL,  -- whatsapp, email, instagram, messenger
  channel_contact_id  TEXT NOT NULL,  -- phone number, email address, etc.
  is_primary          BOOLEAN DEFAULT true,
  created_at          TIMESTAMPTZ DEFAULT now(),
  UNIQUE (channel_name, channel_contact_id)
);

CREATE INDEX IF NOT EXISTS idx_contact_channels_contact_id ON contact_channels (contact_id);
CREATE INDEX IF NOT EXISTS idx_contact_channels_lookup ON contact_channels (channel_contact_id, channel_name);

-- ═══════════════════════════════════════════
-- Sessions — conversation sessions
-- ═══════════════════════════════════════════
CREATE TABLE IF NOT EXISTS sessions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id            UUID REFERENCES contacts(id) ON DELETE SET NULL,
  channel_contact_id    TEXT,  -- for sessions before contact is created
  channel_name          TEXT NOT NULL,
  started_at            TIMESTAMPTZ DEFAULT now(),
  last_activity_at      TIMESTAMPTZ DEFAULT now(),
  message_count         INTEGER DEFAULT 0,
  compressed_summary    TEXT,
  metadata              JSONB DEFAULT '{}',
  created_at            TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sessions_contact_id ON sessions (contact_id);
CREATE INDEX IF NOT EXISTS idx_sessions_last_activity ON sessions (last_activity_at DESC);
CREATE INDEX IF NOT EXISTS idx_sessions_channel_lookup ON sessions (channel_contact_id, channel_name);

-- ═══════════════════════════════════════════
-- Messages — all messages (incoming + outgoing)
-- ═══════════════════════════════════════════
CREATE TABLE IF NOT EXISTS messages (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id      UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  channel_name    TEXT NOT NULL,
  sender_type     TEXT NOT NULL,  -- user, agent
  sender_id       TEXT NOT NULL,
  content         JSONB NOT NULL,  -- {type, text, mediaUrl, ...}
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_messages_session_created ON messages (session_id, created_at);

-- ═══════════════════════════════════════════
-- Campaigns — marketing campaigns for tracking
-- ═══════════════════════════════════════════
CREATE TABLE IF NOT EXISTS campaigns (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT NOT NULL,
  keyword         TEXT,
  destination_number TEXT,
  utm_data        JSONB DEFAULT '{}',
  active          BOOLEAN DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_campaigns_keyword ON campaigns (keyword) WHERE keyword IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_campaigns_active ON campaigns (active) WHERE active = true;
