// LUNA — Module: console
// Panel de control del agente. Renderiza paneles de módulos dinámicamente.

import type { ModuleManifest } from '../../kernel/types.js'
import type { Registry } from '../../kernel/registry.js'
import { createConsoleHandler, createApiRoutes } from './server.js'
import { setRegistryRef } from './manifest-ref.js'

const manifest: ModuleManifest = {
  name: 'console',
  version: '1.0.0',
  description: {
    es: 'Panel de control y configuración del agente',
    en: 'Agent control panel and configuration',
  },
  type: 'core-module',
  removable: false,
  activateByDefault: true,
  depends: [],

  console: {
    title: { es: 'Console', en: 'Console' },
    order: 0,
    apiRoutes: createApiRoutes(),
  },

  async init(registry: Registry) {
    setRegistryRef(registry)

    // Expose request handler for HTML serving (kernel server calls this)
    const handler = createConsoleHandler(registry)
    registry.provide('console:requestHandler', handler)
  },

  async stop() {
    // Nothing to clean up
  },
}

export default manifest
