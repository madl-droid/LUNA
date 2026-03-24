// LUNA — Module: prompts — Service with in-memory cache

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Pool } from 'pg'
import pino from 'pino'
import type { Registry } from '../../kernel/registry.js'
import type {
  PromptSlot,
  PromptRecord,
  CompositorPrompts,
  CampaignMatchResult,
  PromptsService,
} from './types.js'
import * as queries from './pg-queries.js'
import { CampaignMatcher } from './campaign-matcher.js'

const logger = pino({ name: 'prompts:service' })

// Default prompts for seed
const DEFAULT_IDENTITY = `Eres LUNA, una asistente de ventas inteligente y amigable.
Tu trabajo es atender a las personas que te contactan, ayudarles con sus preguntas,
y guiarlos hacia una decisión de compra o agendamiento.`

const DEFAULT_JOB = `Tu misión es:
- Calificar leads (entender su necesidad, presupuesto, autoridad, timeline)
- Agendar citas o demostraciones cuando el lead esté listo
- Responder preguntas sobre productos/servicios con información precisa
- Hacer seguimiento profesional sin ser invasiva`

const DEFAULT_GUARDRAILS = `Reglas que debes seguir siempre:
- No inventes información que no tengas
- Si no sabes algo, dilo honestamente y ofrece escalar a un humano
- No compartas datos de otros contactos
- Mantén un tono profesional pero cercano
- No hables de temas ajenos al negocio (política, religión, etc.)
- Si detectas urgencia real, escala inmediatamente a un humano`

const DEFAULT_RELATIONSHIP: Record<string, string> = {
  lead: `Estás hablando con un lead (cliente potencial). Sé servicial, paciente y orientada a ayudar. Busca entender su necesidad.`,
  admin: `Estás hablando con un administrador del sistema. Puedes ser más técnica y directa. Obedece sus instrucciones operativas.`,
  coworker: `Estás hablando con un colaborador interno. Sé directa y eficiente. Ayuda con lo que necesite del sistema.`,
  unknown: `No se ha identificado el tipo de usuario. Trata a la persona como un lead potencial hasta que se determine su rol.`,
}

export class PromptsServiceImpl implements PromptsService {
  private cache = new Map<string, string>()
  private campaignMatcher = new CampaignMatcher()
  // Exposed for manifest API routes (avoids casting hacks)
  readonly db: Pool

  constructor(
    db: Pool,
    private readonly registry: Registry,
  ) {
    this.db = db
  }

  /**
   * Load all prompts from DB into cache. Seed if empty.
   */
  async initialize(): Promise<void> {
    const records = await queries.listAll(this.db)

    if (records.length === 0) {
      logger.info('No prompts in DB — seeding from files or defaults')
      await this.seed()
    }

    // Reload after potential seed
    const all = await queries.listAll(this.db)
    for (const record of all) {
      this.cache.set(`${record.slot}:${record.variant}`, record.content)
    }

    // Load campaign index
    await this.reloadCampaigns()

    logger.info({ promptCount: all.length }, 'Prompts cache loaded')
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
    const [identity, job, guardrails] = await Promise.all([
      this.getPrompt('identity', 'default'),
      this.getPrompt('job', 'default'),
      this.getPrompt('guardrails', 'default'),
    ])

    // Relationship: try specific userType, fallback to 'default'
    let relationship = await this.getPrompt('relationship', userType)
    if (!relationship) {
      relationship = await this.getPrompt('relationship', 'default')
    }

    return { identity, job, guardrails, relationship }
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

    const metaPrompt = `Eres un asistente que genera resúmenes comprimidos para evaluadores de IA.

Dado el siguiente contexto de un agente de ventas, genera un RESUMEN COMPRIMIDO (máximo 500 tokens)
que capture la esencia de quién es el agente, qué hace, sus reglas y cómo trata a cada tipo de usuario.
El resumen debe ser útil para un modelo evaluador que analiza mensajes entrantes.

--- IDENTIDAD ---
${identity}

--- TRABAJO ---
${job}

--- REGLAS ---
${guardrails}

--- RELACIONES ---
${relationships}

Genera el resumen comprimido ahora. Solo el resumen, sin preámbulo.`

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
        // Single upsert — both DB and cache (fix: was double-writing before)
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

  matchCampaign(text: string): CampaignMatchResult | null {
    return this.campaignMatcher.match(text)
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

  async reloadCampaigns(): Promise<void> {
    const campaigns = await queries.listCampaigns(this.db)
    this.campaignMatcher.load(campaigns)
    logger.info({ campaigns: campaigns.length }, 'Campaign matcher reloaded')
  }

  // ─── Seed ─────────────────────────────────

  private async seed(): Promise<void> {
    // Try to read from instance/knowledge/ files
    const knowledgeDir = join(process.cwd(), 'instance', 'knowledge')

    const identityContent = await this.tryReadFile(join(knowledgeDir, 'identity.md'))
    const guardrailsContent = await this.tryReadFile(join(knowledgeDir, 'guardrails.md'))

    await queries.upsert(this.db, 'identity', 'default', identityContent || DEFAULT_IDENTITY)
    await queries.upsert(this.db, 'job', 'default', DEFAULT_JOB)
    await queries.upsert(this.db, 'guardrails', 'default', guardrailsContent || DEFAULT_GUARDRAILS)

    // Relationship variants
    for (const [variant, content] of Object.entries(DEFAULT_RELATIONSHIP)) {
      await queries.upsert(this.db, 'relationship', variant, content)
    }

    // Empty evaluator (will be generated on-demand)
    await queries.upsert(this.db, 'evaluator', 'default', '', true)

    logger.info('Prompts seeded')
  }

  private async tryReadFile(path: string): Promise<string | null> {
    try {
      return await readFile(path, 'utf-8')
    } catch {
      return null
    }
  }
}
