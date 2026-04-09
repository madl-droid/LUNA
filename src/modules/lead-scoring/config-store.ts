// LUNA — Module: lead-scoring — Config Store (v3)
// Single-framework config. Reads/writes instance/qualifying.json.
// Handles 3 migration formats: flat BANT, multi-framework v2, single-framework v3.

import * as fs from 'node:fs'
import * as path from 'node:path'
import pino from 'pino'
import type { QualifyingConfig, QualifyingCriterion } from './types.js'
import { generateKeyFromName } from './types.js'
import { PRESETS, SPIN_PRESET } from './frameworks.js'

const logger = pino({ name: 'lead-scoring:config' })

export const DEFAULT_CONFIG: QualifyingConfig = {
  preset: 'spin',
  objective: 'schedule',
  stages: SPIN_PRESET.stages,
  criteria: SPIN_PRESET.criteria,
  disqualifyReasons: SPIN_PRESET.disqualifyReasons,
  essentialQuestions: SPIN_PRESET.essentialQuestions,
  thresholds: { cold: 30, qualifying: 31, qualified: 70 },
  minConfidence: 0.4,
  dataFreshnessWindowDays: 90,
}

export class ConfigStore {
  private config: QualifyingConfig
  private filePath: string

  constructor(configPath: string) {
    this.filePath = path.resolve(configPath)
    this.config = this.loadFromDisk()
  }

  getConfig(): QualifyingConfig {
    return this.config
  }

  reload(): QualifyingConfig {
    this.config = this.loadFromDisk()
    logger.info('Qualifying config reloaded from disk')
    return this.config
  }

  save(newConfig: QualifyingConfig): void {
    this.validate(newConfig)
    const dir = path.dirname(this.filePath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    fs.writeFileSync(this.filePath, JSON.stringify(newConfig, null, 2), 'utf-8')
    this.config = newConfig
    logger.info('Qualifying config saved to disk')
  }

  /**
   * Apply a preset — replaces criteria, stages, disqualifyReasons with the preset's defaults.
   * Preserves objective and thresholds.
   */
  applyPreset(presetKey: string): QualifyingConfig {
    const preset = PRESETS[presetKey]
    if (!preset) throw new Error(`Unknown preset: ${presetKey}`)
    const newConfig: QualifyingConfig = {
      ...this.config,
      preset: presetKey,
      stages: JSON.parse(JSON.stringify(preset.stages)) as typeof preset.stages,
      criteria: JSON.parse(JSON.stringify(preset.criteria)) as typeof preset.criteria,
      disqualifyReasons: JSON.parse(JSON.stringify(preset.disqualifyReasons)) as typeof preset.disqualifyReasons,
      essentialQuestions: [...preset.essentialQuestions],
    }
    this.save(newConfig)
    return this.config
  }

  /**
   * Add a criterion. Max 10 total.
   */
  addCriterion(criterion: QualifyingCriterion): void {
    if (this.config.criteria.length >= 10) {
      throw new Error('Maximum 10 criteria allowed')
    }
    const clone = JSON.parse(JSON.stringify(this.config)) as QualifyingConfig
    clone.criteria.push(criterion)
    this.save(clone)
  }

  /**
   * Remove a criterion by key.
   */
  removeCriterion(key: string): void {
    const clone = JSON.parse(JSON.stringify(this.config)) as QualifyingConfig
    clone.criteria = clone.criteria.filter(c => c.key !== key)
    // Remove from essentialQuestions if referenced
    clone.essentialQuestions = clone.essentialQuestions.filter(k => k !== key)
    this.save(clone)
  }

  // ───────────────────────────────────────────────────────────
  // Private
  // ───────────────────────────────────────────────────────────

  private loadFromDisk(): QualifyingConfig {
    if (!fs.existsSync(this.filePath)) {
      logger.info({ path: this.filePath }, 'No qualifying.json found, using defaults')
      const dir = path.dirname(this.filePath)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
      fs.writeFileSync(this.filePath, JSON.stringify(DEFAULT_CONFIG, null, 2), 'utf-8')
      return JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as QualifyingConfig
    }

    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8')
      const parsed = JSON.parse(raw) as Record<string, unknown>
      const migrated = this.migrateIfNeeded(parsed)
      this.validate(migrated)
      return migrated
    } catch (err) {
      logger.error({ err, path: this.filePath }, 'Failed to parse qualifying.json, using defaults')
      return JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as QualifyingConfig
    }
  }

