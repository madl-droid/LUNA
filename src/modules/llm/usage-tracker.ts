// LUNA — LLM Usage Tracker
// Dos capas: Redis (contadores hot en tiempo real) + PostgreSQL (persistencia).
// Tracking de tokens, costos, errores, rate limits.

import type { Pool } from 'pg'
import type { Redis } from 'ioredis'
import pino from 'pino'
import * as pgStore from './pg-store.js'
import type {
  LLMProviderName,
  LLMTask,
  LLMResponse,
  UsageRecord,
  UsageSummary,
} from './types.js'

const logger = pino({ name: 'llm:usage' })

// Redis key prefixes
const PREFIX = 'llm:'
const RPM_KEY = (p: string) => `${PREFIX}rpm:${p}`
const TPM_KEY = (p: string) => `${PREFIX}tpm:${p}`
const DAILY_COST_KEY = () => `${PREFIX}cost:daily:${new Date().toISOString().slice(0, 10)}`
const MONTHLY_COST_KEY = () => `${PREFIX}cost:monthly:${new Date().toISOString().slice(0, 7)}`
const ERROR_COUNT_KEY = (p: string) => `${PREFIX}errors:${p}`
const LAST_USED_KEY = (p: string) => `${PREFIX}last_used:${p}`

export class UsageTracker {
  private costTable: Record<string, { inputPer1M: number; outputPer1M: number }>
  private enabled: boolean
  private retentionDays: number
  private dailyBudgetUsd: number
  private monthlyBudgetUsd: number
  private cleanupInterval: ReturnType<typeof setInterval> | null = null

  constructor(
    private readonly db: Pool,
    private readonly redis: Redis,
    costTable: Record<string, { inputPer1M: number; outputPer1M: number }>,
    options: {
      enabled?: boolean
      retentionDays?: number
      dailyBudgetUsd?: number
      monthlyBudgetUsd?: number
    } = {},
  ) {
    this.costTable = costTable
    this.enabled = options.enabled !== false
    this.retentionDays = options.retentionDays ?? 90
    this.dailyBudgetUsd = options.dailyBudgetUsd ?? 0
    this.monthlyBudgetUsd = options.monthlyBudgetUsd ?? 0
  }

  /**
   * Start periodic cleanup of old records.
   */
  startCleanup(): void {
    // Clean up every 24 hours
    this.cleanupInterval = setInterval(() => {
      pgStore.cleanupOldRecords(this.db, this.retentionDays)
        .catch(err => logger.error({ err }, 'Usage cleanup failed'))
    }, 86400000)
  }

