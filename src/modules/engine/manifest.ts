// LUNA — Module: engine
// Wrapper que inicializa el pipeline de procesamiento de mensajes.

import type { ModuleManifest } from '../../kernel/types.js'
import type { Registry } from '../../kernel/registry.js'
import { initEngine, stopEngine } from '../../engine/index.js'

const manifest: ModuleManifest = {
  name: 'engine',
  version: '1.0.0',
  description: {
    es: 'Motor de procesamiento de mensajes (pipeline de 5 fases)',
    en: 'Message processing engine (5-phase pipeline)',
  },
  type: 'core-module',
  removable: false,
  activateByDefault: true,
  depends: ['memory', 'llm'],

  async init(registry: Registry) {
    // Ensure ack_messages table exists (for ACK predefined pool)
    try {
      const db = registry.getDb()
      await db.query(`
        CREATE TABLE IF NOT EXISTS ack_messages (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          channel TEXT NOT NULL DEFAULT '',
          text TEXT NOT NULL,
          active BOOLEAN DEFAULT true,
          sort_order INTEGER DEFAULT 0,
          created_at TIMESTAMPTZ DEFAULT now(),
          updated_at TIMESTAMPTZ DEFAULT now()
        )
      `)
      // Seed only if table is empty
      const { rows } = await db.query(`SELECT COUNT(*)::int AS cnt FROM ack_messages`)
      if (rows[0]?.cnt === 0) {
        await db.query(`
          INSERT INTO ack_messages (channel, text, sort_order) VALUES
            ('', 'Un momento...', 0),
            ('', 'Dame un segundo...', 1),
            ('', 'Estoy en eso...', 2),
            ('whatsapp', 'Ya te reviso...', 0),
            ('whatsapp', 'Un momento, déjame ver...', 1),
            ('email', 'Procesando su consulta...', 0)
        `)
      }
    } catch {
      // Non-critical — ACK will fallback to in-memory defaults
    }

    initEngine(registry)
  },

  async stop() {
    await stopEngine()
  },
}

export default manifest
