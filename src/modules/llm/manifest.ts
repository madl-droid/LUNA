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

    // API key mode: basic (one key per provider) or advanced (per-group keys)
    LLM_API_MODE: z.string().default('basic'),

    // Per-capability API key overrides (legacy — kept for backward compat)
    LLM_VISION_API_KEY: z.string().default(''),
    LLM_STT_API_KEY: z.string().default(''),
    LLM_IMAGE_GEN_API_KEY: z.string().default(''),

    // Knowledge embeddings API key override
    KNOWLEDGE_EMBEDDING_API_SEPARATE: boolEnv(false),
    KNOWLEDGE_GOOGLE_AI_API_KEY: z.string().default(''),

    // Advanced mode: Gemini group keys (fallback to GOOGLE_AI_API_KEY if empty)
    LLM_GOOGLE_ENGINE_API_KEY: z.string().default(''),
    LLM_GOOGLE_MULTIMEDIA_API_KEY: z.string().default(''),
    LLM_GOOGLE_VOICE_API_KEY: z.string().default(''),
    LLM_GOOGLE_KNOWLEDGE_API_KEY: z.string().default(''),

    // Advanced mode: Anthropic group keys (fallback to ANTHROPIC_API_KEY if empty)
    LLM_ANTHROPIC_ENGINE_API_KEY: z.string().default(''),
    LLM_ANTHROPIC_CORTEX_API_KEY: z.string().default(''),
    LLM_ANTHROPIC_MEMORY_API_KEY: z.string().default(''),

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

    // Task routing — primary targets (JSON strings)
    LLM_ROUTE_CLASSIFY: z.string().default(''),
    LLM_ROUTE_RESPOND: z.string().default(''),
    LLM_ROUTE_COMPLEX: z.string().default(''),
    LLM_ROUTE_TOOLS: z.string().default(''),
    LLM_ROUTE_PROACTIVE: z.string().default(''),
    LLM_ROUTE_CRITICIZE: z.string().default(''),
    LLM_ROUTE_DOCUMENT_READ: z.string().default(''),
    LLM_ROUTE_BATCH: z.string().default(''),

    // Criticizer mode (quality gate — Pro reviews, Flash regenerates)
    LLM_CRITICIZER_MODE: z.string().default('complex_only'),

    // Task routing — downgrade targets (provider + model per task)
    LLM_CLASSIFY_DOWNGRADE_PROVIDER: z.string().default(''),
    LLM_CLASSIFY_DOWNGRADE_MODEL: z.string().default(''),
    LLM_RESPOND_DOWNGRADE_PROVIDER: z.string().default(''),
    LLM_RESPOND_DOWNGRADE_MODEL: z.string().default(''),
    LLM_COMPLEX_DOWNGRADE_PROVIDER: z.string().default(''),
    LLM_COMPLEX_DOWNGRADE_MODEL: z.string().default(''),
    LLM_TOOLS_DOWNGRADE_PROVIDER: z.string().default(''),
    LLM_TOOLS_DOWNGRADE_MODEL: z.string().default(''),
    LLM_PROACTIVE_DOWNGRADE_PROVIDER: z.string().default(''),
    LLM_PROACTIVE_DOWNGRADE_MODEL: z.string().default(''),

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

      // API Key mode toggle
      { key: 'LLM_API_MODE', type: 'select', label: { es: 'Modo de API Keys', en: 'API Key Mode' },
        info: {
          es: 'Básico: una sola key por proveedor. Avanzado: keys separadas por grupo de uso (Engine, Multimedia, Voz, etc.). Si un grupo no tiene key, usa la principal.',
          en: 'Basic: one key per provider. Advanced: separate keys per usage group (Engine, Multimedia, Voice, etc.). If a group has no key, falls back to the main one.',
        },
        options: [
          { value: 'basic', label: { es: 'Básico', en: 'Basic' } },
          { value: 'advanced', label: { es: 'Avanzado', en: 'Advanced' } },
        ],
      },

      // Advanced mode — Gemini group keys
      { key: 'LLM_GOOGLE_ENGINE_API_KEY', type: 'secret',
        label: { es: 'Gemini — Engine', en: 'Gemini — Engine' },
        info: { es: 'Key para llamadas del engine que usan Gemini (compose, web_search)', en: 'Key for engine calls using Gemini (compose, web_search)' },
        visibleWhen: { key: 'LLM_API_MODE', value: 'advanced' } },
      { key: 'LLM_GOOGLE_MULTIMEDIA_API_KEY', type: 'secret',
        label: { es: 'Gemini — Multimedia', en: 'Gemini — Multimedia' },
        info: { es: 'Key para lectura de multimedia (visión, STT, procesamiento de archivos)', en: 'Key for multimedia processing (vision, STT, file processing)' },
        visibleWhen: { key: 'LLM_API_MODE', value: 'advanced' } },
      { key: 'LLM_GOOGLE_VOICE_API_KEY', type: 'secret',
        label: { es: 'Gemini — Voz', en: 'Gemini — Voice' },
        info: { es: 'Key para Gemini Live y Gemini TTS', en: 'Key for Gemini Live and Gemini TTS' },
        visibleWhen: { key: 'LLM_API_MODE', value: 'advanced' } },
      { key: 'LLM_GOOGLE_KNOWLEDGE_API_KEY', type: 'secret',
        label: { es: 'Gemini — Knowledge', en: 'Gemini — Knowledge' },
        info: { es: 'Key para embeddings y operaciones de conocimiento', en: 'Key for embeddings and knowledge operations' },
        visibleWhen: { key: 'LLM_API_MODE', value: 'advanced' } },

      // Advanced mode — Anthropic group keys
      { key: 'LLM_ANTHROPIC_ENGINE_API_KEY', type: 'secret',
        label: { es: 'Anthropic — Engine', en: 'Anthropic — Engine' },
        info: { es: 'Key para llamadas del engine que usan Anthropic (classify, tools)', en: 'Key for engine calls using Anthropic (classify, tools)' },
        visibleWhen: { key: 'LLM_API_MODE', value: 'advanced' } },
      { key: 'LLM_ANTHROPIC_CORTEX_API_KEY', type: 'secret',
        label: { es: 'Anthropic — Cortex', en: 'Anthropic — Cortex' },
        info: { es: 'Key para todas las llamadas del módulo Cortex (Pulse, Trace, Reflex)', en: 'Key for all Cortex module calls (Pulse, Trace, Reflex)' },
        visibleWhen: { key: 'LLM_API_MODE', value: 'advanced' } },
      { key: 'LLM_ANTHROPIC_MEMORY_API_KEY', type: 'secret',
        label: { es: 'Anthropic — Memoria', en: 'Anthropic — Memory' },
        info: { es: 'Key para resúmenes, compresión de memoria y batch nocturno', en: 'Key for summaries, memory compression and nightly batch' },
        visibleWhen: { key: 'LLM_API_MODE', value: 'advanced' } },

      // Legacy per-capability overrides (hidden behind advanced mode)
      { key: 'LLM_VISION_API_KEY', type: 'secret', label: { es: 'API Key Vision (legacy)', en: 'Vision API Key (legacy)' },
        info: { es: 'Usar API key diferente para tareas de visión (legacy, preferir modo avanzado)', en: 'Use different API key for vision tasks (legacy, prefer advanced mode)' },
        visibleWhen: { key: 'LLM_API_MODE', value: 'advanced' } },
      { key: 'LLM_STT_API_KEY', type: 'secret', label: { es: 'API Key STT (legacy)', en: 'STT API Key (legacy)' },
        info: { es: 'Usar API key diferente para Speech-to-Text (legacy, preferir modo avanzado)', en: 'Use different API key for Speech-to-Text (legacy, prefer advanced mode)' },
        visibleWhen: { key: 'LLM_API_MODE', value: 'advanced' } },
      { key: 'LLM_IMAGE_GEN_API_KEY', type: 'secret', label: { es: 'API Key Image Gen (legacy)', en: 'Image Gen API Key (legacy)' },
        visibleWhen: { key: 'LLM_API_MODE', value: 'advanced' } },
      { key: 'KNOWLEDGE_EMBEDDING_API_SEPARATE', type: 'boolean', label: { es: 'API Key de embeddings diferente', en: 'Separate embedding API Key' },
        info: { es: 'Si se activa, usa una API key diferente para embeddings de conocimiento. Si no, usa la misma de Google AI.', en: 'If enabled, use a separate API key for knowledge embeddings. Otherwise uses the Google AI key.' },
        visibleWhen: { key: 'LLM_API_MODE', value: 'advanced' } },
      { key: 'KNOWLEDGE_GOOGLE_AI_API_KEY', type: 'secret', label: { es: 'API Key Embeddings (override)', en: 'Embeddings API Key (override)' },
        info: { es: 'API key de Google AI para embeddings de conocimiento (text-embedding-004)', en: 'Google AI API key for knowledge embeddings (text-embedding-004)' },
        visibleWhen: { key: 'LLM_API_MODE', value: 'advanced' } },

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
