// LUNA — Module: medilink
// Provider de integración con Medilink (HealthAtom) — API REST + Webhooks.
// Gestión de pacientes, citas, disponibilidad, seguimiento automático.

import { z } from 'zod'
import pino from 'pino'
import type { ModuleManifest, ApiRoute } from '../../kernel/types.js'
import type { Registry } from '../../kernel/registry.js'
import { jsonResponse, parseBody, parseQuery, readBody } from '../../kernel/http-helpers.js'
import { numEnv, numEnvMin, boolEnv } from '../../kernel/config-helpers.js'
import { RateLimiter } from './rate-limiter.js'
import { MedilinkApiClient } from './api-client.js'
import { MedilinkCache } from './cache.js'
import { WebhookHandler } from './webhook-handler.js'
import { SecurityService } from './security.js'
import { registerMedilinkTools } from './tools.js'
import { FollowUpScheduler } from './follow-up-scheduler.js'
import { runMigrations } from './pg-store.js'
import * as pgStore from './pg-store.js'
import type { MedilinkConfig, MedilinkAppointment } from './types.js'

const logger = pino({ name: 'medilink' })

let rateLimiter: RateLimiter | null = null
let apiClient: MedilinkApiClient | null = null
let cache: MedilinkCache | null = null
let webhookHandler: WebhookHandler | null = null
let security: SecurityService | null = null
let followUpScheduler: FollowUpScheduler | null = null
let healthCheckTimer: ReturnType<typeof setInterval> | null = null
let _registry: Registry | null = null

// ─── API Routes ──────────────────────────

