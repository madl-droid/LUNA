// LUNA — Module: prompts
// Gestión centralizada de prompts del agente. Editables desde console, con cache en memoria.
// Evaluador generado on-demand por LLM. Campaign management moved to lead-scoring module.

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import pino from 'pino'
import { z } from 'zod'
import { numEnv } from '../../kernel/config-helpers.js'
import type { ModuleManifest, ApiRoute } from '../../kernel/types.js'
import type { Registry } from '../../kernel/registry.js'
import { jsonResponse, parseBody, parseQuery } from '../../kernel/http-helpers.js'
import type { PromptSlot } from './types.js'
import { PromptsServiceImpl } from './prompts-service.js'

const logger = pino({ name: 'prompts' })

let service: PromptsServiceImpl | null = null

/** Maps config key -> { slot, variant } for bidirectional sync between console and prompt_slots DB */
const PROMPT_SYNC_MAP: Array<{ configKey: string; slot: PromptSlot; variant: string }> = [
  { configKey: 'PROMPT_IDENTITY', slot: 'identity', variant: 'default' },
  { configKey: 'PROMPT_JOB', slot: 'job', variant: 'default' },
  { configKey: 'PROMPT_GUARDRAILS', slot: 'guardrails', variant: 'default' },
  { configKey: 'PROMPT_CRITICIZER', slot: 'criticizer', variant: 'default' },
  { configKey: 'PROMPT_RELATIONSHIP_LEAD', slot: 'relationship', variant: 'lead' },
  { configKey: 'PROMPT_RELATIONSHIP_ADMIN', slot: 'relationship', variant: 'admin' },
  { configKey: 'PROMPT_RELATIONSHIP_COWORKER', slot: 'relationship', variant: 'coworker' },
  { configKey: 'PROMPT_RELATIONSHIP_UNKNOWN', slot: 'relationship', variant: 'unknown' },
]

const apiRoutes: ApiRoute[] = [
  // ─── Prompt slots ─────────────────────────
  {
    method: 'GET',
    path: 'slots',
    handler: async (_req, res) => {
      if (!service) { jsonResponse(res, 503, { error: 'Service not ready' }); return }
      const all = await service.listAll()
      jsonResponse(res, 200, { slots: all })
    },
  },
  {
    method: 'GET',
    path: 'slot',
    handler: async (req, res) => {
      if (!service) { jsonResponse(res, 503, { error: 'Service not ready' }); return }
      const params = parseQuery(req)
      const slot = params.get('slot') as PromptSlot | null
      const variant = params.get('variant') ?? 'default'
      if (!slot) { jsonResponse(res, 400, { error: 'Missing slot parameter' }); return }
      const content = await service.getPrompt(slot, variant)
      jsonResponse(res, 200, { slot, variant, content })
    },
  },
  {
    method: 'PUT',
    path: 'slot',
    handler: async (req, res) => {
      if (!service) { jsonResponse(res, 503, { error: 'Service not ready' }); return }
      const body = await parseBody(req)
      const slot = body.slot as PromptSlot | undefined
      const variant = (body.variant as string) ?? 'default'
      const content = body.content as string | undefined
      if (!slot || content === undefined) {
        jsonResponse(res, 400, { error: 'Missing slot or content' }); return
      }
      await service.upsert(slot, variant, content)
      // Sync to config_store so console UI reflects the change immediately
      try {
        const configStore = await import('../../kernel/config-store.js')
        const match = PROMPT_SYNC_MAP.find(m => m.slot === slot && m.variant === variant)
        if (match) {
          const db = service.db
          await configStore.set(db, match.configKey, content, false)
        }
      } catch { /* best-effort sync */ }
      jsonResponse(res, 200, { ok: true })
    },
  },
  {
    method: 'POST',
    path: 'generate-evaluator',
    handler: async (_req, res) => {
      if (!service) { jsonResponse(res, 503, { error: 'Service not ready' }); return }
      const content = await service.generateEvaluator()
      jsonResponse(res, 200, { ok: true, content })
    },
  },
  // Campaign management moved to lead-scoring module
  // See: /console/api/lead-scoring/campaigns

  // ─── Category 2: System prompt templates (read-only) ─────
  {
    method: 'GET',
    path: 'system-prompts',
    handler: async (_req, res) => {
      if (!service) { jsonResponse(res, 503, { error: 'Service not ready' }); return }
      const names = await service.listSystemPrompts()
      const templates: Array<{ name: string; content: string }> = []
      for (const name of names) {
        const content = await service.getSystemPrompt(name)
        templates.push({ name, content })
      }
      jsonResponse(res, 200, { templates })
    },
  },
  {
    method: 'POST',
    path: 'reload-system',
    handler: async (_req, res) => {
      if (!service) { jsonResponse(res, 503, { error: 'Service not ready' }); return }
      service.clearSystemPromptCache()
      jsonResponse(res, 200, { ok: true, message: 'System prompt template cache cleared' })
    },
  },
]

