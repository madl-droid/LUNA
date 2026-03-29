-- Migration 013: Subagents v1
-- Sistema de subagents especializados con CRUD, verificación y uso.

-- ═══════════════════════════════════════════
-- Tipos de subagent (CRUD desde consola)
-- ═══════════════════════════════════════════

CREATE TABLE IF NOT EXISTS subagent_types (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            TEXT UNIQUE NOT NULL,
  name            TEXT NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  enabled         BOOLEAN DEFAULT true,
  model_tier      TEXT NOT NULL DEFAULT 'normal' CHECK (model_tier IN ('normal', 'complex')),
  token_budget    INTEGER NOT NULL DEFAULT 100000 CHECK (token_budget >= 5000),
  verify_result   BOOLEAN DEFAULT true,
  can_spawn_children BOOLEAN DEFAULT false,
  allowed_tools   TEXT[] DEFAULT '{}',
  system_prompt   TEXT DEFAULT '',
  sort_order      INTEGER DEFAULT 0,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

-- ═══════════════════════════════════════════
-- Registro de uso de subagents (métricas + costo)
-- ═══════════════════════════════════════════

CREATE TABLE IF NOT EXISTS subagent_usage (
  id                    BIGSERIAL PRIMARY KEY,
  subagent_type_id      UUID REFERENCES subagent_types(id) ON DELETE SET NULL,
  subagent_slug         TEXT NOT NULL,
  trace_id              TEXT,
  iterations            INTEGER NOT NULL DEFAULT 0,
  tokens_used           INTEGER NOT NULL DEFAULT 0,
  duration_ms           INTEGER NOT NULL DEFAULT 0,
  success               BOOLEAN NOT NULL DEFAULT false,
  verified              BOOLEAN DEFAULT false,
  verification_verdict  TEXT,
  child_spawned         BOOLEAN DEFAULT false,
  cost_usd              NUMERIC(10,6) NOT NULL DEFAULT 0,
  error                 TEXT,
  created_at            TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subagent_usage_created ON subagent_usage (created_at);
CREATE INDEX IF NOT EXISTS idx_subagent_usage_type ON subagent_usage (subagent_type_id, created_at);
CREATE INDEX IF NOT EXISTS idx_subagent_usage_slug ON subagent_usage (subagent_slug, created_at);