function createApiRoutes(): ApiRoute[] {
  return [
    // ── Status ──
    {
      method: 'GET',
      path: 'status',
      handler: async (_req, res) => {
        const connected = apiClient ? await apiClient.healthCheck() : false
        const cacheStats = cache?.getStats() ?? null
        const rlStats = rateLimiter?.getStats() ?? null
        jsonResponse(res, 200, { connected, cache: cacheStats, rateLimit: rlStats })
      },
    },

    // ── Webhook endpoint (no console auth — Medilink calls this) ──
    {
      method: 'POST',
      path: 'webhook',
      handler: async (req, res) => {
        if (!webhookHandler) {
          jsonResponse(res, 503, { error: 'Webhook handler not initialized' })
          return
        }
        // Respond 200 immediately, process async
        const body = await readBody(req)
        const token = req.headers['token'] as string | undefined
        const signing = req.headers['signing'] as string | undefined
        jsonResponse(res, 200, { ok: true })
        // Fire and forget
        void webhookHandler.handleWebhook(body, token ?? '', signing ?? '')
      },
    },

    // ── Audit log ──
    {
      method: 'GET',
      path: 'audit',
      handler: async (req, res) => {
        if (!_registry) { jsonResponse(res, 503, { error: 'Not initialized' }); return }
        const query = parseQuery(req)
        const db = _registry.getDb()
        const result = await pgStore.getAuditLog(db, {
          contactId: query.get('contactId') ?? undefined,
          medilinkPatientId: query.get('patientId') ?? undefined,
          limit: parseInt(query.get('limit') ?? '50', 10),
          offset: parseInt(query.get('offset') ?? '0', 10),
        })
        jsonResponse(res, 200, result)
      },
    },

    // ── Edit requests ──
    {
      method: 'GET',
      path: 'edit-requests',
      handler: async (req, res) => {
        if (!_registry) { jsonResponse(res, 503, { error: 'Not initialized' }); return }
        const query = parseQuery(req)
        const db = _registry.getDb()
        const status = query.get('status') as 'pending' | 'approved' | 'rejected' | null
        const result = await pgStore.getEditRequests(db, {
          status: status ?? undefined,
          limit: parseInt(query.get('limit') ?? '50', 10),
          offset: parseInt(query.get('offset') ?? '0', 10),
        })
        jsonResponse(res, 200, result)
      },
    },
    {
      method: 'POST',
      path: 'edit-requests/approve',
      handler: async (req, res) => {
        if (!_registry) { jsonResponse(res, 503, { error: 'Not initialized' }); return }
        const body = await parseBody<{ id: string; reviewedBy: string; notes?: string }>(req)
        if (!body.id) { jsonResponse(res, 400, { error: 'Missing id' }); return }
        const db = _registry.getDb()
        const result = await pgStore.resolveEditRequest(db, body.id, 'approved', body.reviewedBy ?? 'admin', body.notes)
        if (!result) { jsonResponse(res, 404, { error: 'Request not found or already resolved' }); return }
        // Apply the change in Medilink
        if (apiClient) {
          try {
            const changes = result.requestedChanges
            const update: Record<string, string> = {}
            for (const [field, val] of Object.entries(changes)) {
              update[field] = val.new
            }
            await apiClient.updatePatient(parseInt(result.medilinkPatientId, 10), update)
            await pgStore.logAudit(db, {
              contactId: result.contactId,
              agentId: result.agentId,
              medilinkPatientId: result.medilinkPatientId,
              action: 'edit_approved',
              targetType: 'patient',
              targetId: result.medilinkPatientId,
              detail: { changes, reviewedBy: body.reviewedBy },
              result: 'success',
            })
          } catch (err) {
            logger.error({ err, editRequestId: body.id }, 'Failed to apply edit to Medilink')
            jsonResponse(res, 500, { error: 'Approved but failed to apply: ' + String(err) })
            return
          }
        }
        jsonResponse(res, 200, { ok: true, request: result })
      },
    },
    {
      method: 'POST',
      path: 'edit-requests/reject',
      handler: async (req, res) => {
        if (!_registry) { jsonResponse(res, 503, { error: 'Not initialized' }); return }
        const body = await parseBody<{ id: string; reviewedBy: string; notes?: string }>(req)
        if (!body.id) { jsonResponse(res, 400, { error: 'Missing id' }); return }
        const db = _registry.getDb()
        const result = await pgStore.resolveEditRequest(db, body.id, 'rejected', body.reviewedBy ?? 'admin', body.notes)
        if (!result) { jsonResponse(res, 404, { error: 'Request not found or already resolved' }); return }
        await pgStore.logAudit(db, {
          contactId: result.contactId,
          agentId: result.agentId,
          medilinkPatientId: result.medilinkPatientId,
          action: 'edit_rejected',
          targetType: 'patient',
          targetId: result.medilinkPatientId,
          detail: { reason: body.notes },
          result: 'success',
        })
        jsonResponse(res, 200, { ok: true, request: result })
      },
    },

    // ── Force refresh reference data ──
    {
      method: 'POST',
      path: 'refresh-reference',
      handler: async (_req, res) => {
        if (!cache) { jsonResponse(res, 503, { error: 'Cache not initialized' }); return }
        try {
          await cache.refreshReferenceData()
          jsonResponse(res, 200, { ok: true, stats: cache.getStats() })
        } catch (err) {
          jsonResponse(res, 500, { error: 'Refresh failed: ' + String(err) })
        }
      },
    },

    // ── Follow-ups ──
    {
      method: 'GET',
      path: 'follow-ups',
      handler: async (req, res) => {
        if (!_registry) { jsonResponse(res, 503, { error: 'Not initialized' }); return }
        const query = parseQuery(req)
        const db = _registry.getDb()
        const appointmentId = query.get('appointmentId')
        if (appointmentId) {
          const followUps = await pgStore.getFollowUpsForAppointment(db, appointmentId)
          jsonResponse(res, 200, { followUps })
        } else {
          // Return recent pending follow-ups
          const result = await db.query(
            `SELECT * FROM medilink_follow_ups WHERE status = 'pending' ORDER BY scheduled_at ASC LIMIT 100`,
          )
          jsonResponse(res, 200, { followUps: result.rows })
        }
      },
    },

    // ── Templates ──
    {
      method: 'GET',
      path: 'templates',
      handler: async (_req, res) => {
        if (!_registry) { jsonResponse(res, 503, { error: 'Not initialized' }); return }
        const templates = await pgStore.getTemplates(_registry.getDb())
        jsonResponse(res, 200, { templates })
      },
    },
    {
      method: 'PUT',
      path: 'templates',
      handler: async (req, res) => {
        if (!_registry) { jsonResponse(res, 503, { error: 'Not initialized' }); return }
        const body = await parseBody<{
          touchType: string; templateText?: string; llmInstructions?: string
          useLlm?: boolean; channel?: string; voiceScript?: string
        }>(req)
        if (!body.touchType) { jsonResponse(res, 400, { error: 'Missing touchType' }); return }
        await pgStore.upsertTemplate(_registry.getDb(), body.touchType as any, body)
        jsonResponse(res, 200, { ok: true })
      },
    },

    // ── Scheduling rules ──
    {
      method: 'GET',
      path: 'scheduling-rules',
      handler: async (_req, res) => {
        if (!_registry) { jsonResponse(res, 503, { error: 'Not initialized' }); return }
        const db = _registry.getDb()
        const [professionalTreatments, userTypeRules] = await Promise.all([
          pgStore.getProfessionalTreatments(db),
          pgStore.getUserTypeRules(db),
        ])
        jsonResponse(res, 200, { professionalTreatments, userTypeRules })
      },
    },
    {
      method: 'PUT',
      path: 'scheduling-rules',
      handler: async (req, res) => {
        if (!_registry) { jsonResponse(res, 503, { error: 'Not initialized' }); return }
        const body = await parseBody<{
          professionalTreatments?: Array<{ professionalId: number; treatmentId: number; professionalName: string; treatmentName: string }>
          userTypeRules?: Array<{ userType: string; treatmentId: number; treatmentName: string; allowed: boolean; notes?: string }>
        }>(req)
        const db = _registry.getDb()
        if (body.professionalTreatments) {
          await pgStore.setProfessionalTreatments(db, body.professionalTreatments)
        }
        if (body.userTypeRules) {
          await pgStore.setUserTypeRules(db, body.userTypeRules)
        }
        jsonResponse(res, 200, { ok: true })
      },
    },

    // ── Webhook log ──
    {
      method: 'GET',
      path: 'webhooks',
      handler: async (req, res) => {
        if (!_registry) { jsonResponse(res, 503, { error: 'Not initialized' }); return }
        const query = parseQuery(req)
        const limit = parseInt(query.get('limit') ?? '50', 10)
        const webhooks = await pgStore.getRecentWebhooks(_registry.getDb(), limit)
        jsonResponse(res, 200, { webhooks })
      },
    },
  ]
}

