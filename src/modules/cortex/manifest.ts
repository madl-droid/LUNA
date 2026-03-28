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
import pino from 'pino'

const logger = pino({ name: 'cortex' })

let evaluator: Evaluator | null = null

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
    })

    // Set up API routes
    if (manifest.console) {
      manifest.console.apiRoutes = [
        {
          method: 'GET',
          path: 'health',
          handler: async (_req, res) => {
            const health = await checkHealth(db, redis, registry)
            const statusCode = health.status === 'down' ? 503 : health.status === 'degraded' ? 200 : 200
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
      ]
    }

    logger.info('Cortex module initialized (Reflex active)')
  },

  async stop() {
    if (evaluator) {
      evaluator.stop()
      evaluator = null
    }
    clearSensors()
    logger.info('Cortex module stopped')
  },
}

export default manifest
