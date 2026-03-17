-- LUNA — S02: User Lists & Permissions
-- Referencia SQL. Las tablas se crean automáticamente en init() del módulo users.
-- Este archivo es solo documentación.

-- Lista de usuarios registrados por tipo
CREATE TABLE IF NOT EXISTS user_lists (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id VARCHAR(255) NOT NULL,   -- teléfono, email, etc.
  channel VARCHAR(50) NOT NULL,       -- whatsapp, email, etc.
  list_type VARCHAR(50) NOT NULL,     -- admin, coworker, custom1, custom2
  list_name VARCHAR(100),             -- nombre display de la lista
  display_name VARCHAR(255),          -- nombre del usuario en esta lista
  metadata JSONB DEFAULT '{}',        -- datos extra del usuario
  is_active BOOLEAN DEFAULT true,
  source VARCHAR(50) DEFAULT 'manual', -- manual, sheet_sync, csv_import, api
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(sender_id, channel, list_type)
);

CREATE INDEX IF NOT EXISTS idx_user_lists_sender ON user_lists(sender_id, channel);
CREATE INDEX IF NOT EXISTS idx_user_lists_type ON user_lists(list_type, is_active);

-- Config de listas por instancia
CREATE TABLE IF NOT EXISTS user_list_config (
  list_type VARCHAR(50) PRIMARY KEY,  -- admin, coworker, custom1, custom2
  display_name VARCHAR(100) NOT NULL, -- 'Administradores', 'Doctores', etc.
  is_enabled BOOLEAN DEFAULT true,
  permissions JSONB NOT NULL,          -- {tools: [...], skills: [...], subagents: bool, allAccess: bool}
  sync_config JSONB DEFAULT '{}',      -- {sheetUrl: ..., syncIntervalMs: ...}
  unregistered_behavior VARCHAR(50) DEFAULT 'silence',
  unregistered_message TEXT,           -- mensaje si behavior = generic_message
  max_users INT,                       -- null = sin límite, admin = 5
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed defaults (admin y lead)
INSERT INTO user_list_config (list_type, display_name, is_enabled, permissions, max_users)
VALUES ('admin', 'Administradores', true, '{"tools":["*"],"skills":["*"],"subagents":true,"allAccess":true}', 5)
ON CONFLICT (list_type) DO NOTHING;

INSERT INTO user_list_config (list_type, display_name, is_enabled, permissions, unregistered_behavior)
VALUES ('lead', 'Leads', true, '{"tools":[],"skills":[],"subagents":false,"allAccess":false}', 'silence')
ON CONFLICT (list_type) DO NOTHING;
