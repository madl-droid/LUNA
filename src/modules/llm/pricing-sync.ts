// llm/pricing-sync.ts — Model pricing file management
// Loads pricing from instance/system/model-pricing.json.
// Checks bi-monthly (1st & 16th) if discovered models have pricing entries.
// Creates notifications for models without pricing.

import * as fs from 'node:fs'
import * as path from 'node:path'
import pino from 'pino'
import type { Registry } from '../../kernel/registry.js'
import type { NotificationInput } from '../cortex/notifications.js'
import { DEFAULT_COST_TABLE } from './types.js'

const logger = pino({ name: 'llm:pricing-sync' })

const PRICING_FILE = path.resolve('instance/system/model-pricing.json')
const CHECK_INTERVAL_MS = 12 * 3_600_000 // Check every 12 hours

interface PricingEntry {
  inputPer1M: number
  outputPer1M: number
  provider?: string
}

interface PricingFile {
  version: string
  lastChecked: string
  models: Record<string, PricingEntry>
}

/**
 * Load pricing from file. Falls back to DEFAULT_COST_TABLE if file missing.
 */
export function loadPricingFile(): Record<string, { inputPer1M: number; outputPer1M: number }> {
  try {
    if (fs.existsSync(PRICING_FILE)) {
      const raw = fs.readFileSync(PRICING_FILE, 'utf-8')
      const data = JSON.parse(raw) as PricingFile
      const table: Record<string, { inputPer1M: number; outputPer1M: number }> = {}
      for (const [model, entry] of Object.entries(data.models)) {
        table[model] = { inputPer1M: entry.inputPer1M, outputPer1M: entry.outputPer1M }
      }
      logger.info({ models: Object.keys(table).length }, 'Loaded pricing from file')
      return table
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to read pricing file, using defaults')
  }

  // Bootstrap: create file from DEFAULT_COST_TABLE
  bootstrapPricingFile()
  return { ...DEFAULT_COST_TABLE }
}

/**
 * Create initial pricing file from DEFAULT_COST_TABLE.
 */
function bootstrapPricingFile(): void {
  try {
    fs.mkdirSync(path.dirname(PRICING_FILE), { recursive: true })
    const data: PricingFile = {
      version: new Date().toISOString().slice(0, 10),
      lastChecked: new Date().toISOString(),
      models: {},
    }
    for (const [model, rates] of Object.entries(DEFAULT_COST_TABLE)) {
      const provider = model.startsWith('claude') ? 'anthropic'
        : model.startsWith('gemini') ? 'google' : 'unknown'
      data.models[model] = { ...rates, provider }
    }
    fs.writeFileSync(PRICING_FILE, JSON.stringify(data, null, 2), 'utf-8')
    logger.info('Created initial pricing file from defaults')
  } catch (err) {
    logger.warn({ err }, 'Failed to bootstrap pricing file')
  }
}

/**
 * Start bi-monthly pricing check.
 * On 1st and 16th of each month, compares discovered models vs pricing file.
 * Creates notification for any model without pricing.
 */
export function startPricingCheck(registry: Registry): ReturnType<typeof setInterval> {
  const timer = setInterval(() => { void checkPricing(registry) }, CHECK_INTERVAL_MS)
  // Run initial check after 5 minutes (let model scanner run first)
  setTimeout(() => { void checkPricing(registry) }, 300_000)
  return timer
}

async function checkPricing(registry: Registry): Promise<void> {
  const day = new Date().getUTCDate()
  if (day !== 1 && day !== 16) return

  try {
    // Load current pricing
    let pricingData: PricingFile
    try {
      const raw = fs.readFileSync(PRICING_FILE, 'utf-8')
      pricingData = JSON.parse(raw) as PricingFile
    } catch {
      return
    }

    // Check if already checked today
    const today = new Date().toISOString().slice(0, 10)
    if (pricingData.lastChecked.startsWith(today)) return

    // Get discovered models from instance config
    const configPath = path.resolve('instance/config.json')
    let discoveredModels: string[] = []
    try {
      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as Record<string, unknown>
        const llm = config.llm as { availableModels?: { anthropic?: string[]; gemini?: string[] } } | undefined
        if (llm?.availableModels) {
          discoveredModels = [
            ...(llm.availableModels.anthropic ?? []),
            ...(llm.availableModels.gemini ?? []),
          ]
        }
      }
    } catch { /* ignore */ }

    // Find models without pricing
    const missing = discoveredModels.filter(m => !pricingData.models[m])

    if (missing.length > 0) {
      logger.warn({ missing }, 'Models discovered without pricing entries')

      // Add missing models with zero pricing (admin needs to update)
      for (const model of missing) {
        const provider = model.startsWith('claude') ? 'anthropic'
          : model.startsWith('gemini') ? 'google' : 'unknown'
        pricingData.models[model] = { inputPer1M: 0, outputPer1M: 0, provider }
      }

      // Create notification via cortex
      const notifService = registry.getOptional<{
        create(input: NotificationInput): Promise<void>
      }>('cortex:notifications')
      if (notifService) {
        await notifService.create({
          source: 'pulse',
          severity: 'degraded',
          title: 'Modelos sin precio configurado',
          body: `${missing.length} modelo(s): ${missing.join(', ')}. Actualizar instance/system/model-pricing.json`,
          metadata: { missing },
        })
      }
    }

    // Update lastChecked
    pricingData.lastChecked = new Date().toISOString()
    pricingData.version = today
    fs.writeFileSync(PRICING_FILE, JSON.stringify(pricingData, null, 2), 'utf-8')

    logger.info({ discovered: discoveredModels.length, missing: missing.length }, 'Pricing check completed')
  } catch (err) {
    logger.warn({ err }, 'Pricing check failed')
  }
}
