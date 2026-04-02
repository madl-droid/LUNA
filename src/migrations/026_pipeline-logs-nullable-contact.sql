-- Migration 026: Make pipeline_logs.contact_id nullable
-- Allows pipeline logs to be saved for sessions without a linked contact record
-- (e.g. anonymous users, admin testing, or sessions where contact creation hasn't happened yet)

ALTER TABLE pipeline_logs
  ALTER COLUMN contact_id DROP NOT NULL;

-- Drop the existing NOT NULL foreign key constraint behavior
-- (the FK reference to contacts(id) is preserved, but NULL is now allowed)
