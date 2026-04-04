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
// Default routes (matching existing engine config)
// ═══════════════════════════════════════════

const DEFAULT_ROUTES: TaskRoute[] = [
  // Phase 2 evaluate: Sonnet → Flash
  {
    task: 'classify',
    primary: {
      provider: 'anthropic', model: 'claude-sonnet-4-5-20250929', temperature: 0.1,
    },
    fallbacks: [
      { provider: 'google', model: 'gemini-2.5-flash', temperature: 0.1 },
    ],
  },
  // Phase 4 compose: Flash → Flash-Lite → Sonnet
  {
    task: 'respond',
    primary: {
      provider: 'google', model: 'gemini-2.5-flash', temperature: 0.7,
      downgrade: { provider: 'google', model: 'gemini-2.5-flash-lite', temperature: 0.7 },
    },
    fallbacks: [
      { provider: 'anthropic', model: 'claude-sonnet-4-5-20250929', temperature: 0.7 },
    ],
  },
  // Complex / subagent heavy: Opus → Sonnet → Pro
  {
    task: 'complex',
    primary: {
      provider: 'anthropic', model: 'claude-opus-4-5-20251101', temperature: 0.5,
      downgrade: { provider: 'anthropic', model: 'claude-sonnet-4-5-20250929', temperature: 0.5 },
    },
    fallbacks: [
      { provider: 'google', model: 'gemini-2.5-pro', temperature: 0.5 },
    ],
  },
  // Tools / subagent: Sonnet → Flash
  {
    task: 'tools',
    primary: {
      provider: 'anthropic', model: 'claude-sonnet-4-5-20250929', temperature: 0.1,
    },
    fallbacks: [
      { provider: 'google', model: 'gemini-2.5-flash', temperature: 0.1 },
    ],
  },
  // Proactive: Sonnet → Flash
  {
    task: 'proactive',
    primary: {
      provider: 'anthropic', model: 'claude-sonnet-4-5-20250929', temperature: 0.7,
    },
    fallbacks: [
      { provider: 'google', model: 'gemini-2.5-flash', temperature: 0.7 },
    ],
  },
  // Vision / multimedia: Flash → Flash-Lite → Sonnet
  {
    task: 'vision',
    primary: {
      provider: 'google', model: 'gemini-2.5-flash',
      downgrade: { provider: 'google', model: 'gemini-2.5-flash-lite' },
    },
    fallbacks: [
      { provider: 'anthropic', model: 'claude-sonnet-4-5-20250929' },
    ],
  },
  // Web search: Flash+grounding → Pro → Sonnet
  {
    task: 'web_search',
    primary: {
      provider: 'google', model: 'gemini-2.5-flash',
      downgrade: { provider: 'google', model: 'gemini-2.5-pro' },
    },
    fallbacks: [
      { provider: 'anthropic', model: 'claude-sonnet-4-5-20250929' },
    ],
  },
  // Compress: Haiku → Flash (lightweight)
  {
    task: 'compress',
    primary: {
      provider: 'anthropic', model: 'claude-haiku-4-5-20251001', temperature: 0.2,
    },
    fallbacks: [
      { provider: 'google', model: 'gemini-2.5-flash', temperature: 0.2 },
    ],
  },
  // ACK: Haiku → Flash (ultra-lightweight, 30 tokens)
  {
    task: 'ack',
    primary: {
      provider: 'anthropic', model: 'claude-haiku-4-5-20251001', temperature: 0.8, maxTokens: 30,
    },
    fallbacks: [
      { provider: 'google', model: 'gemini-2.5-flash', temperature: 0.8, maxTokens: 30 },
    ],
  },
  // Criticize: Gemini Pro → Flash → Sonnet (quality gate — reviews response before sending)
  {
    task: 'criticize',
    primary: {
      provider: 'google', model: 'gemini-2.5-pro', temperature: 0.3,
      downgrade: { provider: 'google', model: 'gemini-2.5-flash', temperature: 0.3 },
    },
    fallbacks: [
      { provider: 'anthropic', model: 'claude-sonnet-4-5-20250929', temperature: 0.3 },
    ],
  },
  // Document read: Sonnet → Flash (interpret/summarize extracted documents)
  {
    task: 'document_read',
    primary: {
      provider: 'anthropic', model: 'claude-sonnet-4-5-20250929', temperature: 0.2,
    },
    fallbacks: [
      { provider: 'google', model: 'gemini-2.5-flash', temperature: 0.2 },
    ],
  },
  // Batch (nightly summaries/analysis): Sonnet → Flash
  {
    task: 'batch',
    primary: {
      provider: 'anthropic', model: 'claude-sonnet-4-5-20250929', temperature: 0.3,
    },
    fallbacks: [
      { provider: 'google', model: 'gemini-2.5-flash', temperature: 0.3 },
    ],
  },
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
    const routeMap: Record<string, string | undefined> = {
      classify: config.LLM_ROUTE_CLASSIFY,
      respond: config.LLM_ROUTE_RESPOND,
      complex: config.LLM_ROUTE_COMPLEX,
      tools: config.LLM_ROUTE_TOOLS,
      proactive: config.LLM_ROUTE_PROACTIVE,
      criticize: config.LLM_ROUTE_CRITICIZE,
      document_read: config.LLM_ROUTE_DOCUMENT_READ,
      batch: config.LLM_ROUTE_BATCH,
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
            downgrade: existing.primary.downgrade, // preserve downgrade if already set
          }
          // Validate the route and warn if problematic
          const warning = this.validateRoute(task as LLMTask, existing)
          if (warning) {
            logger.warn({ task, provider: parsed.provider }, warning)
          }
        }
      } catch (err) {
        logger.warn({ task, err }, 'Failed to parse route config, using default')
      }
    }

    // Parse per-task primary model overrides (from advanced console table)
    const cfg = config as unknown as Record<string, string | undefined>
    const primaryOverrides: Array<{ task: LLMTask; providerKey: string; modelKey: string }> = [
      { task: 'classify', providerKey: 'LLM_CLASSIFY_PROVIDER', modelKey: 'LLM_CLASSIFY_MODEL' },
      { task: 'respond', providerKey: 'LLM_RESPOND_PROVIDER', modelKey: 'LLM_RESPOND_MODEL' },
      { task: 'complex', providerKey: 'LLM_COMPLEX_PROVIDER', modelKey: 'LLM_COMPLEX_MODEL' },
      { task: 'tools', providerKey: 'LLM_TOOLS_PROVIDER', modelKey: 'LLM_TOOLS_MODEL' },
      { task: 'proactive', providerKey: 'LLM_PROACTIVE_PROVIDER', modelKey: 'LLM_PROACTIVE_MODEL' },
      { task: 'criticize', providerKey: 'LLM_CRITICIZE_PROVIDER', modelKey: 'LLM_CRITICIZE_MODEL' },
      { task: 'document_read', providerKey: 'LLM_DOCUMENT_READ_PROVIDER', modelKey: 'LLM_DOCUMENT_READ_MODEL' },
      { task: 'batch', providerKey: 'LLM_BATCH_PROVIDER', modelKey: 'LLM_BATCH_MODEL' },
      { task: 'vision', providerKey: 'LLM_VISION_PROVIDER', modelKey: 'LLM_VISION_MODEL' },
      { task: 'web_search', providerKey: 'LLM_WEB_SEARCH_PROVIDER', modelKey: 'LLM_WEB_SEARCH_MODEL' },
    ]

    for (const { task, providerKey, modelKey } of primaryOverrides) {
      const provider = cfg[providerKey]
      const model = cfg[modelKey]
      if (provider && model) {
        const existing = this.routes.get(task)
        if (existing) {
          existing.primary = {
            ...existing.primary,
            provider: provider as LLMProviderName,
            model,
          }
          const warning = this.validateRoute(task, existing)
          if (warning) logger.warn({ task, provider }, warning)
        }
      }
    }

    // Parse per-task downgrade targets (separate provider/model keys)
    const downgradeTasks: Array<{ task: LLMTask; providerKey: string; modelKey: string }> = [
      { task: 'classify', providerKey: 'LLM_CLASSIFY_DOWNGRADE_PROVIDER', modelKey: 'LLM_CLASSIFY_DOWNGRADE_MODEL' },
      { task: 'respond', providerKey: 'LLM_RESPOND_DOWNGRADE_PROVIDER', modelKey: 'LLM_RESPOND_DOWNGRADE_MODEL' },
      { task: 'complex', providerKey: 'LLM_COMPLEX_DOWNGRADE_PROVIDER', modelKey: 'LLM_COMPLEX_DOWNGRADE_MODEL' },
      { task: 'tools', providerKey: 'LLM_TOOLS_DOWNGRADE_PROVIDER', modelKey: 'LLM_TOOLS_DOWNGRADE_MODEL' },
      { task: 'proactive', providerKey: 'LLM_PROACTIVE_DOWNGRADE_PROVIDER', modelKey: 'LLM_PROACTIVE_DOWNGRADE_MODEL' },
      { task: 'criticize', providerKey: 'LLM_CRITICIZE_DOWNGRADE_PROVIDER', modelKey: 'LLM_CRITICIZE_DOWNGRADE_MODEL' },
      { task: 'document_read', providerKey: 'LLM_DOCUMENT_READ_DOWNGRADE_PROVIDER', modelKey: 'LLM_DOCUMENT_READ_DOWNGRADE_MODEL' },
      { task: 'batch', providerKey: 'LLM_BATCH_DOWNGRADE_PROVIDER', modelKey: 'LLM_BATCH_DOWNGRADE_MODEL' },
      { task: 'vision', providerKey: 'LLM_VISION_DOWNGRADE_PROVIDER', modelKey: 'LLM_VISION_DOWNGRADE_MODEL' },
      { task: 'web_search', providerKey: 'LLM_WEB_SEARCH_DOWNGRADE_PROVIDER', modelKey: 'LLM_WEB_SEARCH_DOWNGRADE_MODEL' },
    ]

    for (const { task, providerKey, modelKey } of downgradeTasks) {
      const dgProvider = cfg[providerKey]
      const dgModel = cfg[modelKey]
      if (dgProvider && dgModel) {
        const existing = this.routes.get(task)
        if (existing) {
          existing.primary.downgrade = {
            provider: dgProvider as LLMProviderName,
            model: dgModel,
          }
        }
      }
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
