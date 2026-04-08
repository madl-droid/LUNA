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
    task: LLMTask | string,
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
   * Primary: Redis (fast). Fallback: PG query on Redis failure. Fail-closed if both fail.
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
    } catch (redisErr) {
      logger.warn({ err: redisErr }, 'Redis unavailable for budget check — falling back to PG')
      return this.checkBudgetFromPg()
    }
  }

  /**
   * Fallback budget check from PostgreSQL when Redis is unavailable.
   * Fail-closed: if PG also fails, reject the call to avoid runaway spend.
   */
  private async checkBudgetFromPg(): Promise<{ allowed: boolean; reason?: string }> {
    try {
      const today = new Date().toISOString().slice(0, 10)
      const monthStart = `${new Date().toISOString().slice(0, 7)}-01`

      if (this.dailyBudgetUsd > 0) {
        const res = await this.db.query<{ total: string }>(
          `SELECT COALESCE(SUM(cost_usd), 0)::text AS total
           FROM llm_usage WHERE timestamp >= $1::date`,
          [today],
        )
        const cost = parseFloat(res.rows[0]!.total)
        if (cost >= this.dailyBudgetUsd) {
          logger.warn({ cost, budget: this.dailyBudgetUsd }, 'Daily budget exceeded (PG fallback)')
          return { allowed: false, reason: `Daily budget exceeded ($${cost.toFixed(2)}/$${this.dailyBudgetUsd})` }
        }
      }

      if (this.monthlyBudgetUsd > 0) {
        const res = await this.db.query<{ total: string }>(
          `SELECT COALESCE(SUM(cost_usd), 0)::text AS total
           FROM llm_usage WHERE timestamp >= $1::date`,
          [monthStart],
        )
        const cost = parseFloat(res.rows[0]!.total)
        if (cost >= this.monthlyBudgetUsd) {
          logger.warn({ cost, budget: this.monthlyBudgetUsd }, 'Monthly budget exceeded (PG fallback)')
          return { allowed: false, reason: `Monthly budget exceeded ($${cost.toFixed(2)}/$${this.monthlyBudgetUsd})` }
        }
      }

      return { allowed: true }
    } catch (pgErr) {
      logger.error({ err: pgErr }, 'Both Redis and PG unavailable for budget check — failing closed')
      return { allowed: false, reason: 'Budget check unavailable — failing closed for safety' }
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

  // FIX-09: Lua script executes all INCR+EXPIRE pairs atomically.
  // A Redis crash between INCR and EXPIRE with pipeline() would leave
  // a key without TTL, causing a permanent rate-limit after restart.
  private static readonly COUNTERS_LUA = `
    local rpm = redis.call('INCR', KEYS[1])
    redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1]))
    redis.call('INCRBY', KEYS[2], tonumber(ARGV[2]))
    redis.call('EXPIRE', KEYS[2], tonumber(ARGV[3]))
    redis.call('INCRBYFLOAT', KEYS[3], ARGV[4])
    redis.call('EXPIRE', KEYS[3], tonumber(ARGV[5]))
    redis.call('INCRBYFLOAT', KEYS[4], ARGV[6])
    redis.call('EXPIRE', KEYS[4], tonumber(ARGV[7]))
    return rpm
  `

  private async updateRedisCounters(
    provider: LLMProviderName,
    totalTokens: number,
    cost: number,
  ): Promise<void> {
    try {
      await this.redis.eval(
        UsageTracker.COUNTERS_LUA,
        4,
        RPM_KEY(provider),      // KEYS[1] — RPM counter
        TPM_KEY(provider),      // KEYS[2] — TPM counter
        DAILY_COST_KEY(),       // KEYS[3] — daily cost
        MONTHLY_COST_KEY(),     // KEYS[4] — monthly cost
        '60',                   // ARGV[1] — RPM TTL (60s)
        String(totalTokens),    // ARGV[2] — token count for INCRBY
        '60',                   // ARGV[3] — TPM TTL (60s)
        String(cost),           // ARGV[4] — cost for INCRBYFLOAT daily
        '172800',               // ARGV[5] — daily cost TTL (48h)
        String(cost),           // ARGV[6] — cost for INCRBYFLOAT monthly
        '3024000',              // ARGV[7] — monthly cost TTL (35d)
      )
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
