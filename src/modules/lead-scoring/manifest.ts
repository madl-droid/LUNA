// LUNA — Module: lead-scoring
// Sistema de calificación de leads. BANT + criterios custom, scoring por código,
// extracción natural por LLM, UI personalizable en console.

import * as fs from 'node:fs'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderLeadScoringConsole } from './templates.js'
import { z } from 'zod'
import pino from 'pino'
import type { ModuleManifest, ApiRoute } from '../../kernel/types.js'
import type { Registry } from '../../kernel/registry.js'
import { jsonResponse, parseBody, parseQuery } from '../../kernel/http-helpers.js'
import { boolEnv } from '../../kernel/config-helpers.js'
import type { LeadScoringConfig, QualifyingConfig, QualificationStatus, FrameworkType } from './types.js'
import { FRAMEWORK_PRESETS } from './frameworks.js'
import { ConfigStore } from './config-store.js'
import { LeadQueries } from './pg-queries.js'
import { registerExtractionTool } from './extract-tool.js'
import { calculateScore, resolveTransition } from './scoring-engine.js'
import { CampaignQueries } from './campaign-queries.js'
import { CampaignMatcher } from './campaign-matcher.js'
import type { CampaignMatchResult } from './campaign-types.js'
import {
  registerLead,
  loadWebhookConfig,
  ensureToken,
  ensureWebhookTables,
  extractBearerToken,
  generateToken,
  logWebhookAttempt,
} from './webhook-handler.js'
import type { WebhookRegisterBody } from './webhook-handler.js'

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

    // POST /console/api/lead-scoring/apply-framework
    {
      method: 'POST',
      path: 'apply-framework',
      handler: async (req, res) => {
        try {
          const body = await parseBody<{ framework: FrameworkType }>(req)
          if (!body.framework) {
            jsonResponse(res, 400, { error: 'Missing framework' })
            return
          }
          const store = getConfigStore()
          store.applyFramework(body.framework)
          jsonResponse(res, 200, { ok: true, framework: body.framework })
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
          const presets = Object.values(FRAMEWORK_PRESETS).map(p => ({
            type: p.type,
            name: p.name,
            description: p.description,
            stageCount: p.stages.length,
            criteriaCount: p.criteria.length,
          }))
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

    // ─── Webhook endpoints ───

    // POST /console/api/lead-scoring/webhook
    // External endpoint — auth via Bearer token, NOT console session
    {
      method: 'POST',
      path: 'webhook',
      handler: async (req, res) => {
        const db = getQueries() && campaignQueries ? campaignQueries : null
        if (!db) {
          jsonResponse(res, 503, { error: 'Lead scoring not initialized' })
          return
        }
        try {
          const pool = getCampaignQueries() // validates init
          void pool

          // Load webhook config
          const registryRef = manifest._registry
          if (!registryRef) {
            jsonResponse(res, 503, { error: 'Registry not available' })
            return
          }
          const dbPool = registryRef.getDb()
          const webhookConfig = await loadWebhookConfig(dbPool)

          if (!webhookConfig.enabled) {
            jsonResponse(res, 403, { error: 'Webhook deshabilitado' })
            return
          }

          // Auth
          const token = extractBearerToken(req.headers['authorization'])
          if (!token || token !== webhookConfig.token) {
            jsonResponse(res, 401, { error: 'Token de autorización inválido' })
            return
          }

          // Parse body
          const body = await parseBody<WebhookRegisterBody>(req)
          if (!body.campaign) {
            jsonResponse(res, 400, { error: 'Campo "campaign" es obligatorio (keyword o ID de campaña)' })
            return
          }
          if (!body.email && !body.phone) {
            jsonResponse(res, 400, { error: 'Se requiere al menos "email" o "phone"' })
            return
          }

          const result = await registerLead(body, dbPool, registryRef, campaignQueries!)

          // Log failed campaign lookup but still return success
          if (result.warning) {
            await logWebhookAttempt(dbPool, {
              email: body.email,
              phone: body.phone,
              displayName: body.name,
              campaignKeyword: body.campaign,
              campaignId: null,
              contactId: result.contactId,
              channelUsed: result.channel,
              success: true,
              errorMessage: result.warning,
            })
          }

          jsonResponse(res, 201, result)
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err)
          logger.error({ err }, 'Webhook register failed')

          // Log the error
          try {
            const registryRef = manifest._registry
            if (registryRef) {
              const dbPool = registryRef.getDb()
              const body = { email: undefined, phone: undefined, name: undefined, campaign: '' }
              await logWebhookAttempt(dbPool, {
                campaignKeyword: body.campaign || undefined,
                campaignId: null,
                contactId: null,
                channelUsed: null,
                success: false,
                errorMessage: errMsg,
              })
            }
          } catch { /* logging failed, non-critical */ }

          jsonResponse(res, 400, { error: errMsg })
        }
      },
    },

    // GET /console/api/lead-scoring/webhook-stats
    {
      method: 'GET',
      path: 'webhook-stats',
      handler: async (_req, res) => {
        try {
          const registryRef = manifest._registry
          if (!registryRef) { jsonResponse(res, 503, { error: 'Not initialized' }); return }
          const dbPool = registryRef.getDb()

          const result = await dbPool.query(`
            SELECT
              COUNT(*) FILTER (WHERE success = true) AS total_success,
              COUNT(*) FILTER (WHERE success = false) AS total_errors,
              COUNT(*) FILTER (WHERE campaign_id IS NULL AND success = true) AS no_campaign,
              COUNT(*) AS total,
              MIN(created_at) AS first_at,
              MAX(created_at) AS last_at
            FROM webhook_lead_log
          `)
          const row = result.rows[0]
          jsonResponse(res, 200, {
            totalSuccess: parseInt(row?.total_success ?? '0', 10),
            totalErrors: parseInt(row?.total_errors ?? '0', 10),
            noCampaign: parseInt(row?.no_campaign ?? '0', 10),
            total: parseInt(row?.total ?? '0', 10),
            firstAt: row?.first_at?.toISOString() ?? null,
            lastAt: row?.last_at?.toISOString() ?? null,
          })
        } catch (err) {
          jsonResponse(res, 500, { error: String(err) })
        }
      },
    },

    // GET /console/api/lead-scoring/webhook-log?limit=50&offset=0
    {
      method: 'GET',
      path: 'webhook-log',
      handler: async (req, res) => {
        try {
          const registryRef = manifest._registry
          if (!registryRef) { jsonResponse(res, 503, { error: 'Not initialized' }); return }
          const dbPool = registryRef.getDb()
          const q = parseQuery(req)
          const limit = Math.min(parseInt(q.get('limit') ?? '50', 10), 200)
          const offset = parseInt(q.get('offset') ?? '0', 10)

          const result = await dbPool.query(
            `SELECT id, email, phone, display_name, campaign_keyword, campaign_id,
                    contact_id, channel_used, success, error_message, created_at
             FROM webhook_lead_log
             ORDER BY created_at DESC
             LIMIT $1 OFFSET $2`,
            [limit, offset],
          )
          const countResult = await dbPool.query(`SELECT COUNT(*)::int AS total FROM webhook_lead_log`)

          jsonResponse(res, 200, {
            entries: result.rows.map((r: Record<string, unknown>) => ({
              id: r.id,
              email: r.email,
              phone: r.phone,
              displayName: r.display_name,
              campaignKeyword: r.campaign_keyword,
              campaignId: r.campaign_id,
              contactId: r.contact_id,
              channelUsed: r.channel_used,
              success: r.success,
              errorMessage: r.error_message,
              createdAt: (r.created_at as Date)?.toISOString() ?? '',
            })),
            total: countResult.rows[0]?.total ?? 0,
          })
        } catch (err) {
          jsonResponse(res, 500, { error: String(err) })
        }
      },
    },

    // POST /console/api/lead-scoring/webhook-regenerate-token
    {
      method: 'POST',
      path: 'webhook-regenerate-token',
      handler: async (_req, res) => {
        try {
          const registryRef = manifest._registry
          if (!registryRef) { jsonResponse(res, 503, { error: 'Not initialized' }); return }
          const dbPool = registryRef.getDb()
          const newToken = generateToken()
          const configStoreMod = await import('../../kernel/config-store.js')
          await configStoreMod.set(dbPool, 'LEAD_WEBHOOK_TOKEN', newToken, true)
          jsonResponse(res, 200, { ok: true, token: newToken })
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

const manifest: ModuleManifest & { _registry: Registry | null } = {
  _registry: null,
  name: 'lead-scoring',
  version: '1.0.0',
  description: {
    es: 'Sistema de calificación de leads con frameworks (CHAMP, SPIN, CHAMP+Gov) y criterios personalizables',
    en: 'Lead scoring system with frameworks (CHAMP, SPIN, CHAMP+Gov) and customizable criteria',
  },
  type: 'feature',
  removable: true,
  activateByDefault: true,
  depends: ['tools'],

  configSchema: z.object({
    LEAD_SCORING_CONFIG_PATH: z.string().default('instance/qualifying.json'),
    LEAD_WEBHOOK_ENABLED: boolEnv(false),
    LEAD_WEBHOOK_TOKEN: z.string().default(''),
    LEAD_WEBHOOK_PREFERRED_CHANNEL: z.string().default('auto'),
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
    fields: [
      // ── Webhook de registro de leads ──
      { key: '_div_webhook', type: 'divider', label: { es: 'Webhook de Registro de Leads', en: 'Lead Registration Webhook' } },
      {
        key: 'LEAD_WEBHOOK_ENABLED',
        type: 'boolean',
        label: { es: 'Webhook habilitado', en: 'Webhook enabled' },
        description: {
          es: 'Activa el endpoint para registrar leads desde sistemas externos.',
          en: 'Enable the endpoint to register leads from external systems.',
        },
        icon: '&#128279;',
      },
      {
        key: 'LEAD_WEBHOOK_TOKEN',
        type: 'secret',
        label: { es: 'Token de autorización', en: 'Authorization token' },
        info: {
          es: 'Token Bearer para autenticar llamadas al webhook. Se auto-genera al activar el módulo. Usa el botón de regenerar si necesitas uno nuevo.',
          en: 'Bearer token to authenticate webhook calls. Auto-generated on module activation. Use the regenerate button if you need a new one.',
        },
      },
      {
        key: 'LEAD_WEBHOOK_PREFERRED_CHANNEL',
        type: 'select',
        label: { es: 'Canal preferido de contacto', en: 'Preferred contact channel' },
        info: {
          es: 'Canal por el que el agente contactará al lead. "Auto" elige según los datos disponibles y canales activos.',
          en: 'Channel the agent will use to contact the lead. "Auto" chooses based on available data and active channels.',
        },
        options: [
          { value: 'auto', label: 'Auto (según datos)' },
          { value: 'whatsapp', label: 'WhatsApp' },
          { value: 'email', label: 'Email (Gmail)' },
          { value: 'google-chat', label: 'Google Chat' },
        ],
      },
    ],
    apiRoutes: createApiRoutes(),
  },

  async init(registry: Registry) {
    manifest._registry = registry
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

    // Initialize webhook subsystem
    await ensureWebhookTables(db)
    await ensureToken(db)

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

      // Reload campaign matcher (in case campaigns were modified externally)
      await reloadCampaignMatcher()

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
    manifest._registry = null
    configStore = null
    leadQueries = null
    campaignQueries = null
    campaignMatcher = null
    logger.info('Lead scoring module stopped')
  },
}

export default manifest
