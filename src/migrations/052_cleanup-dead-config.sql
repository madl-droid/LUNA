-- Migration 052: Remove orphaned EXECUTION_QUEUE config keys
-- These keys were defined by execution-queue.ts (dead code, now removed).
-- No configSchema declares them and no code reads them.
-- DELETE is idempotent — if the keys don't exist, nothing happens.

DELETE FROM config_store WHERE key LIKE 'EXECUTION_QUEUE_%';
