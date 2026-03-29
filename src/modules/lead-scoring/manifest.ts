// LUNA — Module: lead-scoring
// Sistema de calificación de leads. Multi-framework (CHAMP, SPIN, CHAMP+Gov),
// scoring por código, extracción natural por LLM, UI personalizable en console.

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
  FrameworkType,
  FrameworkObjective,
} from './types.js'
import { FRAMEWORK_PRESETS } from './frameworks.js'
import { ConfigStore } from './config-store.js'
import { LeadQueries } from './pg-queries.js'
import { registerExtractionTool, clearExtractionPromptCache } from './extract-tool.js'
import { calculateScore, resolveTransition, resolveFramework } from './scoring-engine.js'
import { CampaignQueries } from './campaign-queries.js'
import { CampaignMatcher } from './campaign-matcher.js'
import type { CampaignMatchResult } from './campaign-types.js'

const logger = pino({ name: 'lead-scoring' })

let configStore: ConfigStore | null = null
let leadQueries: LeadQueries | null = null
let campaignQueries: CampaignQueries | null = null
let campaignMatcher: CampaignMatcher | null = null

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
  const getCampaignQueries = (): CampaignQueries => {
    if (!campaignQueries) throw new Error('Campaign system not initialized')
    return campaignQueries
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
          clearExtractionPromptCache()
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
            const fw = resolveFramework(config, lead.qualificationData)
            const result = calculateScore(lead.qualificationData, config, fw ?? undefined)
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

    // POST /console/api/lead-scoring/set-framework
    {
      method: 'POST',
      path: 'set-framework',
      handler: async (req, res) => {
        try {
          const body = await parseBody<{
            framework: FrameworkType
            enabled: boolean
            objective?: FrameworkObjective
          }>(req)
          if (!body.framework) {
            jsonResponse(res, 400, { error: 'Missing framework' })
            return
          }
          const store = getConfigStore()
          store.setFramework(body.framework, body.enabled, body.objective)
          clearExtractionPromptCache()
          jsonResponse(res, 200, { ok: true })
        } catch (err) {
          jsonResponse(res, 400, { error: String(err) })
        }
      },
    },

    // POST /console/api/lead-scoring/reset-framework
    {
      method: 'POST',
      path: 'reset-framework',
      handler: async (req, res) => {
        try {
          const body = await parseBody<{ framework: FrameworkType }>(req)
          if (!body.framework) {
            jsonResponse(res, 400, { error: 'Missing framework' })
            return
          }
          const store = getConfigStore()
          store.resetFrameworkToPreset(body.framework)
          clearExtractionPromptCache()
          jsonResponse(res, 200, { ok: true })
        } catch (err) {
          jsonResponse(res, 400, { error: String(err) })
        }
      },
    },

    // GET /console/api/lead-scoring/frameworks
    {
      method: 'GET',
      path: 'frameworks',
      handler: async (_req, res) => {
        try {
          const config = getConfigStore().getConfig()
          const presets = Object.values(FRAMEWORK_PRESETS).map(p => {
            const active = config.frameworks.find(f => f.type === p.type)
            return {
              type: p.type,
              clientType: p.clientType,
              name: p.name,
              description: p.description,
              stageCount: p.stages.length,
              criteriaCount: p.criteria.length,
              enabled: active?.enabled ?? false,
              objective: active?.objective ?? 'schedule',
              essentialQuestions: active?.essentialQuestions ?? p.essentialQuestions,
            }
          })
          jsonResponse(res, 200, { presets })
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
            const fw = resolveFramework(config, lead.qualificationData)
            const result = calculateScore(lead.qualificationData, config, fw ?? undefined)
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
          // Search across all frameworks for the reason
          let targetStatus: QualificationStatus = 'not_interested'
          for (const fw of config.frameworks) {
            const reason = fw.disqualifyReasons.find(r => r.key === body.reasonKey)
            if (reason) {
              targetStatus = reason.targetStatus
              break
            }
          }
          await getQueries().disqualifyLead(body.contactId, body.reasonKey, targetStatus)
          jsonResponse(res, 200, { ok: true })
        } catch (err) {
          jsonResponse(res, 400, { error: String(err) })
        }
      },
    },

    // ─── Campaign endpoints ───

    // GET /console/api/lead-scoring/campaigns
    {
      method: 'GET',
      path: 'campaigns',
      handler: async (_req, res) => {
        try {
          const campaigns = await getCampaignQueries().listAllCampaigns()
          jsonResponse(res, 200, { campaigns })
        } catch (err) {
          jsonResponse(res, 500, { error: String(err) })
        }
      },
    },

    // GET /console/api/lead-scoring/campaign?id=X
    {
      method: 'GET',
      path: 'campaign',
      handler: async (req, res) => {
        try {
          const q = parseQuery(req)
          const id = q.get('id')
          if (!id) { jsonResponse(res, 400, { error: 'Missing id' }); return }
          const campaign = await getCampaignQueries().getCampaignById(id)
          if (!campaign) { jsonResponse(res, 404, { error: 'Campaign not found' }); return }
          jsonResponse(res, 200, { campaign })
        } catch (err) {
          jsonResponse(res, 500, { error: String(err) })
        }
      },
    },

    // POST /console/api/lead-scoring/campaign
    {
      method: 'POST',
      path: 'campaign',
      handler: async (req, res) => {
        try {
          const body = await parseBody<{
            name: string; keyword: string; matchThreshold?: number
            matchMaxRounds?: number; allowedChannels?: string[]
            promptContext?: string; utmData?: Record<string, string>; tagIds?: string[]
          }>(req)
          if (!body.name || !body.keyword) {
            jsonResponse(res, 400, { error: 'Missing name or keyword' }); return
          }
          const campaign = await getCampaignQueries().createCampaign(body)
          await reloadCampaignMatcher()
          jsonResponse(res, 201, { campaign })
        } catch (err) {
          jsonResponse(res, 400, { error: String(err) })
        }
      },
    },

    // PUT /console/api/lead-scoring/campaign
    {
      method: 'PUT',
      path: 'campaign',
      handler: async (req, res) => {
        try {
          const body = await parseBody<{
            id: string; name?: string; keyword?: string; matchThreshold?: number
            matchMaxRounds?: number; allowedChannels?: string[]
            promptContext?: string; active?: boolean
            utmData?: Record<string, string>; tagIds?: string[]
          }>(req)
          if (!body.id) { jsonResponse(res, 400, { error: 'Missing id' }); return }
          const campaign = await getCampaignQueries().updateCampaign(body.id, body)
          if (!campaign) { jsonResponse(res, 404, { error: 'Campaign not found' }); return }
          await reloadCampaignMatcher()
          jsonResponse(res, 200, { campaign })
        } catch (err) {
          jsonResponse(res, 400, { error: String(err) })
        }
      },
    },

    // DELETE /console/api/lead-scoring/campaign?id=X
    {
      method: 'DELETE',
      path: 'campaign',
      handler: async (req, res) => {
        try {
          const q = parseQuery(req)
          const id = q.get('id')
          if (!id) { jsonResponse(res, 400, { error: 'Missing id' }); return }
          await getCampaignQueries().deleteCampaign(id)
          await reloadCampaignMatcher()
          jsonResponse(res, 200, { ok: true })
        } catch (err) {
          jsonResponse(res, 400, { error: String(err) })
        }
      },
    },

    // ─── Tag endpoints ───

    // GET /console/api/lead-scoring/tags?type=platform|source
    {
      method: 'GET',
      path: 'tags',
      handler: async (req, res) => {
        try {
          const q = parseQuery(req)
          const type = q.get('type') as 'platform' | 'source' | undefined
          const tags = await getCampaignQueries().listTags(type || undefined)
          jsonResponse(res, 200, { tags })
        } catch (err) {
          jsonResponse(res, 500, { error: String(err) })
        }
      },
    },

    // POST /console/api/lead-scoring/tag
    {
      method: 'POST',
      path: 'tag',
      handler: async (req, res) => {
        try {
          const body = await parseBody<{ name: string; tagType: 'platform' | 'source'; color?: string }>(req)
          if (!body.name || !body.tagType) {
            jsonResponse(res, 400, { error: 'Missing name or tagType' }); return
          }
          const tag = await getCampaignQueries().createTag(body.name, body.tagType, body.color ?? '#93c5fd')
          jsonResponse(res, 201, { tag })
        } catch (err) {
          jsonResponse(res, 400, { error: String(err) })
        }
      },
    },

    // PUT /console/api/lead-scoring/tag
    {
      method: 'PUT',
      path: 'tag',
      handler: async (req, res) => {
        try {
          const body = await parseBody<{ id: string; name?: string; color?: string }>(req)
          if (!body.id) { jsonResponse(res, 400, { error: 'Missing id' }); return }
          await getCampaignQueries().updateTag(body.id, body)
          jsonResponse(res, 200, { ok: true })
        } catch (err) {
          jsonResponse(res, 400, { error: String(err) })
        }
      },
    },

    // DELETE /console/api/lead-scoring/tag?id=X
    {
      method: 'DELETE',
      path: 'tag',
      handler: async (req, res) => {
        try {
          const q = parseQuery(req)
          const id = q.get('id')
          if (!id) { jsonResponse(res, 400, { error: 'Missing id' }); return }
          await getCampaignQueries().deleteTag(id)
          jsonResponse(res, 200, { ok: true })
        } catch (err) {
          jsonResponse(res, 400, { error: String(err) })
        }
      },
    },

    // ─── Campaign stats ───

    // GET /console/api/lead-scoring/campaign-stats
    {
      method: 'GET',
      path: 'campaign-stats',
      handler: async (_req, res) => {
        try {
          const stats = await getCampaignQueries().getCampaignStats()
          jsonResponse(res, 200, { stats })
        } catch (err) {
          jsonResponse(res, 500, { error: String(err) })
        }
      },
    },

    // GET /console/api/lead-scoring/contact-campaigns?contactId=X
    {
      method: 'GET',
      path: 'contact-campaigns',
      handler: async (req, res) => {
        try {
          const q = parseQuery(req)
          const contactId = q.get('contactId')
          if (!contactId) { jsonResponse(res, 400, { error: 'Missing contactId' }); return }
          const entries = await getCampaignQueries().getContactCampaigns(contactId)
          jsonResponse(res, 200, { entries })
        } catch (err) {
          jsonResponse(res, 500, { error: String(err) })
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
// Campaign matcher reload helper
// ═══════════════════════════════════════════

async function reloadCampaignMatcher(): Promise<void> {
  if (!campaignQueries || !campaignMatcher) return
  try {
    const active = await campaignQueries.listActiveCampaigns()
    campaignMatcher.load(active)
  } catch (err) {
    logger.error({ err }, 'Failed to reload campaign matcher')
  }
}

// ═══════════════════════════════════════════
// Manifest
// ═══════════════════════════════════════════

const manifest: ModuleManifest = {
  name: 'lead-scoring',
  version: '2.0.0',
  description: {
    es: 'Sistema de calificación de leads multi-framework (CHAMP, SPIN, CHAMP+Gov) con objetivos y detección de tipo de cliente',
    en: 'Multi-framework lead scoring system (CHAMP, SPIN, CHAMP+Gov) with objectives and client type detection',
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
      es: 'Configura frameworks de calificación, objetivos por framework y tipo de cliente.',
      en: 'Configure qualification frameworks, per-framework objectives and client type detection.',
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

    // Initialize campaign subsystem
    campaignQueries = new CampaignQueries(db)
    await campaignQueries.ensureTables()
    campaignMatcher = new CampaignMatcher()
    await reloadCampaignMatcher()

    // Register services
    registry.provide('lead-scoring:config', configStore)
    registry.provide('lead-scoring:queries', leadQueries)
    registry.provide('lead-scoring:campaign-queries', campaignQueries)

    // Campaign match service — called from engine Phase 1
    registry.provide('lead-scoring:match-campaign',
      (text: string, channelName: string, channelType: string, roundNumber: number): CampaignMatchResult | null => {
        return campaignMatcher?.match(text, channelName, channelType, roundNumber) ?? null
      },
    )

    // Campaign reload service
    registry.provide('lead-scoring:reload-campaigns', reloadCampaignMatcher)

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
      clearExtractionPromptCache()

      // Reload campaign matcher
      await reloadCampaignMatcher()

      // Recalculate if criteria/thresholds changed
      {
        const criteriaChanged = JSON.stringify(oldConfig.frameworks.map(f => f.criteria)) !== JSON.stringify(newConfig.frameworks.map(f => f.criteria))
        const thresholdsChanged = JSON.stringify(oldConfig.thresholds) !== JSON.stringify(newConfig.thresholds)

        if (criteriaChanged || thresholdsChanged) {
          logger.info('Config changed, recalculating all lead scores...')
          const leads = await leadQueries!.getAllLeadsForRecalc()
          const updates: Array<{ contactId: string; score: number; status: QualificationStatus | null }> = []

          for (const lead of leads) {
            const fw = resolveFramework(newConfig, lead.qualificationData)
            const result = calculateScore(lead.qualificationData, newConfig, fw ?? undefined)
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

    logger.info('Lead scoring module v2 initialized')
  },

  async stop() {
    configStore = null
    leadQueries = null
    campaignQueries = null
    campaignMatcher = null
    logger.info('Lead scoring module stopped')
  },
}

export default manifest
