// LUNA — LLM Gateway
// Orquestador central de llamadas LLM. Coordina:
// routing → rate limit check → budget check → circuit breaker → retry → provider call → usage tracking → response sanitization

import pino from 'pino'
import type { Pool } from 'pg'
import type { Redis } from 'ioredis'
import type { Registry } from '../../kernel/registry.js'
import { CircuitBreakerManager } from './circuit-breaker.js'
import { TaskRouter, type ResolvedRoute } from './task-router.js'
import { UsageTracker } from './usage-tracker.js'
import { createAdapters } from './providers.js'
import { sanitizePrompt, sanitizeResponse, securityPreamble } from './security.js'
import * as pgStore from './pg-store.js'
import {
  DEFAULT_COST_TABLE,
  type LLMModuleConfig,
  type LLMProviderName,
  type LLMRequest,
  type LLMResponse,
  type LLMTask,
  type ProviderAdapter,
  type ProviderStatus,
  type ModelInfo,
  type TaskRoute,
  type CircuitBreakerConfig,
  type UsageSummary,
} from './types.js'

const logger = pino({ name: 'llm:gateway' })

export class LLMGateway {
  private adapters: Map<LLMProviderName, ProviderAdapter>
  private breakers: CircuitBreakerManager
  private router: TaskRouter
  private tracker: UsageTracker
  private apiKeys = new Map<string, string>()
  private providerTimeouts = new Map<LLMProviderName, number>()
  private retryMax = 2
  private retryBackoffMs = 1000
  private registry: Registry | null = null

  // Model cache (from model-scanner or listModels)
  private modelCache = new Map<LLMProviderName, ModelInfo[]>()

  constructor(
    db: Pool,
    redis: Redis,
    config: LLMModuleConfig,
  ) {
    // Create adapters
    this.adapters = createAdapters()

    // Circuit breaker config
    const cbConfig: CircuitBreakerConfig = {
      failureThreshold: config.LLM_CB_FAILURE_THRESHOLD,
      windowMs: config.LLM_CB_WINDOW_MS,
      recoveryMs: config.LLM_CB_RECOVERY_MS,
      halfOpenMax: config.LLM_CB_HALF_OPEN_MAX,
    }
    this.breakers = new CircuitBreakerManager(cbConfig)
    this.breakers.onRecovery = (provider) => {
      if (this.registry) {
        this.registry.runHook('llm:provider_up', { provider })
      }
    }

    // Retry config
    this.retryMax = config.LLM_RETRY_MAX
    this.retryBackoffMs = config.LLM_RETRY_BACKOFF_MS

    // Collect API keys
    this.loadApiKeys(config)

    // Provider timeouts
    this.providerTimeouts.set('anthropic', config.LLM_TIMEOUT_ANTHROPIC_MS)
    this.providerTimeouts.set('google', config.LLM_TIMEOUT_GOOGLE_MS)
    this.providerTimeouts.set('openai', config.LLM_TIMEOUT_OPENAI_MS)

    // Initialize adapters with their default keys
    this.initAdapters()

    // Create router
    this.router = new TaskRouter(this.adapters, this.breakers, this.apiKeys)
    this.router.loadFromConfig(config)

    // Create usage tracker
    this.tracker = new UsageTracker(db, redis, DEFAULT_COST_TABLE, {
      enabled: config.LLM_USAGE_ENABLED === 'true',
      retentionDays: config.LLM_USAGE_RETENTION_DAYS,
      dailyBudgetUsd: config.LLM_DAILY_BUDGET_USD,
      monthlyBudgetUsd: config.LLM_MONTHLY_BUDGET_USD,
    })
  }

  /**
   * Set registry reference (for firing hooks).
   */
  setRegistry(registry: Registry): void {
    this.registry = registry
  }

  /**
   * Initialize database tables and start background processes.
   */
  async init(db: Pool): Promise<void> {
    await pgStore.ensureTables(db)
    this.tracker.startCleanup()
  }

  /**
   * Stop background processes.
   */
  stop(): void {
    this.tracker.stop()
  }

