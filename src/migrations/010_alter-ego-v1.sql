-- 010: Trace — Simulation & Testing subsystem for Cortex
-- 3 tables: scenarios, runs, results

-- Scenario definitions
CREATE TABLE IF NOT EXISTS trace_scenarios (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  description TEXT,
  config      JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trace_scenarios_created
  ON trace_scenarios (created_at DESC);

-- Simulation runs (batch of N simulations)
CREATE TABLE IF NOT EXISTS trace_runs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scenario_id      UUID NOT NULL REFERENCES trace_scenarios(id) ON DELETE CASCADE,
  variant_name     TEXT NOT NULL DEFAULT 'baseline',
  status           TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending', 'running', 'analyzing', 'completed', 'failed', 'cancelled')),
  sim_count        SMALLINT NOT NULL DEFAULT 1,
  admin_context    TEXT NOT NULL,
  config           JSONB,
  started_at       TIMESTAMPTZ,
  completed_at     TIMESTAMPTZ,
  progress         JSONB DEFAULT '{"completed": 0, "total": 0, "analyzing": 0}',
  summary          JSONB,
  synthesis        TEXT,
  synthesis_model  TEXT,
  tokens_input     INTEGER DEFAULT 0,
  tokens_output    INTEGER DEFAULT 0,
  error            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trace_runs_scenario
  ON trace_runs (scenario_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trace_runs_status
  ON trace_runs (status, created_at DESC);

-- Individual simulation results per message
CREATE TABLE IF NOT EXISTS trace_results (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id          UUID NOT NULL REFERENCES trace_runs(id) ON DELETE CASCADE,
  sim_index       SMALLINT NOT NULL DEFAULT 0,
  message_index   SMALLINT NOT NULL,
  message_text    TEXT NOT NULL,
  -- Phase 2 output
  intent          TEXT,
  emotion         TEXT,
  tools_planned   TEXT[],
  execution_plan  JSONB,
  injection_risk  BOOLEAN,
  on_scope        BOOLEAN,
  -- Phase 3 output (tool execution)
  tools_executed  JSONB,
  -- Phase 4 output
  response_text   TEXT,
  -- Timing & tokens
  phase2_ms       INTEGER,
  phase3_ms       INTEGER,
  phase4_ms       INTEGER,
  total_ms        INTEGER,
  tokens_input    INTEGER DEFAULT 0,
  tokens_output   INTEGER DEFAULT 0,
  -- Raw LLM outputs
  raw_phase2      JSONB,
  raw_phase4      TEXT,
  -- Analyst LLM output
  analysis        TEXT,
  analysis_model  TEXT,
  analysis_tokens INTEGER DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trace_results_run
  ON trace_results (run_id, sim_index, message_index);
