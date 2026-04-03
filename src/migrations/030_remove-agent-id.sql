-- LUNA - Remove practical agent_id dependency for single-agent deployment
-- Keeps columns/tables for compatibility, but normalizes all data to the
-- single 'luna' agent and makes contact_id the effective unique relation key.

DO $$
DECLARE
  luna_agent_id UUID;
BEGIN
  SELECT id INTO luna_agent_id
  FROM agents
  WHERE slug = 'luna'
  LIMIT 1;

  IF luna_agent_id IS NULL THEN
    RAISE EXCEPTION 'Migration 030 requires an agents row with slug=''luna''';
  END IF;

  -- Step 1: normalize existing rows to the single agent.
  UPDATE agent_contacts
  SET agent_id = luna_agent_id
  WHERE agent_id IS DISTINCT FROM luna_agent_id;

  UPDATE sessions
  SET agent_id = luna_agent_id
  WHERE agent_id IS NULL;

  UPDATE messages
  SET agent_id = luna_agent_id
  WHERE agent_id IS NULL;

  UPDATE session_summaries
  SET agent_id = luna_agent_id
  WHERE agent_id IS NULL;

  UPDATE commitments
  SET agent_id = luna_agent_id
  WHERE agent_id IS NULL;

  UPDATE conversation_archives
  SET agent_id = luna_agent_id
  WHERE agent_id IS NULL;

  UPDATE pipeline_logs
  SET agent_id = luna_agent_id
  WHERE agent_id IS NULL;

  -- Deduplicate agent_contacts by contact_id, keeping the most recently updated row.
  DELETE FROM agent_contacts ac
  USING (
    SELECT id
    FROM (
      SELECT id,
             row_number() OVER (
               PARTITION BY contact_id
               ORDER BY updated_at DESC, created_at DESC, id DESC
             ) AS rn
      FROM agent_contacts
    ) ranked
    WHERE ranked.rn > 1
  ) duplicates
  WHERE ac.id = duplicates.id;

  -- Step 2: set default agent_id to luna on all relevant tables.
  EXECUTE format(
    'ALTER TABLE messages ALTER COLUMN agent_id SET DEFAULT %L::uuid',
    luna_agent_id
  );
  EXECUTE format(
    'ALTER TABLE sessions ALTER COLUMN agent_id SET DEFAULT %L::uuid',
    luna_agent_id
  );
  EXECUTE format(
    'ALTER TABLE session_summaries ALTER COLUMN agent_id SET DEFAULT %L::uuid',
    luna_agent_id
  );
  EXECUTE format(
    'ALTER TABLE commitments ALTER COLUMN agent_id SET DEFAULT %L::uuid',
    luna_agent_id
  );
  EXECUTE format(
    'ALTER TABLE conversation_archives ALTER COLUMN agent_id SET DEFAULT %L::uuid',
    luna_agent_id
  );
  EXECUTE format(
    'ALTER TABLE pipeline_logs ALTER COLUMN agent_id SET DEFAULT %L::uuid',
    luna_agent_id
  );
  EXECUTE format(
    'ALTER TABLE agent_contacts ALTER COLUMN agent_id SET DEFAULT %L::uuid',
    luna_agent_id
  );

  -- Step 3: move from (agent_id, contact_id) uniqueness to contact_id-only uniqueness.
  ALTER TABLE agent_contacts
    DROP CONSTRAINT IF EXISTS agent_contacts_agent_id_contact_id_key;

  DROP INDEX IF EXISTS idx_agent_contacts_contact_unique;
  CREATE UNIQUE INDEX idx_agent_contacts_contact_unique
    ON agent_contacts (contact_id);

  -- Step 4: ensure every contact has an agent_contacts row.
  INSERT INTO agent_contacts (agent_id, contact_id)
  SELECT luna_agent_id, c.id
  FROM contacts c
  WHERE NOT EXISTS (
    SELECT 1
    FROM agent_contacts ac
    WHERE ac.contact_id = c.id
  )
  ON CONFLICT (contact_id) DO NOTHING;
END $$;
