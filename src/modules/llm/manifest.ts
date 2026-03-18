// LUNA — Module: LLM
// Gateway unificado de LLM con circuit breaker, routing por tarea, usage tracking.

import { z } from 'zod'
import type { ModuleManifest } from '../../kernel/types.js'
import type { Registry } from '../../kernel/registry.js'
import { LLMGateway } from './llm-gateway.js'
import type { LLMModuleConfig, LLMTask, LLMProviderName, TaskRoute, RouteTarget } from './types.js'

let _gateway: LLMGateway | null = null
let _registry: Registry | null = null

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
    OPENAI_API_KEY: z.string().default(''),
    GOOGLE_AI_API_KEY: z.string().default(''),

    // Per-capability API key overrides
    LLM_VISION_API_KEY: z.string().default(''),
    LLM_STT_API_KEY: z.string().default(''),
    LLM_IMAGE_GEN_API_KEY: z.string().default(''),

    // Circuit breaker
    LLM_CB_FAILURE_THRESHOLD: z.string().transform(Number).pipe(z.number().int().min(1)).default('5'),
    LLM_CB_WINDOW_MS: z.string().transform(Number).pipe(z.number().int().min(1000)).default('600000'),
    LLM_CB_RECOVERY_MS: z.string().transform(Number).pipe(z.number().int().min(1000)).default('300000'),
    LLM_CB_HALF_OPEN_MAX: z.string().transform(Number).pipe(z.number().int().min(1)).default('1'),

    // Retry
    LLM_RETRY_MAX: z.string().transform(Number).pipe(z.number().int().min(0)).default('2'),
    LLM_RETRY_BACKOFF_MS: z.string().transform(Number).pipe(z.number().int().min(100)).default('1000'),

    // Timeouts per provider
    LLM_TIMEOUT_ANTHROPIC_MS: z.string().transform(Number).pipe(z.number().int().min(1000)).default('30000'),
    LLM_TIMEOUT_GOOGLE_MS: z.string().transform(Number).pipe(z.number().int().min(1000)).default('30000'),
    LLM_TIMEOUT_OPENAI_MS: z.string().transform(Number).pipe(z.number().int().min(1000)).default('30000'),

    // Rate limits per provider (0 = unlimited)
    LLM_RPM_ANTHROPIC: z.string().transform(Number).pipe(z.number().int().min(0)).default('0'),
    LLM_RPM_GOOGLE: z.string().transform(Number).pipe(z.number().int().min(0)).default('0'),
    LLM_RPM_OPENAI: z.string().transform(Number).pipe(z.number().int().min(0)).default('0'),
    LLM_TPM_ANTHROPIC: z.string().transform(Number).pipe(z.number().int().min(0)).default('0'),
    LLM_TPM_GOOGLE: z.string().transform(Number).pipe(z.number().int().min(0)).default('0'),
    LLM_TPM_OPENAI: z.string().transform(Number).pipe(z.number().int().min(0)).default('0'),

    // Usage tracking
    LLM_USAGE_ENABLED: z.string().default('true'),
    LLM_USAGE_RETENTION_DAYS: z.string().transform(Number).pipe(z.number().int().min(1)).default('90'),

    // Cost budget (0 = unlimited)
    LLM_DAILY_BUDGET_USD: z.string().transform(Number).pipe(z.number().min(0)).default('0'),
    LLM_MONTHLY_BUDGET_USD: z.string().transform(Number).pipe(z.number().min(0)).default('0'),

    // Task routing (JSON strings)
    LLM_ROUTE_CLASSIFY: z.string().default(''),
    LLM_ROUTE_RESPOND: z.string().default(''),
    LLM_ROUTE_COMPLEX: z.string().default(''),
    LLM_ROUTE_TOOLS: z.string().default(''),
    LLM_ROUTE_PROACTIVE: z.string().default(''),

    // Fallback chain order (comma-separated)
    LLM_FALLBACK_CHAIN: z.string().default('anthropic,google,openai'),
  }),

  oficina: {
    title: { es: 'Gateway LLM', en: 'LLM Gateway' },
    info: {
      es: 'Gestión centralizada de proveedores LLM: routing, circuit breaker, costos y seguridad.',
      en: 'Centralized LLM provider management: routing, circuit breaker, costs and security.',
    },
    order: 10,
    fields: [
      // API Keys
      { key: 'ANTHROPIC_API_KEY', type: 'secret', label: { es: 'API Key Anthropic', en: 'Anthropic API Key' } },
      { key: 'OPENAI_API_KEY', type: 'secret', label: { es: 'API Key OpenAI', en: 'OpenAI API Key' } },
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
      { key: 'LLM_TIMEOUT_OPENAI_MS', type: 'number', label: { es: 'Timeout OpenAI (ms)', en: 'OpenAI timeout (ms)' } },

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
        info: { es: 'Orden de proveedores separados por coma (ej: anthropic,google,openai)', en: 'Provider order comma-separated (e.g.: anthropic,google,openai)' } },
    ],
    apiRoutes: [
      // Provider status
      {
        method: 'GET',
        path: 'status',
        handler: async (_req, res) => {
          if (!_gateway) {
            res.writeHead(503, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'LLM gateway not initialized' }))
            return
          }
          const status = await _gateway.getProviderStatus()
          const cost = await _gateway.getTodayCost()
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ providers: status, todayCostUsd: cost }))
        },
      },
      // Available models
      {
        method: 'GET',
        path: 'models',
        handler: async (_req, res) => {
          if (!_gateway) {
            res.writeHead(503, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'LLM gateway not initialized' }))
            return
          }
          const url = new URL(_req.url ?? '/', `http://${_req.headers.host}`)
          const provider = url.searchParams.get('provider') as LLMProviderName | null
          const models = _gateway.getAvailableModels(provider ?? undefined)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ models }))
        },
      },
      // Refresh models
      {
        method: 'POST',
        path: 'models/refresh',
        handler: async (_req, res) => {
          if (!_gateway) {
            res.writeHead(503, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'LLM gateway not initialized' }))
            return
          }
          await _gateway.refreshModels()
          const models = _gateway.getAvailableModels()
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true, count: models.length }))
        },
      },
      // Usage summary
      {
        method: 'GET',
        path: 'usage',
        handler: async (_req, res) => {
          if (!_gateway) {
            res.writeHead(503, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'LLM gateway not initialized' }))
            return
          }
          const url = new URL(_req.url ?? '/', `http://${_req.headers.host}`)
          const period = (url.searchParams.get('period') ?? 'day') as 'hour' | 'day' | 'week' | 'month'
          const summary = await _gateway.getUsageSummary(period)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify(summary))
        },
      },
      // Task routes
      {
        method: 'GET',
        path: 'routes',
        handler: async (_req, res) => {
          if (!_gateway) {
            res.writeHead(503, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'LLM gateway not initialized' }))
            return
          }
          const routes = _gateway.getRoutes()
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ routes }))
        },
      },
      // Update task route
      {
        method: 'PUT',
        path: 'routes',
        handler: async (req, res) => {
          if (!_gateway) {
            res.writeHead(503, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'LLM gateway not initialized' }))
            return
          }
          try {
            const body = await readBody(req)
            const data = JSON.parse(body) as { task: LLMTask; primary: RouteTarget; fallbacks?: RouteTarget[] }
            const route: TaskRoute = {
              task: data.task,
              primary: data.primary,
              fallbacks: data.fallbacks ?? [],
            }
            _gateway.setRoute(data.task, route)
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: true }))
          } catch (err) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Invalid route data: ' + String(err) }))
          }
        },
      },
      // Circuit breaker status
      {
        method: 'GET',
        path: 'circuit-breakers',
        handler: async (_req, res) => {
          if (!_gateway) {
            res.writeHead(503, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'LLM gateway not initialized' }))
            return
          }
          const status = _gateway.getCircuitBreakerStatus()
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ circuitBreakers: status }))
        },
      },
      // Reset circuit breaker
      {
        method: 'POST',
        path: 'circuit-breakers/reset',
        handler: async (req, res) => {
          if (!_gateway) {
            res.writeHead(503, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'LLM gateway not initialized' }))
            return
          }
          try {
            const body = await readBody(req)
            const data = JSON.parse(body) as { provider: LLMProviderName }
            _gateway.resetCircuitBreaker(data.provider)
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: true, provider: data.provider }))
          } catch (err) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Invalid data: ' + String(err) }))
          }
        },
      },
    ],
  },

  async init(registry: Registry) {
    _registry = registry
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
        messages: payload.messages.map(m => ({ role: m.role, content: m.content })),
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
    _registry = null
  },
}

// ─── Helper ──────────────────────────────

function readBody(req: import('node:http').IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')))
    req.on('error', reject)
  })
}

export default manifest
