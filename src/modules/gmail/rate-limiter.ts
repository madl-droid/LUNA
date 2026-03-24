// LUNA — Module: gmail — Rate Limiter
// Redis-backed rate limiter for Gmail API send operations.
// Limits are hardcoded per account type to match Gmail's actual limits.

import pino from 'pino'
import type IoRedis from 'ioredis'

const logger = pino({ name: 'email:rate-limiter' })

const LIMITS = {
  workspace: { perHour: 80, perDay: 2000 },
  free: { perHour: 20, perDay: 500 },
} as const

export interface RateLimitUsage {
  hourly: number
  daily: number
  limits: { perHour: number; perDay: number }
  canSend: boolean
}

export class EmailRateLimiter {
  private limits: { perHour: number; perDay: number }

  constructor(
    private accountType: 'workspace' | 'free',
    private redis: IoRedis,
  ) {
    this.limits = LIMITS[accountType] ?? LIMITS.workspace
  }

  async canSend(): Promise<boolean> {
    const [hourly, daily] = await Promise.all([
      this.getHourlyCount(),
      this.getDailyCount(),
    ])
    return hourly < this.limits.perHour && daily < this.limits.perDay
  }

  async recordSend(): Promise<void> {
    const now = new Date()
    const hourKey = `email:rate:hour:${this.formatHour(now)}`
    const dayKey = `email:rate:day:${this.formatDay(now)}`

    const pipeline = this.redis.pipeline()
    pipeline.incr(hourKey)
    pipeline.expire(hourKey, 3600)
    pipeline.incr(dayKey)
    pipeline.expire(dayKey, 86400)
    await pipeline.exec()
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
    }
  }

  updateAccountType(type: 'workspace' | 'free'): void {
    this.accountType = type
    this.limits = LIMITS[type] ?? LIMITS.workspace
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