  /**
   * Detect format and migrate to v3 if needed.
   * Format 1: Old flat (BANT) — has 'criteria' at root, no 'frameworks', no 'preset'
   * Format 2: Multi-framework (v2) — has 'frameworks' array
   * Format 3: New single-framework (v3) — has 'preset' key
   */
  private migrateIfNeeded(raw: Record<string, unknown>): QualifyingConfig {
    if ('criteria' in raw && !('frameworks' in raw) && !('preset' in raw)) {
      logger.info('Migrating flat BANT config (v1) to single-framework format (v3)')
      return this.migrateFromFlat(raw)
    }
    if ('frameworks' in raw) {
      logger.info('Migrating multi-framework config (v2) to single-framework format (v3)')
      return this.migrateFromMultiFramework(raw)
    }
    // Already v3 — fill in any missing fields with defaults
    const config = raw as unknown as QualifyingConfig
    if (config.minConfidence === undefined) config.minConfidence = 0.4
    if (config.dataFreshnessWindowDays === undefined) config.dataFreshnessWindowDays = 90
    return config
  }

  /**
   * Migrate from flat BANT format (criteria at root, weights as numbers).
   * Uses SPIN preset for stages, converts weight→priority.
   */
  private migrateFromFlat(old: Record<string, unknown>): QualifyingConfig {
    const oldCriteria = (old['criteria'] as Array<Record<string, unknown>>) ?? []
    const oldThresholds = (old['thresholds'] as QualifyingConfig['thresholds']) ?? DEFAULT_CONFIG.thresholds
    const oldDisqualify = (old['disqualifyReasons'] as QualifyingConfig['disqualifyReasons']) ?? []
    const oldMinConf = (old['minConfidence'] as number) ?? 0.4

    const criteria: QualifyingCriterion[] = oldCriteria.map(c => ({
      key: c['key'] as string,
      name: c['name'] as { es: string; en: string },
      type: (c['type'] as QualifyingCriterion['type']) ?? 'text',
      options: c['options'] as string[] | undefined,
      priority: weightToPriority(c['weight'] as number | undefined),
      required: (c['required'] as boolean) ?? false,
      neverAskDirectly: (c['neverAskDirectly'] as boolean) ?? false,
      stage: c['stage'] as string | undefined,
    }))

    const newConfig: QualifyingConfig = {
      preset: 'spin',
      objective: 'schedule',
      stages: JSON.parse(JSON.stringify(SPIN_PRESET.stages)) as typeof SPIN_PRESET.stages,
      criteria: criteria.length > 0 ? criteria : JSON.parse(JSON.stringify(SPIN_PRESET.criteria)) as typeof SPIN_PRESET.criteria,
      disqualifyReasons: oldDisqualify.length > 0 ? oldDisqualify : JSON.parse(JSON.stringify(SPIN_PRESET.disqualifyReasons)) as typeof SPIN_PRESET.disqualifyReasons,
      essentialQuestions: SPIN_PRESET.essentialQuestions,
      thresholds: oldThresholds,
      minConfidence: oldMinConf,
      dataFreshnessWindowDays: 90,
    }

    this.writeToDisk(newConfig)
    logger.info('Flat BANT config migrated to v3 and saved')
    return newConfig
  }

