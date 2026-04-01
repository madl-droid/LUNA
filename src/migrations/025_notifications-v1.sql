-- 025_notifications-v1.sql — Notification center for Cortex events
-- Sources: reflex (alerts), pulse (reports), trace (simulation completions)

CREATE TABLE IF NOT EXISTS notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source      TEXT NOT NULL,                    -- 'reflex', 'pulse', 'trace'
  severity    TEXT NOT NULL DEFAULT 'info',      -- 'critical', 'degraded', 'info', 'success'
  title       TEXT NOT NULL,
  body        TEXT,
  metadata    JSONB DEFAULT '{}',               -- alert rule, report id, run id, etc.
  read        BOOLEAN DEFAULT false,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_notifications_unread
  ON notifications (read, created_at DESC) WHERE read = false;

CREATE INDEX IF NOT EXISTS idx_notifications_created
  ON notifications (created_at DESC);
