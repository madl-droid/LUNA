-- Pool de mensajes ACK predefinidos (respaldo cuando LLM falla)
CREATE TABLE IF NOT EXISTS ack_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  channel TEXT NOT NULL DEFAULT '',       -- whatsapp, email, google-chat, '' (all)
  text TEXT NOT NULL,
  active BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Seeds
INSERT INTO ack_messages (channel, text, sort_order) VALUES
  ('', 'Un momento...', 0),
  ('', 'Dame un segundo...', 1),
  ('', 'Estoy en eso...', 2),
  ('whatsapp', 'Ya te reviso...', 0),
  ('whatsapp', 'Un momento, déjame ver...', 1),
  ('email', 'Procesando su consulta...', 0);
