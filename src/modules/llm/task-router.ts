// LUNA — LLM Task Router
// Enruta tareas a providers/modelos según configuración, disponibilidad y circuit breaker.

import pino from 'pino'
import type { CircuitBreakerManager } from './circuit-breaker.js'
import type {
  LLMProviderName,
  LLMTask,
  TaskRoute,
  ProviderAdapter,
  LLMModuleConfig,
} from './types.js'
import { TASK_TO_KEY_GROUP } from './types.js'

const logger = pino({ name: 'llm:router' })

// ═══════════════════════════════════════════
// Task temperature defaults (internal — not user-configurable)
// ═══════════════════════════════════════════

const TASK_TEMPERATURES: Partial<Record<LLMTask, number>> = {
  classify: 0.1,
  respond: 0.7,
  complex: 0.5,
  tools: 0.1,
  proactive: 0.7,
  compress: 0.2,
  ack: 0.8,
  criticize: 0.3,
  document_read: 0.2,
  batch: 0.3,
}

const TASK_MAX_TOKENS: Partial<Record<LLMTask, number>> = {
  ack: 30,
}

/** All tasks that can be configured via LLM_{TASK}_PROVIDER/MODEL */
const CONFIGURABLE_TASKS: LLMTask[] = [
  'classify', 'respond', 'complex', 'tools', 'proactive', 'criticize',
  'document_read', 'batch', 'vision', 'web_search', 'compress', 'ack',
]

// ═══════════════════════════════════════════
// Route resolution
// ═══════════════════════════════════════════

export type FallbackLevel = 'primary' | 'downgrade' | 'cross-api'

export interface ResolvedRoute {
  provider: LLMProviderName
  model: string
  apiKey: string
  temperature?: number
  maxTokens?: number
  isFallback: boolean
  fallbackIndex: number
  /** Which level in the 3-tier fallback chain */
  fallbackLevel: FallbackLevel
}

/**
 * Maps custom task names (used by engine/modules) to canonical route names.
 * This ensures all LLM calls route through the configured providers/models
 * with proper fallback chains, even when callers use descriptive task names.
 */
const TASK_ALIASES: Record<string, LLMTask> = {
  'evaluate': 'classify',
  'proactive-evaluate': 'classify',
  'compose': 'respond',
  'detect_commitment': 'classify',
  'process_attachment': 'vision',
  'subagent': 'tools',
  'scheduled-task': 'tools',
  'extract_qualification': 'classify',
  'parse_signature': 'classify',
  'extract_knowledge': 'vision',
  'transcribe': 'vision',
  // Nightly batch jobs
  'nightly-scoring': 'batch',
  'nightly-compress': 'batch',
  'nightly-reactivation': 'batch',
  // Document reading (attachments, tools, knowledge)
  'read_document': 'document_read',
  'summarize_document': 'document_read',
  // Cortex tasks (route to 'complex' for Anthropic engine key group)
  'cortex-analyze': 'complex',
  'cortex-pulse': 'complex',
  'cortex-trace': 'complex',
  'trace-evaluate': 'complex',
  'trace-compose': 'complex',
  'trace-analyze': 'complex',
  'trace-synthesize': 'complex',
}

export class TaskRouter {
  private routes: Map<LLMTask, TaskRoute> = new Map()
  private fallbackChain: LLMProviderName[] = ['anthropic', 'google']

  constructor(
    private readonly adapters: Map<LLMProviderName, ProviderAdapter>,
    private readonly breakers: CircuitBreakerManager,
    private readonly apiKeys: Map<string, string>, // envVar → key
  ) {}