  stop(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
      this.cleanupInterval = null
    }
  }

  /**
   * Record a completed LLM call (success or failure).
   */
  async record(
    response: LLMResponse | null,
    task: LLMTask,
    provider: LLMProviderName,
    model: string,
    durationMs: number,
    success: boolean,
    error?: string,
    traceId?: string,
  ): Promise<void> {
    if (!this.enabled) return

    const inputTokens = response?.inputTokens ?? 0
    const outputTokens = response?.outputTokens ?? 0
    const cost = this.estimateCost(model, inputTokens, outputTokens)

    const record: UsageRecord = {
      timestamp: new Date(),
      provider,
      model,
      task,
      inputTokens,
      outputTokens,
      durationMs,
      success,
      error,
      traceId,
      estimatedCostUsd: cost,
    }

    // Fire-and-forget: Redis counters + PG insert in parallel
    const promises: Promise<unknown>[] = [
      pgStore.insertUsage(this.db, record),
      this.updateRedisCounters(provider, inputTokens + outputTokens, cost),
    ]

    if (!success && error) {
      promises.push(this.incrementErrors(provider))
    }

    // Track last used
    promises.push(this.redis.set(LAST_USED_KEY(provider), new Date().toISOString()))

    await Promise.allSettled(promises)
  }

  /**
   * Check if the provider is within rate limits.
   */
  async checkRateLimit(
    provider: LLMProviderName,
    rpmLimit: number,
    tpmLimit: number,
  ): Promise<{ allowed: boolean; reason?: string }> {
    if (rpmLimit === 0 && tpmLimit === 0) return { allowed: true }

    try {
      const [rpm, tpm] = await Promise.all([
        rpmLimit > 0 ? this.redis.get(RPM_KEY(provider)) : null,
        tpmLimit > 0 ? this.redis.get(TPM_KEY(provider)) : null,
      ])

      if (rpmLimit > 0 && rpm && parseInt(rpm, 10) >= rpmLimit) {
        return { allowed: false, reason: `RPM limit exceeded (${rpm}/${rpmLimit})` }
      }

      if (tpmLimit > 0 && tpm && parseInt(tpm, 10) >= tpmLimit) {
        return { allowed: false, reason: `TPM limit exceeded (${tpm}/${tpmLimit})` }
      }

      return { allowed: true }
    } catch {
      // If Redis fails, allow the request (fail-open)
      return { allowed: true }
    }
  }

  /**
   * Check if within budget.
   */
  async checkBudget(): Promise<{ allowed: boolean; reason?: string }> {
    if (this.dailyBudgetUsd === 0 && this.monthlyBudgetUsd === 0) {
      return { allowed: true }
    }

    try {
      const [daily, monthly] = await Promise.all([
        this.dailyBudgetUsd > 0 ? this.redis.get(DAILY_COST_KEY()) : null,
        this.monthlyBudgetUsd > 0 ? this.redis.get(MONTHLY_COST_KEY()) : null,
      ])

      if (this.dailyBudgetUsd > 0 && daily) {
        const cost = parseFloat(daily)
        if (cost >= this.dailyBudgetUsd) {
          return { allowed: false, reason: `Daily budget exceeded ($${cost.toFixed(2)}/$${this.dailyBudgetUsd})` }
        }
      }

      if (this.monthlyBudgetUsd > 0 && monthly) {
        const cost = parseFloat(monthly)
        if (cost >= this.monthlyBudgetUsd) {
          return { allowed: false, reason: `Monthly budget exceeded ($${cost.toFixed(2)}/$${this.monthlyBudgetUsd})` }
        }
      }

      return { allowed: true }
    } catch {
      return { allowed: true }
    }
  }

  /**
   * Get usage summary for a period.
   */
  async getSummary(period: 'hour' | 'day' | 'week' | 'month'): Promise<UsageSummary> {
    return pgStore.getUsageSummary(this.db, period)
  }

  /**
   * Get recent errors for a provider.
   */
  async getRecentErrors(provider: LLMProviderName, limit = 20) {
    return pgStore.getRecentErrors(this.db, provider, limit)
  }

  /**
   * Get error count in last hour for a provider.
   */
  async getErrorCount(provider: LLMProviderName): Promise<number> {
    try {
      const count = await this.redis.get(ERROR_COUNT_KEY(provider))
      return count ? parseInt(count, 10) : 0
    } catch {
      return 0
    }
  }

  /**
   * Get average latency for a provider.
   */
  async getAvgLatency(provider: LLMProviderName): Promise<number> {
    return pgStore.getAvgLatency(this.db, provider)
  }

  /**
   * Get last used timestamp for a provider.
   */
  async getLastUsed(provider: LLMProviderName): Promise<string | null> {
    try {
      return await this.redis.get(LAST_USED_KEY(provider))
    } catch {
      return null
    }
  }

  /**
   * Get today's cost.
   */
  async getTodayCost(): Promise<number> {
    try {
      const cached = await this.redis.get(DAILY_COST_KEY())
      if (cached) return parseFloat(cached)
    } catch { /* fall through to PG */ }
    return pgStore.getTodayCost(this.db)
  }

  /**
   * Estimate cost for a model and token count.
   */
  estimateCost(model: string, inputTokens: number, outputTokens: number): number {
    // Try exact match first, then fuzzy
    let rates = this.costTable[model]
    if (!rates) {
      // Try matching by prefix
      for (const [key, value] of Object.entries(this.costTable)) {
        if (model.startsWith(key) || key.startsWith(model)) {
          rates = value
          break
        }
      }
    }
    if (!rates) return 0

    return (inputTokens / 1_000_000) * rates.inputPer1M +
           (outputTokens / 1_000_000) * rates.outputPer1M
  }

  /**
   * Update cost table (e.g., from console config).
   */
  updateCostTable(table: Record<string, { inputPer1M: number; outputPer1M: number }>): void {
    this.costTable = { ...this.costTable, ...table }
  }

  // ─── Private ───────────────────────────────

  private async updateRedisCounters(
    provider: LLMProviderName,
    totalTokens: number,
    cost: number,
  ): Promise<void> {
    try {
      const pipeline = this.redis.pipeline()

      // RPM counter (expires after 60s)
      pipeline.incr(RPM_KEY(provider))
      pipeline.expire(RPM_KEY(provider), 60)

      // TPM counter (expires after 60s)
      pipeline.incrby(TPM_KEY(provider), totalTokens)
      pipeline.expire(TPM_KEY(provider), 60)

      // Daily cost (expires after 48h for safety)
      pipeline.incrbyfloat(DAILY_COST_KEY(), cost)
      pipeline.expire(DAILY_COST_KEY(), 172800)

      // Monthly cost (expires after 35 days)
      pipeline.incrbyfloat(MONTHLY_COST_KEY(), cost)
      pipeline.expire(MONTHLY_COST_KEY(), 3024000)

      await pipeline.exec()
    } catch (err) {
      logger.error({ err }, 'Failed to update Redis counters')
    }
  }

  private async incrementErrors(provider: LLMProviderName): Promise<void> {
    try {
      const pipeline = this.redis.pipeline()
      pipeline.incr(ERROR_COUNT_KEY(provider))
      pipeline.expire(ERROR_COUNT_KEY(provider), 3600) // 1 hour window
      await pipeline.exec()
    } catch { /* ignore */ }
  }
}
