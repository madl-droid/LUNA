-- Fix contact_campaigns.contact_id from TEXT to UUID
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'contact_campaigns' AND column_name = 'contact_id' AND data_type = 'text'
  ) THEN
    -- Remove any non-UUID entries before casting
    DELETE FROM contact_campaigns
    WHERE contact_id !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

    ALTER TABLE contact_campaigns ALTER COLUMN contact_id TYPE UUID USING contact_id::uuid;
  END IF;
END $$;
