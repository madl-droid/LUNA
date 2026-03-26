// LUNA — Module: freight
// Wrapper que registra la tool estimate-freight en el sistema modular.
// La lógica vive en src/tools/freight/. Este módulo solo hace el bridge.

import { z } from 'zod'
import type { ModuleManifest } from '../../kernel/types.js'
import type { Registry } from '../../kernel/registry.js'
import { boolEnv, floatEnvMin } from '../../kernel/config-helpers.js'
import { registerFreightTool } from '../../tools/freight/freight-tool.js'

export interface FreightModuleConfig {
  FREIGHT_ENABLED: boolean
  FREIGHT_BUFFER_PERCENTAGE: number
  SEARATES_API_KEY: string
  SEARATES_PLATFORM_ID: string
  DHL_EXPRESS_USERNAME: string
  DHL_EXPRESS_PASSWORD: string
  DHL_EXPRESS_ACCOUNT_NUMBER: string
  DHL_EXPRESS_TEST_MODE: boolean
}

const manifest: ModuleManifest = {
  name: 'freight',
  version: '1.0.0',
  description: {
    es: 'Estimación de flete internacional (SeaRates + DHL Express)',
    en: 'International freight estimation (SeaRates + DHL Express)',
  },
  type: 'feature',
  removable: true,
  activateByDefault: true,
  depends: ['tools'],

  configSchema: z.object({
    FREIGHT_ENABLED: boolEnv(true),
    FREIGHT_BUFFER_PERCENTAGE: floatEnvMin(0, 0.15),
    SEARATES_API_KEY: z.string().default(''),
    SEARATES_PLATFORM_ID: z.string().default(''),
    DHL_EXPRESS_USERNAME: z.string().default(''),
    DHL_EXPRESS_PASSWORD: z.string().default(''),
    DHL_EXPRESS_ACCOUNT_NUMBER: z.string().default(''),
    DHL_EXPRESS_TEST_MODE: boolEnv(true),
  }),

  console: {
    title: { es: 'Flete', en: 'Freight' },
    info: {
      es: 'Estimación de costos de flete internacional. Carriers: SeaRates (ocean/air/ground) y DHL Express.',
      en: 'International freight cost estimation. Carriers: SeaRates (ocean/air/ground) and DHL Express.',
    },
    order: 35,
    group: 'agent',
    icon: '&#128666;',
    fields: [
      {
        key: 'FREIGHT_ENABLED',
        type: 'boolean',
        label: { es: 'Habilitar estimación de flete', en: 'Enable freight estimation' },
        description: {
          es: 'Activa o desactiva la tool estimate-freight para el agente.',
          en: 'Enable or disable the estimate-freight tool for the agent.',
        },
      },
      {
        key: 'FREIGHT_BUFFER_PERCENTAGE',
        type: 'number',
        label: { es: 'Buffer de precio (%)', en: 'Price buffer (%)' },
        description: {
          es: 'Porcentaje que se suma al estimado de cada carrier (0.15 = 15%). Protege contra variaciones de precio.',
          en: 'Percentage added to each carrier estimate (0.15 = 15%). Protects against price variations.',
        },
        min: 0,
        max: 1,
        width: 'half',
      },

      // ── SeaRates ──
      { key: '_div_searates', type: 'divider', label: { es: 'SeaRates (Ocean / Air / Ground)', en: 'SeaRates (Ocean / Air / Ground)' } },
      {
        key: 'SEARATES_API_KEY',
        type: 'secret',
        label: { es: 'API Key', en: 'API Key' },
        description: { es: 'Bearer token para SeaRates Logistics Explorer API', en: 'Bearer token for SeaRates Logistics Explorer API' },
        placeholder: 'sr_...',
      },
      {
        key: 'SEARATES_PLATFORM_ID',
        type: 'text',
        label: { es: 'Platform ID', en: 'Platform ID' },
        description: { es: 'ID de plataforma SeaRates (opcional)', en: 'SeaRates platform ID (optional)' },
        width: 'half',
      },

      // ── DHL Express ──
      { key: '_div_dhl', type: 'divider', label: { es: 'DHL Express', en: 'DHL Express' } },
      {
        key: 'DHL_EXPRESS_USERNAME',
        type: 'secret',
        label: { es: 'Username', en: 'Username' },
        description: { es: 'Usuario MyDHL API', en: 'MyDHL API username' },
      },
      {
        key: 'DHL_EXPRESS_PASSWORD',
        type: 'secret',
        label: { es: 'Password', en: 'Password' },
        description: { es: 'Contraseña MyDHL API', en: 'MyDHL API password' },
      },
      {
        key: 'DHL_EXPRESS_ACCOUNT_NUMBER',
        type: 'text',
        label: { es: 'Número de cuenta', en: 'Account number' },
        description: { es: 'Número de cuenta DHL Express', en: 'DHL Express account number' },
        width: 'half',
      },
      {
        key: 'DHL_EXPRESS_TEST_MODE',
        type: 'boolean',
        label: { es: 'Modo test', en: 'Test mode' },
        description: {
          es: 'Usa el endpoint de pruebas de DHL (500 llamadas/día). Desactivar para producción.',
          en: 'Use DHL test endpoint (500 calls/day). Disable for production.',
        },
      },
    ],
  },

  async init(registry: Registry) {
    const config = registry.getConfig<FreightModuleConfig>('freight')

    if (!config.FREIGHT_ENABLED) {
      return
    }

    await registerFreightTool(registry, config)
  },

  async stop() {
    // Tools se des-registran automáticamente via hook module:deactivated
  },
}

export default manifest
