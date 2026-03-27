-- Migration: Rename module 'oficina' to 'console' in kernel_modules table
-- Run BEFORE deploying code with the rename

UPDATE kernel_modules
SET name = 'console'
WHERE name = 'oficina';

-- Update any config_store keys that reference the old module name
UPDATE config_store
SET key = REPLACE(key, 'oficina', 'console')
WHERE key LIKE '%oficina%';
