// cortex/manifest.ts — Cortex module: the nervous system of LUNA
// Feature: Reflex — real-time monitoring and alerts, 100% code, zero LLM.

import { z } from 'zod'
import type { ModuleManifest } from '../../kernel/types.js'
import type { Registry } from '../../kernel/registry.js'
import { boolEnv, numEnv, numEnvMin } from '../../kernel/config-helpers.js'
import { jsonResponse } from '../../kernel/http-helpers.js'
import type { CortexConfig } from './types.js'
import { RingBuffer } from './reflex/ring-buffer.js'
import { createCounters } from './reflex/counters.js'
import { registerSensors, clearSensors } from './reflex/sensors.js'
import { Evaluator } from './reflex/evaluator.js'
import { checkHealth } from './reflex/health.js'
import { getMetricsSummary, writeHealthSnapshot } from './reflex/metrics-store.js'
import pino from 'pino'

const logger = pino({ name: 'cortex' })

let evaluator: Evaluator | null = null
let snapshotTimer: ReturnType<typeof setInterval> | null = null

const manifest: ModuleManifest = {
  name: 'cortex',
  version: '1.0.0',
  description: {
    es: 'Sistema nervioso de LUNA: monitoreo en tiempo real y alertas (Reflex)',
    en: 'LUNA nervous system: real-time monitoring and alerts (Reflex)',
  },
  type: 'feature',
  removable: true,
  activateByDefault: true,
  depends: [], // No hard dependencies — monitors whatever is available

  configSchema: z.object({
    CORTEX_REFLEX_ENABLED: boolEnv(true),
    CORTEX_REFLEX_INFRA_INTERVAL_MS: numEnv(60_000),
    CORTEX_REFLEX_RESOURCE_INTERVAL_MS: numEnv(300_000),
    CORTEX_REFLEX_TRENDS_INTERVAL_MS: numEnv(900_000),
    CORTEX_REFLEX_FLUSH_INTERVAL_MS: numEnv(60_000),
    CORTEX_REFLEX_LOG_BUFFER_SIZE: numEnvMin(10, 100),
    CORTEX_REFLEX_DEDUP_WINDOW_MS: numEnv(300_000),
    CORTEX_REFLEX_ESCALATION_MS: numEnv(900_000),
    CORTEX_REFLEX_CHANNELS: z.string().default('telegram'),
    CORTEX_TELEGRAM_BOT_TOKEN: z.string().default(''),
    CORTEX_TELEGRAM_CHAT_ID: z.string().default(''),
    CORTEX_REFLEX_SILENCE_START: z.string().default('23:00'),
    CORTEX_REFLEX_SILENCE_END: z.string().default('07:00'),
    CORTEX_REFLEX_MEM_THRESHOLD: numEnv(80),
    CORTEX_REFLEX_DISK_THRESHOLD: numEnv(90),
    CORTEX_REFLEX_LATENCY_THRESHOLD_MS: numEnv(10_000),
  }),

  console: {
    title: { es: 'Cortex', en: 'Cortex' },
    info: {
      es: 'Sistema nervioso: monitoreo, alertas y estado del sistema en tiempo real.',
      en: 'Nervous system: monitoring, alerts and real-time system status.',
    },
    order: 90,
    group: 'system',
    icon: '&#129504;', // 🧠
    fields: [
      {
        key: 'CORTEX_REFLEX_ENABLED',
        type: 'boolean',
        label: { es: 'Reflex activo', en: 'Reflex enabled' },
        info: { es: 'Activa el sistema de monitoreo y alertas', en: 'Enable monitoring and alert system' },
      },
      { key: 'divider-channels', type: 'divider', label: { es: 'Canales de alerta', en: 'Alert channels' } },
      {
        key: 'CORTEX_REFLEX_CHANNELS',
        type: 'text',
        label: { es: 'Canales', en: 'Channels' },
        info: { es: 'Canales de despacho separados por coma: telegram, whatsapp, email', en: 'Dispatch channels, comma-separated: telegram, whatsapp, email' },
      },
      {
        key: 'CORTEX_TELEGRAM_BOT_TOKEN',
        type: 'secret',
        label: { es: 'Telegram Bot Token', en: 'Telegram Bot Token' },
        info: { es: 'Token del bot de Telegram para alertas', en: 'Telegram bot token for alerts' },
      },
      {
        key: 'CORTEX_TELEGRAM_CHAT_ID',
        type: 'text',
        label: { es: 'Telegram Chat ID', en: 'Telegram Chat ID' },
        info: { es: 'ID del chat o grupo donde enviar alertas', en: 'Chat or group ID for alerts' },
      },
      { key: 'divider-thresholds', type: 'divider', label: { es: 'Umbrales', en: 'Thresholds' } },
      {
        key: 'CORTEX_REFLEX_MEM_THRESHOLD',
        type: 'number',
        label: { es: 'Umbral memoria (%)', en: 'Memory threshold (%)' },
        min: 50,
        max: 99,
        unit: '%',
      },
      {
        key: 'CORTEX_REFLEX_DISK_THRESHOLD',
        type: 'number',
        label: { es: 'Umbral disco (%)', en: 'Disk threshold (%)' },
        min: 50,
        max: 99,
        unit: '%',
      },
      {
        key: 'CORTEX_REFLEX_LATENCY_THRESHOLD_MS',
        type: 'number',
        label: { es: 'Umbral latencia pipeline', en: 'Pipeline latency threshold' },
        min: 1000,
        unit: 'ms',
      },
      { key: 'divider-intervals', type: 'divider', label: { es: 'Intervalos', en: 'Intervals' } },
      {
        key: 'CORTEX_REFLEX_INFRA_INTERVAL_MS',
        type: 'number',
        label: { es: 'Check infraestructura', en: 'Infrastructure check' },
        min: 10000,
        unit: 'ms',
        info: { es: 'Cada cuánto verificar PG y Redis', en: 'How often to check PG and Redis' },
      },
      {
        key: 'CORTEX_REFLEX_RESOURCE_INTERVAL_MS',
        type: 'number',
        label: { es: 'Check recursos', en: 'Resource check' },
        min: 30000,
        unit: 'ms',
        info: { es: 'Cada cuánto verificar RAM, CPU, disco', en: 'How often to check RAM, CPU, disk' },
      },
      { key: 'divider-silence', type: 'divider', label: { es: 'Silencio programado', en: 'Scheduled silence' } },
      {
        key: 'CORTEX_REFLEX_SILENCE_START',
        type: 'text',
        label: { es: 'Inicio silencio', en: 'Silence start' },
        info: { es: 'Hora inicio silencio INFO (HH:MM). CRÍTICO siempre pasa.', en: 'Info silence start (HH:MM). Critical always passes.' },
      },
      {
        key: 'CORTEX_REFLEX_SILENCE_END',
        type: 'text',
        label: { es: 'Fin silencio', en: 'Silence end' },
        info: { es: 'Hora fin silencio INFO (HH:MM)', en: 'Info silence end (HH:MM)' },
      },
    ],
    apiRoutes: [], // populated in init()
  },

  async init(registry: Registry) {
    const config = registry.getConfig<CortexConfig>('cortex')

    if (!config.CORTEX_REFLEX_ENABLED) {
      logger.info('Cortex Reflex disabled by config')
      return
    }

    const db = registry.getDb()
    const redis = registry.getRedis()

    // Initialize Reflex components
    const ringBuffer = new RingBuffer(config.CORTEX_REFLEX_LOG_BUFFER_SIZE)
    const counters = createCounters()

    // Register sensors (hook listeners)
    registerSensors(registry, counters, ringBuffer)

    // Start evaluator (setInterval-based, NOT BullMQ)
    evaluator = new Evaluator(db, redis, registry, config, counters, ringBuffer)
    evaluator.start()

    // Provide health service for other modules
    registry.provide('cortex:health', {
      check: () => checkHealth(db, redis, registry),
      getActiveAlerts: () => evaluator?.alerts.getActiveAlerts() ?? Promise.resolve([]),
      getAlertHistory: (limit?: number) => evaluator?.alerts.getAlertHistory(limit) ?? Promise.resolve([]),
      getMetrics: () => getMetricsSummary(redis),
    })

    // Provide render function for console
    registry.provide('cortex:renderSection', async (lang: 'es' | 'en') => {
      const health = await checkHealth(db, redis, registry)
      const alerts = evaluator ? await evaluator.alerts.getActiveAlerts() : []
      const history = evaluator ? await evaluator.alerts.getAlertHistory(10) : []
      const metrics = await getMetricsSummary(redis)
      return renderCortexSection(health, alerts, history, metrics, lang)
    })

    // Write health snapshot to Redis periodically (for dashboard/Pulse)
    snapshotTimer = setInterval(async () => {
      try {
        const health = await checkHealth(db, redis, registry)
        await writeHealthSnapshot(redis, health as unknown as Record<string, unknown>)
      } catch { /* best effort */ }
    }, 60_000)

    // Set up API routes
    if (manifest.console) {
      manifest.console.apiRoutes = [
        {
          method: 'GET',
          path: 'health',
          handler: async (_req, res) => {
            const health = await checkHealth(db, redis, registry)
            const statusCode = health.status === 'down' ? 503 : 200
            jsonResponse(res, statusCode, health)
          },
        },
        {
          method: 'GET',
          path: 'alerts/active',
          handler: async (_req, res) => {
            const alerts = evaluator ? await evaluator.alerts.getActiveAlerts() : []
            jsonResponse(res, 200, { alerts })
          },
        },
        {
          method: 'GET',
          path: 'alerts/history',
          handler: async (_req, res) => {
            const alerts = evaluator ? await evaluator.alerts.getAlertHistory() : []
            jsonResponse(res, 200, { alerts })
          },
        },
        {
          method: 'GET',
          path: 'metrics',
          handler: async (_req, res) => {
            const metrics = await getMetricsSummary(redis)
            jsonResponse(res, 200, metrics)
          },
        },
      ]
    }

    logger.info('Cortex module initialized (Reflex active)')
  },

  async stop() {
    if (snapshotTimer) {
      clearInterval(snapshotTimer)
      snapshotTimer = null
    }
    if (evaluator) {
      evaluator.stop()
      evaluator = null
    }
    clearSensors()
    logger.info('Cortex module stopped')
  },
}

