-- HITL (Human-in-the-Loop) v1
-- Tickets, audit log, rules, and supervisor chain

-- 1. Add supervisor_id to users table (per-user supervisor chain)
ALTER TABLE users ADD COLUMN IF NOT EXISTS supervisor_id VARCHAR(20)
  REFERENCES users(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_users_supervisor ON users(supervisor_id)
  WHERE supervisor_id IS NOT NULL;

-- 2. HITL tickets
CREATE TABLE IF NOT EXISTS hitl_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Context: who triggered and why
  requester_contact_id VARCHAR(255) NOT NULL,
  requester_channel VARCHAR(50) NOT NULL,
  requester_sender_id VARCHAR(255) NOT NULL,
  agent_id VARCHAR(100),
  session_id VARCHAR(100),
  correlation_id VARCHAR(100),
  -- What the agent needs
  request_type VARCHAR(50) NOT NULL,
  request_summary TEXT NOT NULL,
  request_context JSONB DEFAULT '{}',
  urgency VARCHAR(20) DEFAULT 'normal',
  -- Human assignment
  assigned_user_id VARCHAR(20),
  assigned_channel VARCHAR(50),
  assigned_sender_id VARCHAR(255),
  target_role VARCHAR(50) NOT NULL,
  -- Escalation chain
  escalation_level INT DEFAULT 0,
  escalation_history JSONB DEFAULT '[]',
  -- Handoff
  handoff_mode VARCHAR(20) DEFAULT 'intermediary',
  handoff_active BOOLEAN DEFAULT false,
  -- Resolution
  status VARCHAR(30) NOT NULL DEFAULT 'pending',
  resolution_text TEXT,
  resolution_data JSONB,
  resolved_by VARCHAR(20),
  resolved_at TIMESTAMPTZ,
  -- Follow-up tracking
  notification_count INT DEFAULT 0,
  last_notified_at TIMESTAMPTZ,
  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_hitl_tickets_status
  ON hitl_tickets(status) WHERE status NOT IN ('resolved', 'expired', 'cancelled');
CREATE INDEX IF NOT EXISTS idx_hitl_tickets_assigned
  ON hitl_tickets(assigned_sender_id, assigned_channel)
  WHERE status IN ('notified', 'waiting');
CREATE INDEX IF NOT EXISTS idx_hitl_tickets_requester
  ON hitl_tickets(requester_sender_id, requester_channel)
  WHERE status NOT IN ('resolved', 'expired', 'cancelled');
CREATE INDEX IF NOT EXISTS idx_hitl_tickets_handoff
  ON hitl_tickets(requester_channel, requester_sender_id)
  WHERE handoff_active = true;

-- 3. Audit log for state transitions
CREATE TABLE IF NOT EXISTS hitl_ticket_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID NOT NULL REFERENCES hitl_tickets(id) ON DELETE CASCADE,
  event VARCHAR(50) NOT NULL,
  actor VARCHAR(50),
  details JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_hitl_log_ticket ON hitl_ticket_log(ticket_id);

-- 4. HITL rules (natural language conditions for LLM evaluator)
CREATE TABLE IF NOT EXISTS hitl_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  condition TEXT NOT NULL,
  target_role VARCHAR(50) NOT NULL,
  request_type VARCHAR(50) NOT NULL DEFAULT 'custom',
  urgency VARCHAR(20) DEFAULT 'normal',
  handoff BOOLEAN DEFAULT false,
  enabled BOOLEAN DEFAULT true,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
