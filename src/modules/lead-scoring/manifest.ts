// LUNA — Module: lead-scoring
// Sistema de calificación de leads. BANT + criterios custom, scoring por código,
// extracción natural por LLM, UI personalizable en console.

import * as fs from 'node:fs'
import * as path from 'node:path'
import { z } from 'zod'
import pino from 'pino'
import type { ModuleManifest, ApiRoute } from '../../kernel/types.js'
import type { Registry } from '../../kernel/registry.js'
import { jsonResponse, parseBody, parseQuery } from '../../kernel/http-helpers.js'
import type { LeadScoringConfig, QualifyingConfig, QualificationStatus } from './types.js'
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

    // ─── Lead endpoints ───

    // GET /console/api/lead-scoring/leads?status=X&search=Y&limit=50&offset=0&sort=score&dir=desc
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
          await getQueries().updateQualification(
            body.contactId,
            {},  // don't change data
            -1,  // placeholder — need to recalc
            body.status,
          )
          // Actually update properly: load and recalc
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
          if (!reason) {
            jsonResponse(res, 400, { error: 'Unknown disqualify reason' })
            return
          }
          await getQueries().disqualifyLead(body.contactId, body.reasonKey, reason.targetStatus)
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
          const candidates = [
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
  version: '1.0.0',
  description: {
    es: 'Sistema de calificación de leads con BANT y criterios personalizables',
    en: 'Lead scoring system with BANT and customizable criteria',
  },
  type: 'feature',
  removable: true,
  activateByDefault: true,
  depends: ['tools'],

  configSchema: z.object({
    LEAD_SCORING_CONFIG_PATH: z.string().default('instance/qualifying.json'),
  }),

  console: {
    title: { es: 'Calificación de Leads', en: 'Lead Scoring' },
    info: {
      es: 'Configura criterios de calificación, umbrales, y visualiza leads del sistema.',
      en: 'Configure qualification criteria, thresholds, and view system leads.',
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

    // Register extraction tool
    await registerExtractionTool(registry, configStore)

    // Listen for config apply → reload + optional recalculate
    registry.addHook('lead-scoring', 'console:config_applied', async () => {
      const store = configStore!
      const oldConfig = store.getConfig()
      const newConfig = store.reload()

      // Recalculate if enabled and thresholds/criteria changed
      if (newConfig.recalculateOnConfigChange) {
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
      }
    })

    logger.info('Lead scoring module initialized')
  },

  async stop() {
    configStore = null
    leadQueries = null
    logger.info('Lead scoring module stopped')
  },
}

export default manifest
