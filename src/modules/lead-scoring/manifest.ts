// LUNA — Module: lead-scoring (v3)
// Single-framework. Preset-based config. Priority weights.

import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderLeadScoringConsole } from './templates.js'
import { z } from 'zod'
import pino from 'pino'
import type { ModuleManifest, ApiRoute } from '../../kernel/types.js'
import type { Registry } from '../../kernel/registry.js'
import { jsonResponse, parseBody, parseQuery } from '../../kernel/http-helpers.js'
import type {
  LeadScoringConfig,
  QualifyingConfig,
  QualificationStatus,
} from './types.js'
import { PRESETS } from './frameworks.js'
import { ConfigStore } from './config-store.js'
import { LeadQueries } from './pg-queries.js'
import { registerExtractionTool } from './extract-tool.js'
import { calculateScore, resolveTransition } from './scoring-engine.js'

const logger = pino({ name: 'lead-scoring' })

let configStore: ConfigStore | null = null
let leadQueries: LeadQueries | null = null

// ═══════════════════════════════════════════
// API Routes
// ═══════════════════════════════════════════

function createApiRoutes(): ApiRoute[] {
  const getConfigStore = (): ConfigStore => {
    if (!configStore) throw new Error('Lead scoring not initialized')
    return configStore
  }
  const getQueries = (): LeadQueries => {
    if (!leadQueries) throw new Error('Lead scoring not initialized')
    return leadQueries
  }
  return [
    // ─── Config endpoints ───

    // GET /console/api/lead-scoring/config
    {
      method: 'GET',
      path: 'config',
      handler: async (_req, res) => {
        try {
          const config = getConfigStore().getConfig()
          jsonResponse(res, 200, { config })
        } catch (err) {
          jsonResponse(res, 500, { error: String(err) })
        }
      },
    },

    // PUT /console/api/lead-scoring/config
    {
      method: 'PUT',
      path: 'config',
      handler: async (req, res) => {
        try {
          const body = await parseBody<QualifyingConfig>(req)
          getConfigStore().save(body)
          jsonResponse(res, 200, { ok: true })
        } catch (err) {
          jsonResponse(res, 400, { error: String(err) })
        }
      },
    },

    // GET /console/api/lead-scoring/presets
    {
      method: 'GET',
      path: 'presets',
      handler: async (_req, res) => {
        try {
          const presets = Object.values(PRESETS).map(p => ({
            key: p.key,
            name: p.name,
            description: p.description,
            defaultObjective: p.defaultObjective,
            stageCount: p.stages.length,
            criteriaCount: p.criteria.length,
            essentialQuestions: p.essentialQuestions,
          }))
          jsonResponse(res, 200, { presets })
        } catch (err) {
          jsonResponse(res, 500, { error: String(err) })
        }
      },
    },

    // POST /console/api/lead-scoring/apply-preset
    {
      method: 'POST',
      path: 'apply-preset',
      handler: async (req, res) => {
        try {
          const body = await parseBody<{ preset: string }>(req)
          if (!body.preset) {
            jsonResponse(res, 400, { error: 'Missing preset' })
            return
          }
          const store = getConfigStore()
          store.applyPreset(body.preset)
          jsonResponse(res, 200, { ok: true })
        } catch (err) {
          jsonResponse(res, 400, { error: String(err) })
        }
      },
    },

    // POST /console/api/lead-scoring/recalculate
    {
      method: 'POST',
      path: 'recalculate',
      handler: async (_req, res) => {
        try {
          const queries = getQueries()
          const store = getConfigStore()
          const config = store.getConfig()
          const leads = await queries.getAllLeadsForRecalc()

          const updates: Array<{ contactId: string; score: number; status: QualificationStatus | null }> = []
          for (const lead of leads) {
            const result = calculateScore(lead.qualificationData, config)
            const newStatus = resolveTransition(lead.qualificationStatus, result.suggestedStatus)
            updates.push({
              contactId: lead.contactId,
              score: result.totalScore,
              status: newStatus,
            })
          }

          const count = await queries.batchUpdateScores(updates)
          jsonResponse(res, 200, { ok: true, recalculated: count })
        } catch (err) {
          jsonResponse(res, 500, { error: String(err) })
        }
      },
    },

    // ─── Stats endpoint ───

    // GET /console/api/lead-scoring/stats
    {
      method: 'GET',
      path: 'stats',
      handler: async (_req, res) => {
        try {
          const stats = await getQueries().getStats()
          jsonResponse(res, 200, { stats })
        } catch (err) {
          jsonResponse(res, 500, { error: String(err) })
        }
      },
    },

    // GET /console/api/lead-scoring/stats-detailed
    {
      method: 'GET',
      path: 'stats-detailed',
      handler: async (req, res) => {
        try {
          const q = parseQuery(req)
          const period = (q.get('period') as 'today' | '7d' | '30d' | '90d' | 'all') ?? 'all'
          const channelsRaw = q.get('channels')
          const channels = channelsRaw ? channelsRaw.split(',').filter(Boolean) : undefined
          const qualification = (q.get('qualification') as QualificationStatus) ?? undefined
          const metrics = await getQueries().getStatsDetailed({ period, channels, qualification })
          jsonResponse(res, 200, { metrics })
        } catch (err) {
          jsonResponse(res, 500, { error: String(err) })
        }
      },
    },

    // ─── Lead endpoints ───

    // GET /console/api/lead-scoring/leads
    {
      method: 'GET',
      path: 'leads',
      handler: async (req, res) => {
        try {
          const q = parseQuery(req)
          const result = await getQueries().listLeads({
            status: (q.get('status') as QualificationStatus) ?? undefined,
            search: q.get('search') ?? undefined,
            limit: q.has('limit') ? parseInt(q.get('limit')!, 10) : 50,
            offset: q.has('offset') ? parseInt(q.get('offset')!, 10) : 0,
            sortBy: (q.get('sort') as 'score' | 'updated' | 'created') ?? 'updated',
            sortDir: (q.get('dir') as 'asc' | 'desc') ?? 'desc',
          })
          jsonResponse(res, 200, result)
        } catch (err) {
          jsonResponse(res, 500, { error: String(err) })
        }
      },
    },

    // GET /console/api/lead-scoring/lead?id=X
    {
      method: 'GET',
      path: 'lead',
      handler: async (req, res) => {
        try {
          const q = parseQuery(req)
          const contactId = q.get('id')
          if (!contactId) {
            jsonResponse(res, 400, { error: 'Missing "id" query parameter' })
            return
          }
          const lead = await getQueries().getLeadDetail(contactId)
          if (!lead) {
            jsonResponse(res, 404, { error: 'Lead not found' })
            return
          }
          jsonResponse(res, 200, { lead })
        } catch (err) {
          jsonResponse(res, 500, { error: String(err) })
        }
      },
    },

    // PUT /console/api/lead-scoring/lead-status
    {
      method: 'PUT',
      path: 'lead-status',
      handler: async (req, res) => {
        try {
          const body = await parseBody<{
            contactId: string
            status: QualificationStatus
          }>(req)
          if (!body.contactId || !body.status) {
            jsonResponse(res, 400, { error: 'Missing contactId or status' })
            return
          }
          // Load, recalc, and update
          const lead = await getQueries().getLeadDetail(body.contactId)
          if (lead) {
            const config = getConfigStore().getConfig()
            const result = calculateScore(lead.qualificationData, config)
            await getQueries().updateQualification(
              body.contactId,
              lead.qualificationData,
              result.totalScore,
              body.status,
            )
          }
          jsonResponse(res, 200, { ok: true })
        } catch (err) {
          jsonResponse(res, 400, { error: String(err) })
        }
      },
    },

    // POST /console/api/lead-scoring/disqualify
    {
      method: 'POST',
      path: 'disqualify',
      handler: async (req, res) => {
        try {
          const body = await parseBody<{
            contactId: string
            reasonKey: string
          }>(req)
          if (!body.contactId || !body.reasonKey) {
            jsonResponse(res, 400, { error: 'Missing contactId or reasonKey' })
            return
          }
          const config = getConfigStore().getConfig()
          const reason = config.disqualifyReasons.find(r => r.key === body.reasonKey)
          const targetStatus: QualificationStatus = reason?.targetStatus ?? 'not_interested'
          await getQueries().disqualifyLead(body.contactId, body.reasonKey, targetStatus)
          jsonResponse(res, 200, { ok: true })
        } catch (err) {
          jsonResponse(res, 400, { error: String(err) })
        }
      },
    },

    // ─── UI endpoint ───

    // GET /console/api/lead-scoring/ui
    {
      method: 'GET',
      path: 'ui',
      handler: async (_req, res) => {
        try {
          const thisDir = path.dirname(fileURLToPath(import.meta.url))
          const candidates = [
            path.resolve(thisDir, 'ui', 'lead-scoring.html'),
            path.resolve(process.cwd(), 'dist', 'modules', 'lead-scoring', 'ui', 'lead-scoring.html'),
            path.resolve(process.cwd(), 'src', 'modules', 'lead-scoring', 'ui', 'lead-scoring.html'),
          ]
          for (const htmlPath of candidates) {
            if (fs.existsSync(htmlPath)) {
              const html = fs.readFileSync(htmlPath, 'utf-8')
              res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
              res.end(html)
              return
            }
          }
          res.writeHead(404, { 'Content-Type': 'text/plain' })
          res.end('Lead scoring UI not found')
        } catch (err) {
          jsonResponse(res, 500, { error: String(err) })
        }
      },
    },
  ]
}