const manifest: ModuleManifest = {
  name: 'prompts',
  version: '1.0.0',
  description: {
    es: 'Gestión centralizada de prompts del agente',
    en: 'Centralized agent prompt management',
  },
  type: 'feature',
  removable: true,
  activateByDefault: true,
  depends: [], // llm is optional (only for evaluator generation)
  configSchema: z.object({
    AGENT_NAME: z.string().default('Luna'),
    AGENT_LAST_NAME: z.string().default(''),
    AGENT_TITLE: z.string().default(''),
    AGENT_LANGUAGE: z.string().default('es'),
    AGENT_COUNTRY: z.string().default(''),
    AGENT_TIMEZONE: z.string().default(''),
    COMPANY_NAME: z.string().default(''),
    COMPANY_WEBSITES: z.string().default(''),
    AGENT_ACCENT: z.string().default(''),
    // Generated accent prompt — injected into context when accent is set
    // Content will be built by a future accent prompt generator
    AGENT_ACCENT_PROMPT: z.string().default(''),
    AGENT_TTS_STYLE_PROMPT: z.string().default(''),
    // Prompts system config
    PROMPTS_MAX_SYSTEM_PROMPT_TOKENS: numEnv(4000),
    PROMPTS_MAX_COMPRESSION_SUMMARY_TOKENS: numEnv(1000),
  }),

  console: {
    title: { es: 'Prompts del Agente', en: 'Agent Prompts' },
    info: {
      es: 'Edita los prompts que definen la personalidad, trabajo, reglas y relaciones del agente. Los cambios se aplican inmediatamente.',
      en: 'Edit the prompts that define the agent\'s personality, job, rules and relationships. Changes apply immediately.',
    },
    order: 5,
    group: 'agent',
    icon: '&#128221;',
    fields: [
      { key: '_divider_agent_identity', type: 'divider', label: { es: 'Identidad del agente', en: 'Agent identity' } },
      {
        key: 'AGENT_NAME',
        type: 'text',
        label: { es: 'Nombre', en: 'First name' },
        info: {
          es: 'Nombre del agente. Usado para @mencion en canales instant, firmas, saludos. Fuente unica de verdad para todos los canales.',
          en: 'Agent first name. Used for @mention in instant channels, signatures, greetings. Single source of truth for all channels.',
        },
        width: 'half',
      },
      {
        key: 'AGENT_LAST_NAME',
        type: 'text',
        label: { es: 'Apellido', en: 'Last name' },
        info: {
          es: 'Apellido del agente. Opcional. Usado en firmas y presentaciones formales.',
          en: 'Agent last name. Optional. Used in signatures and formal introductions.',
        },
        width: 'half',
      },
      {
        key: 'AGENT_TITLE',
        type: 'text',
        label: { es: 'Cargo', en: 'Title' },
        info: {
          es: 'Cargo o rol del agente. Usado en presentaciones y firmas formales.',
          en: 'Agent title or role. Used in introductions and formal signatures.',
        },
        width: 'half',
      },
      {
        key: 'AGENT_LANGUAGE',
        type: 'select',
        label: { es: 'Idioma', en: 'Language' },
        info: {
          es: 'Idioma principal del agente. Afecta mensajes de sistema, avisos, y preferencia de respuesta.',
          en: 'Agent primary language. Affects system messages, ack messages, and response preference.',
        },
        options: [
          { value: 'es', label: 'Espanol / Spanish' },
          { value: 'en', label: 'English / Ingles' },
        ],
        width: 'half',
      },
      {
        key: 'COMPANY_NAME',
        type: 'text',
        label: { es: 'Empresa', en: 'Company' },
        info: {
          es: 'Nombre de la empresa donde trabaja el agente. Se inyecta en la identidad del agente.',
          en: 'Company the agent works for. Injected into the agent identity.',
        },
        width: 'half',
      },
      {
        key: 'COMPANY_WEBSITES',
        type: 'tags',
        label: { es: 'Sitios web de la empresa', en: 'Company websites' },
        info: {
          es: 'URLs del sitio web de la empresa (separadas por coma). El agente puede leer estas páginas directamente sin usar el subagente de búsqueda web.',
          en: 'Company website URLs (comma separated). The agent can read these pages directly without the web search subagent.',
        },
        separator: ',',
        width: 'full',
        placeholder: 'https://miempresa.com, https://docs.miempresa.com',
      },
      {
        key: 'AGENT_COUNTRY',
        type: 'text',
        label: { es: 'Pa\u00eds', en: 'Country' },
        info: {
          es: 'Pa\u00eds donde opera el agente. Afecta contexto regional y referencias culturales.',
          en: 'Country where the agent operates. Affects regional context and cultural references.',
        },
        width: 'half',
      },
      {
        key: 'AGENT_ACCENT',
        type: 'text',
        label: { es: 'Acento / Locale', en: 'Accent / Locale' },
        info: {
          es: 'Codigo BCP-47 del acento regional (ej: es-MX, es-CO, en-US). Gestionado desde la pagina Identidad donde puedes elegirlo con un selector por idioma.',
          en: 'BCP-47 regional accent code (e.g. es-MX, es-CO, en-US). Managed from the Identity page where you can select it by language.',
        },
        width: 'half',
      },
      { key: '_divider_prompts', type: 'divider', label: { es: 'Prompts del agente', en: 'Agent prompts' } },
      {
        key: 'PROMPT_IDENTITY',
        type: 'textarea',
        label: { es: 'Identidad', en: 'Identity' },
        info: { es: 'Quién es el agente. Define personalidad y tono base.', en: 'Who the agent is. Defines personality and base tone.' },
      },
      {
        key: 'PROMPT_JOB',
        type: 'textarea',
        label: { es: 'Trabajo / Misión', en: 'Job / Mission' },
        info: { es: 'Qué hace el agente. Su misión y objetivos principales.', en: 'What the agent does. Its mission and main objectives.' },
      },
      {
        key: 'PROMPT_GUARDRAILS',
        type: 'textarea',
        label: { es: 'Reglas / Guardrails', en: 'Rules / Guardrails' },
        info: { es: 'Reglas y límites que el agente nunca debe violar.', en: 'Rules and limits the agent must never violate.' },
      },
      { key: '_divider_criticizer', type: 'divider', label: { es: 'Checklist de calidad', en: 'Quality checklist' } },
      {
        key: '_info_criticizer_base',
        type: 'readonly',
        label: { es: 'Base del sistema (no editable)', en: 'System base (not editable)' },
        info: {
          es: 'Estas reglas son fijas y garantizan la eficiencia del sistema. Se cargan de instance/prompts/system/criticizer-base.md.',
          en: 'These rules are fixed and guarantee system efficiency. Loaded from instance/prompts/system/criticizer-base.md.',
        },
      },
      {
        key: 'PROMPT_CRITICIZER',
        type: 'textarea',
        label: { es: 'Checklist personalizable', en: 'Customizable checklist' },
        info: {
          es: 'Puntos adicionales de auto-revisión antes de enviar. Personaliza el estilo y metodología del agente.',
          en: 'Additional self-review points before sending. Customize the agent style and methodology.',
        },
      },
      { key: '_divider_relationships', type: 'divider', label: { es: 'Relaciones por tipo de usuario', en: 'Relationships by user type' } },
      {
        key: 'PROMPT_RELATIONSHIP_LEAD',
        type: 'textarea',
        label: { es: 'Relacion con leads', en: 'Relationship with leads' },
        info: {
          es: 'Como debe tratar el agente a los leads (clientes potenciales). Define tono, nivel de formalidad y objetivos.',
          en: 'How the agent should treat leads (potential customers). Define tone, formality level and objectives.',
        },
      },
      {
        key: 'PROMPT_RELATIONSHIP_ADMIN',
        type: 'textarea',
        label: { es: 'Relacion con admins', en: 'Relationship with admins' },
        info: {
          es: 'Como debe tratar el agente a los administradores del sistema. Puede ser mas tecnico y directo.',
          en: 'How the agent should treat system administrators. Can be more technical and direct.',
        },
      },
      {
        key: 'PROMPT_RELATIONSHIP_COWORKER',
        type: 'textarea',
        label: { es: 'Relacion con coworkers', en: 'Relationship with coworkers' },
        info: {
          es: 'Como debe tratar el agente a los companeros de trabajo. Tono colaborativo e informal.',
          en: 'How the agent should treat coworkers. Collaborative and informal tone.',
        },
      },
      {
        key: 'PROMPT_RELATIONSHIP_UNKNOWN',
        type: 'textarea',
        label: { es: 'Relacion con desconocidos', en: 'Relationship with unknowns' },
        info: {
          es: 'Como debe tratar el agente a contactos no identificados. Cauteloso pero amable.',
          en: 'How the agent should treat unidentified contacts. Cautious but friendly.',
        },
      },
    ],
    apiRoutes,
  },

  async init(registry: Registry) {
    const db = registry.getDb()

    // Create service
    service = new PromptsServiceImpl(db, registry)
    await service.initialize()

    // Expose service
    registry.provide('prompts:service', service)

    // Sync console fields with DB content
    await syncConsoleFields(registry)

    // Hot-reload when console saves/applies config
    registry.addHook('prompts', 'console:config_saved', async (payload) => {
      const keys = payload.keys ?? []
      const promptKeys = keys.filter((k: string) => k.startsWith('PROMPT_'))
      if (promptKeys.length > 0 && service) {
        await syncFromConsole(registry)
      }
      // Auto-generate accent prompt when AGENT_ACCENT changes
      if (keys.includes('AGENT_ACCENT')) {
        await generateAccentPrompt(registry)
      }
    })

    registry.addHook('prompts', 'console:config_applied', async () => {
      if (service) {
        await syncFromConsole(registry)
        service.invalidateCache()
        service.clearSystemPromptCache()
      }
    })

    // Ensure accent prompt is generated if accent was set (e.g. by setup wizard)
    // but accent prompt was never generated yet
    const bootCfg = registry.getConfig<{
      AGENT_ACCENT: string
      AGENT_ACCENT_PROMPT: string
      AGENT_TTS_STYLE_PROMPT: string
    }>('prompts')
    if (bootCfg.AGENT_ACCENT && (!bootCfg.AGENT_ACCENT_PROMPT || !bootCfg.AGENT_TTS_STYLE_PROMPT)) {
      await generateAccentPrompt(registry)
      await registry.reloadAllModuleConfigs()
    }

    logger.info('Prompts module initialized')
  },

  async stop() {
    service = null
  },
}

