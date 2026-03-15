// LUNA — LLM Model Scanner
// Escanea periódicamente las APIs de los proveedores LLM para descubrir
// modelos disponibles. Si un modelo configurado fue descontinuado, lo
// reemplaza automáticamente por el sucesor de la misma familia.

import * as fs from 'node:fs'
import * as path from 'node:path'
import pino from 'pino'
import { config, reloadInstanceConfig } from '../config.js'

const logger = pino({ name: 'model-scanner', level: config.logLevel })

// ═══════════════════════════════════════════
// Types
// ═══════════════════════════════════════════
export interface ScannedModel {
  id: string
  displayName: string
  provider: 'anthropic' | 'google'
  family: string      // haiku, sonnet, opus, flash, pro
  createdAt: string
}

export interface ScanResult {
  anthropic: ScannedModel[]
  google: ScannedModel[]
  lastScanAt: string
  replacements: Replacement[]
}

interface Replacement {
  configKey: string
  oldModel: string
  newModel: string
  reason: string
}

// ═══════════════════════════════════════════
// Family detection
// ═══════════════════════════════════════════
const ANTHROPIC_FAMILIES = ['haiku', 'sonnet', 'opus'] as const
const GOOGLE_FAMILIES = ['flash', 'pro'] as const

function detectFamily(modelId: string): string {
  const lower = modelId.toLowerCase()
  for (const f of [...ANTHROPIC_FAMILIES, ...GOOGLE_FAMILIES]) {
    if (lower.includes(f)) return f
  }
  return 'unknown'
}

// ═══════════════════════════════════════════
// API calls
// ═══════════════════════════════════════════
async function fetchAnthropicModels(apiKey: string): Promise<ScannedModel[]> {
  try {
    const res = await fetch('https://api.anthropic.com/v1/models', {
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
    })
    if (!res.ok) {
      logger.warn({ status: res.status }, 'Failed to fetch Anthropic models')
      return []
    }
    const data = await res.json() as { data: Array<{ id: string; display_name: string; created_at: string }> }
    return data.data.map(m => ({
      id: m.id,
      displayName: m.display_name,
      provider: 'anthropic' as const,
      family: detectFamily(m.id),
      createdAt: m.created_at,
    }))
  } catch (err) {
    logger.error({ err }, 'Error fetching Anthropic models')
    return []
  }
}

