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
    initEngine(registry)
  },

  async stop() {
    stopEngine()
  },
}

export default manifest
