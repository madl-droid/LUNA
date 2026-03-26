// LUNA — Module: gmail — Rate Limiter
// Redis-backed rate limiter for Gmail API send operations.
// Default limits are conservative (below Gmail's actual API caps).
// Can be overridden via config (EMAIL_RATE_LIMIT_PER_HOUR, EMAIL_RATE_LIMIT_PER_DAY).

import pino from 'pino'
import type { Redis } from 'ioredis'

const logger = pino({ name: 'email:rate-limiter' })

const DEFAULT_LIMITS = {
  workspace: { perHour: 80, perDay: 1500 },
  free: { perHour: 20, perDay: 400 },
} as const

export interface RateLimitUsage {
  hourly: number
  daily: number
  limits: { perHour: number; perDay: number }
  canSend: boolean
  remainingHourly: number
  remainingDaily: number
}

export class EmailRateLimiter {
  private limits: { perHour: number; perDay: number }

  constructor(
    private accountType: 'workspace' | 'free',
    private redis: Redis,
    customLimits?: { perHour?: number; perDay?: number },
  ) {
    const defaults = DEFAULT_LIMITS[accountType] ?? DEFAULT_LIMITS.workspace
    this.limits = {
      perHour: customLimits?.perHour ?? defaults.perHour,
      perDay: customLimits?.perDay ?? defaults.perDay,
    }
  }

  // FIX: SEC-8.1 — Atomic check+increment via Lua script (TOCTOU fix)
  async canSend(): Promise<boolean> {
    const now = new Date()
    const hourKey = `email:rate:hour:${this.formatHour(now)}`
    const dayKey = `email:rate:day:${this.formatDay(now)}`
    const { atomicDualRateCheck } = await import('../../kernel/redis-rate-limiter.js')
    return atomicDualRateCheck(
      this.redis,
      hourKey, this.limits.perHour, 3600,
      dayKey, this.limits.perDay, 86400,
    )
  }

  /** @deprecated Use canSend() which now atomically increments. Kept for backward compat. */
  async recordSend(): Promise<void> {
    // No-op: canSend() now atomically increments counters via Lua script
  }

  async getUsage(): Promise<RateLimitUsage> {
    const [hourly, daily] = await Promise.all([
      this.getHourlyCount(),
      this.getDailyCount(),
    ])
    return {
      hourly,
      daily,
      limits: this.limits,
      canSend: hourly < this.limits.perHour && daily < this.limits.perDay,
      remainingHourly: Math.max(0, this.limits.perHour - hourly),
      remainingDaily: Math.max(0, this.limits.perDay - daily),
    }
  }

  updateAccountType(type: 'workspace' | 'free', customLimits?: { perHour?: number; perDay?: number }): void {
    this.accountType = type
    const defaults = DEFAULT_LIMITS[type] ?? DEFAULT_LIMITS.workspace
    this.limits = {
      perHour: customLimits?.perHour ?? defaults.perHour,
      perDay: customLimits?.perDay ?? defaults.perDay,
    }
  }

  private async getHourlyCount(): Promise<number> {
    const key = `email:rate:hour:${this.formatHour(new Date())}`
    const val = await this.redis.get(key)
    return val ? parseInt(val, 10) : 0
  }

  private async getDailyCount(): Promise<number> {
    const key = `email:rate:day:${this.formatDay(new Date())}`
    const val = await this.redis.get(key)
    return val ? parseInt(val, 10) : 0
  }

  private formatHour(d: Date): string {
    return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}${String(d.getUTCHours()).padStart(2, '0')}`
  }

  private formatDay(d: Date): string {
    return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`
  }
}
