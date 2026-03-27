// LUNA — Module: freight
// Wrapper que registra la tool estimate-freight en el sistema modular.
// La lógica vive en src/tools/freight/. Este módulo solo hace el bridge.

import { z } from 'zod'
import type { ModuleManifest } from '../../kernel/types.js'
import type { Registry } from '../../kernel/registry.js'
import { boolEnv, floatEnvMin } from '../../kernel/config-helpers.js'
import { registerFreightTool } from '../../tools/freight/freight-tool.js'
import { renderFreightSection } from './console-section.js'
import type { FreightConsoleConfig } from './console-section.js'

export interface FreightModuleConfig {
  FREIGHT_ENABLED: boolean
  SEARATES_API_KEY: string
  SEARATES_PLATFORM_ID: string
  SEARATES_BUFFER_PERCENTAGE: number
  DHL_EXPRESS_USERNAME: string
  DHL_EXPRESS_PASSWORD: string
  DHL_EXPRESS_ACCOUNT_NUMBER: string
  DHL_EXPRESS_TEST_MODE: boolean
  DHL_EXPRESS_BUFFER_PERCENTAGE: number
  FREIGHT_PARTS_SHEET_URL: string
}

const manifest: ModuleManifest = {
  name: 'freight',
  version: '1.1.0',
  description: {
    es: 'Cotización de envío internacional — conecta APIs de carriers para estimar costos, tiempos de tránsito y cálculo de contenedores.',
    en: 'International shipping quotes — connects carrier APIs to estimate costs, transit times, and container calculations.',
  },
  type: 'feature',
  removable: true,
  activateByDefault: true,
  depends: ['tools'],

  configSchema: z.object({
    FREIGHT_ENABLED: boolEnv(true),
    SEARATES_API_KEY: z.string().default(''),
    SEARATES_PLATFORM_ID: z.string().default(''),
    SEARATES_BUFFER_PERCENTAGE: floatEnvMin(0, 0.15),
    DHL_EXPRESS_USERNAME: z.string().default(''),
    DHL_EXPRESS_PASSWORD: z.string().default(''),
    DHL_EXPRESS_ACCOUNT_NUMBER: z.string().default(''),
    DHL_EXPRESS_TEST_MODE: boolEnv(true),
    DHL_EXPRESS_BUFFER_PERCENTAGE: floatEnvMin(0, 0.15),
    FREIGHT_PARTS_SHEET_URL: z.string().default(''),
  }),

  console: {
    title: { es: 'Cotizar Envío', en: 'Shipping Quotes' },
    info: {
      es: 'Cotización automática de envío internacional. Configura las APIs de cada carrier y el catálogo de partes.',
      en: 'Automatic international shipping quotes. Configure each carrier API and the parts catalog.',
    },
    order: 35,
    group: 'agent',
    icon: '&#128666;',
    fields: [],
  },

  async init(registry: Registry) {
    const config = registry.getConfig<FreightModuleConfig>('freight')

    // Register custom console section renderer
    registry.provide('freight:renderSection', (lang: 'es' | 'en') => {
      const consoleConfig: FreightConsoleConfig = {
        searatesApiKey: config.SEARATES_API_KEY,
        searatesPlatformId: config.SEARATES_PLATFORM_ID,
        searatesBufferPercentage: config.SEARATES_BUFFER_PERCENTAGE,
        dhlExpressUsername: config.DHL_EXPRESS_USERNAME,
        dhlExpressPassword: config.DHL_EXPRESS_PASSWORD,
        dhlExpressAccountNumber: config.DHL_EXPRESS_ACCOUNT_NUMBER,
        dhlExpressTestMode: config.DHL_EXPRESS_TEST_MODE,
        dhlExpressBufferPercentage: config.DHL_EXPRESS_BUFFER_PERCENTAGE,
        partsSheetUrl: config.FREIGHT_PARTS_SHEET_URL,
      }
      return renderFreightSection(lang, consoleConfig)
    })

    // When module is activated, everything is enabled — register the tool
    await registerFreightTool(registry, config)
  },

  async stop() {
    // Tools se des-registran automáticamente via hook module:deactivated
  },
}

export default manifest