/**
 * Load prompt content from DB into config_store so console fields show current values.
 */
async function syncConsoleFields(registry: Registry): Promise<void> {
  if (!service) return
  const configStore = await import('../../kernel/config-store.js')
  const db = registry.getDb()

  for (const { configKey, slot, variant } of PROMPT_SYNC_MAP) {
    const content = await service.getPrompt(slot, variant)
    if (content) {
      await configStore.set(db, configKey, content, false).catch(() => {})
    }
  }
}

/**
 * When console saves PROMPT_* fields, sync them back to prompt_slots table.
 */
async function syncFromConsole(registry: Registry): Promise<void> {
  if (!service) return
  const configStore = await import('../../kernel/config-store.js')
  const db = registry.getDb()

  for (const { configKey, slot, variant } of PROMPT_SYNC_MAP) {
    const value = await configStore.get(db, configKey).catch(() => null)
    if (value !== null && value !== undefined) {
      await service.upsert(slot, variant, value)
    }
  }
}


function buildIdentityAccentPrompt(accent: string, traitPrompt: string): string {
  const languageScopedPrefix = accent.startsWith('en-')
    ? 'Apply this accent profile only when responding in English. Speak naturally; never imitate pronunciation with misspellings. When the answer will be spoken aloud, you may lean into natural regional wording, discourse markers, and rhythm that fit this accent, but keep them subtle, clear, and easy to understand.'
    : 'Aplica este perfil de acento solo cuando respondas en espanol. Habla natural natural; nunca imites pronunciacion con errores escritos. Cuando la respuesta vaya a sonar en audio, puedes inclinarte un poco hacia giros regionales, muletillas y ritmo propios de este acento, pero siempre de forma sutil, clara y facil de entender.'

  const writingDirectives = accent.startsWith('en-')
    ? 'For text responses, prefer lexical choice, cadence, politeness level, and a light regional flavor over exaggerated slang.'
    : 'Para respuestas en texto, prioriza eleccion lexical, cadencia, nivel de formalidad y un matiz regional ligero por encima del slang exagerado.'

  const traitLabel = accent.startsWith('en-') ? 'Accent profile:' : 'Perfil del acento:'

  return `${languageScopedPrefix}

${writingDirectives}

${traitLabel}
${traitPrompt}`
}

