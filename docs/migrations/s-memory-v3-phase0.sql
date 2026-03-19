-- LUNA Memory V3 — Phase 0: Infrastructure base
-- Creates foundation tables without breaking existing functionality.
-- Run BEFORE phase1.

-- ═══════════════════════════════════════════
-- pgvector extension for embeddings
-- ═══════════════════════════════════════════
CREATE EXTENSION IF NOT EXISTS vector;

-- ═══════════════════════════════════════════
-- Reusable trigger function for updated_at
-- ═══════════════════════════════════════════
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ═══════════════════════════════════════════
-- agents — Registro de agentes
-- ═══════════════════════════════════════════
CREATE TABLE IF NOT EXISTS agents (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          TEXT UNIQUE NOT NULL,
  name          TEXT NOT NULL,
  description   TEXT,
  status        TEXT NOT NULL DEFAULT 'active'
                CHECK (status IN ('active', 'paused', 'disabled')),
  config_path   TEXT NOT NULL,
  owned_fields  JSONB NOT NULL DEFAULT '[]',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER trg_agents_updated_at
  BEFORE UPDATE ON agents
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Insert default agent
INSERT INTO agents (slug, name, description, config_path)
VALUES ('luna', 'LUNA', 'Agente principal de ventas', 'instance/config.json')
ON CONFLICT (slug) DO NOTHING;

-- ═══════════════════════════════════════════
-- companies — Empresas B2B
-- ═══════════════════════════════════════════
CREATE TABLE IF NOT EXISTS companies (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  domain      TEXT,
  industry    TEXT,
  country     TEXT,
  city        TEXT,
  notes       TEXT,
  metadata    JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_domain
  ON companies (lower(domain)) WHERE domain IS NOT NULL;

CREATE TRIGGER trg_companies_updated_at
  BEFORE UPDATE ON companies
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ═══════════════════════════════════════════
-- system_state — Key-value runtime state
-- ═══════════════════════════════════════════
CREATE TABLE IF NOT EXISTS system_state (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  updated_at  TIMESTAMPTZ DEFAULT now()
);

INSERT INTO system_state (key, value)
VALUES ('schema_version', 'memory-v3-phase0')
ON CONFLICT (key) DO UPDATE SET value = 'memory-v3-phase0', updated_at = now();

-- ═══════════════════════════════════════════
-- pipeline_logs — Observabilidad del pipeline
-- ═══════════════════════════════════════════
CREATE TABLE IF NOT EXISTS pipeline_logs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id      UUID REFERENCES messages(id) ON DELETE SET NULL,
  agent_id        UUID NOT NULL REFERENCES agents(id),
  contact_id      UUID NOT NULL REFERENCES contacts(id),
  session_id      UUID REFERENCES sessions(id),
  phase1_ms       INTEGER,
  phase2_ms       INTEGER,
  phase2_result   JSONB,
  phase3_ms       INTEGER,
  phase3_result   JSONB,
  phase4_ms       INTEGER,
  phase5_ms       INTEGER,
  total_ms        INTEGER,
  tokens_input    INTEGER,
  tokens_output   INTEGER,
  estimated_cost  NUMERIC(10,6),
  models_used     TEXT[],
  tools_called    TEXT[],
  had_subagent    BOOLEAN DEFAULT false,
  had_fallback    BOOLEAN DEFAULT false,
  error           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pipeline_logs_agent_created
  ON pipeline_logs (agent_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pipeline_logs_contact
  ON pipeline_logs (contact_id, created_at DESC);