  /**
   * Build all routes from module config. No hardcoded defaults —
   * all defaults come from configSchema Zod `.default()` values.
   */
  loadFromConfig(config: LLMModuleConfig): void {
    // Parse fallback chain
    if (config.LLM_FALLBACK_CHAIN) {
      try {
        this.fallbackChain = config.LLM_FALLBACK_CHAIN.split(',').map(s => s.trim()) as LLMProviderName[]
      } catch { /* keep default */ }
    }

    const cfg = config as unknown as Record<string, string | undefined>

    // Build routes from per-task config fields
    for (const task of CONFIGURABLE_TASKS) {
      const upper = task.toUpperCase()
      const provider = cfg[`LLM_${upper}_PROVIDER`] as LLMProviderName | undefined
      const model = cfg[`LLM_${upper}_MODEL`]
      if (!provider || !model) continue

      const temperature = TASK_TEMPERATURES[task]
      const maxTokens = TASK_MAX_TOKENS[task]

      // Downgrade (optional)
      const dgProvider = cfg[`LLM_${upper}_DOWNGRADE_PROVIDER`] as LLMProviderName | undefined
      const dgModel = cfg[`LLM_${upper}_DOWNGRADE_MODEL`]
      const downgrade = dgProvider && dgModel
        ? { provider: dgProvider, model: dgModel, temperature }
        : undefined

      // Cross-API fallback (optional)
      const fbProvider = cfg[`LLM_${upper}_FALLBACK_PROVIDER`] as LLMProviderName | undefined
      const fbModel = cfg[`LLM_${upper}_FALLBACK_MODEL`]
      const fallbacks = fbProvider && fbModel
        ? [{ provider: fbProvider, model: fbModel, temperature, maxTokens }]
        : []

      const route: TaskRoute = {
        task,
        primary: { provider, model, temperature, maxTokens, downgrade },
        fallbacks,
      }

      const warning = this.validateRoute(task, route)
      if (warning) logger.warn({ task, provider }, warning)

      this.routes.set(task, route)
    }
  }

