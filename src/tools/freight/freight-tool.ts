// LUNA — Tool: estimate_freight
// Estima costos de flete internacional. Registra la tool con tools:registry.
// Carriers V1: SeaRates + DHL Express.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { z } from 'zod'
import pino from 'pino'
import type { Registry } from '../../kernel/registry.js'
import type { ToolRegistry } from '../../modules/tools/tool-registry.js'
import { SeaRatesAdapter } from './adapters/searates-adapter.js'
import { DhlExpressAdapter } from './adapters/dhl-express-adapter.js'
import { FreightRouter } from './freight-router.js'
import type {
  FreightEstimateInput,
  FreightEstimateResult,
  FreightConfig,
  FreightSecrets,
  FreightEstimate,
} from './types.js'

const logger = pino({ name: 'freight:tool' })

// ─── Input validation schema ──────────────────

const locationSchema = z.object({
  city: z.string().min(1),
  country_code: z.string().length(2),
  postal_code: z.string().optional(),
  coordinates: z.object({
    lat: z.number(),
    lng: z.number(),
  }).optional(),
})

const packageSchema = z.object({
  weight_kg: z.number().positive(),
  length_cm: z.number().positive(),
  width_cm: z.number().positive(),
  height_cm: z.number().positive(),
  quantity: z.number().int().positive(),
  description: z.string().optional(),
})

const inputSchema = z.object({
  origin: locationSchema,
  destination: locationSchema,
  packages: z.array(packageSchema).min(1),
  service_type: z.enum(['ocean', 'air', 'ground', 'express']).optional(),
  ready_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
})

// ─── Module config → secrets adapter ──────────

