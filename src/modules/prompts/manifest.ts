// LUNA — Module: prompts
// Gestión centralizada de prompts del agente. Editables desde console, con cache en memoria.
// Campaign matching via fuse.js. Evaluador generado on-demand por LLM.

import pino from 'pino'
import { z } from 'zod'
import type { ModuleManifest, ApiRoute } from '../../kernel/types.js'
import type { Registry } from '../../kernel/registry.js'
import { jsonResponse, parseBody, parseQuery } from '../../kernel/http-helpers.js'
import type { PromptSlot } from './types.js'
import { ensureTable, ensureCampaignColumns } from './pg-queries.js'
import * as campaignQueries from './pg-queries.js'
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
  // ─── Campaigns ────────────────────────────
  {
    method: 'GET',
    path: 'campaigns',
    handler: async (_req, res) => {
      if (!service) { jsonResponse(res, 503, { error: 'Service not ready' }); return }
      const campaigns = await campaignQueries.listAllCampaigns(service.db)
      jsonResponse(res, 200, { campaigns })
    },
  },
  {
    method: 'PUT',
    path: 'campaign',
    handler: async (req, res) => {
      if (!service) { jsonResponse(res, 503, { error: 'Service not ready' }); return }
      const body = await parseBody(req)
      const id = body.id as string | undefined
      if (!id) { jsonResponse(res, 400, { error: 'Missing id' }); return }
      await campaignQueries.updateCampaign(
        service.db,
        id,
        (body.match_phrases ?? body.matchPhrases ?? []) as string[],
        (body.match_threshold ?? body.matchThreshold ?? 0.95) as number,
        (body.prompt_context ?? body.promptContext ?? '') as string,
      )
      await service.reloadCampaigns()
      jsonResponse(res, 200, { ok: true })
    },
  },
  {
    method: 'POST',
    path: 'campaign',
    handler: async (req, res) => {
      if (!service) { jsonResponse(res, 503, { error: 'Service not ready' }); return }
      const body = await parseBody(req)
      const name = body.name as string | undefined
      if (!name) { jsonResponse(res, 400, { error: 'Missing name' }); return }
      const id = await campaignQueries.createCampaign(
        service.db,
        name,
        (body.match_phrases ?? body.matchPhrases ?? []) as string[],
        (body.match_threshold ?? body.matchThreshold ?? 0.95) as number,
        (body.prompt_context ?? body.promptContext ?? '') as string,
      )
      await service.reloadCampaigns()
      jsonResponse(res, 200, { ok: true, id })
    },
  },
  {
    method: 'DELETE',
    path: 'campaign',
    handler: async (req, res) => {
      if (!service) { jsonResponse(res, 503, { error: 'Service not ready' }); return }
      const params = parseQuery(req)
      const id = params.get('id')
      if (!id) { jsonResponse(res, 400, { error: 'Missing id' }); return }
      await campaignQueries.deleteCampaign(service.db, id)
      await service.reloadCampaigns()
      jsonResponse(res, 200, { ok: true })
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
      {
        key: 'AGENT_NAME',
        type: 'text',
        label: { es: 'Nombre del agente', en: 'Agent name' },
        info: {
          es: 'Nombre usado para deteccion de @mencion en grupos/rooms de canales instantaneos (WhatsApp, Google Chat, etc). Fuente unica de verdad para todos los canales.',
          en: 'Name used for @mention detection in groups/rooms of instant channels (WhatsApp, Google Chat, etc). Single source of truth for all channels.',
        },
      },
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
    await ensureCampaignColumns(db)

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
