// hitl/manifest.ts — HITL module manifest

import { z } from 'zod'
import type { ModuleManifest } from '../../kernel/types.js'
import type { Registry } from '../../kernel/registry.js'
import { boolEnv, numEnvMin } from '../../kernel/config-helpers.js'
import { jsonResponse, parseBody } from '../../kernel/http-helpers.js'
import type { HitlConfig } from './types.js'
import { TicketStore } from './ticket-store.js'
import { RulesStore } from './rules-store.js'
import { registerHitlTool } from './tool.js'
import { registerInterceptor } from './message-interceptor.js'
import { provideRulesService, provideContextService } from './context-injector.js'
import { registerFollowUpJob } from './follow-up-job.js'
import { renderHitlSection } from './render-section.js'
import pino from 'pino'

const logger = pino({ name: 'hitl' })

let ticketStore: TicketStore
let rulesStore: RulesStore
let config: HitlConfig

const manifest: ModuleManifest = {
  name: 'hitl',
  version: '1.0.0',
  description: {
    es: 'Human-in-the-Loop: consulta humana y escalamiento',
    en: 'Human-in-the-Loop: human consultation and escalation',
  },
  type: 'feature',
  removable: true,
  activateByDefault: true,
  depends: ['tools', 'users'],

  configSchema: z.object({
    HITL_ENABLED: boolEnv(true),
    HITL_DEFAULT_CHANNEL: z.string().default('auto'),
    HITL_TICKET_TTL_HOURS: numEnvMin(1, 24),
    HITL_FOLLOWUP_INTERVAL_MIN: numEnvMin(5, 30),
    HITL_MAX_FOLLOWUPS: numEnvMin(1, 3),
    HITL_AUTO_EXPIRE_NOTIFY: boolEnv(true),
  }),

  console: {
    title: { es: 'HITL', en: 'HITL' },
    info: { es: 'Human-in-the-Loop: consulta humana y escalamiento', en: 'Human-in-the-Loop: human consultation and escalation' },
    order: 55,
    group: 'agent',
    icon: '&#9997;',
    apiRoutes: [], // Populated in init()
  },

  async init(registry: Registry) {
    const db = registry.getDb()
    const redis = registry.getRedis()
    config = registry.getConfig<HitlConfig>('hitl')

    ticketStore = new TicketStore(db)
    rulesStore = new RulesStore(db)

    const getConfig = () => config

    // Register services
    registry.provide('hitl:manager', {
      createTicket: ticketStore.create.bind(ticketStore),
      resolveTicket: ticketStore.resolve.bind(ticketStore),
      getActiveTickets: (filters: Record<string, unknown>) => ticketStore.listTickets(filters as Parameters<typeof ticketStore.listTickets>[0]),
      cancelTicket: ticketStore.cancel.bind(ticketStore),
    })

    provideRulesService(registry, rulesStore)
    provideContextService(registry, redis)

    // Provide render section service for console
    registry.provide('hitl:renderSection', (cfg: Record<string, string>, lang: string) => {
      return renderHitlSection(cfg, lang as 'es' | 'en')
    })

    // Register tool
    await registerHitlTool(registry, ticketStore, getConfig)

    // Register message interceptor
    registerInterceptor(registry, ticketStore, redis, getConfig)

    // Register follow-up job
    registerFollowUpJob(registry, ticketStore, redis, getConfig)

    // Hot-reload config
    registry.addHook('hitl', 'console:config_applied', async () => {
      config = registry.getConfig<HitlConfig>('hitl')
      logger.info('HITL config reloaded')
    })

    // API routes
    manifest.console!.apiRoutes = [
      // Rules CRUD
      {
        method: 'GET',
        path: 'rules',
        handler: async (_req, res) => {
          const rules = await rulesStore.list()
          jsonResponse(res, 200, { ok: true, rules })
        },
      },
      {
        method: 'POST',
        path: 'rules',
        handler: async (req, res) => {
          const body = await parseBody<{ name: string; condition: string; targetRole: string; requestType?: string; urgency?: string; handoff?: boolean }>(req)
          if (!body?.name || !body?.condition || !body?.targetRole) {
            jsonResponse(res, 400, { ok: false, error: 'Missing required fields' })
            return
          }
          const rule = await rulesStore.create(body)
          jsonResponse(res, 201, { ok: true, rule })
        },
      },
      {
        method: 'PUT',
        path: 'rules/:id',
        handler: async (req, res) => {
          const url = new URL(req.url ?? '', 'http://localhost')
          const id = url.pathname.split('/').pop() ?? ''
          const body = await parseBody<Record<string, unknown>>(req)
          if (!body) {
            jsonResponse(res, 400, { ok: false, error: 'Missing body' })
            return
          }
          const rule = await rulesStore.update(id, body)
          if (!rule) {
            jsonResponse(res, 404, { ok: false, error: 'Rule not found' })
            return
          }
          jsonResponse(res, 200, { ok: true, rule })
        },
      },
      {
        method: 'DELETE',
        path: 'rules/:id',
        handler: async (req, res) => {
          const url = new URL(req.url ?? '', 'http://localhost')
          const id = url.pathname.split('/').pop() ?? ''
          const deleted = await rulesStore.remove(id)
          jsonResponse(res, deleted ? 200 : 404, { ok: deleted })
        },
      },
      // Tickets
      {
        method: 'GET',
        path: 'tickets',
        handler: async (req, res) => {
          const url = new URL(req.url ?? '', 'http://localhost')
          const status = url.searchParams.get('status') ?? undefined
          const targetRole = url.searchParams.get('role') ?? undefined
          const limit = parseInt(url.searchParams.get('limit') ?? '50', 10)
          const offset = parseInt(url.searchParams.get('offset') ?? '0', 10)
          const result = await ticketStore.listTickets({
            status: status as import('./types.js').HitlStatus | undefined,
            targetRole,
            limit,
            offset,
          })
          jsonResponse(res, 200, { ok: true, ...result })
        },
      },
      {
        method: 'GET',
        path: 'tickets/:id',
        handler: async (req, res) => {
          const url = new URL(req.url ?? '', 'http://localhost')
          const id = url.pathname.split('/').pop() ?? ''
          const ticket = await ticketStore.getById(id)
          if (!ticket) {
            jsonResponse(res, 404, { ok: false, error: 'Ticket not found' })
            return
          }
          const log = await ticketStore.getTicketLog(id)
          jsonResponse(res, 200, { ok: true, ticket, log })
        },
      },
    ]

    logger.info('HITL module initialized')
  },

  async stop() {
    logger.info('HITL module stopped')
  },
}

export default manifest
