// LUNA — LLM Task Router
// Enruta tareas a providers/modelos según configuración, disponibilidad y circuit breaker.

import pino from 'pino'
import type { CircuitBreakerManager } from './circuit-breaker.js'
import type {
  LLMProviderName,
  LLMTask,
  TaskRoute,
  RouteTarget,
  ProviderAdapter,
  LLMModuleConfig,
} from './types.js'

const logger = pino({ name: 'llm:router' })

// ═══════════════════════════════════════════
// Default routes (matching existing engine config)
// ═══════════════════════════════════════════

const DEFAULT_ROUTES: TaskRoute[] = [
  {
    task: 'classify',
    primary: { provider: 'anthropic', model: 'claude-haiku-4-5-20251001', temperature: 0.1 },
    fallbacks: [
      { provider: 'google', model: 'gemini-2.5-flash', temperature: 0.1 },
      { provider: 'openai', model: 'gpt-4o-mini', temperature: 0.1 },
    ],
  },
  {
    task: 'respond',
    primary: { provider: 'anthropic', model: 'claude-sonnet-4-5-20250929', temperature: 0.7 },
    fallbacks: [
      { provider: 'google', model: 'gemini-2.5-flash', temperature: 0.7 },
      { provider: 'openai', model: 'gpt-4o-mini', temperature: 0.7 },
    ],
  },
  {
    task: 'complex',
    primary: { provider: 'anthropic', model: 'claude-opus-4-5-20251101', temperature: 0.5 },
    fallbacks: [
      { provider: 'google', model: 'gemini-2.5-pro', temperature: 0.5 },
      { provider: 'openai', model: 'gpt-4o', temperature: 0.5 },
    ],
  },
  {
    task: 'tools',
    primary: { provider: 'anthropic', model: 'claude-haiku-4-5-20251001', temperature: 0.1 },
    fallbacks: [
      { provider: 'google', model: 'gemini-2.5-flash', temperature: 0.1 },
      { provider: 'openai', model: 'gpt-4o-mini', temperature: 0.1 },
    ],
  },
  {
    task: 'proactive',
    primary: { provider: 'anthropic', model: 'claude-sonnet-4-5-20250929', temperature: 0.7 },
    fallbacks: [
      { provider: 'google', model: 'gemini-2.5-flash', temperature: 0.7 },
      { provider: 'openai', model: 'gpt-4o-mini', temperature: 0.7 },
    ],
  },
  {
    task: 'vision',
    primary: { provider: 'anthropic', model: 'claude-sonnet-4-5-20250929' },
    fallbacks: [
      { provider: 'openai', model: 'gpt-4o' },
      { provider: 'google', model: 'gemini-2.5-pro' },
    ],
  },
  {
    task: 'web_search',
    primary: { provider: 'google', model: 'gemini-2.5-flash' },
    fallbacks: [
      { provider: 'openai', model: 'gpt-4o-mini' },
      { provider: 'anthropic', model: 'claude-sonnet-4-5-20250929' },
    ],
  },
  {
    task: 'compress',
    primary: { provider: 'anthropic', model: 'claude-haiku-4-5-20251001', temperature: 0.2 },
    fallbacks: [
      { provider: 'google', model: 'gemini-2.5-flash', temperature: 0.2 },
    ],
  },
  {
    task: 'ack',
    primary: { provider: 'anthropic', model: 'claude-haiku-4-5-20251001', temperature: 0.8, maxTokens: 30 },
    fallbacks: [
      { provider: 'google', model: 'gemini-2.5-flash', temperature: 0.8, maxTokens: 30 },
    ],
  },
]

// ═══════════════════════════════════════════
// Route resolution
// ═══════════════════════════════════════════

export interface ResolvedRoute {
  provider: LLMProviderName
  model: string
  apiKey: string
  temperature?: number
  maxTokens?: number
  isFallback: boolean
  fallbackIndex: number
}

export class TaskRouter {
  private routes: Map<LLMTask, TaskRoute> = new Map()
  private fallbackChain: LLMProviderName[] = ['anthropic', 'google', 'openai']

  constructor(
    private readonly adapters: Map<LLMProviderName, ProviderAdapter>,
    private readonly breakers: CircuitBreakerManager,
    private readonly apiKeys: Map<string, string>, // envVar → key
  ) {
    // Load defaults
    for (const route of DEFAULT_ROUTES) {
      this.routes.set(route.task, route)
    }
  }

