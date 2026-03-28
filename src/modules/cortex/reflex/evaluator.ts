// cortex/reflex/evaluator.ts — Periodic rule evaluator
// setInterval nativo (NO BullMQ). Si Redis muere, el evaluador sigue vivo.

import type { Pool } from 'pg'
import type { Redis } from 'ioredis'
import type { Registry } from '../../../kernel/registry.js'
import type { CortexConfig, CounterSet, Rule, RuleCheckContext } from '../types.js'
import type { RingBuffer } from './ring-buffer.js'
import { AlertManager } from './alert-manager.js'
import { CRITICAL_RULES, DEGRADED_RULES, INFO_RULES } from './rules.js'
import { flushToRedis } from './counters.js'
import { reflexBus } from './sensors.js'
import pino from 'pino'

const logger = pino({ name: 'cortex:evaluator' })

export class Evaluator {
  private infraInterval: ReturnType<typeof setInterval> | null = null
  private resourceInterval: ReturnType<typeof setInterval> | null = null
  private trendsInterval: ReturnType<typeof setInterval> | null = null
  private flushInterval: ReturnType<typeof setInterval> | null = null
  private alertManager: AlertManager
  private running = false

  constructor(
    private readonly db: Pool,
    private readonly redis: Redis,
    private readonly registry: Registry,
    private readonly config: CortexConfig,
    private readonly counters: CounterSet,
    private readonly ringBuffer: RingBuffer,
  ) {
    this.alertManager = new AlertManager(redis, registry, config, ringBuffer)
  }

  start(): void {
    if (this.running) return
    this.running = true

    // ─── Interval-based checks ───

    // Infrastructure checks (PG, Redis) — every 60s
    this.infraInterval = setInterval(() => {
      void this.runInfraChecks()
    }, this.config.CORTEX_REFLEX_INFRA_INTERVAL_MS)

    // Resource checks (memory, CPU, disk, event loop) — every 5 min
    this.resourceInterval = setInterval(() => {
      void this.runResourceChecks()
    }, this.config.CORTEX_REFLEX_RESOURCE_INTERVAL_MS)

    // Trend checks (aggregated metrics from Redis) — every 15 min
    this.trendsInterval = setInterval(() => {
      void this.runTrendChecks()
    }, this.config.CORTEX_REFLEX_TRENDS_INTERVAL_MS)

    // Counter flush — every 60s
    this.flushInterval = setInterval(() => {
      void flushToRedis(this.counters, this.redis)
    }, this.config.CORTEX_REFLEX_FLUSH_INTERVAL_MS)

    // ─── Event-driven checks (instant) ───

    reflexBus.on('provider:down', () => {
      // LLM provider down — evaluate WA-independent rules immediately
      void this.runInfraChecks()
    })

    // Run initial checks after a short delay (let other modules initialize)
    setTimeout(() => {
      void this.runInfraChecks()
      void this.runResourceChecks()
    }, 5000)

    logger.info({
      infraMs: this.config.CORTEX_REFLEX_INFRA_INTERVAL_MS,
      resourceMs: this.config.CORTEX_REFLEX_RESOURCE_INTERVAL_MS,
      trendsMs: this.config.CORTEX_REFLEX_TRENDS_INTERVAL_MS,
      flushMs: this.config.CORTEX_REFLEX_FLUSH_INTERVAL_MS,
    }, 'Evaluator started')
  }

  stop(): void {
    if (!this.running) return
    this.running = false

    if (this.infraInterval) clearInterval(this.infraInterval)
    if (this.resourceInterval) clearInterval(this.resourceInterval)
    if (this.trendsInterval) clearInterval(this.trendsInterval)
    if (this.flushInterval) clearInterval(this.flushInterval)

    this.infraInterval = null
    this.resourceInterval = null
    this.trendsInterval = null
    this.flushInterval = null

    reflexBus.removeAllListeners('provider:down')

    logger.info('Evaluator stopped')
  }

  // ─── Check runners ─────────────────────

  private buildContext(): RuleCheckContext {
    return {
      db: this.db,
      redis: this.redis,
      registry: this.registry,
      counters: this.counters,
      config: this.config,
    }
  }

  private async runInfraChecks(): Promise<void> {
    const ctx = this.buildContext()
    const infraRules = CRITICAL_RULES.filter(r =>
      r.id === 'pg-down' || r.id === 'redis-down' || r.id === 'wa-down',
    )
    await this.evaluateRules(infraRules, ctx)
  }

  private async runResourceChecks(): Promise<void> {
    const ctx = this.buildContext()
    const resourceRules = CRITICAL_RULES.filter(r =>
      r.id === 'mem-high' || r.id === 'disk-high' || r.id === 'eventloop-lag',
    )
    await this.evaluateRules(resourceRules, ctx)
  }

  private async runTrendChecks(): Promise<void> {
    const ctx = this.buildContext()
    await this.evaluateRules([...DEGRADED_RULES, ...INFO_RULES], ctx)
  }

  private async evaluateRules(rules: Rule[], ctx: RuleCheckContext): Promise<void> {
    for (const rule of rules) {
      try {
        const isFailing = await rule.check(ctx)
        await this.alertManager.processRuleResult(rule, isFailing, ctx)
      } catch (err) {
        logger.error({ rule: rule.id, err }, 'Error evaluating rule')
        // Rule evaluation itself failed — log but don't alert about it
        this.ringBuffer.push({
          timestamp: Date.now(),
          level: 'error',
          component: 'reflex',
          message: `Rule evaluation error: ${rule.id} — ${err instanceof Error ? err.message : String(err)}`,
        })
      }
    }
  }

  // ─── Public API ────────────────────────

  get alerts(): AlertManager {
    return this.alertManager
  }
}