async function fetchGoogleModels(apiKey: string): Promise<ScannedModel[]> {
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`)
    if (!res.ok) {
      logger.warn({ status: res.status }, 'Failed to fetch Google models')
      return []
    }
    const data = await res.json() as { models: Array<{ name: string; displayName: string }> }
    return (data.models || [])
      .filter(m => m.name.startsWith('models/gemini'))
      .map(m => {
        const id = m.name.replace('models/', '')
        return {
          id,
          displayName: m.displayName,
          provider: 'google' as const,
          family: detectFamily(id),
          createdAt: '',
        }
      })
  } catch (err) {
    logger.error({ err }, 'Error fetching Google models')
    return []
  }
}

// ═══════════════════════════════════════════
// Replacement logic
// ═══════════════════════════════════════════

/** Find best replacement: same family, most recent */
function findReplacement(missingId: string, available: ScannedModel[]): ScannedModel | null {
  const family = detectFamily(missingId)
  const candidates = available
    .filter(m => m.family === family)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return candidates[0] ?? null
}

/** All config keys that hold a model ID (env-level config) */
const MODEL_CONFIG_KEYS = [
  'LLM_CLASSIFY_MODEL',
  'LLM_RESPOND_MODEL',
  'LLM_COMPLEX_MODEL',
  'LLM_TOOLS_MODEL',
  'LLM_COMPRESS_MODEL',
  'LLM_PROACTIVE_MODEL',
  'LLM_FALLBACK_CLASSIFY_MODEL',
  'LLM_FALLBACK_RESPOND_MODEL',
  'LLM_FALLBACK_COMPLEX_MODEL',
] as const

/** Map from config key to how to read current value from config object */
function getConfiguredModel(key: string): string {
  switch (key) {
    case 'LLM_CLASSIFY_MODEL': return config.llm.classify.model
    case 'LLM_RESPOND_MODEL': return config.llm.respond.model
    case 'LLM_COMPLEX_MODEL': return config.llm.complex.model
    case 'LLM_TOOLS_MODEL': return config.llm.tools.model
    case 'LLM_COMPRESS_MODEL': return config.llm.compress.model
    case 'LLM_PROACTIVE_MODEL': return config.llm.proactive.model
    case 'LLM_FALLBACK_CLASSIFY_MODEL': return config.llm.fallback.classifyModel
    case 'LLM_FALLBACK_RESPOND_MODEL': return config.llm.fallback.respondModel
    case 'LLM_FALLBACK_COMPLEX_MODEL': return config.llm.fallback.complexModel
    default: return ''
  }
}

function getConfiguredProvider(key: string): string {
  switch (key) {
    case 'LLM_CLASSIFY_MODEL': return config.llm.classify.provider
    case 'LLM_RESPOND_MODEL': return config.llm.respond.provider
    case 'LLM_COMPLEX_MODEL': return config.llm.complex.provider
    case 'LLM_TOOLS_MODEL': return config.llm.tools.provider
    case 'LLM_COMPRESS_MODEL': return config.llm.compress.provider
    case 'LLM_PROACTIVE_MODEL': return config.llm.proactive.provider
    case 'LLM_FALLBACK_CLASSIFY_MODEL': return config.llm.fallback.classifyProvider
    case 'LLM_FALLBACK_RESPOND_MODEL': return config.llm.fallback.respondProvider
    case 'LLM_FALLBACK_COMPLEX_MODEL': return config.llm.fallback.complexProvider
    default: return 'anthropic'
  }
}

// ═══════════════════════════════════════════
// Instance config update
// ═══════════════════════════════════════════
function updateInstanceConfigModels(anthropicModels: ScannedModel[], googleModels: ScannedModel[]): void {
  const configPath = path.resolve('instance/config.json')
  let instanceConfig: Record<string, unknown> = {}
  try {
    if (fs.existsSync(configPath)) {
      instanceConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as Record<string, unknown>
    }
  } catch { /* start fresh */ }

  const llm = (instanceConfig.llm ?? {}) as Record<string, unknown>
  const available = (llm.availableModels ?? {}) as Record<string, string[]>

  available.anthropic = anthropicModels.map(m => m.id)
  available.gemini = googleModels.map(m => m.id)

  llm.availableModels = available
  instanceConfig.llm = llm

  fs.writeFileSync(configPath, JSON.stringify(instanceConfig, null, 2), 'utf-8')
  reloadInstanceConfig()
}

// ═══════════════════════════════════════════
// .env update
// ═══════════════════════════════════════════
function updateEnvFile(replacements: Replacement[]): void {
  if (replacements.length === 0) return

  const envPath = path.resolve('.env')
  if (!fs.existsSync(envPath)) return

  let content = fs.readFileSync(envPath, 'utf-8')
  for (const r of replacements) {
    const regex = new RegExp(`^${r.configKey}=.*$`, 'm')
    if (regex.test(content)) {
      content = content.replace(regex, `${r.configKey}=${r.newModel}`)
    }
  }
  fs.writeFileSync(envPath, content, 'utf-8')
}

// ═══════════════════════════════════════════
// Main scan
// ═══════════════════════════════════════════
let _lastScanResult: ScanResult | null = null

export function getLastScanResult(): ScanResult | null {
  return _lastScanResult
}

export async function scanModels(): Promise<ScanResult> {
  logger.info('Starting model scan...')

  const anthropicKey = config.apiKeys.anthropic
  const googleKey = config.apiKeys.googleAi

  const anthropicModels = anthropicKey ? await fetchAnthropicModels(anthropicKey) : []
  const googleModels = googleKey ? await fetchGoogleModels(googleKey) : []

  logger.info({ anthropic: anthropicModels.length, google: googleModels.length }, 'Models discovered')

  // Update instance config with discovered models
  if (anthropicModels.length > 0 || googleModels.length > 0) {
    updateInstanceConfigModels(anthropicModels, googleModels)
  }

  // Check for deprecated models and auto-replace
  const allAvailable = [...anthropicModels, ...googleModels]
  const allAvailableIds = new Set(allAvailable.map(m => m.id))
  const replacements: Replacement[] = []

  for (const key of MODEL_CONFIG_KEYS) {
    const currentModel = getConfiguredModel(key)
    if (!currentModel) continue

    const provider = getConfiguredProvider(key)
    const providerModels = provider === 'google' ? googleModels : anthropicModels

    // Skip check if provider has no key (can't verify)
    if (providerModels.length === 0) continue

    if (!allAvailableIds.has(currentModel)) {
      const replacement = findReplacement(currentModel, providerModels)
      if (replacement) {
        replacements.push({
          configKey: key,
          oldModel: currentModel,
          newModel: replacement.id,
          reason: `Model "${currentModel}" no longer available. Replaced with "${replacement.id}" (${replacement.displayName}).`,
        })
        logger.warn({ key, oldModel: currentModel, newModel: replacement.id }, 'Auto-replacing deprecated model')
      } else {
        logger.error({ key, model: currentModel }, 'Model deprecated but no replacement found in same family')
      }
    }
  }

  // Apply replacements to .env + reload
  if (replacements.length > 0) {
    updateEnvFile(replacements)
    // Reload config so changes take effect
    const { reloadEnvConfig } = await import('../config.js')
    reloadEnvConfig()
    logger.info({ count: replacements.length }, 'Applied model replacements')
  }

  const result: ScanResult = {
    anthropic: anthropicModels,
    google: googleModels,
    lastScanAt: new Date().toISOString(),
    replacements,
  }

  _lastScanResult = result
  return result
}

// ═══════════════════════════════════════════
// Periodic scanner
// ═══════════════════════════════════════════
const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000 // 6 hours
let _intervalId: ReturnType<typeof setInterval> | null = null

export function startModelScanner(intervalMs = DEFAULT_INTERVAL_MS): void {
  // Run immediately on start
  scanModels().catch(err => logger.error({ err }, 'Initial model scan failed'))

  _intervalId = setInterval(() => {
    scanModels().catch(err => logger.error({ err }, 'Periodic model scan failed'))
  }, intervalMs)

  logger.info({ intervalHours: intervalMs / 3600000 }, 'Model scanner started')
}

export function stopModelScanner(): void {
  if (_intervalId) {
    clearInterval(_intervalId)
    _intervalId = null
    logger.info('Model scanner stopped')
  }
}