  // ═══════════════════════════════════════════
  // Main API
  // ═══════════════════════════════════════════

  /**
   * Send a chat request through the gateway.
   * Handles: routing, circuit breaker, retry, fallback, tracking, sanitization.
   */
  async chat(request: LLMRequest): Promise<LLMResponse> {
    const start = Date.now()
    const task = request.task

    // 1. Sanitize system prompt — never send API keys to the model
    if (request.system) {
      request.system = sanitizePrompt(request.system)
    }

    // 2. Inject security preamble
    if (request.system) {
      request.system = securityPreamble() + '\n\n' + request.system
    } else {
      request.system = securityPreamble()
    }

    // 3. Resolve route targets (ordered by preference + availability)
    const targets = this.router.resolve(
      task,
      request.provider,
      request.model,
      request.apiKeyEnv,
    )

    if (targets.length === 0) {
      const error = 'No available LLM providers for task: ' + task
      logger.error({ task }, error)
      throw new Error(error)
    }

    // 4. Try each target with retry
    let lastError: Error | null = null

    for (const target of targets) {
      // Check rate limits
      const rpmLimit = this.getRpmLimit(target.provider)
      const tpmLimit = this.getTpmLimit(target.provider)
      const rateCheck = await this.tracker.checkRateLimit(target.provider, rpmLimit, tpmLimit)
      if (!rateCheck.allowed) {
        logger.warn({ provider: target.provider, reason: rateCheck.reason }, 'Rate limit exceeded, trying next')
        lastError = new Error(rateCheck.reason ?? 'Rate limit exceeded')
        continue
      }

      // Check budget
      const budgetCheck = await this.tracker.checkBudget()
      if (!budgetCheck.allowed) {
        logger.error({ reason: budgetCheck.reason }, 'Budget exceeded — blocking LLM call')
        throw new Error('LLM budget exceeded: ' + budgetCheck.reason)
      }

      // Check circuit breaker (unless bypass requested)
      if (!request.bypassCircuitBreaker) {
        const breaker = this.breakers.get(target.provider)
        if (!breaker.isAvailable()) {
          logger.warn({ provider: target.provider }, 'Circuit breaker open, skipping')
          lastError = new Error('Circuit breaker open for ' + target.provider)
          continue
        }
      }

      // Try with retries
      const result = await this.tryWithRetry(request, target, task, start)
      if (result) {
        // Sanitize response
        const sanitized = sanitizeResponse(result.text)
        if (sanitized.hadSensitiveData) {
          logger.error({ provider: target.provider, model: target.model }, 'LLM response contained sensitive data — redacted')
        }
        result.text = sanitized.text
        result.fromFallback = target.isFallback
        return result
      }
      lastError = new Error(`Provider ${target.provider}/${target.model} failed after retries`)
    }

    // All targets exhausted
    const errorMsg = lastError?.message ?? 'All LLM providers failed'
    logger.error({ task, targets: targets.length }, errorMsg)
    throw new Error(errorMsg)
  }

  /**
   * Get status of all providers (for oficina).
   */
  async getProviderStatus(): Promise<ProviderStatus[]> {
    const statuses: ProviderStatus[] = []
    const providers: LLMProviderName[] = ['anthropic', 'google', 'openai']

    for (const name of providers) {
      const adapter = this.adapters.get(name)
      const breaker = this.breakers.get(name)
      const snapshot = breaker.snapshot()
      const hasKey = this.hasApiKey(name)

      const [recentErrors, avgLatency, lastUsed] = await Promise.all([
        this.tracker.getErrorCount(name),
        this.tracker.getAvgLatency(name),
        this.tracker.getLastUsed(name),
      ])

      const models = this.modelCache.get(name) ?? []

      statuses.push({
        name,
        enabled: hasKey && (adapter?.isInitialized() ?? false),
        circuitState: snapshot.state,
        available: hasKey && snapshot.state !== 'open',
        modelsCount: models.length,
        recentErrors,
        avgLatencyMs: avgLatency,
        lastUsedAt: lastUsed,
      })
    }

    return statuses
  }

