-- Migration 053: Drop FK constraint on pipeline_logs.message_id
-- The message INSERT (fire-and-forget via memory-manager) can race against
-- the pipeline_log INSERT, causing FK violations when the message row
-- has not yet been committed.  pipeline_logs is an observability table
-- and does not need referential integrity to messages.

ALTER TABLE pipeline_logs
  DROP CONSTRAINT IF EXISTS pipeline_logs_message_id_fkey;
