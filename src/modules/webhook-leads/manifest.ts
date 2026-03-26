// LUNA — Module: webhook-leads
// Webhook externo para registro de leads en la base de contactos.
// Usa servicios de lead-scoring (campañas), canales activos (message:send),
// y el campo contact_origin de contacts para marcar fuente = 'outbound'.

import { z } from 'zod'
import pino from 'pino'
import type { ModuleManifest, ApiRoute } from '../../kernel/types.js'
import type { Registry } from '../../kernel/registry.js'
import { jsonResponse, parseBody, parseQuery } from '../../kernel/http-helpers.js'
import { boolEnv } from '../../kernel/config-helpers.js'
import type { WebhookLeadsConfig, WebhookRegisterBody, WebhookLogEntry } from './types.js'
import {
  registerLead,
  loadWebhookConfig,
  ensureToken,
  ensureWebhookTables,
  extractBearerToken,
  generateToken,
  logWebhookAttempt,
} from './webhook-handler.js'

const logger = pino({ name: 'webhook-leads' })

let _registry: Registry | null = null

// ═══════════════════════════════════════════
// API Routes
// ═══════════════════════════════════════════

function createApiRoutes(): ApiRoute[] {
  const getDb = () => {
    if (!_registry) throw new Error('webhook-leads not initialized')
    return _registry.getDb()
  }

  return [
    // ─── POST /console/api/webhook-leads/register ───
    // External endpoint — auth via Bearer token
    {
      method: 'POST',
      path: 'register',
      handler: async (req, res) => {
        try {
          const db = getDb()
          const webhookConfig = await loadWebhookConfig(db)

          if (!webhookConfig.WEBHOOK_LEADS_ENABLED) {
            jsonResponse(res, 403, { error: 'Webhook deshabilitado' })
            return
          }

          // Auth via bearer token
          const token = extractBearerToken(req.headers['authorization'])
          if (!token || token !== webhookConfig.WEBHOOK_LEADS_TOKEN) {
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

          const result = await registerLead(body, db, _registry!, webhookConfig)
          jsonResponse(res, 201, result)
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err)
          logger.error({ err }, 'Webhook register failed')

          // Log the error
          try {
            const db = getDb()
            await logWebhookAttempt(db, {
              campaignKeyword: undefined,
              campaignId: null,
              contactId: null,
              channelUsed: null,
              success: false,
              errorMessage: errMsg,
            })
          } catch { /* logging non-critical */ }

          jsonResponse(res, 400, { error: errMsg })
        }
      },
    },

    // ─── GET /console/api/webhook-leads/stats ───
    {
      method: 'GET',
      path: 'stats',
      handler: async (_req, res) => {
        try {
          const db = getDb()
          const result = await db.query(`
            SELECT
              COUNT(*) FILTER (WHERE success = true)::int AS total_success,
              COUNT(*) FILTER (WHERE success = false)::int AS total_errors,
              COUNT(*) FILTER (WHERE campaign_id IS NULL AND success = true)::int AS no_campaign,
              COUNT(*)::int AS total,
              MIN(created_at) AS first_at,
              MAX(created_at) AS last_at
            FROM webhook_lead_log
          `)
          const row = result.rows[0]
          jsonResponse(res, 200, {
            totalSuccess: row?.total_success ?? 0,
            totalErrors: row?.total_errors ?? 0,
            noCampaign: row?.no_campaign ?? 0,
            total: row?.total ?? 0,
            firstAt: row?.first_at?.toISOString() ?? null,
            lastAt: row?.last_at?.toISOString() ?? null,
          })
        } catch (err) {
          jsonResponse(res, 500, { error: String(err) })
        }
      },
    },

    // ─── GET /console/api/webhook-leads/log?limit=50&offset=0 ───
    {
      method: 'GET',
      path: 'log',
      handler: async (req, res) => {
        try {
          const db = getDb()
          const q = parseQuery(req)
          const limit = Math.min(parseInt(q.get('limit') ?? '50', 10), 200)
          const offset = parseInt(q.get('offset') ?? '0', 10)

          const result = await db.query(
            `SELECT id, email, phone, display_name, campaign_keyword, campaign_id,
                    contact_id, channel_used, success, error_message, created_at
             FROM webhook_lead_log
             ORDER BY created_at DESC
             LIMIT $1 OFFSET $2`,
            [limit, offset],
          )
          const countResult = await db.query(`SELECT COUNT(*)::int AS total FROM webhook_lead_log`)

          const entries: WebhookLogEntry[] = result.rows.map((r: Record<string, unknown>) => ({
            id: r.id as string,
            email: r.email as string | null,
            phone: r.phone as string | null,
            displayName: r.display_name as string | null,
            campaignKeyword: r.campaign_keyword as string | null,
            campaignId: r.campaign_id as string | null,
            contactId: r.contact_id as string | null,
            channelUsed: r.channel_used as string | null,
            success: r.success as boolean,
            errorMessage: r.error_message as string | null,
            createdAt: (r.created_at as Date)?.toISOString() ?? '',
          }))

          jsonResponse(res, 200, { entries, total: countResult.rows[0]?.total ?? 0 })
        } catch (err) {
          jsonResponse(res, 500, { error: String(err) })
        }
      },
    },

    // ─── POST /console/api/webhook-leads/regenerate-token ───
    {
      method: 'POST',
      path: 'regenerate-token',
      handler: async (_req, res) => {
        try {
          const db = getDb()
          const newToken = generateToken()
          const cs = await import('../../kernel/config-store.js')
          await cs.set(db, 'WEBHOOK_LEADS_TOKEN', newToken, true)
          jsonResponse(res, 200, { ok: true, token: newToken })
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
  name: 'webhook-leads',
  version: '1.0.0',
  description: {
    es: 'Webhook para registrar leads desde sistemas externos (CRM, ads, formularios)',
    en: 'Webhook to register leads from external systems (CRM, ads, forms)',
  },
  type: 'feature',
  removable: true,
  activateByDefault: true,
  depends: [],

  configSchema: z.object({
    WEBHOOK_LEADS_ENABLED: boolEnv(false),
    WEBHOOK_LEADS_TOKEN: z.string().default(''),
    WEBHOOK_LEADS_PREFERRED_CHANNEL: z.string().default('auto'),
  }),

  console: {
    title: { es: 'Webhook de Leads', en: 'Lead Webhook' },
    info: {
      es: 'Registra leads desde sistemas externos. Endpoint: POST /console/api/webhook-leads/register',
      en: 'Register leads from external systems. Endpoint: POST /console/api/webhook-leads/register',
    },
    order: 16,
    group: 'leads',
    icon: '&#128279;',
    fields: [
      {
        key: 'WEBHOOK_LEADS_ENABLED',
        type: 'boolean',
        label: { es: 'Webhook habilitado', en: 'Webhook enabled' },
        description: {
          es: 'Activa o desactiva el endpoint de registro de leads externos.',
          en: 'Enable or disable the external lead registration endpoint.',
        },
        icon: '&#128279;',
      },
      {
        key: 'WEBHOOK_LEADS_TOKEN',
        type: 'secret',
        label: { es: 'Token de autorización', en: 'Authorization token' },
        info: {
          es: 'Token Bearer para autenticar llamadas al webhook. Se auto-genera al activar el módulo.',
          en: 'Bearer token to authenticate webhook calls. Auto-generated on module activation.',
        },
      },
      {
        key: 'WEBHOOK_LEADS_PREFERRED_CHANNEL',
        type: 'select',
        label: { es: 'Canal preferido de contacto', en: 'Preferred contact channel' },
        info: {
          es: 'Canal por el que el agente contactará al lead. "Auto" elige según datos disponibles y canales activos.',
          en: 'Channel the agent will use to contact the lead. "Auto" picks based on data and active channels.',
        },
        options: [
          { value: 'auto', label: 'Auto' },
          { value: 'whatsapp', label: 'WhatsApp' },
          { value: 'email', label: 'Email (Gmail)' },
          { value: 'google-chat', label: 'Google Chat' },
        ],
      },
    ],
    apiRoutes: createApiRoutes(),
  },

  async init(registry: Registry) {
    _registry = registry
    const db = registry.getDb()

    // Ensure webhook tables exist
    await ensureWebhookTables(db)

    // Auto-generate token if not set
    await ensureToken(db)

    logger.info('Webhook leads module initialized')
  },

  async stop() {
    _registry = null
    logger.info('Webhook leads module stopped')
  },
}

export default manifest
