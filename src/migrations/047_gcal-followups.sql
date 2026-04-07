-- Calendar follow-up tracking
CREATE TABLE IF NOT EXISTS calendar_follow_ups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  calendar_event_id TEXT NOT NULL,
  event_summary TEXT,
  event_start TIMESTAMPTZ,
  event_end TIMESTAMPTZ,
  contact_id TEXT NOT NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('attendee_main', 'coworker')),
  target_contact_id TEXT,
  target_name TEXT,
  follow_up_type TEXT NOT NULL CHECK (follow_up_type IN ('pre_reminder', 'post_meeting')),
  channel TEXT NOT NULL,
  scheduled_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'cancelled', 'failed')),
  bullmq_job_id TEXT,
  scheduled_task_id TEXT,
  error TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cal_followups_event
  ON calendar_follow_ups(calendar_event_id);
CREATE INDEX IF NOT EXISTS idx_cal_followups_pending
  ON calendar_follow_ups(status) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_cal_followups_scheduled
  ON calendar_follow_ups(scheduled_at) WHERE status = 'pending';
