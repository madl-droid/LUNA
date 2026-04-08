-- Migration 025: Rename legacy phase columns in trace_results
-- Aligns column names with the agentic pipeline architecture (no more Phase 2/3/4).

ALTER TABLE trace_results RENAME COLUMN phase2_ms TO classify_ms;
ALTER TABLE trace_results RENAME COLUMN phase3_ms TO agentic_ms;
ALTER TABLE trace_results RENAME COLUMN phase4_ms TO postprocess_ms;
ALTER TABLE trace_results RENAME COLUMN raw_phase2 TO raw_classify;
ALTER TABLE trace_results RENAME COLUMN raw_phase4 TO raw_postprocess;
