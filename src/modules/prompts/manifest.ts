// LUNA — Module: prompts
// Gestión centralizada de prompts del agente. Editables desde oficina, con cache en memoria.
// Campaign matching via fuse.js. Evaluador generado on-demand por LLM.

import pino from 'pino'
import type { ModuleManifest, ApiRoute } from '../../kernel/types.js'
import type { Registry } from '../../kernel/registry.js'
import type { PromptSlot } from './types.js'
import { ensureTable, ensureCampaignColumns } from './pg-queries.js'
import * as campaignQueries from './pg-queries.js'
import { PromptsServiceImpl } from './prompts-service.js'

const logger = pino({ name: 'prompts' })

let service: PromptsServiceImpl | null = null

function jsonResponse(res: import('node:http').ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(data))
}

function parseBody(req: import('node:http').IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      try {
        const body = Buffer.concat(chunks).toString()
        resolve(body ? JSON.parse(body) : {})
      } catch (err) { reject(err) }
    })
    req.on('error', reject)
  })
}

function parseQuery(req: import('node:http').IncomingMessage): URLSearchParams {
  const url = new URL(req.url ?? '', 'http://localhost')
  return url.searchParams
}

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

  oficina: {
    title: { es: 'Prompts del Agente', en: 'Agent Prompts' },
    info: {
      es: 'Edita los prompts que definen la personalidad, trabajo, reglas y relaciones del agente. Los cambios se aplican inmediatamente.',
      en: 'Edit the prompts that define the agent\'s personality, job, rules and relationships. Changes apply immediately.',
    },
    order: 5,
    fields: [
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

    // Sync oficina fields with DB content
    await syncOficinaFields(registry)

    // Hot-reload when oficina saves/applies config
    registry.addHook('prompts', 'oficina:config_saved', async (payload) => {
      const keys = payload.keys ?? []
      const promptKeys = keys.filter((k: string) => k.startsWith('PROMPT_'))
      if (promptKeys.length > 0 && service) {
        await syncFromOficina(registry)
      }
    })

    registry.addHook('prompts', 'oficina:config_applied', async () => {
      if (service) {
        await syncFromOficina(registry)
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
 * Load prompt content from DB into config_store so oficina fields show current values.
 */
async function syncOficinaFields(registry: Registry): Promise<void> {
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
 * When oficina saves PROMPT_* fields, sync them back to prompt_slots table.
 */
async function syncFromOficina(registry: Registry): Promise<void> {
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
