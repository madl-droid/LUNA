// LUNA — Module: engine
// Wrapper que inicializa el pipeline de procesamiento de mensajes.

import type { ModuleManifest } from '../../kernel/types.js'
import type { Registry } from '../../kernel/registry.js'
import { initEngine, stopEngine } from '../../engine/index.js'
import { runAttachmentMigration } from '../../engine/attachments/migration.js'
import { registerQueryAttachmentTool } from '../../engine/attachments/tools/query-attachment.js'
import { registerWebExploreTool } from '../../engine/attachments/tools/web-explore.js'

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
    // Run attachment_extractions table migration
    const db = registry.getDb()
    await runAttachmentMigration(db)

    initEngine(registry)

    // Register attachment tools (after engine init, tools:registry may now be available)
    await registerQueryAttachmentTool(registry)
    await registerWebExploreTool(registry)
  },

  async stop() {
    await stopEngine()
  },
}

export default manifest
