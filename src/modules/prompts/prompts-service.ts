// LUNA — Module: prompts — Service with in-memory cache
// Category 1 (DB-backed) + Category 2 (file-backed system templates)
// Zero hardcoded prompt text — all loaded from .md files

import type { Pool } from 'pg'
import pino from 'pino'
import type { Registry } from '../../kernel/registry.js'
import type {
  PromptSlot,
  PromptRecord,
  CompositorPrompts,
  PromptsService,
} from './types.js'
import * as queries from './pg-queries.js'
import {
  loadSystemPrompt,
  loadDefaultPrompt,
  renderTemplate,
  preloadAll,
  clearTemplateCache,
  listTemplates,
} from './template-loader.js'

const logger = pino({ name: 'prompts:service' })

export class PromptsServiceImpl implements PromptsService {
  private cache = new Map<string, string>()
  // Exposed for manifest API routes (avoids casting hacks)
  readonly db: Pool

  constructor(
    db: Pool,
    private readonly registry: Registry,
  ) {
    this.db = db
  }

  /** Agent first name. Single source of truth for all channels. */
  getAgentName(): string {
    const cfg = this.registry.getConfig<{ AGENT_NAME: string; AGENT_LAST_NAME: string }>('prompts')
    return cfg.AGENT_NAME || 'Luna'
  }

  /** Agent last name. */
  getAgentLastName(): string {
    const cfg = this.registry.getConfig<{ AGENT_LAST_NAME: string }>('prompts')
    return cfg.AGENT_LAST_NAME || ''
  }

  /** Agent full name (first + last, trimmed). */
  getAgentFullName(): string {
    return `${this.getAgentName()} ${this.getAgentLastName()}`.trim()
  }

  /** Agent language code (e.g. 'es', 'en'). */
  getLanguage(): string {
    const cfg = this.registry.getConfig<{ AGENT_LANGUAGE: string }>('prompts')
    return cfg.AGENT_LANGUAGE || 'es'
  }

  /** Agent accent / locale (BCP-47). Empty string = neutral/no accent. */
  getAccent(): string {
    const cfg = this.registry.getConfig<{ AGENT_ACCENT: string }>('prompts')
    return cfg.AGENT_ACCENT || ''
  }

  /**
   * Load all prompts from DB into cache. Seed if empty.
   * Also preloads Category 2 system templates.
   */
  async initialize(): Promise<void> {
    const records = await queries.listAll(this.db)

    if (records.length === 0) {
      logger.info('No prompts in DB — seeding from default files')
      await this.seed()
    }

    // Reload after potential seed
    const all = await queries.listAll(this.db)
    for (const record of all) {
      this.cache.set(`${record.slot}:${record.variant}`, record.content)
    }

    logger.info({ promptCount: all.length }, 'Prompts cache loaded')

    // Preload Category 2 system templates
    await preloadAll()
  }

  async getPrompt(slot: PromptSlot, variant = 'default'): Promise<string> {
    const key = `${slot}:${variant}`
    const cached = this.cache.get(key)
    if (cached !== undefined) return cached

    // Fallback to DB
    const record = await queries.getBySlotVariant(this.db, slot, variant)
    if (record) {
      this.cache.set(key, record.content)
      return record.content
    }

    return ''
  }

  async getCompositorPrompts(userType: string): Promise<CompositorPrompts> {
    const [identity, job, guardrails, criticizer] = await Promise.all([
      this.getPrompt('identity', 'default'),
      this.getPrompt('job', 'default'),
      this.getPrompt('guardrails', 'default'),
      this.getPrompt('criticizer', 'default'),
    ])

    // Relationship: try specific userType, fallback to 'default'
    let relationship = await this.getPrompt('relationship', userType)
    if (!relationship) {
      relationship = await this.getPrompt('relationship', 'default')
    }

    // Inject agent persona and accent into identity
    const cfg = this.registry.getConfig<{
      AGENT_NAME: string; AGENT_LAST_NAME: string; AGENT_TITLE: string
      AGENT_LANGUAGE: string; AGENT_COUNTRY: string
      AGENT_ACCENT: string; AGENT_ACCENT_PROMPT: string
    }>('prompts')

    // Build persona header from config fields
    const personaParts: string[] = []
    const fullName = [cfg.AGENT_NAME, cfg.AGENT_LAST_NAME].filter(Boolean).join(' ')
    if (fullName) personaParts.push(`Tu nombre es ${fullName}.`)
    if (cfg.AGENT_TITLE) personaParts.push(`Tu cargo es ${cfg.AGENT_TITLE}.`)
    if (cfg.AGENT_LANGUAGE) personaParts.push(`Tu idioma principal es ${cfg.AGENT_LANGUAGE}.`)
    if (cfg.AGENT_COUNTRY) personaParts.push(`Operas desde ${cfg.AGENT_COUNTRY}.`)

    let finalIdentity = identity
    if (personaParts.length > 0) {
      finalIdentity = personaParts.join(' ') + '\n\n' + identity
    }
    if (cfg.AGENT_ACCENT && cfg.AGENT_ACCENT_PROMPT) {
      finalIdentity = finalIdentity + '\n\n--- ACENTO ---\n' + cfg.AGENT_ACCENT_PROMPT
    }

    return { identity: finalIdentity, job, guardrails, relationship, criticizer }
  }