function buildTtsAccentPrompt(accent: string, traitPrompt: string): string {
  const audioProfile = accent.startsWith('en-')
    ? 'You are a professional voice actor performing a regional accent for customer-facing audio. Keep the transcript faithful and let the accent be heard mainly through cadence, prosody, vowel color, articulation, consonant shaping, and pacing.'
    : 'Eres un locutor profesional interpretando un acento regional para audio orientado al cliente. Manten el transcript fiel y deja que el acento se perciba sobre todo en la cadencia, la prosodia, el color vocalico, la articulacion, el modelado de consonantes y la velocidad.'

  const directorsNotes = accent.startsWith('en-')
    ? [
        'DIRECTOR NOTES:',
        '- Do not rewrite, translate, or embellish the transcript.',
        '- Keep the accent natural, subtle, and consistent. Never caricature it.',
        '- Prioritize intelligibility first and regional flavor second.',
        '- Apply pronunciation cues only when they sound natural in fluent speech.',
        '- Express local identity mostly through rhythm, melody, stress, pacing, and light pronunciation detail.',
      ].join('\n')
    : [
        'NOTAS DE DIRECCION:',
        '- No reescribas, traduzcas ni adornes el transcript.',
        '- Manten el acento natural, sutil y consistente. Nunca lo caricaturices.',
        '- Prioriza primero la inteligibilidad y despues el color regional.',
        '- Aplica los rasgos de pronunciacion solo cuando suenen naturales en habla fluida.',
        '- Expresa la identidad local sobre todo a traves de ritmo, melodia, acentuacion, velocidad y detalles ligeros de pronunciacion.',
      ].join('\n')

  const traitLabel = accent.startsWith('en-') ? 'ACCENT TRAITS:' : 'RASGOS DEL ACENTO:'

  return `${audioProfile}

${directorsNotes}

${traitLabel}
${traitPrompt}`
}

