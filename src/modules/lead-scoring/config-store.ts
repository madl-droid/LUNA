// LUNA — Module: lead-scoring — Config Store
// Lee/escribe instance/qualifying.json. Hot-reload via Apply.
// Supports framework presets (CHAMP, SPIN, CHAMP+Gov) and custom config.

import * as fs from 'node:fs'
import * as path from 'node:path'
import pino from 'pino'
import type { QualifyingConfig, FrameworkType } from './types.js'
import { FRAMEWORK_PRESETS, DEFAULT_AUTO_SIGNALS } from './frameworks.js'

const logger = pino({ name: 'lead-scoring:config' })

const DEFAULT_CONFIG: QualifyingConfig = {
  framework: 'custom',
  stages: [],
  criteria: [
    {
      key: 'budget',
      name: { es: 'Presupuesto', en: 'Budget' },
      type: 'enum',
      options: ['low', 'medium', 'high'],
      weight: 25,
      required: false,
      neverAskDirectly: true,
    },
    {
      key: 'authority',
      name: { es: 'Autoridad', en: 'Authority' },
      type: 'enum',
      options: ['decision_maker', 'influencer', 'researcher'],
      weight: 20,
      required: false,
      neverAskDirectly: false,
    },
    {
      key: 'need',
      name: { es: 'Necesidad', en: 'Need' },
      type: 'text',
      weight: 30,
      required: true,
      neverAskDirectly: false,
    },
    {
      key: 'timeline',
      name: { es: 'Timeline', en: 'Timeline' },
      type: 'enum',
      options: ['urgent', 'this_month', 'this_quarter', 'no_rush'],
      weight: 25,
      required: false,
      neverAskDirectly: false,
    },
  ],
  thresholds: {
    cold: 30,
    qualifying: 31,
    qualified: 70,
  },
  qualifiedActions: ['scheduled', 'transferred_to_sales', 'sold', 'purchase_complete'],
  defaultQualifiedAction: 'scheduled',
  disqualifyReasons: [
    { key: 'no_budget', name: { es: 'Sin presupuesto', en: 'No budget' }, targetStatus: 'not_interested' },
    { key: 'not_interested', name: { es: 'No interesado', en: 'Not interested' }, targetStatus: 'not_interested' },
    { key: 'spam', name: { es: 'Spam', en: 'Spam' }, targetStatus: 'blocked' },
    { key: 'out_of_zone', name: { es: 'Fuera de zona', en: 'Out of zone' }, targetStatus: 'out_of_zone' },
  ],
  autoSignals: DEFAULT_AUTO_SIGNALS,
  maxCustomCriteria: 6,
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
   * Apply a framework preset. Replaces stages, criteria, and disqualifyReasons
   * with the preset's defaults. Preserves thresholds, actions, and options.
   */
  applyFramework(frameworkType: FrameworkType): QualifyingConfig {
    if (frameworkType === 'custom') {
      // Switch to custom — keep current criteria but clear framework marker
      const updated = { ...this.config, framework: 'custom' as FrameworkType, stages: [] }
      this.save(updated)
      return updated
    }

    const preset = FRAMEWORK_PRESETS[frameworkType]
    if (!preset) {
      throw new Error(`Unknown framework: ${frameworkType}`)
    }

    const updated: QualifyingConfig = {
      ...this.config,
      framework: frameworkType,
      stages: preset.stages,
      criteria: preset.criteria,
      disqualifyReasons: preset.disqualifyReasons,
    }

    this.save(updated)
    logger.info({ framework: frameworkType }, 'Framework preset applied')
    return updated
  }

  private loadFromDisk(): QualifyingConfig {
    if (!fs.existsSync(this.filePath)) {
      logger.info({ path: this.filePath }, 'No qualifying.json found, using defaults')
      // Write defaults to disk so the file exists
      const dir = path.dirname(this.filePath)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
      fs.writeFileSync(this.filePath, JSON.stringify(DEFAULT_CONFIG, null, 2), 'utf-8')
      return JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as QualifyingConfig
    }

    try {
      const raw = fs.readFileSync(this.filePath, 'utf-8')
      const parsed = JSON.parse(raw) as QualifyingConfig
      // Apply defaults for new fields added after initial deploy
      if (parsed.minConfidence === undefined) parsed.minConfidence = 0.3
      if (parsed.framework === undefined) parsed.framework = 'custom'
      if (parsed.stages === undefined) parsed.stages = []
      if (parsed.autoSignals === undefined) parsed.autoSignals = DEFAULT_AUTO_SIGNALS
      this.validate(parsed)
      return parsed
    } catch (err) {
      logger.error({ err, path: this.filePath }, 'Failed to parse qualifying.json, using defaults')
      return JSON.parse(JSON.stringify(DEFAULT_CONFIG)) as QualifyingConfig
    }
  }

  private validate(config: QualifyingConfig): void {
    if (!Array.isArray(config.criteria)) {
      throw new Error('criteria must be an array')
    }
    // Framework presets can have more than 10 criteria (B2G has ~24)
    // Only enforce max for custom frameworks
    if (config.framework === 'custom' && config.criteria.length > 10) {
      throw new Error('Maximum 10 criteria allowed for custom framework (4 base + 6 custom)')
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

    // Validate weights sum
    const totalWeight = config.criteria.reduce((sum, c) => sum + c.weight, 0)
    if (totalWeight !== 100 && config.criteria.length > 0) {
      logger.warn({ totalWeight }, 'Criteria weights do not sum to 100 — scores will be normalized')
    }

    // Validate unique keys
    const keys = new Set<string>()
    for (const c of config.criteria) {
      if (keys.has(c.key)) throw new Error(`Duplicate criterion key: ${c.key}`)
      keys.add(c.key)
    }

    // Validate enum criteria have options
    for (const c of config.criteria) {
      if (c.type === 'enum' && (!c.options || c.options.length === 0)) {
        throw new Error(`Enum criterion "${c.key}" must have options`)
      }
    }

    // Validate stages if framework is not custom
    if (config.framework !== 'custom' && config.stages) {
      const stageKeys = new Set(config.stages.map(s => s.key))
      for (const c of config.criteria) {
        if (c.stage && !stageKeys.has(c.stage)) {
          throw new Error(`Criterion "${c.key}" references unknown stage "${c.stage}"`)
        }
      }
    }
  }
}

export { DEFAULT_CONFIG }