  /**
   * Update a specific task route (from console UI).
   * Returns a warning message if the route has a problem (e.g. web_search without Google).
   */
  setRoute(task: LLMTask, route: TaskRoute): { warning?: string } {
    const warning = this.validateRoute(task, route)
    this.routes.set(task, route)
    logger.info({ task, primary: route.primary.provider + '/' + route.primary.model, warning }, 'Route updated')
    return { warning }
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
   * In advanced API mode, selects group-specific API keys per task.
   * Returns ordered list of targets to try.
   */
  resolve(
    task: LLMTask,
    overrideProvider?: LLMProviderName,
    overrideModel?: string,
    overrideApiKeyEnv?: string,
  ): ResolvedRoute[] {
    const results: ResolvedRoute[] = []
    const resolvedTask = TASK_ALIASES[task] ?? task
    const route = this.routes.get(resolvedTask as LLMTask)
    // Use original task name for key group lookup (e.g. 'trace-evaluate' → cortex group)
    // Falls back to resolved task if original has no group mapping
    const keyGroupTask = task

    // If explicit override, try that first
    if (overrideProvider && overrideModel) {
      const key = this.resolveApiKeyForTask(overrideProvider, keyGroupTask, overrideApiKeyEnv)
      if (key) {
        results.push({
          provider: overrideProvider,
          model: overrideModel,
          apiKey: key,
          isFallback: false,
          fallbackIndex: -1,
          fallbackLevel: 'primary',
        })
      }
    }

    if (route) {
      // Primary target
      const primaryKey = this.resolveApiKeyForTask(route.primary.provider, keyGroupTask, route.primary.apiKeyEnv)
      if (primaryKey && this.isAvailable(route.primary.provider)) {
        results.push({
          provider: route.primary.provider,
          model: route.primary.model,
          apiKey: primaryKey,
          temperature: route.primary.temperature,
          maxTokens: route.primary.maxTokens,
          isFallback: false,
          fallbackIndex: -1,
          fallbackLevel: 'primary',
        })
      }

      // Downgrade target (same provider, lesser model)
      if (route.primary.downgrade) {
        const dg = route.primary.downgrade
        const dgKey = this.resolveApiKeyForTask(dg.provider, keyGroupTask, dg.apiKeyEnv)
        if (dgKey && this.isAvailable(dg.provider)) {
          results.push({
            provider: dg.provider,
            model: dg.model,
            apiKey: dgKey,
            temperature: dg.temperature ?? route.primary.temperature,
            maxTokens: dg.maxTokens ?? route.primary.maxTokens,
            isFallback: true,
            fallbackIndex: -1,
            fallbackLevel: 'downgrade',
          })
        }
      }

      // Cross-API fallback targets
      for (let i = 0; i < route.fallbacks.length; i++) {
        const fb = route.fallbacks[i]!
        const fbKey = this.resolveApiKeyForTask(fb.provider, keyGroupTask, fb.apiKeyEnv)
        if (fbKey && this.isAvailable(fb.provider)) {
          results.push({
            provider: fb.provider,
            model: fb.model,
            apiKey: fbKey,
            temperature: fb.temperature,
            maxTokens: fb.maxTokens,
            isFallback: true,
            fallbackIndex: i,
            fallbackLevel: 'cross-api',
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
            fallbackLevel: 'cross-api',
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

  /**
   * Validate a route configuration and return a warning if problematic.
   * web_search MUST use Google as primary for native search grounding.
   * Anthropic does not have native web search — results will be degraded.
   */
  private validateRoute(task: LLMTask, route: TaskRoute): string | undefined {
    if (task === 'web_search' && route.primary.provider !== 'google') {
      return 'web_search debe usar Google como provider primario. Anthropic no tiene búsqueda web nativa — los resultados serán degradados o fallarán.'
    }
    return undefined
  }

  // ─── Private helpers ────────────────────────

  private isAvailable(provider: LLMProviderName): boolean {
    const adapter = this.adapters.get(provider)
    if (!adapter) return false
    return this.breakers.get(provider).isAvailable()
  }

  /**
   * Resolve API key for a specific task, considering advanced mode group keys.
   * Priority: explicit envVar → advanced group key → provider default key.
   */
  private resolveApiKeyForTask(provider: LLMProviderName, task: string, envVar?: string): string | null {
    // 1. Explicit envVar override always wins
    if (envVar) {
      const key = this.apiKeys.get(envVar)
      if (key) return key
    }

    // 2. Try group-specific key (if configured)
    const groupKey = this.resolveGroupApiKey(provider, task)
    if (groupKey) return groupKey

    // 3. Fall back to provider default key
    return this.resolveApiKeyForProvider(provider)
  }

  /**
   * Resolve the group-specific API key for a task in advanced mode.
   * Tries the original task name first (e.g. 'trace-evaluate' → cortex),
   * then falls back to the resolved/canonical task name.
   * Returns null if no group key is configured (falls back to default).
   */
  private resolveGroupApiKey(provider: LLMProviderName, task: string): string | null {
    // Try original task name first, then resolved alias
    const resolvedTask = TASK_ALIASES[task] ?? task
    const group = TASK_TO_KEY_GROUP[task] ?? TASK_TO_KEY_GROUP[resolvedTask]
    if (!group) return null

    // Build the env var name: LLM_{PROVIDER}_{GROUP}_API_KEY
    const providerUpper = provider === 'anthropic' ? 'ANTHROPIC' : 'GOOGLE'
    const groupUpper = group.toUpperCase()
    const envVar = `LLM_${providerUpper}_${groupUpper}_API_KEY`

    return this.apiKeys.get(envVar) ?? null
  }

  private resolveApiKeyForProvider(provider: LLMProviderName): string | null {
    const defaultVars: Record<LLMProviderName, string> = {
      anthropic: 'ANTHROPIC_API_KEY',
      google: 'GOOGLE_AI_API_KEY',
    }
    return this.apiKeys.get(defaultVars[provider]) ?? null
  }

  private defaultModelFor(provider: LLMProviderName): string {
    const defaults: Record<LLMProviderName, string> = {
      anthropic: 'claude-sonnet-4-5-20250929',
      google: 'gemini-2.5-flash',
    }
    return defaults[provider]
  }
}
