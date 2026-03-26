// LUNA — Module: medilink
// Token bucket rate limiter with priority queue for Medilink API (20 req/min default)

import pino from 'pino'
import type { Redis } from 'ioredis'
import type { RequestPriority } from './types.js'

const logger = pino({ name: 'medilink:rate-limiter' })

const REDIS_KEY = 'medilink:ratelimit:window'
const WINDOW_MS = 60_000

interface QueuedRequest {
  priority: RequestPriority
  resolve: () => void
  reject: (err: Error) => void
  enqueuedAt: number
}

const PRIORITY_ORDER: Record<RequestPriority, number> = { high: 0, medium: 1, low: 2 }
const MAX_QUEUE: Record<RequestPriority, number> = { high: 10, medium: 20, low: 50 }
const MAX_WAIT_MS = 30_000

export class RateLimiter {
  private maxPerMinute: number
  private redis: Redis | null
  private queue: QueuedRequest[] = []
  private drainTimer: ReturnType<typeof setInterval> | null = null
  private localCounter = 0
  private localWindowStart = Date.now()

  constructor(maxPerMinute: number, redis?: Redis) {
    this.maxPerMinute = maxPerMinute
    this.redis = redis ?? null
  }

  start(): void {
    if (this.drainTimer) return
    const intervalMs = Math.ceil(60_000 / this.maxPerMinute) + 100
    this.drainTimer = setInterval(() => { void this.drain() }, intervalMs)
    logger.info({ maxPerMinute: this.maxPerMinute, intervalMs }, 'Rate limiter started')
  }

  stop(): void {
    if (this.drainTimer) {
      clearInterval(this.drainTimer)
      this.drainTimer = null
    }
    for (const req of this.queue) {
      req.reject(new Error('Rate limiter stopped'))
    }
    this.queue = []
  }

  updateLimit(maxPerMinute: number): void {
    this.maxPerMinute = maxPerMinute
    logger.info({ maxPerMinute }, 'Rate limit updated')
  }

  async acquire(priority: RequestPriority = 'medium'): Promise<void> {
    const currentCount = this.queueCountByPriority(priority)
    if (currentCount >= MAX_QUEUE[priority]) {
      throw new Error(`Rate limiter queue full for priority ${priority} (${currentCount}/${MAX_QUEUE[priority]})`)
    }

    const available = await this.tryConsume()
    if (available) return

    return new Promise<void>((resolve, reject) => {
      this.queue.push({ priority, resolve, reject, enqueuedAt: Date.now() })
      this.queue.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority])
    })
  }

  getStats(): { queued: number; usedThisWindow: number; maxPerMinute: number } {
    return {
      queued: this.queue.length,
      usedThisWindow: this.localCounter,
      maxPerMinute: this.maxPerMinute,
    }
  }

  private queueCountByPriority(priority: RequestPriority): number {
    return this.queue.filter((r) => r.priority === priority).length
  }

  private async tryConsume(): Promise<boolean> {
    if (this.redis) {
      return this.tryConsumeRedis()
    }
    return this.tryConsumeLocal()
  }

  private tryConsumeLocal(): boolean {
    const now = Date.now()
    if (now - this.localWindowStart > WINDOW_MS) {
      this.localWindowStart = now
      this.localCounter = 0
    }
    if (this.localCounter < this.maxPerMinute) {
      this.localCounter++
      return true
    }
    return false
  }

  private async tryConsumeRedis(): Promise<boolean> {
    if (!this.redis) return this.tryConsumeLocal()
    try {
      const now = Date.now()
      const windowKey = `${REDIS_KEY}:${Math.floor(now / WINDOW_MS)}`
      const count = await this.redis.incr(windowKey)
      if (count === 1) {
        await this.redis.pexpire(windowKey, WINDOW_MS + 1000)
      }
      if (count <= this.maxPerMinute) {
        this.localCounter = count
        return true
      }
      await this.redis.decr(windowKey)
      this.localCounter = count - 1
      return false
    } catch (err) {
      logger.warn({ err }, 'Redis rate limit check failed, falling back to local')
      return this.tryConsumeLocal()
    }
  }

  private async drain(): Promise<void> {
    // Evict timed-out requests
    const now = Date.now()
    this.queue = this.queue.filter((req) => {
      if (now - req.enqueuedAt > MAX_WAIT_MS) {
        req.reject(new Error('Rate limiter timeout — too many requests'))
        return false
      }
      return true
    })

    if (this.queue.length === 0) return

    const available = await this.tryConsume()
    if (!available) return

    const next = this.queue.shift()
    if (next) {
      next.resolve()
    }
  }
}
