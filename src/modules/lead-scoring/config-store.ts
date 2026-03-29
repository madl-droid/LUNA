// LUNA — Module: lead-scoring — Config Store
// Lee/escribe instance/qualifying.json. Hot-reload via Apply.
// Multi-framework config: multiple frameworks can be active simultaneously.
// Auto-generates keys from criterion names.

import * as fs from 'node:fs'
import * as path from 'node:path'
import pino from 'pino'
import type { QualifyingConfig, FrameworkConfig, FrameworkType, FrameworkObjective, ClientType } from './types.js'
import { CLIENT_TYPE_FRAMEWORK, generateKeyFromName } from './types.js'
import { FRAMEWORK_PRESETS } from './frameworks.js'

const logger = pino({ name: 'lead-scoring:config' })

const spinPreset = FRAMEWORK_PRESETS.spin!

const DEFAULT_CONFIG: QualifyingConfig = {
  frameworks: [
    {
      type: 'spin',
      enabled: true,
      objective: 'schedule',
      stages: spinPreset.stages,
      criteria: spinPreset.criteria,
      disqualifyReasons: spinPreset.disqualifyReasons,
      essentialQuestions: spinPreset.essentialQuestions,
    },
  ],
  thresholds: {
    cold: 30,
    qualifying: 31,
    qualified: 70,
  },
  recalculateOnConfigChange: true,
  minConfidence: 0.3,
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

  /** Get the active frameworks (enabled ones) */
  getActiveFrameworks(): FrameworkConfig[] {
    return this.config.frameworks.filter(f => f.enabled)
  }

  /** Get framework config for a specific client type */
  getFrameworkForClientType(clientType: ClientType): FrameworkConfig | null {
    const fwType = CLIENT_TYPE_FRAMEWORK[clientType]
    return this.config.frameworks.find(f => f.type === fwType && f.enabled) ?? null
  }

  /** Check if multi-framework mode is active (>1 enabled framework) */
  isMultiFramework(): boolean {
    return this.getActiveFrameworks().length > 1
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
   * Enable/disable a framework and set its objective.
   */
  setFramework(frameworkType: FrameworkType, enabled: boolean, objective?: FrameworkObjective): QualifyingConfig {
    const existing = this.config.frameworks.find(f => f.type === frameworkType)
    if (existing) {
      existing.enabled = enabled
      if (objective) existing.objective = objective
    } else if (enabled) {
      const preset = FRAMEWORK_PRESETS[frameworkType]!
      this.config.frameworks.push({
        type: frameworkType,
        enabled: true,
        objective: objective ?? 'schedule',
        stages: preset.stages,
        criteria: preset.criteria,
        disqualifyReasons: preset.disqualifyReasons,
        essentialQuestions: preset.essentialQuestions,
      })
    }
    this.save(this.config)
    return this.config
  }

  /**
   * Reset a framework to its preset defaults (preserving enabled/objective).
   */
  resetFrameworkToPreset(frameworkType: FrameworkType): QualifyingConfig {
    const preset = FRAMEWORK_PRESETS[frameworkType]!
    const existing = this.config.frameworks.find(f => f.type === frameworkType)
    if (existing) {
      existing.stages = preset.stages
      existing.criteria = preset.criteria
      existing.disqualifyReasons = preset.disqualifyReasons
      existing.essentialQuestions = preset.essentialQuestions
    }
    this.save(this.config)
    return this.config
  }

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

      // Migrate old single-framework format to new multi-framework format
      if ('framework' in parsed && !('frameworks' in parsed)) {
        logger.info('Migrating old single-framework config to multi-framework format')
        return this.migrateOldConfig(parsed)
      }

      const config = parsed as unknown as QualifyingConfig
      if (config.minConfidence === undefined) config.minConfidence = 0.3
      if (config.recalculateOnConfigChange === undefined) config.recalculateOnConfigChange = true
      this.validate(config)
      return config
    } catch (err) {
      logger.error({ err, path: this.filePath }, 'Failed to parse qualifying.json, using defaults')
      return JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as QualifyingConfig
    }
  }

  /**
   * Migrate old config format (single framework, autoSignals, custom) to new format.
   */
  private migrateOldConfig(old: Record<string, unknown>): QualifyingConfig {
    const oldFramework = (old['framework'] as string) ?? 'custom'
    const oldCriteria = old['criteria'] as QualifyingConfig['frameworks'][0]['criteria'] ?? []
    const oldStages = old['stages'] as QualifyingConfig['frameworks'][0]['stages'] ?? []
    const oldDisqualify = old['disqualifyReasons'] as QualifyingConfig['frameworks'][0]['disqualifyReasons'] ?? []
    const oldThresholds = old['thresholds'] as QualifyingConfig['thresholds'] ?? DEFAULT_CONFIG.thresholds

    const frameworks: FrameworkConfig[] = []

    if (oldFramework === 'custom') {
      // Old custom → enable SPIN with the existing criteria
      frameworks.push({
        type: 'spin',
        enabled: true,
        objective: 'schedule',
        stages: oldStages.length > 0 ? oldStages : spinPreset.stages,
        criteria: oldCriteria.length > 0 ? oldCriteria : spinPreset.criteria,
        disqualifyReasons: oldDisqualify.length > 0 ? oldDisqualify : spinPreset.disqualifyReasons,
        essentialQuestions: spinPreset.essentialQuestions,
      })
    } else if (oldFramework in FRAMEWORK_PRESETS) {
      const fwType = oldFramework as FrameworkType
      frameworks.push({
        type: fwType,
        enabled: true,
        objective: 'schedule',
        stages: oldStages,
        criteria: oldCriteria,
        disqualifyReasons: oldDisqualify,
        essentialQuestions: FRAMEWORK_PRESETS[fwType]!.essentialQuestions,
      })
    }

    const newConfig: QualifyingConfig = {
      frameworks,
      thresholds: oldThresholds,
      recalculateOnConfigChange: true,
      minConfidence: (old['minConfidence'] as number) ?? 0.3,
    }

    // Save migrated config
    const dir = path.dirname(this.filePath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    fs.writeFileSync(this.filePath, JSON.stringify(newConfig, null, 2), 'utf-8')
    logger.info('Old config migrated and saved')
    return newConfig
  }

  private validate(config: QualifyingConfig): void {
    if (!Array.isArray(config.frameworks)) {
      throw new Error('frameworks must be an array')
    }

    if (config.frameworks.length === 0) {
      throw new Error('At least one framework must be configured')
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

    for (const fw of config.frameworks) {
      this.validateFramework(fw)
    }
  }

  private validateFramework(fw: FrameworkConfig): void {
    if (!fw.criteria || !Array.isArray(fw.criteria)) {
      throw new Error(`Framework ${fw.type}: criteria must be an array`)
    }

    // Validate weights sum to 100
    const totalWeight = fw.criteria.reduce((sum, c) => sum + c.weight, 0)
    if (fw.criteria.length > 0 && totalWeight !== 100) {
      throw new Error(`Framework ${fw.type}: criteria weights must sum to 100 (current: ${totalWeight})`)
    }

    // Validate unique keys
    const keys = new Set<string>()
    for (const c of fw.criteria) {
      if (keys.has(c.key)) throw new Error(`Framework ${fw.type}: duplicate criterion key: ${c.key}`)
      keys.add(c.key)
    }

    // Validate enum criteria have options
    for (const c of fw.criteria) {
      if (c.type === 'enum' && (!c.options || c.options.length === 0)) {
        throw new Error(`Framework ${fw.type}: enum criterion "${c.key}" must have options`)
      }
    }

    // Validate stages
    if (fw.stages) {
      const stageKeys = new Set(fw.stages.map(s => s.key))
      for (const c of fw.criteria) {
        if (c.stage && !stageKeys.has(c.stage)) {
          throw new Error(`Framework ${fw.type}: criterion "${c.key}" references unknown stage "${c.stage}"`)
        }
      }
    }

    // Validate essential questions (max 2, must reference valid criteria)
    if (fw.essentialQuestions) {
      if (fw.essentialQuestions.length > 2) {
        throw new Error(`Framework ${fw.type}: max 2 essential questions allowed`)
      }
      const criteriaKeys = new Set(fw.criteria.map(c => c.key))
      for (const eq of fw.essentialQuestions) {
        if (!criteriaKeys.has(eq)) {
          throw new Error(`Framework ${fw.type}: essential question "${eq}" does not match any criterion key`)
        }
      }
    }
  }
}

/** Auto-generate a criterion key from the English name */
export function autoGenerateKey(nameEn: string): string {
  return generateKeyFromName(nameEn)
}

export { DEFAULT_CONFIG }
