-- HITL: Add notification_message_id for quote-based interception
ALTER TABLE hitl_tickets ADD COLUMN IF NOT EXISTS notification_message_id TEXT;

-- Index for potential lookup by notification message ID
CREATE INDEX IF NOT EXISTS idx_hitl_tickets_notification_msg
  ON hitl_tickets (notification_message_id)
  WHERE notification_message_id IS NOT NULL;
