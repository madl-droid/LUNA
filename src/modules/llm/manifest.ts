// LUNA — Module: LLM
// Gateway unificado de LLM con circuit breaker, routing por tarea, usage tracking.

import { z } from 'zod'
import type { ModuleManifest } from '../../kernel/types.js'
import type { Registry } from '../../kernel/registry.js'
import { jsonResponse, parseBody, parseQuery } from '../../kernel/http-helpers.js'
import { numEnvMin, floatEnvMin } from '../../kernel/config-helpers.js'
import { LLMGateway } from './llm-gateway.js'
import type { LLMModuleConfig, LLMTask, LLMProviderName, TaskRoute, RouteTarget } from './types.js'

let _gateway: LLMGateway | null = null

const manifest: ModuleManifest = {
  name: 'llm',
  version: '1.0.0',
  description: {
    es: 'Gateway LLM unificado — circuit breaker, routing, tracking, seguridad',
    en: 'Unified LLM gateway — circuit breaker, routing, tracking, security',
  },
  type: 'core-module',
  removable: false,
  activateByDefault: true,
  depends: [],

  configSchema: z.object({
    // Provider API keys
    ANTHROPIC_API_KEY: z.string().default(''),
    GOOGLE_AI_API_KEY: z.string().default(''),

    // Per-capability API key overrides
    LLM_VISION_API_KEY: z.string().default(''),
    LLM_STT_API_KEY: z.string().default(''),
    LLM_IMAGE_GEN_API_KEY: z.string().default(''),

    // Circuit breaker
    LLM_CB_FAILURE_THRESHOLD: numEnvMin(1, 5),
    LLM_CB_WINDOW_MS: numEnvMin(1000, 600000),
    LLM_CB_RECOVERY_MS: numEnvMin(1000, 300000),
    LLM_CB_HALF_OPEN_MAX: numEnvMin(1, 1),

    // Retry
    LLM_RETRY_MAX: numEnvMin(0, 2),
    LLM_RETRY_BACKOFF_MS: numEnvMin(100, 1000),

    // Timeouts per provider
    LLM_TIMEOUT_ANTHROPIC_MS: numEnvMin(1000, 30000),
    LLM_TIMEOUT_GOOGLE_MS: numEnvMin(1000, 30000),

    // Rate limits per provider (0 = unlimited)
    LLM_RPM_ANTHROPIC: numEnvMin(0, 0),
    LLM_RPM_GOOGLE: numEnvMin(0, 0),
    LLM_TPM_ANTHROPIC: numEnvMin(0, 0),
    LLM_TPM_GOOGLE: numEnvMin(0, 0),

    // Usage tracking
    LLM_USAGE_ENABLED: z.string().default('true'),
    LLM_USAGE_RETENTION_DAYS: numEnvMin(1, 90),

    // Cost budget (0 = unlimited)
    LLM_DAILY_BUDGET_USD: floatEnvMin(0, 0),
    LLM_MONTHLY_BUDGET_USD: floatEnvMin(0, 0),

    // Task routing (JSON strings)
    LLM_ROUTE_CLASSIFY: z.string().default(''),
    LLM_ROUTE_RESPOND: z.string().default(''),
    LLM_ROUTE_COMPLEX: z.string().default(''),
    LLM_ROUTE_TOOLS: z.string().default(''),
    LLM_ROUTE_PROACTIVE: z.string().default(''),

    // Fallback chain order (comma-separated)
    LLM_FALLBACK_CHAIN: z.string().default('anthropic,google'),
  }),

  console: {
    title: { es: 'Gateway LLM', en: 'LLM Gateway' },
    info: {
      es: 'Gestión centralizada de proveedores LLM: routing, circuit breaker, costos y seguridad.',
      en: 'Centralized LLM provider management: routing, circuit breaker, costs and security.',
    },
    order: 10,
    group: 'system',
    icon: '&#129504;',
    fields: [
      // API Keys
      { key: 'ANTHROPIC_API_KEY', type: 'secret', label: { es: 'API Key Anthropic', en: 'Anthropic API Key' } },
      { key: 'GOOGLE_AI_API_KEY', type: 'secret', label: { es: 'API Key Google AI', en: 'Google AI API Key' } },
      { key: 'LLM_VISION_API_KEY', type: 'secret', label: { es: 'API Key Vision (override)', en: 'Vision API Key (override)' },
        info: { es: 'Usar API key diferente para tareas de visión', en: 'Use different API key for vision tasks' } },
      { key: 'LLM_STT_API_KEY', type: 'secret', label: { es: 'API Key STT (override)', en: 'STT API Key (override)' },
        info: { es: 'Usar API key diferente para Speech-to-Text', en: 'Use different API key for Speech-to-Text' } },
      { key: 'LLM_IMAGE_GEN_API_KEY', type: 'secret', label: { es: 'API Key Image Gen (override)', en: 'Image Gen API Key (override)' } },

      // Circuit breaker
      { key: 'LLM_CB_FAILURE_THRESHOLD', type: 'number', label: { es: 'Fallos para circuit breaker', en: 'Failures for circuit breaker' },
        info: { es: 'Cantidad de fallos en la ventana para marcar provider como DOWN', en: 'Number of failures in window to mark provider as DOWN' } },
      { key: 'LLM_CB_WINDOW_MS', type: 'number', label: { es: 'Ventana CB (ms)', en: 'CB Window (ms)' },
        info: { es: 'Ventana de tiempo para contar fallos (default: 600000 = 10 min)', en: 'Time window to count failures (default: 600000 = 10 min)' } },
      { key: 'LLM_CB_RECOVERY_MS', type: 'number', label: { es: 'Recuperación CB (ms)', en: 'CB Recovery (ms)' },
        info: { es: 'Tiempo que el provider permanece DOWN antes de probar de nuevo (default: 300000 = 5 min)', en: 'Time provider stays DOWN before retesting (default: 300000 = 5 min)' } },

      // Retry
      { key: 'LLM_RETRY_MAX', type: 'number', label: { es: 'Reintentos máximos', en: 'Max retries' } },
      { key: 'LLM_RETRY_BACKOFF_MS', type: 'number', label: { es: 'Backoff base (ms)', en: 'Backoff base (ms)' } },

      // Timeouts
      { key: 'LLM_TIMEOUT_ANTHROPIC_MS', type: 'number', label: { es: 'Timeout Anthropic (ms)', en: 'Anthropic timeout (ms)' } },
      { key: 'LLM_TIMEOUT_GOOGLE_MS', type: 'number', label: { es: 'Timeout Google (ms)', en: 'Google timeout (ms)' } },

      // Budget
      { key: 'LLM_DAILY_BUDGET_USD', type: 'number', label: { es: 'Presupuesto diario (USD)', en: 'Daily budget (USD)' },
        info: { es: '0 = sin límite', en: '0 = unlimited' } },
      { key: 'LLM_MONTHLY_BUDGET_USD', type: 'number', label: { es: 'Presupuesto mensual (USD)', en: 'Monthly budget (USD)' },
        info: { es: '0 = sin límite', en: '0 = unlimited' } },

      // Usage
      { key: 'LLM_USAGE_ENABLED', type: 'boolean', label: { es: 'Tracking de uso habilitado', en: 'Usage tracking enabled' } },
      { key: 'LLM_USAGE_RETENTION_DAYS', type: 'number', label: { es: 'Retención de datos (días)', en: 'Data retention (days)' } },

      // Fallback chain
      { key: 'LLM_FALLBACK_CHAIN', type: 'text', label: { es: 'Cadena de fallback', en: 'Fallback chain' },
        info: { es: 'Orden de proveedores separados por coma (ej: anthropic,google)', en: 'Provider order comma-separated (e.g.: anthropic,google)' } },
    ],
    apiRoutes: [
      // Provider status
      {
        method: 'GET',
        path: 'status',
        handler: async (_req, res) => {
          if (!_gateway) {
            jsonResponse(res, 503, { error: 'LLM gateway not initialized' })
            return
          }
          const status = await _gateway.getProviderStatus()
          const cost = await _gateway.getTodayCost()
          jsonResponse(res, 200, { providers: status, todayCostUsd: cost })
        },
      },
      // Available models
      {
        method: 'GET',
        path: 'models',
        handler: async (_req, res) => {
          if (!_gateway) {
            jsonResponse(res, 503, { error: 'LLM gateway not initialized' })
            return
          }
          const query = parseQuery(_req)
          const provider = query.get('provider') as LLMProviderName | null
          const models = _gateway.getAvailableModels(provider ?? undefined)
          jsonResponse(res, 200, { models })
        },
      },
      // Refresh models
      {
        method: 'POST',
        path: 'models/refresh',
        handler: async (_req, res) => {
          if (!_gateway) {
            jsonResponse(res, 503, { error: 'LLM gateway not initialized' })
            return
          }
          await _gateway.refreshModels()
          const models = _gateway.getAvailableModels()
          jsonResponse(res, 200, { ok: true, count: models.length })
        },
      },
      // Usage summary
      {
        method: 'GET',
        path: 'usage',
        handler: async (_req, res) => {
          if (!_gateway) {
            jsonResponse(res, 503, { error: 'LLM gateway not initialized' })
            return
          }
          const query = parseQuery(_req)
          const period = (query.get('period') ?? 'day') as 'hour' | 'day' | 'week' | 'month'
          const summary = await _gateway.getUsageSummary(period)
          jsonResponse(res, 200, summary)
        },
      },
      // Task routes
      {
        method: 'GET',
        path: 'routes',
        handler: async (_req, res) => {
          if (!_gateway) {
            jsonResponse(res, 503, { error: 'LLM gateway not initialized' })
            return
          }
          const routes = _gateway.getRoutes()
          jsonResponse(res, 200, { routes })
        },
      },
      // Update task route
      {
        method: 'PUT',
        path: 'routes',
        handler: async (req, res) => {
          if (!_gateway) {
            jsonResponse(res, 503, { error: 'LLM gateway not initialized' })
            return
          }
          try {
            const data = await parseBody<{ task: LLMTask; primary: RouteTarget; fallbacks?: RouteTarget[] }>(req)
            const route: TaskRoute = {
              task: data.task,
              primary: data.primary,
              fallbacks: data.fallbacks ?? [],
            }
            _gateway.setRoute(data.task, route)
            jsonResponse(res, 200, { ok: true })
          } catch (err) {
            jsonResponse(res, 400, { error: 'Invalid route data: ' + String(err) })
          }
        },
      },
      // Circuit breaker status
      {
        method: 'GET',
        path: 'circuit-breakers',
        handler: async (_req, res) => {
          if (!_gateway) {
            jsonResponse(res, 503, { error: 'LLM gateway not initialized' })
            return
          }
          const status = _gateway.getCircuitBreakerStatus()
          jsonResponse(res, 200, { circuitBreakers: status })
        },
      },
      // Reset circuit breaker
      {
        method: 'POST',
        path: 'circuit-breakers/reset',
        handler: async (req, res) => {
          if (!_gateway) {
            jsonResponse(res, 503, { error: 'LLM gateway not initialized' })
            return
          }
          try {
            const data = await parseBody<{ provider: LLMProviderName }>(req)
            _gateway.resetCircuitBreaker(data.provider)
            jsonResponse(res, 200, { ok: true, provider: data.provider })
          } catch (err) {
            jsonResponse(res, 400, { error: 'Invalid data: ' + String(err) })
          }
        },
      },
    ],
  },

  async init(registry: Registry) {
    const db = registry.getDb()
    const redis = registry.getRedis()
    const config = registry.getConfig<LLMModuleConfig>('llm')

    // Create gateway
    _gateway = new LLMGateway(db, redis, config)
    _gateway.setRegistry(registry)
    await _gateway.init(db)

    // Register service — this is how the engine and other modules access the gateway
    registry.provide('llm:gateway', _gateway)

    // Register llm:chat hook handler — enables hook-based LLM calls
    registry.addHook('llm', 'llm:chat', async (payload) => {
      const response = await _gateway!.chat({
        task: (payload.task ?? 'custom') as LLMTask,
        provider: payload.provider as LLMProviderName | undefined,
        model: payload.model,
        system: payload.system,
        messages: payload.messages.map(m => ({
          role: m.role,
          content: m.content as string | import('./types.js').ContentPart[],
        })),
        maxTokens: payload.maxTokens,
        temperature: payload.temperature,
        tools: payload.tools,
      })
      return {
        text: response.text,
        provider: response.provider,
        model: response.model,
        inputTokens: response.inputTokens,
        outputTokens: response.outputTokens,
        toolCalls: response.toolCalls,
      }
    })

    // Register llm:models_available hook handler
    registry.addHook('llm', 'llm:models_available', async (payload) => {
      const provider = payload.provider as LLMProviderName
      const models = _gateway!.getAvailableModels(provider)
      return { models: models.map(m => ({ id: m.id, displayName: m.displayName, family: m.family })) }
    })

    // Refresh models on init (non-blocking)
    _gateway.refreshModels().catch(() => { /* logged internally */ })
  },

  async stop() {
    if (_gateway) {
      _gateway.stop()
      _gateway = null
    }
  },
}

export default manifest