interface FreightModuleConfig {
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

/** Per-carrier buffer percentages */
interface CarrierBuffers {
  searates: number
  dhl_express: number
}

function moduleConfigToSecrets(moduleConfig: FreightModuleConfig): FreightSecrets {
  return {
    searatesApiKey: moduleConfig.SEARATES_API_KEY || undefined,
    searatesPlatformId: moduleConfig.SEARATES_PLATFORM_ID || undefined,
    dhlExpressUsername: moduleConfig.DHL_EXPRESS_USERNAME || undefined,
    dhlExpressPassword: moduleConfig.DHL_EXPRESS_PASSWORD || undefined,
    dhlExpressAccountNumber: moduleConfig.DHL_EXPRESS_ACCOUNT_NUMBER || undefined,
    dhlExpressTestMode: moduleConfig.DHL_EXPRESS_TEST_MODE,
  }
}

// ─── Config loader ────────────────────────────

function loadFreightConfig(): FreightConfig {
  const configPath = resolve(process.cwd(), 'instance/tools/freight.json')
  try {
    const raw = readFileSync(configPath, 'utf-8')
    return JSON.parse(raw) as FreightConfig
  } catch (err) {
    logger.warn({ configPath, error: String(err) }, 'Could not load freight config, using defaults')
    return getDefaultConfig()
  }
}

function getDefaultConfig(): FreightConfig {
  return {
    enabled: true,
    buffer_percentage: 0.15,
    disclaimer_es: 'Este es un estimado aproximado. El precio final se confirma al cerrar la orden y puede variar según condiciones del envío.',
    disclaimer_en: 'This is an approximate estimate. Final price is confirmed when closing the order and may vary based on shipping conditions.',
    default_ready_days: 3,
    max_packages: 20,
    carriers: {
      searates: {
        enabled: true,
        container_thresholds: { st20_max_cbm: 15, st40_max_cbm: 30 },
      },
      dhl_express: {
        enabled: true,
        max_weight_per_piece_kg: 70,
        account_number: 'FROM_ENV',
      },
    },
    known_origins: {
      san_diego: { city: 'San Diego', country_code: 'US', postal_code: '92101', coordinates: { lat: 32.7157, lng: -117.1611 } },
      shenzhen: { city: 'Shenzhen', country_code: 'CN', postal_code: '518000', coordinates: { lat: 22.5431, lng: 114.0579 } },
      bogota: { city: 'Bogota', country_code: 'CO', postal_code: '110111', coordinates: { lat: 4.7110, lng: -74.0721 } },
    },
  }
}

// ─── Main handler ─────────────────────────────

async function handleEstimateFreight(
  input: Record<string, unknown>,
  config: FreightConfig,
  secrets: FreightSecrets,
  carrierBuffers: CarrierBuffers,
): Promise<FreightEstimateResult> {
  // 1. Validate input
  const parsed = inputSchema.safeParse(input)
  if (!parsed.success) {
    return {
      success: false,
      estimates: [],
      buffer_applied: config.buffer_percentage,
      disclaimer: config.disclaimer_es,
      errors: [{ carrier: 'validation', error: parsed.error.message }],
    }
  }

  const params: FreightEstimateInput = parsed.data
  const start = Date.now()

  // Validate max packages
  if (params.packages.length > config.max_packages) {
    return {
      success: false,
      estimates: [],
      buffer_applied: config.buffer_percentage,
      disclaimer: config.disclaimer_es,
      errors: [{
        carrier: 'validation',
        error: `Too many package types: ${params.packages.length} exceeds max ${config.max_packages}`,
      }],
    }
  }

  // 2. Create adapters and router
  const adapters = []
  if (config.carriers.searates.enabled && secrets.searatesApiKey) {
    adapters.push(new SeaRatesAdapter(secrets, config))
  }
  if (config.carriers.dhl_express.enabled && (secrets.dhlExpressUsername && secrets.dhlExpressPassword)) {
    adapters.push(new DhlExpressAdapter(secrets, config))
  }

  const router = new FreightRouter(adapters, config)

  // 3. Select carriers for this route
  const selectedAdapters = router.selectCarriers(
    params.origin,
    params.destination,
    params.service_type,
    params.packages,
  )

  if (selectedAdapters.length === 0) {
    return {
      success: false,
      estimates: [],
      buffer_applied: config.buffer_percentage,
      disclaimer: config.disclaimer_es,
      errors: [{ carrier: 'router', error: 'No carriers available for this route' }],
    }
  }

  // 4. Query all selected carriers in parallel
  const results = await Promise.allSettled(
    selectedAdapters.map(async (adapter) => {
      const adapterStart = Date.now()
      try {
        const estimates = await adapter.getEstimate(params)
        const latency = Date.now() - adapterStart
        logger.info(
          { carrier: adapter.carrierId, latency, estimateCount: estimates.length },
          'Carrier estimate received',
        )
        return { carrierId: adapter.carrierId, estimates }
      } catch (err) {
        const latency = Date.now() - adapterStart
        logger.error(
          { carrier: adapter.carrierId, latency, error: String(err) },
          'Carrier estimate failed',
        )
        throw err
      }
    }),
  )

  // 5. Collect estimates and errors
  const allEstimates: FreightEstimate[] = []
  const errors: Array<{ carrier: string; error: string }> = []

  for (const result of results) {
    if (result.status === 'fulfilled') {
      const { carrierId, estimates } = result.value
      for (const est of estimates) {
        // Apply per-carrier buffer: price / (1 - buffer)
        const buffer = carrierBuffers[carrierId] ?? config.buffer_percentage
        const bufferedPrice = buffer < 1 ? est.price_usd / (1 - buffer) : est.price_usd
        allEstimates.push({
          carrier: carrierId,
          service_name: est.service_name,
          shipping_type: est.shipping_type,
          price_usd: Math.round(bufferedPrice * 100) / 100,
          price_original_usd: Math.round(est.price_usd * 100) / 100,
          currency_original: est.currency_original,
          transit_days_min: est.transit_days_min,
          transit_days_max: est.transit_days_max,
          valid_until: est.valid_until,
          is_indicative: est.is_indicative,
          details: est.details,
        })
      }
    } else {
      const errMsg = result.reason instanceof Error ? result.reason.message : String(result.reason)
      errors.push({ carrier: 'unknown', error: errMsg })
    }
  }

  const totalLatency = Date.now() - start
  logger.info(
    { totalLatency, estimateCount: allEstimates.length, errorCount: errors.length },
    'Freight estimation complete',
  )

  return {
    success: allEstimates.length > 0,
    estimates: allEstimates,
    buffer_applied: config.buffer_percentage,
    disclaimer: config.disclaimer_es,
    errors: errors.length > 0 ? errors : undefined,
  }
}

// ─── Registration ─────────────────────────────

/**
 * Registra la tool estimate-freight con tools:registry.
 * Llamada desde el módulo wrapper src/modules/freight/manifest.ts.
 * @param registry - Kernel registry
 * @param moduleConfig - Config parseada del configSchema del módulo freight
 */
export async function registerFreightTool(
  registry: Registry,
  moduleConfig: FreightModuleConfig,
): Promise<void> {
  const toolRegistry = registry.getOptional<ToolRegistry>('tools:registry')
  if (!toolRegistry) {
    logger.warn('Tools module not available — skipping freight tool registration')
    return
  }

  const config = loadFreightConfig()
  const secrets = moduleConfigToSecrets(moduleConfig)
  const carrierBuffers: CarrierBuffers = {
    searates: moduleConfig.SEARATES_BUFFER_PERCENTAGE,
    dhl_express: moduleConfig.DHL_EXPRESS_BUFFER_PERCENTAGE,
  }

  await toolRegistry.registerTool({
    definition: {
      name: 'estimate-freight',
      displayName: 'Cotizar envío internacional',
      description: 'Cotiza envío internacional dado un origen, destino y carga. Retorna precios estimados y tiempos de tránsito de carriers disponibles. NO decide el origen - usar check_inventory primero si es necesario.',
      category: 'logistics',
      sourceModule: 'freight',
      parameters: {
        type: 'object',
        properties: {
          origin: {
            type: 'object',
            description: 'Origen del envío con city, country_code (ISO alpha-2), y opcionalmente postal_code y coordinates {lat, lng}',
          },
          destination: {
            type: 'object',
            description: 'Destino del envío con city, country_code (ISO alpha-2), y opcionalmente postal_code y coordinates {lat, lng}',
          },
          packages: {
            type: 'array',
            description: 'Lista de paquetes con weight_kg, length_cm, width_cm, height_cm, quantity, y opcionalmente description',
            items: { type: 'object', description: 'Paquete con dimensiones y peso' },
          },
          service_type: {
            type: 'string',
            description: 'Tipo de servicio: ocean, air, ground, express. Si no se especifica, cotiza todos los aplicables.',
            enum: ['ocean', 'air', 'ground', 'express'],
          },
          ready_date: {
            type: 'string',
            description: 'Fecha de despacho ISO YYYY-MM-DD. Default: hoy + 3 días.',
          },
        },
        required: ['origin', 'destination', 'packages'],
      },
    },
    handler: async (input) => {
      const result = await handleEstimateFreight(input, config, secrets, carrierBuffers)
      return {
        success: result.success,
        data: result,
        error: result.success ? undefined : (result.errors?.[0]?.error ?? 'No estimates available'),
      }
    },
  })

  logger.info(
    {
      searates: config.carriers.searates.enabled && !!secrets.searatesApiKey,
      dhlExpress: config.carriers.dhl_express.enabled && !!secrets.dhlExpressUsername,
    },
    'Freight tool registered',
  )
}

// Exported for testing
export { handleEstimateFreight, loadFreightConfig, inputSchema }