// ═══════════════════════════════════════════
// Manifest
// ═══════════════════════════════════════════

const manifest: ModuleManifest = {
  name: 'lead-scoring',
  version: '3.0.0',
  description: {
    es: 'Sistema de calificación de leads (preset único por tenant, pesos por prioridad, scoring por código)',
    en: 'Lead scoring system (single preset per tenant, priority-based weights, code scoring)',
  },
  type: 'feature',
  removable: true,
  activateByDefault: true,
  depends: ['tools'],

  configSchema: z.object({
    LEAD_SCORING_CONFIG_PATH: z.string().default('instance/qualifying.json'),
  }),

  console: {
    title: { es: 'Calificación', en: 'Qualification' },
    info: {
      es: 'Configura el framework de calificación, criterios con prioridad y objetivo del agente.',
      en: 'Configure the qualification framework, priority-based criteria and agent objective.',
    },
    order: 15,
    group: 'leads',
    icon: '&#128202;',
    apiRoutes: createApiRoutes(),
  },

  async init(registry: Registry) {
    const config = registry.getConfig<LeadScoringConfig>('lead-scoring')
    const db = registry.getDb()

    // Initialize config store
    const configPath = path.resolve(process.cwd(), config.LEAD_SCORING_CONFIG_PATH)
    configStore = new ConfigStore(configPath)
    leadQueries = new LeadQueries(db)

    // Register services
    registry.provide('lead-scoring:config', configStore)
    registry.provide('lead-scoring:queries', leadQueries)

    // Provide renderSection service for inline console embedding (SSR)
    registry.provide('lead-scoring:renderSection', (lang: 'es' | 'en') => {
      return renderLeadScoringConsole(configStore!, lang)
    })

    // Register extraction tool
    await registerExtractionTool(registry, configStore)

    // Listen for config apply → reload + optional recalculate
    registry.addHook('lead-scoring', 'console:config_applied', async () => {
      const store = configStore!
      const oldConfig = store.getConfig()
      const newConfig = store.reload()

      // Recalculate if criteria/thresholds changed
      const criteriaChanged = JSON.stringify(oldConfig.criteria) !== JSON.stringify(newConfig.criteria)
      const thresholdsChanged = JSON.stringify(oldConfig.thresholds) !== JSON.stringify(newConfig.thresholds)

      if (criteriaChanged || thresholdsChanged) {
        logger.info('Config changed, recalculating all lead scores...')
        const leads = await leadQueries!.getAllLeadsForRecalc()
        const updates: Array<{ contactId: string; score: number; status: QualificationStatus | null }> = []

        for (const lead of leads) {
          const result = calculateScore(lead.qualificationData, newConfig)
          const newStatus = resolveTransition(lead.qualificationStatus, result.suggestedStatus)
          updates.push({
            contactId: lead.contactId,
            score: result.totalScore,
            status: newStatus,
          })
        }

        if (updates.length > 0) {
          await leadQueries!.batchUpdateScores(updates)
        }
      }
    })

    logger.info('Lead scoring module v3 initialized')
  },

  async stop() {
    configStore = null
    leadQueries = null
    logger.info('Lead scoring module stopped')
  },
}

export default manifest