  /**
   * Load custom routes from module config (overrides defaults).
   */
  loadFromConfig(config: LLMModuleConfig): void {
    // Parse fallback chain
    if (config.LLM_FALLBACK_CHAIN) {
      try {
        this.fallbackChain = config.LLM_FALLBACK_CHAIN.split(',').map(s => s.trim()) as LLMProviderName[]
      } catch { /* keep default */ }
    }

    // Parse per-task routes from JSON env vars
    const routeMap: Record<string, string> = {
      classify: config.LLM_ROUTE_CLASSIFY,
      respond: config.LLM_ROUTE_RESPOND,
      complex: config.LLM_ROUTE_COMPLEX,
      tools: config.LLM_ROUTE_TOOLS,
      proactive: config.LLM_ROUTE_PROACTIVE,
    }

    for (const [task, json] of Object.entries(routeMap)) {
      if (!json) continue
      try {
        const parsed = JSON.parse(json) as { provider: string; model: string; temperature?: number; apiKeyEnv?: string }
        const existing = this.routes.get(task as LLMTask)
        if (existing) {
          existing.primary = {
            provider: parsed.provider as LLMProviderName,
            model: parsed.model,
            temperature: parsed.temperature,
            apiKeyEnv: parsed.apiKeyEnv,
          }
        }
      } catch (err) {
        logger.warn({ task, err }, 'Failed to parse route config, using default')
      }
    }
  }

  /**
   * Update a specific task route (from console UI).
   */
  setRoute(task: LLMTask, route: TaskRoute): void {
    this.routes.set(task, route)
    logger.info({ task, primary: route.primary.provider + '/' + route.primary.model }, 'Route updated')
  }

  /**
   * Get the configured route for a task.
   */
  getRoute(task: LLMTask): TaskRoute | undefined {
    return this.routes.get(task)
  }

  /**
   * Get all configured routes.
   */
  getAllRoutes(): TaskRoute[] {
    return [...this.routes.values()]
  }

  /**
   * Resolve the best available target for a request.
   * Considers: explicit overrides, circuit breaker state, adapter availability.
   * Returns ordered list of targets to try.
   */
  resolve(
    task: LLMTask,
    overrideProvider?: LLMProviderName,
    overrideModel?: string,
    overrideApiKeyEnv?: string,
  ): ResolvedRoute[] {
    const results: ResolvedRoute[] = []
    const route = this.routes.get(task)

    // If explicit override, try that first
    if (overrideProvider && overrideModel) {
      const key = this.resolveApiKey(overrideProvider, overrideApiKeyEnv)
      if (key) {
        results.push({
          provider: overrideProvider,
          model: overrideModel,
          apiKey: key,
          isFallback: false,
          fallbackIndex: -1,
        })
      }
    }

    if (route) {
      // Primary target
      const primaryKey = this.resolveApiKey(route.primary.provider, route.primary.apiKeyEnv)
      if (primaryKey && this.isAvailable(route.primary.provider)) {
        results.push({
          provider: route.primary.provider,
          model: route.primary.model,
          apiKey: primaryKey,
          temperature: route.primary.temperature,
          maxTokens: route.primary.maxTokens,
          isFallback: false,
          fallbackIndex: -1,
        })
      }

      // Fallback targets
      for (let i = 0; i < route.fallbacks.length; i++) {
        const fb = route.fallbacks[i]!
        const fbKey = this.resolveApiKey(fb.provider, fb.apiKeyEnv)
        if (fbKey && this.isAvailable(fb.provider)) {
          results.push({
            provider: fb.provider,
            model: fb.model,
            apiKey: fbKey,
            temperature: fb.temperature,
            maxTokens: fb.maxTokens,
            isFallback: true,
            fallbackIndex: i,
          })
        }
      }
    }

    // Last resort: try any available provider from fallback chain
    if (results.length === 0) {
      for (const provider of this.fallbackChain) {
        const key = this.resolveApiKeyForProvider(provider)
        if (key && this.isAvailable(provider)) {
          results.push({
            provider,
            model: this.defaultModelFor(provider),
            apiKey: key,
            isFallback: true,
            fallbackIndex: 99,
          })
          break
        }
      }
    }

    // Deduplicate by provider+model
    const seen = new Set<string>()
    return results.filter(r => {
      const key = `${r.provider}:${r.model}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
  }

  // ─── Private helpers ────────────────────────

  private isAvailable(provider: LLMProviderName): boolean {
    const adapter = this.adapters.get(provider)
    if (!adapter) return false
    return this.breakers.get(provider).isAvailable()
  }

  private resolveApiKey(provider: LLMProviderName, envVar?: string): string | null {
    // Priority: explicit envVar override → provider default key
    if (envVar) {
      const key = this.apiKeys.get(envVar)
      if (key) return key
    }
    return this.resolveApiKeyForProvider(provider)
  }

  private resolveApiKeyForProvider(provider: LLMProviderName): string | null {
    const defaultVars: Record<LLMProviderName, string> = {
      anthropic: 'ANTHROPIC_API_KEY',
      google: 'GOOGLE_AI_API_KEY',
      openai: 'OPENAI_API_KEY',
    }
    return this.apiKeys.get(defaultVars[provider]) ?? null
  }

  private defaultModelFor(provider: LLMProviderName): string {
    const defaults: Record<LLMProviderName, string> = {
      anthropic: 'claude-sonnet-4-5-20250929',
      google: 'gemini-2.5-flash',
      openai: 'gpt-4o-mini',
    }
    return defaults[provider]
  }
}
