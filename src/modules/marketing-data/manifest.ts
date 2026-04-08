// LUNA — Module: marketing-data
// Gestión de campañas de marketing: CRUD, tags, matching, stats.
// Extraído de lead-scoring para independizar la funcionalidad de campañas.

import pino from 'pino'
import { z } from 'zod'
import type { ModuleManifest, ApiRoute } from '../../kernel/types.js'
import type { Registry } from '../../kernel/registry.js'
import { jsonResponse, parseBody, parseQuery } from '../../kernel/http-helpers.js'
import { boolEnv } from '../../kernel/config-helpers.js'
import { CampaignQueries } from './campaign-queries.js'
import { CampaignMatcher } from './campaign-matcher.js'
import { renderMarketingDataConsole } from './templates.js'
import type { CampaignMatchResult, UtmParams } from './campaign-types.js'

const logger = pino({ name: 'marketing-data' })

let campaignQueries: CampaignQueries | null = null
let campaignMatcher: CampaignMatcher | null = null
let moduleConfig: { CAMPAIGN_UTM_MATCH_ENABLED: boolean; CAMPAIGN_KEYWORD_MATCH_ENABLED: boolean } | null = null

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
// API Routes
// ═══════════════════════════════════════════

function createApiRoutes(): ApiRoute[] {
  const getCampaignQueries = (): CampaignQueries => {
    if (!campaignQueries) throw new Error('Marketing data not initialized')
    return campaignQueries
  }

  return [
    // ─── Campaign endpoints ───

    // GET /console/api/marketing-data/campaigns
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

    // GET /console/api/marketing-data/campaign?id=X
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

    // POST /console/api/marketing-data/campaign
    {
      method: 'POST',
      path: 'campaign',
      handler: async (req, res) => {
        try {
          const body = await parseBody<{
            name: string; keyword?: string; matchThreshold?: number
            matchMaxRounds?: number; allowedChannels?: string[]
            promptContext?: string; utmData?: Record<string, string>
            utmKeys?: string[]; tagIds?: string[]
          }>(req)
          if (!body.name) {
            jsonResponse(res, 400, { error: 'Missing name' }); return
          }
          const campaign = await getCampaignQueries().createCampaign(body)
          await reloadCampaignMatcher()
          jsonResponse(res, 201, { campaign })
        } catch (err) {
          jsonResponse(res, 400, { error: String(err) })
        }
      },
    },

    // PUT /console/api/marketing-data/campaign
    {
      method: 'PUT',
      path: 'campaign',
      handler: async (req, res) => {
        try {
          const body = await parseBody<{
            id: string; name?: string; keyword?: string; matchThreshold?: number
            matchMaxRounds?: number; allowedChannels?: string[]
            promptContext?: string; active?: boolean
            utmData?: Record<string, string>; utmKeys?: string[]; tagIds?: string[]
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

    // DELETE /console/api/marketing-data/campaign?id=X
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

    // GET /console/api/marketing-data/tags?type=platform|source
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

    // POST /console/api/marketing-data/tag
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

    // PUT /console/api/marketing-data/tag
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

    // DELETE /console/api/marketing-data/tag?id=X
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

    // GET /console/api/marketing-data/campaign-stats
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

    // GET /console/api/marketing-data/contact-campaigns?contactId=X
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

    // GET /console/api/marketing-data/campaign-detailed-stats
    {
      method: 'GET',
      path: 'campaign-detailed-stats',
      handler: async (_req, res) => {
        try {
          const stats = await getCampaignQueries().getCampaignDetailedStats()
          jsonResponse(res, 200, { stats })
        } catch (err) {
          jsonResponse(res, 500, { error: String(err) })
        }
      },
    },

    // GET /console/api/marketing-data/utm-breakdown
    {
      method: 'GET',
      path: 'utm-breakdown',
      handler: async (_req, res) => {
        try {
          const breakdown = await getCampaignQueries().getGlobalUtmBreakdown()
          jsonResponse(res, 200, { breakdown })
        } catch (err) {
          jsonResponse(res, 500, { error: String(err) })
        }
      },
    },

    // GET /console/api/marketing-data/config
    {
      method: 'GET',
      path: 'config',
      handler: async (_req, res) => {
        jsonResponse(res, 200, {
          utmMatchEnabled: moduleConfig?.CAMPAIGN_UTM_MATCH_ENABLED ?? true,
          keywordMatchEnabled: moduleConfig?.CAMPAIGN_KEYWORD_MATCH_ENABLED ?? true,
        })
      },
    },
  ]
}

// ═══════════════════════════════════════════
// Manifest
// ═══════════════════════════════════════════

const manifest: ModuleManifest = {
  name: 'marketing-data',
  version: '1.1.0',
  description: {
    es: 'Gestión de campañas de marketing: CRUD, tags, matching, estadísticas de conversión',
    en: 'Marketing campaign management: CRUD, tags, matching, conversion stats',
  },
  type: 'feature',
  removable: true,
  activateByDefault: true,
  depends: [],

  configSchema: z.object({
    CAMPAIGN_UTM_MATCH_ENABLED: boolEnv(true),
    CAMPAIGN_KEYWORD_MATCH_ENABLED: boolEnv(true),
  }),

  console: {
    title: { es: 'Marketing Data', en: 'Marketing Data' },
    info: {
      es: 'Gestiona campañas de marketing, tags de plataforma y fuente, matching de keywords y estadísticas de conversión.',
      en: 'Manage marketing campaigns, platform and source tags, keyword matching and conversion stats.',
    },
    order: 16,
    group: 'modules',
    icon: '&#128200;',
    apiRoutes: createApiRoutes(),
  },

  async init(registry: Registry) {
    const db = registry.getDb()

    // Read feature toggles
    const config = registry.getConfig<{ CAMPAIGN_UTM_MATCH_ENABLED: boolean; CAMPAIGN_KEYWORD_MATCH_ENABLED: boolean }>('marketing-data')
    moduleConfig = config

    // Initialize campaign subsystem
    campaignQueries = new CampaignQueries(db)
    await campaignQueries.ensureTables()
    campaignMatcher = new CampaignMatcher()
    campaignMatcher.setCampaignQueries(campaignQueries)
    await reloadCampaignMatcher()

    // Register services
    registry.provide('marketing-data:campaign-queries', campaignQueries)

    // Keyword match service — called from engine intake (fallback when UTM doesn't match)
    registry.provide('marketing-data:match-campaign',
      (text: string, channelName: string, channelType: string, roundNumber: number): CampaignMatchResult | null => {
        if (!config.CAMPAIGN_KEYWORD_MATCH_ENABLED) return null
        return campaignMatcher?.match(text, channelName, channelType, roundNumber) ?? null
      },
    )

    // UTM match service — called from engine intake (priority over keyword)
    registry.provide('marketing-data:match-campaign-utm',
      async (utmData: UtmParams, channelName: string, channelType: string): Promise<CampaignMatchResult | null> => {
        if (!config.CAMPAIGN_UTM_MATCH_ENABLED) return null
        return campaignMatcher?.matchUtm(utmData, channelName, channelType) ?? null
      },
    )

    // Campaign reload service
    registry.provide('marketing-data:reload-campaigns', reloadCampaignMatcher)

    // Provide renderSection service for inline console embedding (SSR)
    registry.provide('marketing-data:renderSection', (lang: 'es' | 'en') => {
      return renderMarketingDataConsole(lang)
    })

    logger.info({ utmMatch: config.CAMPAIGN_UTM_MATCH_ENABLED, keywordMatch: config.CAMPAIGN_KEYWORD_MATCH_ENABLED }, 'Marketing data module initialized')
  },

  async stop() {
    campaignQueries = null
    campaignMatcher = null
    moduleConfig = null
    logger.info('Marketing data module stopped')
  },
}

export default manifest