/**
 * Auto-generate AGENT_ACCENT_PROMPT and AGENT_TTS_STYLE_PROMPT when accent changes.
 * Trait text is loaded from instance/prompts/accents/{accent}.md.
 */
async function generateAccentPrompt(registry: Registry): Promise<void> {
  const configStore = await import('../../kernel/config-store.js')
  const db = registry.getDb()
  const accent = await configStore.get(db, 'AGENT_ACCENT').catch(() => '')

  if (!accent) {
    await configStore.set(db, 'AGENT_ACCENT_PROMPT', '', false).catch(() => {})
    await configStore.set(db, 'AGENT_TTS_STYLE_PROMPT', '', false).catch(() => {})
    return
  }

  const accentPath = join(process.cwd(), 'instance', 'prompts', 'accents', `${accent}.md`)
  let traitPrompt = ''
  try {
    traitPrompt = (await readFile(accentPath, 'utf-8')).trim()
  } catch {
    logger.warn({ accent, path: accentPath }, 'Accent .md file not found')
    await configStore.set(db, 'AGENT_ACCENT_PROMPT', '', false).catch(() => {})
    await configStore.set(db, 'AGENT_TTS_STYLE_PROMPT', '', false).catch(() => {})
    return
  }

  await configStore.set(db, 'AGENT_ACCENT_PROMPT', buildIdentityAccentPrompt(accent, traitPrompt), false).catch(() => {})
  await configStore.set(db, 'AGENT_TTS_STYLE_PROMPT', buildTtsAccentPrompt(accent, traitPrompt), false).catch(() => {})
  logger.info({ accent }, 'Accent prompt loaded from .md file')
}

export default manifest
