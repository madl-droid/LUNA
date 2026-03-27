// LUNA — Module: prompts
// Gestión centralizada de prompts del agente. Editables desde console, con cache en memoria.
// Evaluador generado on-demand por LLM. Campaign management moved to lead-scoring module.

import pino from 'pino'
import { z } from 'zod'
import { boolEnv, numEnv } from '../../kernel/config-helpers.js'
import type { ModuleManifest, ApiRoute } from '../../kernel/types.js'
import type { Registry } from '../../kernel/registry.js'
import { jsonResponse, parseBody, parseQuery } from '../../kernel/http-helpers.js'
import type { PromptSlot } from './types.js'
import { ensureTable } from './pg-queries.js'
import { PromptsServiceImpl } from './prompts-service.js'

const logger = pino({ name: 'prompts' })

let service: PromptsServiceImpl | null = null

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
    AGENT_ACCENT: z.string().default(''),
    // Generated accent prompt — injected into context when accent is set
    // Content will be built by a future accent prompt generator
    AGENT_ACCENT_PROMPT: z.string().default(''),
    // Prompts system config
    TTS_ENABLED: boolEnv(false),
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
        key: 'AGENT_LANGUAGE',
        type: 'select',
        label: { es: 'Idioma', en: 'Language' },
        info: {
          es: 'Idioma principal del agente. Afecta mensajes de sistema, avisos, y preferencia de respuesta.',
          en: 'Agent primary language. Affects system messages, ack messages, and response preference.',
        },
        options: [
          { value: 'es', label: 'Español / Spanish' },
          { value: 'en', label: 'English / Inglés' },
          { value: 'pt', label: 'Português / Portuguese' },
          { value: 'fr', label: 'Français / French' },
          { value: 'de', label: 'Deutsch / German' },
          { value: 'it', label: 'Italiano / Italian' },
        ],
        width: 'half',
      },
      {
        key: 'AGENT_ACCENT',
        type: 'text',
        label: { es: 'Acento / Locale', en: 'Accent / Locale' },
        info: {
          es: 'Código BCP-47 (ej: es-MX, es-ES, en-US, pt-BR). Usado para voz (TTS/STT) y regionalismos.',
          en: 'BCP-47 code (e.g. es-MX, es-ES, en-US, pt-BR). Used for voice (TTS/STT) and regional expressions.',
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
    ],
    apiRoutes,
  },

  async init(registry: Registry) {
    const db = registry.getDb()

    // Ensure tables
    await ensureTable(db)

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
    })

    registry.addHook('prompts', 'console:config_applied', async () => {
      if (service) {
        await syncFromConsole(registry)
        service.invalidateCache()
      }
    })

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

  const slotToKey: Record<string, PromptSlot> = {
    'PROMPT_IDENTITY': 'identity',
    'PROMPT_JOB': 'job',
    'PROMPT_GUARDRAILS': 'guardrails',
  }

  for (const [configKey, slot] of Object.entries(slotToKey)) {
    const content = await service.getPrompt(slot, 'default')
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

  const slotToKey: Record<string, PromptSlot> = {
    'PROMPT_IDENTITY': 'identity',
    'PROMPT_JOB': 'job',
    'PROMPT_GUARDRAILS': 'guardrails',
  }

  for (const [configKey, slot] of Object.entries(slotToKey)) {
    const value = await configStore.get(db, configKey).catch(() => null)
    if (value !== null && value !== undefined) {
      await service.upsert(slot, 'default', value)
    }
  }
}

export default manifest
