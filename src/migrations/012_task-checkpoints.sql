-- 012: Task checkpoint system for resumable pipeline execution
-- Allows long multi-step pipelines to survive crashes and resume from last completed step

-- Main checkpoint table: one row per pipeline execution
CREATE TABLE IF NOT EXISTS task_checkpoints (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  trace_id      TEXT NOT NULL,
  message_id    TEXT NOT NULL,
  contact_id    TEXT,
  agent_id      TEXT NOT NULL,
  channel       TEXT NOT NULL,

  -- Pipeline phase tracking (1-5)
  current_phase SMALLINT NOT NULL DEFAULT 1,
  status        TEXT NOT NULL DEFAULT 'running'
                CHECK (status IN ('running', 'completed', 'failed', 'resuming')),

  -- Serialized state for resume
  message_payload   JSONB NOT NULL,             -- original IncomingMessage (needed to re-enter pipeline)
  phase1_result     JSONB,                      -- ContextBundle essentials (contact, session, agent, etc.)
  phase2_result     JSONB,                      -- EvaluatorOutput
  phase3_result     JSONB,                      -- ExecutionOutput (partial or complete)
  phase4_result     JSONB,                      -- CompositorOutput
  step_results      JSONB NOT NULL DEFAULT '[]', -- Array of StepResult for completed steps in Phase 3

  -- Metadata
  replan_attempt    SMALLINT NOT NULL DEFAULT 0,
  error             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at      TIMESTAMPTZ,

  -- Prevent duplicate active checkpoints for same message
  CONSTRAINT uq_checkpoint_message UNIQUE (message_id, status)
);

-- Indexes for resume queries and cleanup
CREATE INDEX IF NOT EXISTS idx_checkpoints_status ON task_checkpoints (status) WHERE status IN ('running', 'resuming');
CREATE INDEX IF NOT EXISTS idx_checkpoints_created ON task_checkpoints (created_at);
CREATE INDEX IF NOT EXISTS idx_checkpoints_contact ON task_checkpoints (contact_id) WHERE contact_id IS NOT NULL;