export default manifest

// ─── Console render function ─────────────

function renderCortexSection(
  health: import('./types.js').HealthStatus,
  activeAlerts: import('./types.js').Alert[],
  history: import('./types.js').Alert[],
  metrics: import('./reflex/metrics-store.js').MetricsSummary,
  lang: 'es' | 'en',
): string {
  const t = lang === 'es'
    ? { status: 'Estado', alerts: 'Alertas activas', history: 'Historial', metrics: 'Métricas', noAlerts: 'Sin alertas activas', uptime: 'Uptime', pipeline: 'Pipeline', llm: 'LLM', tools: 'Tools', rule: 'Regla', severity: 'Severidad', since: 'Desde', resolved: 'Resuelto' }
    : { status: 'Status', alerts: 'Active alerts', history: 'History', metrics: 'Metrics', noAlerts: 'No active alerts', uptime: 'Uptime', pipeline: 'Pipeline', llm: 'LLM', tools: 'Tools', rule: 'Rule', severity: 'Severity', since: 'Since', resolved: 'Resolved' }

  const statusIcon = health.status === 'healthy' ? '🟢' : health.status === 'degraded' ? '🟡' : '🔴'
  const uptimeH = Math.floor(health.uptime_seconds / 3600)
  const uptimeM = Math.floor((health.uptime_seconds % 3600) / 60)

  let html = `<div class="cortex-dashboard">`

  // ── Status bar ──
  html += `<div class="cortex-status-bar" style="display:flex;align-items:center;gap:12px;padding:12px 16px;background:var(--bg-secondary);border-radius:8px;margin-bottom:16px;">`
  html += `<span style="font-size:1.5em">${statusIcon}</span>`
  html += `<div><strong>${health.status.toUpperCase()}</strong> — ${t.uptime}: ${uptimeH}h ${uptimeM}m</div>`
  html += `</div>`

  // ── Components ──
  html += `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px;margin-bottom:16px;">`
  for (const [name, status] of Object.entries(health.components)) {
    const icon = status === 'connected' || status === 'authenticated' ? '🟢' : status === 'not_configured' ? '⚪' : '🔴'
    html += `<div style="padding:8px 12px;background:var(--bg-secondary);border-radius:6px;font-size:0.9em;">`
    html += `${icon} <strong>${name}</strong><br/><span style="opacity:0.7">${status}</span></div>`
  }
  html += `</div>`

  // ── Active alerts ──
  html += `<h3 style="margin:16px 0 8px">${t.alerts} (${activeAlerts.length})</h3>`
  if (activeAlerts.length === 0) {
    html += `<p style="opacity:0.6">${t.noAlerts}</p>`
  } else {
    html += `<div style="display:flex;flex-direction:column;gap:6px;">`
    for (const alert of activeAlerts) {
      const icon = alert.severity === 'critical' ? '🔴' : alert.severity === 'degraded' ? '🟡' : 'ℹ️'
      const since = new Date(alert.triggeredAt).toLocaleTimeString()
      html += `<div style="padding:8px 12px;background:var(--bg-secondary);border-radius:6px;border-left:3px solid ${alert.severity === 'critical' ? '#e74c3c' : '#f39c12'}">`
      html += `${icon} <strong>${alert.rule}</strong> — ${alert.severity} — ${t.since} ${since}`
      if (alert.flapCount > 0) html += ` ⚡ flapping (${alert.flapCount}x)`
      if (alert.escalatedAt) html += ` 🔺 escalated`
      html += `</div>`
    }
    html += `</div>`
  }

  // ── Metrics ──
  html += `<h3 style="margin:16px 0 8px">${t.metrics}</h3>`
  html += `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;">`

  html += `<div style="padding:12px;background:var(--bg-secondary);border-radius:6px;">`
  html += `<div style="font-size:0.8em;opacity:0.6">${t.pipeline}</div>`
  html += `<div style="font-size:1.4em;font-weight:600">${metrics.hourly.pipeline}</div>`
  html += `<div style="font-size:0.8em;opacity:0.6">avg ${metrics.pipeline.latency_avg}ms</div></div>`

  html += `<div style="padding:12px;background:var(--bg-secondary);border-radius:6px;">`
  html += `<div style="font-size:0.8em;opacity:0.6">${t.llm}</div>`
  html += `<div style="font-size:1.4em;font-weight:600">${metrics.llm.calls}</div>`
  html += `<div style="font-size:0.8em;opacity:0.6">${metrics.llm.errors} errors / ${metrics.llm.fallbacks} fallbacks</div></div>`

  html += `<div style="padding:12px;background:var(--bg-secondary);border-radius:6px;">`
  html += `<div style="font-size:0.8em;opacity:0.6">${t.tools}</div>`
  html += `<div style="font-size:1.4em;font-weight:600">${metrics.tools.calls}</div>`
  html += `<div style="font-size:0.8em;opacity:0.6">${metrics.tools.errors} errors</div></div>`

  html += `</div>`

  // ── History ──
  if (history.length > 0) {
    html += `<h3 style="margin:16px 0 8px">${t.history}</h3>`
    html += `<div style="font-size:0.85em;">`
    for (const alert of history) {
      const icon = alert.severity === 'critical' ? '🔴' : alert.severity === 'degraded' ? '🟡' : 'ℹ️'
      const time = new Date(alert.triggeredAt).toLocaleString()
      const dur = alert.resolvedAt ? `${Math.round((alert.resolvedAt - alert.triggeredAt) / 1000)}s` : '—'
      html += `<div style="padding:4px 0;border-bottom:1px solid var(--border)">`
      html += `${icon} ${alert.rule} — ${time} — ${dur}</div>`
    }
    html += `</div>`
  }

  html += `</div>`
  return html
}
