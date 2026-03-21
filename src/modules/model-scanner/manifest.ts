// LUNA — Module: model-scanner
// Escanea periódicamente las APIs de LLM providers para descubrir modelos disponibles.

import { z } from 'zod'
import type { ModuleManifest } from '../../kernel/types.js'
import type { Registry } from '../../kernel/registry.js'
import { jsonResponse } from '../../kernel/http-helpers.js'
import { numEnv } from '../../kernel/config-helpers.js'
import { startScanner, stopScanner, scanModels, getLastScanResult } from './scanner.js'

let _registry: Registry | null = null

const manifest: ModuleManifest = {
  name: 'model-scanner',
  version: '1.0.0',
  description: {
    es: 'Escaneo periódico de modelos LLM disponibles',
    en: 'Periodic scan of available LLM models',
  },
  type: 'feature',
  removable: true,
  activateByDefault: true,
  depends: [],

  configSchema: z.object({
    ANTHROPIC_API_KEY: z.string().default(''),
    GOOGLE_AI_API_KEY: z.string().default(''),
    MODEL_SCAN_INTERVAL_MS: numEnv(21600000),
  }),

  oficina: {
    title: { es: 'Escáner de Modelos LLM', en: 'LLM Model Scanner' },
    info: {
      es: 'Escanea APIs de providers para descubrir modelos y reemplazar deprecados.',
      en: 'Scans provider APIs to discover models and replace deprecated ones.',
    },
    order: 50,
    group: 'system',
    icon: '&#128270;',
    fields: [
      { key: 'ANTHROPIC_API_KEY', type: 'secret', label: { es: 'API Key Anthropic', en: 'Anthropic API Key' } },
      { key: 'GOOGLE_AI_API_KEY', type: 'secret', label: { es: 'API Key Google AI', en: 'Google AI API Key' } },
    ],
    apiRoutes: [
      {
        method: 'GET',
        path: 'status',
        handler: async (_req, res) => {
          const scan = getLastScanResult()
          jsonResponse(res, 200, scan ?? { anthropic: [], google: [], lastScanAt: null, replacements: [] })
        },
      },
      {
        method: 'GET',
        path: 'models',
        handler: async (_req, res) => {
          const scan = getLastScanResult()
          const models = {
            anthropic: scan?.anthropic.map(m => m.id) ?? [],
            gemini: scan?.google.map(m => m.id) ?? [],
          }
          jsonResponse(res, 200, { models, scan })
        },
      },
      {
        method: 'POST',
        path: 'scan',
        handler: async (_req, res) => {
          try {
            const result = await scanModels(_registry!)
            jsonResponse(res, 200, {
              ok: true,
              anthropic: result.anthropic.length,
              google: result.google.length,
              replacements: result.replacements,
              errors: result.errors,
            })
          } catch (err) {
            jsonResponse(res, 500, { error: 'Scan failed: ' + String(err) })
          }
        },
      },
    ],
  },

  async init(registry: Registry) {
    _registry = registry
    const config = registry.getConfig<{ ANTHROPIC_API_KEY: string; GOOGLE_AI_API_KEY: string; MODEL_SCAN_INTERVAL_MS: number }>('model-scanner')
    startScanner(registry, config.MODEL_SCAN_INTERVAL_MS)
  },

  async stop() {
    stopScanner()
    _registry = null
  },
}

export default manifest
