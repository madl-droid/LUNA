-- Migration 025: Rename legacy phase columns in trace_results
-- Aligns column names with the agentic pipeline architecture (no more Phase 2/3/4).
-- Wrapped in DO blocks with IF EXISTS guards to be safe on instances where
-- the cortex module already created the table with the new column names.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'trace_results' AND column_name = 'phase2_ms') THEN
    ALTER TABLE trace_results RENAME COLUMN phase2_ms TO classify_ms;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'trace_results' AND column_name = 'phase3_ms') THEN
    ALTER TABLE trace_results RENAME COLUMN phase3_ms TO agentic_ms;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'trace_results' AND column_name = 'phase4_ms') THEN
    ALTER TABLE trace_results RENAME COLUMN phase4_ms TO postprocess_ms;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'trace_results' AND column_name = 'raw_phase2') THEN
    ALTER TABLE trace_results RENAME COLUMN raw_phase2 TO raw_classify;
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'trace_results' AND column_name = 'raw_phase4') THEN
    ALTER TABLE trace_results RENAME COLUMN raw_phase4 TO raw_postprocess;
  END IF;
END $$;
