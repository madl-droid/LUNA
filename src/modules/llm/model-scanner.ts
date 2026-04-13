// LUNA — LLM Model Scanner
// Escanea APIs de providers, detecta modelos deprecados, auto-reemplaza.
// Integrado como servicio interno del módulo LLM.

import * as fs from 'node:fs'
import * as path from 'node:path'
import pino from 'pino'
import Anthropic from '@anthropic-ai/sdk'
import { GoogleGenAI } from '@google/genai'
import type { Registry } from '../../kernel/registry.js'
import * as configStore from '../../kernel/config-store.js'
import type { ScannedModel, ScanResult, ModelReplacement } from './types.js'
import { detectFamily } from './helpers.js'

const logger = pino({ name: 'llm:model-scanner' })

// ═══════════════════════════════════════════
// API calls
// ═══════════════════════════════════════════

async function fetchAnthropicModels(apiKey: string): Promise<ScannedModel[]> {
  try {
    const client = new Anthropic({ apiKey })
    const page = await client.models.list()
    return page.data.map((m: { id: string; display_name: string; created_at: string }) => ({
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
    const client = new GoogleGenAI({ apiKey })
    const pager = await client.models.list()
    const models: ScannedModel[] = []
    for await (const m of pager) {
      const name = m.name ?? ''
      if (!name.startsWith('models/gemini')) continue
      const id = name.replace('models/', '')
      models.push({
        id,
        displayName: m.displayName ?? id,
        provider: 'google' as const,
        family: detectFamily(id),
        createdAt: '',
      })
    }
    return models
  } catch (err) {
    logger.error({ err }, 'Error fetching Google models')
    return []
  }
}

// ═══════════════════════════════════════════
// Replacement logic
// ═══════════════════════════════════════════

function findReplacement(missingId: string, available: ScannedModel[]): ScannedModel | null {
  const family = detectFamily(missingId)
  const candidates = available
    .filter(m => m.family === family)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return candidates[0] ?? null
}

// ═══════════════════════════════════════════
// Instance config update
// ═══════════════════════════════════════════

function updateInstanceConfigModels(anthropicModels: ScannedModel[], googleModels: ScannedModel[]): void {
  const configPath = path.resolve('instance/config.json')
  fs.mkdirSync(path.dirname(configPath), { recursive: true })
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
}

// ═══════════════════════════════════════════
// .env + config_store update
// ═══════════════════════════════════════════

function updateEnvFile(replacements: ModelReplacement[]): void {
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

/**
 * Write replacements to config_store (DB) so that models configured via
 * the console (which are stored in config_store, not .env) are also updated.
 */
async function updateConfigStore(registry: Registry, replacements: ModelReplacement[]): Promise<void> {
  if (replacements.length === 0) return
  const pool = registry.getDb()
  for (const r of replacements) {
    try {
      await configStore.set(pool, r.configKey, r.newModel, false)
      logger.info({ key: r.configKey, newModel: r.newModel }, 'Auto-replaced deprecated model in config_store')
    } catch (err) {
      logger.error({ err, key: r.configKey }, 'Failed to update config_store for deprecated model')
    }
  }
}

// ═══════════════════════════════════════════
// Main scan
// ═══════════════════════════════════════════

let _lastScanResult: ScanResult | null = null

export function getLastScanResult(): ScanResult | null {
  return _lastScanResult
}

/**
 * All configurable routing tasks — mirrors CONFIGURABLE_TASKS in task-router.ts.
 * Each task has up to 3 tiers: primary, downgrade, fallback.
 * For each tier we track both the model key and its provider key.
 */
const ROUTING_TASKS = [
  'MAIN', 'COMPLEX', 'LOW', 'CRITICIZE', 'MEDIA',
  'WEB_SEARCH', 'COMPRESS', 'BATCH', 'TTS', 'KNOWLEDGE',
] as const

interface ModelConfigEntry {
  modelKey: string
  providerKey: string
}

/** Build the full list of (modelKey, providerKey) pairs for all tasks × tiers */
function buildModelConfigEntries(): ModelConfigEntry[] {
  const entries: ModelConfigEntry[] = []
  for (const task of ROUTING_TASKS) {
    // Primary
    entries.push({ modelKey: `LLM_${task}_MODEL`, providerKey: `LLM_${task}_PROVIDER` })
    // Downgrade
    entries.push({ modelKey: `LLM_${task}_DOWNGRADE_MODEL`, providerKey: `LLM_${task}_DOWNGRADE_PROVIDER` })
    // Fallback
    entries.push({ modelKey: `LLM_${task}_FALLBACK_MODEL`, providerKey: `LLM_${task}_FALLBACK_PROVIDER` })
  }
  return entries
}

export async function scanModels(registry: Registry): Promise<ScanResult> {
  logger.info('Starting model scan...')

  const config = registry.getConfig<{ ANTHROPIC_API_KEY: string; GOOGLE_AI_API_KEY: string }>('llm')
  const anthropicKey = config.ANTHROPIC_API_KEY
  const googleKey = config.GOOGLE_AI_API_KEY
  const errors: Array<{ provider: string; message: string }> = []

  if (!anthropicKey) {
    errors.push({ provider: 'anthropic', message: 'ANTHROPIC_API_KEY is not configured. Set it in API Keys to scan Anthropic models.' })
  }
  if (!googleKey) {
    errors.push({ provider: 'google', message: 'GOOGLE_AI_API_KEY is not configured. Set it in API Keys to scan Google models.' })
  }

  const anthropicModels = anthropicKey ? await fetchAnthropicModels(anthropicKey) : []
  const googleModels = googleKey ? await fetchGoogleModels(googleKey) : []

  logger.info({ anthropic: anthropicModels.length, google: googleModels.length, errors: errors.length }, 'Models discovered')

  if (anthropicModels.length > 0 || googleModels.length > 0) {
    updateInstanceConfigModels(anthropicModels, googleModels)
  }

  // Check for deprecated models and auto-replace.
  // Read from registry.getConfig() which merges process.env + config_store (DB),
  // so models configured via the console are correctly detected.
  const llmConfig = registry.getConfig<Record<string, string>>('llm')
  const allAvailableIds = new Set([...anthropicModels, ...googleModels].map(m => m.id))
  const replacements: ModelReplacement[] = []

  for (const { modelKey, providerKey } of buildModelConfigEntries()) {
    const currentModel = llmConfig[modelKey]
    if (!currentModel) continue

    const provider = llmConfig[providerKey] ?? 'anthropic'
    const providerModels = provider === 'google' ? googleModels : anthropicModels

    // Skip if we have no data for this provider (API key missing, etc.)
    if (providerModels.length === 0) continue

    if (!allAvailableIds.has(currentModel)) {
      const replacement = findReplacement(currentModel, providerModels)
      if (replacement) {
        replacements.push({
          configKey: modelKey,
          oldModel: currentModel,
          newModel: replacement.id,
          reason: `Model "${currentModel}" no longer available. Replaced with "${replacement.id}" (${replacement.displayName}).`,
        })
        logger.warn({ key: modelKey, oldModel: currentModel, newModel: replacement.id }, 'Auto-replacing deprecated model')
      } else {
        logger.error({ key: modelKey, model: currentModel }, 'Model deprecated but no replacement found in same family')
      }
    }
  }

  if (replacements.length > 0) {
    // Update .env for process-level env vars
    updateEnvFile(replacements)
    // Update config_store for models configured via console (stored in DB)
    await updateConfigStore(registry, replacements)
  }

  const result: ScanResult = {
    anthropic: anthropicModels,
    google: googleModels,
    lastScanAt: new Date().toISOString(),
    replacements,
    errors: errors.length > 0 ? errors : undefined,
  }

  _lastScanResult = result
  return result
}

// ═══════════════════════════════════════════
// Periodic scanner
// ═══════════════════════════════════════════

let _intervalId: ReturnType<typeof setInterval> | null = null

export function startScanner(registry: Registry, intervalMs = 21600000): void {
  // Run immediately on start
  scanModels(registry).catch(err => logger.error({ err }, 'Initial model scan failed'))

  _intervalId = setInterval(() => {
    scanModels(registry).catch(err => logger.error({ err }, 'Periodic model scan failed'))
  }, intervalMs)

  logger.info({ intervalHours: intervalMs / 3600000 }, 'Model scanner started')
}

export function stopScanner(): void {
  if (_intervalId) {
    clearInterval(_intervalId)
    _intervalId = null
    logger.info('Model scanner stopped')
  }
}