  /**
   * Migrate from multi-framework v2 format.
   * Takes the first enabled framework (or first if none enabled).
   */
  private migrateFromMultiFramework(old: Record<string, unknown>): QualifyingConfig {
    const frameworks = (old['frameworks'] as Array<Record<string, unknown>>) ?? []
    const enabled = frameworks.filter(f => f['enabled'] === true)
    const source = enabled[0] ?? frameworks[0]

    if (!source) {
      logger.warn('Multi-framework config has no frameworks, using defaults')
      return JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as QualifyingConfig
    }

    const fwType = (source['type'] as string) ?? 'spin'
    const preset = PRESETS[fwType]
    const objective = (source['objective'] as QualifyingConfig['objective']) ?? 'schedule'

    // Convert criteria: weight→priority
    const rawCriteria = (source['criteria'] as Array<Record<string, unknown>>) ?? []
    const criteria: QualifyingCriterion[] = rawCriteria.map(c => ({
      key: c['key'] as string,
      name: c['name'] as { es: string; en: string },
      type: (c['type'] as QualifyingCriterion['type']) ?? 'text',
      options: c['options'] as string[] | undefined,
      priority: weightToPriority(c['weight'] as number | undefined),
      required: (c['required'] as boolean) ?? false,
      neverAskDirectly: (c['neverAskDirectly'] as boolean) ?? false,
      stage: c['stage'] as string | undefined,
    }))

    const oldThresholds = (old['thresholds'] as QualifyingConfig['thresholds']) ?? DEFAULT_CONFIG.thresholds

    const newConfig: QualifyingConfig = {
      preset: fwType,
      objective,
      stages: (source['stages'] as QualifyingConfig['stages']) ?? (preset?.stages ?? SPIN_PRESET.stages),
      criteria: criteria.length > 0 ? criteria : (preset?.criteria ?? SPIN_PRESET.criteria),
      disqualifyReasons: (source['disqualifyReasons'] as QualifyingConfig['disqualifyReasons']) ?? (preset?.disqualifyReasons ?? SPIN_PRESET.disqualifyReasons),
      essentialQuestions: (source['essentialQuestions'] as string[]) ?? (preset?.essentialQuestions ?? SPIN_PRESET.essentialQuestions),
      thresholds: oldThresholds,
      minConfidence: (old['minConfidence'] as number) ?? 0.4,
      dataFreshnessWindowDays: 90,
    }

    this.writeToDisk(newConfig)
    logger.info({ preset: fwType }, 'Multi-framework config migrated to v3 and saved')
    return newConfig
  }

  private writeToDisk(config: QualifyingConfig): void {
    const dir = path.dirname(this.filePath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    fs.writeFileSync(this.filePath, JSON.stringify(config, null, 2), 'utf-8')
  }

  private validate(config: QualifyingConfig): void {
    if (!Array.isArray(config.criteria)) {
      throw new Error('criteria must be an array')
    }
    if (config.criteria.length > 10) {
      throw new Error(`Maximum 10 criteria allowed (got ${config.criteria.length})`)
    }
    if (!config.thresholds || typeof config.thresholds.cold !== 'number') {
      throw new Error('thresholds.cold must be a number')
    }
    if (!config.thresholds || typeof config.thresholds.qualified !== 'number') {
      throw new Error('thresholds.qualified must be a number')
    }
    if (config.thresholds.cold >= config.thresholds.qualified) {
      throw new Error('thresholds.cold must be less than thresholds.qualified')
    }

    // Validate enum criteria have options
    for (const c of config.criteria) {
      if (c.type === 'enum' && (!c.options || c.options.length === 0)) {
        throw new Error(`Enum criterion "${c.key}" must have options`)
      }
    }

    // Validate unique keys
    const keys = new Set<string>()
    for (const c of config.criteria) {
      if (keys.has(c.key)) throw new Error(`Duplicate criterion key: ${c.key}`)
      keys.add(c.key)
    }

    // Validate stages referenced by criteria exist
    if (config.stages && config.stages.length > 0) {
      const stageKeys = new Set(config.stages.map(s => s.key))
      for (const c of config.criteria) {
        if (c.stage && !stageKeys.has(c.stage)) {
          throw new Error(`Criterion "${c.key}" references unknown stage "${c.stage}"`)
        }
      }
    }

    // Validate essential questions (max 2, must reference valid criteria)
    if (config.essentialQuestions) {
      if (config.essentialQuestions.length > 2) {
        throw new Error('Max 2 essential questions allowed')
      }
      const criteriaKeys = new Set(config.criteria.map(c => c.key))
      for (const eq of config.essentialQuestions) {
        if (!criteriaKeys.has(eq)) {
          throw new Error(`Essential question "${eq}" does not match any criterion key`)
        }
      }
    }
  }
}

/** Convert old numeric weight to priority level */
function weightToPriority(weight: number | undefined): QualifyingCriterion['priority'] {
  if (!weight) return 'medium'
  if (weight >= 8) return 'high'
  if (weight >= 4) return 'medium'
  return 'low'
}

/** Auto-generate a criterion key from the English name */
export function autoGenerateKey(nameEn: string): string {
  return generateKeyFromName(nameEn)
}