  /**
   * Get available models (from cache or fresh scan).
   */
  getAvailableModels(provider?: LLMProviderName): ModelInfo[] {
    if (provider) {
      return this.modelCache.get(provider) ?? []
    }
    const all: ModelInfo[] = []
    for (const models of this.modelCache.values()) {
      all.push(...models)
    }
    return all
  }

  /**
   * Refresh model list from provider APIs.
   */
  async refreshModels(): Promise<void> {
    const providers: LLMProviderName[] = ['anthropic', 'google', 'openai']

    const results = await Promise.allSettled(
      providers.map(async (name) => {
        const adapter = this.adapters.get(name)
        const key = this.getDefaultApiKey(name)
        if (!adapter?.listModels || !key) return { name, models: [] }
        const models = await adapter.listModels(key)
        return { name, models }
      }),
    )

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value.models.length > 0) {
        this.modelCache.set(result.value.name, result.value.models)
      }
    }

    // Fire hook to notify oficina
    if (this.registry) {
      for (const [provider, models] of this.modelCache) {
        await this.registry.callHook('llm:models_available', { provider })
      }
    }

    logger.info(
      {
        anthropic: this.modelCache.get('anthropic')?.length ?? 0,
        google: this.modelCache.get('google')?.length ?? 0,
        openai: this.modelCache.get('openai')?.length ?? 0,
      },
      'Models refreshed',
    )
  }

  /**
   * Get usage summary.
   */
  async getUsageSummary(period: 'hour' | 'day' | 'week' | 'month'): Promise<UsageSummary> {
    return this.tracker.getSummary(period)
  }

  /**
   * Get today's estimated cost.
   */
  async getTodayCost(): Promise<number> {
    return this.tracker.getTodayCost()
  }

  /**
   * Get all task routes.
   */
  getRoutes(): TaskRoute[] {
    return this.router.getAllRoutes()
  }

  /**
   * Update a task route (from oficina).
   */
  setRoute(task: LLMTask, route: TaskRoute): void {
    this.router.setRoute(task, route)
  }

  /**
   * Force reset a circuit breaker (manual recovery).
   */
  resetCircuitBreaker(provider: LLMProviderName): void {
    this.breakers.get(provider).reset()
    if (this.registry) {
      this.registry.runHook('llm:provider_up', { provider })
    }
  }

  /**
   * Get circuit breaker snapshots.
   */
  getCircuitBreakerStatus() {
    return this.breakers.allSnapshots()
  }

  // ═══════════════════════════════════════════
  // Internal
  // ═══════════════════════════════════════════

  private async tryWithRetry(
    request: LLMRequest,
    target: ResolvedRoute,
    task: LLMTask,
    overallStart: number,
  ): Promise<LLMResponse | null> {
    const adapter = this.adapters.get(target.provider)
    if (!adapter) return null

    const timeout = request.timeoutMs ?? this.providerTimeouts.get(target.provider) ?? 30000

    // Build the request with target overrides
    const req: LLMRequest = {
      ...request,
      model: target.model,
      temperature: request.temperature ?? target.temperature,
      maxTokens: request.maxTokens ?? target.maxTokens,
    }

    for (let attempt = 0; attempt <= this.retryMax; attempt++) {
      const attemptStart = Date.now()

      try {
        const response = await adapter.chat(req, target.apiKey, timeout)
        response.attempt = attempt

        // Record success
        this.breakers.get(target.provider).recordSuccess()
        await this.tracker.record(
          response, task, target.provider, target.model,
          Date.now() - attemptStart, true, undefined, request.traceId,
        )

        return response
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err))
        const durationMs = Date.now() - attemptStart

        logger.warn(
          { provider: target.provider, model: target.model, attempt, error: error.message, durationMs },
          'LLM call failed',
        )

        // Record failure
        await this.tracker.record(
          null, task, target.provider, target.model,
          durationMs, false, error.message, request.traceId,
        )

        // Only count retryable errors toward circuit breaker
        if (this.isRetryableError(error)) {
          if (attempt === this.retryMax) {
            // All retries exhausted — record circuit breaker failure
            const opened = this.breakers.get(target.provider).recordFailure(error.message)
            if (opened && this.registry) {
              await this.registry.runHook('llm:provider_down', {
                provider: target.provider,
                reason: error.message,
              })
            }
          } else {
            // Wait before retry with exponential backoff
            const delay = this.retryBackoffMs * Math.pow(2, attempt)
            await sleep(delay)
          }
        } else {
          // Non-retryable error — count as circuit breaker failure immediately
          const opened = this.breakers.get(target.provider).recordFailure(error.message)
          if (opened && this.registry) {
            await this.registry.runHook('llm:provider_down', {
              provider: target.provider,
              reason: error.message,
            })
          }
          break // Don't retry non-retryable errors
        }
      }
    }

    return null
  }

  private isRetryableError(error: Error): boolean {
    const msg = error.message.toLowerCase()
    const retryable = [
      'timeout', 'abort', 'econnrefused', 'econnreset', 'enotfound',
      'socket hang up', 'network', 'fetch failed',
      '429', 'rate limit', 'too many requests',
      '500', '502', '503', '504', 'internal server error', 'bad gateway',
      'service unavailable', 'gateway timeout', 'overloaded',
    ]
    return retryable.some(pattern => msg.includes(pattern))
  }

  private loadApiKeys(config: LLMModuleConfig): void {
    // Default provider keys
    if (config.ANTHROPIC_API_KEY) this.apiKeys.set('ANTHROPIC_API_KEY', config.ANTHROPIC_API_KEY)
    if (config.OPENAI_API_KEY) this.apiKeys.set('OPENAI_API_KEY', config.OPENAI_API_KEY)
    if (config.GOOGLE_AI_API_KEY) this.apiKeys.set('GOOGLE_AI_API_KEY', config.GOOGLE_AI_API_KEY)

    // Per-capability overrides
    if (config.LLM_VISION_API_KEY) this.apiKeys.set('LLM_VISION_API_KEY', config.LLM_VISION_API_KEY)
    if (config.LLM_STT_API_KEY) this.apiKeys.set('LLM_STT_API_KEY', config.LLM_STT_API_KEY)
    if (config.LLM_IMAGE_GEN_API_KEY) this.apiKeys.set('LLM_IMAGE_GEN_API_KEY', config.LLM_IMAGE_GEN_API_KEY)
  }

  private initAdapters(): void {
    const keyMap: Record<LLMProviderName, string> = {
      anthropic: 'ANTHROPIC_API_KEY',
      google: 'GOOGLE_AI_API_KEY',
      openai: 'OPENAI_API_KEY',
    }

    for (const [provider, envVar] of Object.entries(keyMap)) {
      const key = this.apiKeys.get(envVar)
      if (key) {
        const adapter = this.adapters.get(provider as LLMProviderName)
        adapter?.init(key)
        logger.info({ provider }, 'Provider adapter initialized')
      }
    }
  }

  private hasApiKey(provider: LLMProviderName): boolean {
    const envVars: Record<LLMProviderName, string> = {
      anthropic: 'ANTHROPIC_API_KEY',
      google: 'GOOGLE_AI_API_KEY',
      openai: 'OPENAI_API_KEY',
    }
    return !!this.apiKeys.get(envVars[provider])
  }

  private getDefaultApiKey(provider: LLMProviderName): string | null {
    const envVars: Record<LLMProviderName, string> = {
      anthropic: 'ANTHROPIC_API_KEY',
      google: 'GOOGLE_AI_API_KEY',
      openai: 'OPENAI_API_KEY',
    }
    return this.apiKeys.get(envVars[provider]) ?? null
  }

  private getRpmLimit(provider: LLMProviderName): number {
    // These come from config, stored in the tracker
    return 0 // Default: no limit (tracked but not enforced by default)
  }

  private getTpmLimit(provider: LLMProviderName): number {
    return 0
  }
}

// ─── Helper ──────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