  async getEvaluatorGenerated(): Promise<string> {
    return this.getPrompt('evaluator', 'default')
  }

  async generateEvaluator(): Promise<string> {
    // Gather current prompts for context
    const [identity, job, guardrails] = await Promise.all([
      this.getPrompt('identity', 'default'),
      this.getPrompt('job', 'default'),
      this.getPrompt('guardrails', 'default'),
    ])

    // Get all relationship variants
    const relationshipRecords = await queries.getBySlot(this.db, 'relationship')
    const relationships = relationshipRecords.map(r => `[${r.variant}]: ${r.content}`).join('\n')

    // Load meta-evaluator template from file (Category 2)
    const metaTemplate = await this.getSystemPrompt('meta-evaluator', {
      identity,
      job,
      guardrails,
      relationships,
    })

    // Fallback if template file is missing
    const metaPrompt = metaTemplate || [
      `Identidad: ${identity}`,
      `Trabajo: ${job}`,
      `Reglas: ${guardrails}`,
      `Relaciones: ${relationships}`,
    ].join('\n\n')

    try {
      const result = await this.registry.callHook('llm:chat', {
        task: 'generate-evaluator',
        system: 'Genera resúmenes comprimidos y precisos. Responde solo con el resumen.',
        messages: [{ role: 'user', content: metaPrompt }],
        maxTokens: 600,
        temperature: 0.3,
      })

      const content = result?.text ?? ''
      if (content) {
        // Single upsert — both DB and cache
        await this.upsert('evaluator', 'default', content)
        logger.info({ length: content.length }, 'Evaluator prompt generated')
        return content
      }
    } catch (err) {
      logger.error({ err }, 'Failed to generate evaluator prompt')
    }

    return ''
  }

  async upsert(slot: PromptSlot, variant: string, content: string): Promise<void> {
    const isGenerated = slot === 'evaluator'
    await queries.upsert(this.db, slot, variant, content, isGenerated)
    this.cache.set(`${slot}:${variant}`, content)
  }

  async listAll(): Promise<PromptRecord[]> {
    return queries.listAll(this.db)
  }

  invalidateCache(): void {
    this.cache.clear()
    // Reload asynchronously
    queries.listAll(this.db).then(all => {
      for (const record of all) {
        this.cache.set(`${record.slot}:${record.variant}`, record.content)
      }
    }).catch(err => {
      logger.error({ err }, 'Failed to reload cache after invalidation')
    })
  }

  // ─── Category 2: System prompt templates ─────────────────

  async getSystemPrompt(name: string, variables?: Record<string, string>): Promise<string> {
    const template = await loadSystemPrompt(name)
    if (!template) return ''
    if (!variables || Object.keys(variables).length === 0) return template
    return renderTemplate(template, variables)
  }

  clearSystemPromptCache(): void {
    clearTemplateCache()
  }

  async listSystemPrompts(): Promise<string[]> {
    return listTemplates()
  }

  // ─── Seed (from .md files, zero hardcoded text) ─────────────

  private async seed(): Promise<void> {
    // Load seeds from instance/prompts/defaults/*.md
    const [
      identityContent,
      jobContent,
      guardrailsContent,
      criticizerContent,
      relLead,
      relAdmin,
      relCoworker,
      relUnknown,
    ] = await Promise.all([
      loadDefaultPrompt('identity'),
      loadDefaultPrompt('job'),
      loadDefaultPrompt('guardrails'),
      loadDefaultPrompt('criticizer'),
      loadDefaultPrompt('relationship-lead'),
      loadDefaultPrompt('relationship-admin'),
      loadDefaultPrompt('relationship-coworker'),
      loadDefaultPrompt('relationship-unknown'),
    ])

    // Also try legacy location: instance/knowledge/identity.md, guardrails.md
    let identity = identityContent
    let gdrails = guardrailsContent
    if (!identity) {
      identity = await this.tryReadLegacyFile('identity.md')
    }
    if (!gdrails) {
      gdrails = await this.tryReadLegacyFile('guardrails.md')
    }

    await queries.upsert(this.db, 'identity', 'default', identity)
    await queries.upsert(this.db, 'job', 'default', jobContent)
    await queries.upsert(this.db, 'guardrails', 'default', gdrails)
    await queries.upsert(this.db, 'criticizer', 'default', criticizerContent)

    // Relationship variants
    const relationships: Record<string, string> = {
      lead: relLead,
      admin: relAdmin,
      coworker: relCoworker,
      unknown: relUnknown,
    }
    for (const [variant, content] of Object.entries(relationships)) {
      if (content) {
        await queries.upsert(this.db, 'relationship', variant, content)
      }
    }

    // Empty evaluator (will be generated on-demand)
    await queries.upsert(this.db, 'evaluator', 'default', '', true)

    logger.info('Prompts seeded from .md files')
  }

  private async tryReadLegacyFile(filename: string): Promise<string> {
    const { readFile } = await import('node:fs/promises')
    const { join } = await import('node:path')
    try {
      return (await readFile(join(process.cwd(), 'instance', 'knowledge', filename), 'utf-8')).trim()
    } catch {
      return ''
    }
  }
}
