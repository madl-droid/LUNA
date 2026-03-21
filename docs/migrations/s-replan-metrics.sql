-- Migration: Add replanning + subagent metrics columns to pipeline_logs
-- Related: Replanning loop + subagent iteration tracking

ALTER TABLE pipeline_logs ADD COLUMN IF NOT EXISTS replan_attempts smallint DEFAULT 0;
ALTER TABLE pipeline_logs ADD COLUMN IF NOT EXISTS subagent_iterations smallint DEFAULT 0;
