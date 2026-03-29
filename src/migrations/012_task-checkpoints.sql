-- 012: Task checkpoint system for resumable Phase 3 execution plans
-- When Phase 2 generates a multi-step plan, checkpoints track which steps
-- completed so Phase 3 can skip them on retry after a crash.

CREATE TABLE IF NOT EXISTS task_checkpoints (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trace_id        TEXT NOT NULL,
  message_id      TEXT NOT NULL,
  contact_id      TEXT,
  channel         TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'running'
                  CHECK (status IN ('running', 'completed', 'failed')),

  -- Minimal message payload for resume (~200 bytes)
  message_from    TEXT NOT NULL,
  message_text    TEXT,

  -- Phase 3 execution state
  execution_plan  JSONB NOT NULL DEFAULT '[]',     -- ExecutionStep[] from Phase 2
  step_results    JSONB NOT NULL DEFAULT '[]',     -- StepResult[] completed so far

  error           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Fast lookup for resume on startup
CREATE INDEX IF NOT EXISTS idx_checkpoints_status
  ON task_checkpoints (status) WHERE status = 'running';

-- Cleanup of old rows
CREATE INDEX IF NOT EXISTS idx_checkpoints_created
  ON task_checkpoints (created_at);
