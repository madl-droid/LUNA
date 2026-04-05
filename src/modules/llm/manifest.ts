// LUNA — Module: LLM
// Gateway unificado de LLM con circuit breaker, routing por tarea, usage tracking.
// Incluye: TTS (Text-to-Speech) y model scanner como servicios integrados.

import { z } from 'zod'
import type { ModuleManifest } from '../../kernel/types.js'
import type { Registry } from '../../kernel/registry.js'
import { jsonResponse, parseBody, parseQuery } from '../../kernel/http-helpers.js'
import { numEnvMin, numEnv, floatEnvMin, boolEnv } from '../../kernel/config-helpers.js'
import { LLMGateway } from './llm-gateway.js'
import type { LLMModuleConfig, LLMTask, LLMProviderName, TaskRoute, RouteTarget, TTSRequest } from './types.js'

let _gateway: LLMGateway | null = null
let _pricingTimer: ReturnType<typeof setInterval> | null = null

const manifest: ModuleManifest = {
  name: 'llm',
  version: '1.1.0',
  description: {
    es: 'Gateway LLM unificado — circuit breaker, routing, tracking, TTS, model scanner',
    en: 'Unified LLM gateway — circuit breaker, routing, tracking, TTS, model scanner',
  },
  type: 'core-module',
  removable: false,
  activateByDefault: true,
  depends: [],

  configSchema: z.object({
    // Provider API keys
    ANTHROPIC_API_KEY: z.string().default(''),
    GOOGLE_AI_API_KEY: z.string().default(''),

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

    // Criticizer mode (quality gate — Pro reviews, Flash regenerates)
    LLM_CRITICIZER_MODE: z.string().default('complex_only'),

    // ── Task routing: 10 canonical tasks (primary provider + model) ──
    // See docs/architecture/task-routing.md for task descriptions and categories
    LLM_MAIN_PROVIDER: z.string().default('anthropic'),
    LLM_MAIN_MODEL: z.string().default('claude-sonnet-4-6'),
    LLM_COMPLEX_PROVIDER: z.string().default('anthropic'),
    LLM_COMPLEX_MODEL: z.string().default('claude-opus-4-6'),
    LLM_LOW_PROVIDER: z.string().default('anthropic'),
    LLM_LOW_MODEL: z.string().default('claude-haiku-4-5-20251001'),
    LLM_CRITICIZE_PROVIDER: z.string().default('google'),
    LLM_CRITICIZE_MODEL: z.string().default('gemini-3.1-pro-preview'),
    LLM_MEDIA_PROVIDER: z.string().default('google'),
    LLM_MEDIA_MODEL: z.string().default('gemini-3-flash-preview'),
    LLM_WEB_SEARCH_PROVIDER: z.string().default('google'),
    LLM_WEB_SEARCH_MODEL: z.string().default('gemini-3-flash-preview'),
    LLM_COMPRESS_PROVIDER: z.string().default('anthropic'),
    LLM_COMPRESS_MODEL: z.string().default('claude-sonnet-4-6'),
    LLM_BATCH_PROVIDER: z.string().default('anthropic'),
    LLM_BATCH_MODEL: z.string().default('claude-sonnet-4-6'),
    LLM_TTS_PROVIDER: z.string().default('google'),
    LLM_TTS_MODEL: z.string().default('gemini-2.5-pro-preview-tts'),
    LLM_KNOWLEDGE_PROVIDER: z.string().default('google'),
    LLM_KNOWLEDGE_MODEL: z.string().default('gemini-embedding-2-preview'),

    // ── Task routing: downgrade (same provider, lesser model — empty = no downgrade) ──
    LLM_MAIN_DOWNGRADE_PROVIDER: z.string().default('anthropic'),
    LLM_MAIN_DOWNGRADE_MODEL: z.string().default('claude-sonnet-4-5-20250929'),
    LLM_COMPLEX_DOWNGRADE_PROVIDER: z.string().default('anthropic'),
    LLM_COMPLEX_DOWNGRADE_MODEL: z.string().default('claude-opus-4-5-20251101'),
    LLM_LOW_DOWNGRADE_PROVIDER: z.string().default('anthropic'),
    LLM_LOW_DOWNGRADE_MODEL: z.string().default('claude-sonnet-4-20250514'),
    LLM_MEDIA_DOWNGRADE_PROVIDER: z.string().default('google'),
    LLM_MEDIA_DOWNGRADE_MODEL: z.string().default('gemini-2.5-flash'),
    LLM_WEB_SEARCH_DOWNGRADE_PROVIDER: z.string().default('google'),
    LLM_WEB_SEARCH_DOWNGRADE_MODEL: z.string().default('gemini-2.5-flash'),
    LLM_CRITICIZE_DOWNGRADE_PROVIDER: z.string().default('google'),
    LLM_CRITICIZE_DOWNGRADE_MODEL: z.string().default('gemini-3-flash-preview'),
    LLM_COMPRESS_DOWNGRADE_PROVIDER: z.string().default('anthropic'),
    LLM_COMPRESS_DOWNGRADE_MODEL: z.string().default('claude-sonnet-4-5-20250929'),
    LLM_BATCH_DOWNGRADE_PROVIDER: z.string().default('anthropic'),
    LLM_BATCH_DOWNGRADE_MODEL: z.string().default('claude-sonnet-4-5-20250929'),

    // ── Task routing: cross-API fallback (different provider) ──
    LLM_MAIN_FALLBACK_PROVIDER: z.string().default('google'),
    LLM_MAIN_FALLBACK_MODEL: z.string().default('gemini-3-flash-preview'),
    LLM_COMPLEX_FALLBACK_PROVIDER: z.string().default('google'),
    LLM_COMPLEX_FALLBACK_MODEL: z.string().default('gemini-3.1-pro-preview'),
    LLM_LOW_FALLBACK_PROVIDER: z.string().default('google'),
    LLM_LOW_FALLBACK_MODEL: z.string().default('gemini-2.5-flash-lite'),
    LLM_CRITICIZE_FALLBACK_PROVIDER: z.string().default('anthropic'),
    LLM_CRITICIZE_FALLBACK_MODEL: z.string().default('claude-opus-4-6'),
    LLM_MEDIA_FALLBACK_PROVIDER: z.string().default('anthropic'),
    LLM_MEDIA_FALLBACK_MODEL: z.string().default('claude-sonnet-4-6'),
    LLM_WEB_SEARCH_FALLBACK_PROVIDER: z.string().default('anthropic'),
    LLM_WEB_SEARCH_FALLBACK_MODEL: z.string().default('claude-sonnet-4-6'),
    LLM_COMPRESS_FALLBACK_PROVIDER: z.string().default('google'),
    LLM_COMPRESS_FALLBACK_MODEL: z.string().default('gemini-3-flash-preview'),
    LLM_BATCH_FALLBACK_PROVIDER: z.string().default('google'),
    LLM_BATCH_FALLBACK_MODEL: z.string().default('gemini-3-flash-preview'),
    LLM_TTS_FALLBACK_PROVIDER: z.string().default('google'),
    LLM_TTS_FALLBACK_MODEL: z.string().default('gemini-2.5-flash-preview-tts'),
    LLM_KNOWLEDGE_FALLBACK_PROVIDER: z.string().default(''),
    LLM_KNOWLEDGE_FALLBACK_MODEL: z.string().default(''),

    // Fallback chain order (comma-separated)
    LLM_FALLBACK_CHAIN: z.string().default('anthropic,google'),

    // Prompt caching (Anthropic: cache_control, Google: implicit for 2.5+)
    LLM_PROMPT_CACHE_ENABLED: boolEnv(true),

    // Citations (Anthropic only — source attribution for knowledge responses)
    LLM_CITATIONS_ENABLED: boolEnv(false),

    // Model scanner
    MODEL_SCAN_INTERVAL_MS: numEnv(21600000),
  }),

  console: {
    title: { es: 'Gateway LLM', en: 'LLM Gateway' },
    info: {
      es: 'Gestión centralizada de proveedores LLM: routing, circuit breaker, costos, TTS y escáner de modelos.',
      en: 'Centralized LLM provider management: routing, circuit breaker, costs, TTS and model scanner.',
    },
    order: 10,
    group: 'system',
    icon: '&#129504;',
    fields: [
      // API Keys — Basic mode (always visible)
      { key: 'ANTHROPIC_API_KEY', type: 'secret', label: { es: 'API Key Anthropic', en: 'Anthropic API Key' } },
      { key: 'GOOGLE_AI_API_KEY', type: 'secret', label: { es: 'API Key Google AI', en: 'Google AI API Key' } },

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

      // Model scanner
      // Criticizer (quality gate)
      { key: 'LLM_CRITICIZER_MODE', type: 'select', label: { es: 'Criticizer (gate de calidad)', en: 'Criticizer (quality gate)' },
        info: {
          es: 'Gemini Pro revisa la respuesta antes de enviarla. Si encuentra problemas, Flash regenera con refinements. El prompt se configura en la pestaña Identidad > Criticizer.',
          en: 'Gemini Pro reviews response before sending. If issues found, Flash regenerates with refinements. Prompt configured in Identity > Criticizer tab.',
        },
        options: [
          { value: 'disabled', label: { es: 'Desactivado', en: 'Disabled' } },
          { value: 'complex_only', label: { es: 'Solo complejo (3+ pasos LLM)', en: 'Complex only (3+ LLM steps)' } },
          { value: 'always', label: { es: 'Siempre', en: 'Always' } },
        ],
      },

      // Model scanner
      { key: 'MODEL_SCAN_INTERVAL_MS', type: 'number', label: { es: 'Intervalo de escaneo de modelos (ms)', en: 'Model scan interval (ms)' },
        info: { es: 'Cada cuánto escanear modelos disponibles (default: 21600000 = 6 horas)', en: 'How often to scan available models (default: 21600000 = 6 hours)' } },
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
            const result = _gateway.setRoute(data.task, route)
            jsonResponse(res, 200, { ok: true, warning: result.warning })
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
          const services = _gateway.getServiceStatus()
          jsonResponse(res, 200, { circuitBreakers: status, services })
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
      // TTS — Text-to-Speech synthesis
      {
        method: 'POST',
        path: 'tts',
        handler: async (req, res) => {
          if (!_gateway) {
            jsonResponse(res, 503, { error: 'LLM gateway not initialized' })
            return
          }
          try {
            const body = await parseBody<TTSRequest>(req)
            if (!body?.text || !body?.voice) {
              jsonResponse(res, 400, { error: 'Missing text or voice' })
              return
            }
            const result = await _gateway.tts(body)
            jsonResponse(res, 200, result)
          } catch (err) {
            jsonResponse(res, 500, { error: `TTS failed: ${String(err)}` })
          }
        },
      },
      // Model scanner — status
      {
        method: 'GET',
        path: 'scanner/status',
        handler: async (_req, res) => {
          if (!_gateway) {
            jsonResponse(res, 503, { error: 'LLM gateway not initialized' })
            return
          }
          const scan = _gateway.getLastScanResult()
          jsonResponse(res, 200, scan ?? { anthropic: [], google: [], lastScanAt: null, replacements: [] })
        },
      },
      // Model scanner — get models
      {
        method: 'GET',
        path: 'scanner/models',
        handler: async (_req, res) => {
          if (!_gateway) {
            jsonResponse(res, 503, { error: 'LLM gateway not initialized' })
            return
          }
          const scan = _gateway.getLastScanResult()
          const models = {
            anthropic: scan?.anthropic.map(m => m.id) ?? [],
            gemini: scan?.google.map(m => m.id) ?? [],
          }
          jsonResponse(res, 200, { models, scan })
        },
      },
      // Model scanner — trigger scan
      {
        method: 'POST',
        path: 'scanner/scan',
        handler: async (_req, res) => {
          if (!_gateway) {
            jsonResponse(res, 503, { error: 'LLM gateway not initialized' })
            return
          }
          try {
            const result = await _gateway.scanModels()
            jsonResponse(res, 200, {
              ok: true,
              anthropic: result.anthropic.length,
              google: result.google.length,
              replacements: result.replacements,
              errors: result.errors,
            })
          } catch (err) {
            jsonResponse(res, 500, { error: 'Scan failed: ' + String(err) })
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
    await _gateway.init(db, config.MODEL_SCAN_INTERVAL_MS)

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

    // Register llm:tts hook handler — enables hook-based TTS calls
    registry.addHook('llm', 'llm:tts', async (payload) => {
      const result = await _gateway!.tts({
        text: payload.text,
        voice: payload.voice,
        languageCode: payload.languageCode,
        audioEncoding: payload.audioEncoding as 'MP3' | 'LINEAR16' | 'OGG_OPUS' | undefined,
      })
      return result
    })

    // Register llm:models_available hook handler
    registry.addHook('llm', 'llm:models_available', async (payload) => {
      const provider = payload.provider as LLMProviderName
      const models = _gateway!.getAvailableModels(provider)
      return { models: models.map(m => ({ id: m.id, displayName: m.displayName, family: m.family })) }
    })

    // Hot-reload API keys, mode and limits when console saves config
    registry.addHook('llm', 'console:config_applied', async () => {
      const fresh = registry.getConfig<LLMModuleConfig>('llm')
      _gateway?.updateConfig(fresh)
    })

    // Refresh models on init (non-blocking)
    _gateway.refreshModels().catch(() => { /* logged internally */ })

    // Start bi-monthly pricing check (1st & 16th of each month)
    try {
      const { startPricingCheck } = await import('./pricing-sync.js')
      _pricingTimer = startPricingCheck(registry)
    } catch { /* pricing-sync is best-effort */ }
  },

  async stop() {
    if (_pricingTimer) {
      clearInterval(_pricingTimer)
      _pricingTimer = null
    }
    if (_gateway) {
      _gateway.stop()
      _gateway = null
    }
  },
}

export default manifest