// ─── Manifest ────────────────────────────

const manifest: ModuleManifest = {
  name: 'medilink',
  version: '1.0.0',
  description: {
    es: 'Integración Medilink (HealthAtom): pacientes, citas, disponibilidad, seguimiento automático',
    en: 'Medilink (HealthAtom) integration: patients, appointments, availability, automatic follow-up',
  },
  type: 'provider',
  removable: true,
  activateByDefault: false,
  depends: ['tools', 'memory', 'scheduled-tasks'],

  configSchema: z.object({
    MEDILINK_API_TOKEN: z.string().default(''),
    MEDILINK_BASE_URL: z.string().default('https://api.medilink2.healthatom.com/api/v1'),
    MEDILINK_WEBHOOK_PUBLIC_KEY: z.string().default(''),
    MEDILINK_WEBHOOK_PRIVATE_KEY: z.string().default(''),
    MEDILINK_RATE_LIMIT_RPM: numEnvMin(1, 20),
    MEDILINK_API_TIMEOUT_MS: numEnv(15000),
    MEDILINK_AVAILABILITY_CACHE_TTL_MS: numEnv(600000),
    MEDILINK_REFERENCE_REFRESH_DAYS: numEnv(30),
    MEDILINK_DEFAULT_BRANCH_ID: z.string().default(''),
    MEDILINK_DEFAULT_DURATION_MIN: numEnvMin(5, 30),
    MEDILINK_DEFAULT_STATUS_ID: z.string().default(''),
    MEDILINK_FOLLOWUP_ENABLED: boolEnv(true),
    MEDILINK_FOLLOWUP_TOUCH1_DAYS_BEFORE: numEnv(7),
    MEDILINK_FOLLOWUP_FALLBACK_A_HOURS: numEnv(3),
    MEDILINK_FOLLOWUP_FALLBACK_B_DAYS_BEFORE: numEnv(5),
    MEDILINK_FOLLOWUP_TOUCH3_HOURS_BEFORE: numEnv(24),
    MEDILINK_FOLLOWUP_TOUCH4_HOURS_BEFORE: numEnv(3),
    MEDILINK_FOLLOWUP_NOSHOW_HOURS_AFTER: numEnv(3),
    MEDILINK_FOLLOWUP_REACTIVATION_DAYS: numEnv(15),
    MEDILINK_REQUIRE_DOCUMENT_FOR_DEBTS: boolEnv(true),
    MEDILINK_AUTO_LINK_SINGLE_MATCH: boolEnv(true),
    MEDILINK_HEALTH_CHECK_INTERVAL_MS: numEnv(21600000),
  }),

  console: {
    title: { es: 'Medilink', en: 'Medilink' },
    info: {
      es: 'Integración con Medilink (HealthAtom). Gestión de pacientes, citas, disponibilidad y seguimiento automático de citas.',
      en: 'Medilink (HealthAtom) integration. Patient management, appointments, availability and automatic appointment follow-up.',
    },
    order: 45,
    group: 'modules',
    icon: '&#127973;',
    fields: [
      // ── Conexión ──
      { key: '_div_connection', type: 'divider', label: { es: 'Conexión', en: 'Connection' } },
      { key: 'MEDILINK_API_TOKEN', type: 'secret', label: { es: 'Token API', en: 'API Token' }, info: { es: 'Token de acceso generado en Medilink (Admin → Configuración API)', en: 'Access token generated in Medilink (Admin → API Configuration)' } },
      { key: 'MEDILINK_BASE_URL', type: 'text', label: { es: 'URL Base API', en: 'API Base URL' }, info: { es: 'URL base de la API Medilink', en: 'Medilink API base URL' } },
      { key: 'MEDILINK_WEBHOOK_PUBLIC_KEY', type: 'text', label: { es: 'Webhook clave pública', en: 'Webhook public key' }, info: { es: 'Clave pública del proveedor de webhooks (header "token")', en: 'Webhook provider public key ("token" header)' } },
      { key: 'MEDILINK_WEBHOOK_PRIVATE_KEY', type: 'secret', label: { es: 'Webhook clave privada', en: 'Webhook private key' }, info: { es: 'Clave privada para verificar firma HMAC de webhooks', en: 'Private key for HMAC webhook signature verification' } },

      // ── Defaults ──
      { key: '_div_defaults', type: 'divider', label: { es: 'Valores por defecto', en: 'Defaults' } },
      { key: 'MEDILINK_DEFAULT_BRANCH_ID', type: 'text', label: { es: 'Sucursal por defecto (ID)', en: 'Default branch (ID)' }, width: 'half' },
      { key: 'MEDILINK_DEFAULT_DURATION_MIN', type: 'number', label: { es: 'Duración cita (min)', en: 'Appointment duration (min)' }, min: 5, step: 5, unit: 'min', width: 'half' },
      { key: 'MEDILINK_DEFAULT_STATUS_ID', type: 'text', label: { es: 'Estado para nuevas citas (ID)', en: 'Status for new appointments (ID)' } },

      // ── Rate Limiting ──
      { key: '_div_rate', type: 'divider', label: { es: 'Rate Limiting', en: 'Rate Limiting' } },
      { key: 'MEDILINK_RATE_LIMIT_RPM', type: 'number', label: { es: 'Requests por minuto', en: 'Requests per minute' }, min: 1, max: 100, unit: 'req/min', width: 'half' },
      { key: 'MEDILINK_API_TIMEOUT_MS', type: 'number', label: { es: 'Timeout', en: 'Timeout' }, min: 1000, max: 60000, unit: 'ms', width: 'half' },

      // ── Cache / Reference data ──
      { key: '_div_cache', type: 'divider', label: { es: 'Datos de referencia', en: 'Reference data' } },
      { key: 'MEDILINK_REFERENCE_REFRESH_DAYS', type: 'number', label: { es: 'Refresh automático (días)', en: 'Auto refresh (days)' }, min: 1, max: 90, unit: 'días' },
      { key: 'MEDILINK_AVAILABILITY_CACHE_TTL_MS', type: 'number', label: { es: 'Cache disponibilidad (ms)', en: 'Availability cache (ms)' }, min: 60000, unit: 'ms', info: { es: 'TTL del cache de disponibilidad. Se invalida automáticamente por webhook.', en: 'Availability cache TTL. Automatically invalidated by webhook.' } },

      // ── Follow-up ──
      { key: '_div_followup', type: 'divider', label: { es: 'Seguimiento de citas', en: 'Appointment follow-up' } },
      { key: 'MEDILINK_FOLLOWUP_ENABLED', type: 'boolean', label: { es: 'Habilitado', en: 'Enabled' } },
      { key: 'MEDILINK_FOLLOWUP_TOUCH1_DAYS_BEFORE', type: 'number', label: { es: 'Touch 1: días antes (llamada)', en: 'Touch 1: days before (call)' }, min: 1, max: 30, unit: 'días', width: 'half' },
      { key: 'MEDILINK_FOLLOWUP_FALLBACK_A_HOURS', type: 'number', label: { es: 'Fallback A: horas después de llamada', en: 'Fallback A: hours after call' }, min: 1, max: 24, unit: 'h', width: 'half' },
      { key: 'MEDILINK_FOLLOWUP_FALLBACK_B_DAYS_BEFORE', type: 'number', label: { es: 'Fallback B: días antes (2da llamada)', en: 'Fallback B: days before (2nd call)' }, min: 1, max: 30, unit: 'días', width: 'half' },
      { key: 'MEDILINK_FOLLOWUP_TOUCH3_HOURS_BEFORE', type: 'number', label: { es: 'Touch 3: horas antes (instrucciones)', en: 'Touch 3: hours before (prep)' }, min: 1, max: 72, unit: 'h', width: 'half' },
      { key: 'MEDILINK_FOLLOWUP_TOUCH4_HOURS_BEFORE', type: 'number', label: { es: 'Touch 4: horas antes (recordatorio)', en: 'Touch 4: hours before (reminder)' }, min: 1, max: 24, unit: 'h', width: 'half' },
      { key: 'MEDILINK_FOLLOWUP_NOSHOW_HOURS_AFTER', type: 'number', label: { es: 'No-show: horas después', en: 'No-show: hours after' }, min: 1, max: 24, unit: 'h', width: 'half' },
      { key: 'MEDILINK_FOLLOWUP_REACTIVATION_DAYS', type: 'number', label: { es: 'Reactivación: días después', en: 'Reactivation: days after' }, min: 1, max: 90, unit: 'días' },

      // ── Security ──
      { key: '_div_security', type: 'divider', label: { es: 'Seguridad', en: 'Security' } },
      { key: 'MEDILINK_REQUIRE_DOCUMENT_FOR_DEBTS', type: 'boolean', label: { es: 'Pedir documento para ver deudas', en: 'Require document to view debts' }, description: { es: 'Si está activo, se re-verifica el documento del paciente cada vez que consulta montos de deuda', en: 'If active, patient document is re-verified each time debt amounts are queried' } },
      { key: 'MEDILINK_AUTO_LINK_SINGLE_MATCH', type: 'boolean', label: { es: 'Auto-vincular match único', en: 'Auto-link single match' }, description: { es: 'Vincular automáticamente cuando el teléfono coincide con exactamente un paciente', en: 'Auto-link when phone matches exactly one patient' } },
    ],
    apiRoutes: createApiRoutes(),
  },

  async init(registry: Registry) {
    _registry = registry
    const config = registry.getConfig<MedilinkConfig>('medilink')
    const db = registry.getDb()
    const redis = registry.getRedis()

    // Run migrations
    await runMigrations(db)

    // Initialize rate limiter
    rateLimiter = new RateLimiter(config.MEDILINK_RATE_LIMIT_RPM, redis)
    rateLimiter.start()

    // Initialize API client
    apiClient = new MedilinkApiClient(config, rateLimiter)

    // Initialize cache
    cache = new MedilinkCache(apiClient, redis, config)

    // Initialize security service
    security = new SecurityService(apiClient, db, config)

    // Initialize webhook handler
    webhookHandler = new WebhookHandler(config, db, cache)

    // Initialize follow-up scheduler (no own BullMQ — delegates to scheduled-tasks)
    if (config.MEDILINK_FOLLOWUP_ENABLED) {
      followUpScheduler = new FollowUpScheduler(registry, db, config)
    }

    // Provide services to other modules
    registry.provide('medilink:api', apiClient)
    registry.provide('medilink:cache', cache)
    registry.provide('medilink:security', security)
    if (followUpScheduler) {
      registry.provide('medilink:followup', followUpScheduler)
    }

    // Register agent tools
    await registerMedilinkTools(registry, apiClient, cache, security)

    // Register webhook listeners for follow-ups
    if (followUpScheduler && webhookHandler) {
      webhookHandler.on('cita', 'created', async (payload) => {
        // External appointment creation → create follow-up sequence
        const citaId = payload.data?.id
        if (!citaId) return

        try {
          // Fetch appointment details from API
          const apt = await apiClient!.getAppointment(citaId, 'high')

          // Find linked contact for this patient
          const contactResult = await db.query(
            `SELECT contact_id, agent_id FROM agent_contacts
             WHERE agent_data->>'medilink_patient_id' = $1 LIMIT 1`,
            [String(apt.id_paciente)],
          )
          if (contactResult.rows.length === 0) return

          const row = contactResult.rows[0]!
          await followUpScheduler!.scheduleSequence({
            appointmentId: String(citaId),
            contactId: row.contact_id as string,
            agentId: row.agent_id as string,
            appointment: {
              fecha: apt.fecha,
              hora_inicio: apt.hora_inicio,
              nombre_paciente: apt.nombre_paciente,
              nombre_profesional: apt.nombre_profesional,
              nombre_tratamiento: apt.nombre_tratamiento,
              nombre_sucursal: apt.nombre_sucursal,
            },
          })
        } catch (err) {
          logger.error({ err, citaId }, 'Failed to create follow-up from webhook')
        }
      })

      webhookHandler.on('cita', 'modified', async (payload) => {
        // If appointment modified externally, cancel existing follow-ups
        const citaId = payload.data?.id
        if (citaId) {
          await followUpScheduler!.cancelSequence(String(citaId))
        }
      })
    }

    // Register message:incoming hook for confirmation detection
    if (followUpScheduler) {
      registry.addHook('medilink', 'message:incoming', async (payload) => {
        const contactId = payload.from
        const text = payload.content?.text
        if (contactId && text) {
          await followUpScheduler!.checkForConfirmation(contactId, text)
        }
      }, 200) // Low priority — don't block other handlers
    }

    // Load reference data if token configured
    if (config.MEDILINK_API_TOKEN) {
      try {
        await cache.refreshReferenceData()
        logger.info('Reference data loaded')
      } catch (err) {
        logger.warn({ err }, 'Failed to load reference data — configure token in console')
      }
    } else {
      logger.info('Medilink API token not configured — use console to set it')
    }

    // Health check timer
    if (config.MEDILINK_API_TOKEN && config.MEDILINK_HEALTH_CHECK_INTERVAL_MS > 0) {
      healthCheckTimer = setInterval(async () => {
        const ok = await apiClient!.healthCheck()
        if (!ok) logger.warn('Medilink health check failed — token may be expired')
      }, config.MEDILINK_HEALTH_CHECK_INTERVAL_MS)
    }

    // Hot-reload config
    registry.addHook('medilink', 'console:config_applied', async () => {
      const fresh = registry.getConfig<MedilinkConfig>('medilink')
      apiClient?.updateConfig(fresh)
      rateLimiter?.updateLimit(fresh.MEDILINK_RATE_LIMIT_RPM)
      cache?.updateConfig(fresh)
      followUpScheduler?.updateConfig(fresh)
      logger.info('Config hot-reloaded')
    })

    logger.info({ baseUrl: config.MEDILINK_BASE_URL, hasToken: !!config.MEDILINK_API_TOKEN }, 'Medilink module initialized')
  },

  async stop() {
    if (healthCheckTimer) {
      clearInterval(healthCheckTimer)
      healthCheckTimer = null
    }
    followUpScheduler = null
    rateLimiter?.stop()
    rateLimiter = null
    apiClient = null
    cache = null
    webhookHandler = null
    security = null
    _registry = null
    logger.info('Medilink module stopped')
  },
}

export default manifest
