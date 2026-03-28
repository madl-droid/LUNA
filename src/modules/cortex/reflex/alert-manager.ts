// cortex/reflex/alert-manager.ts — Alert state machine
// States: triggered → resolved | escalated
// Deduplication: same rule+severity max 1 alert per dedup window

import type { Redis } from 'ioredis'
import type { Registry } from '../../../kernel/registry.js'
import type { Alert, CortexConfig, Rule, RuleCheckContext } from '../types.js'
import { CHANNEL_DEPENDENCIES } from '../types.js'
import { RingBuffer } from './ring-buffer.js'
import { dispatchAlert, dispatchResolution } from './dispatcher.js'
import pino from 'pino'

const logger = pino({ name: 'cortex:alerts' })

const ACTIVE_KEY = 'reflex:alerts:active'
const HISTORY_KEY = 'reflex:alerts:history'
const HISTORY_TTL = 604800 // 7 days in seconds

export class AlertManager {
  constructor(
    private readonly redis: Redis,
    private readonly registry: Registry,
    private readonly config: CortexConfig,
    private readonly ringBuffer: RingBuffer,
  ) {}

  /**
   * Evaluate a rule result and manage alert state.
   * @param rule - The rule that was checked
   * @param isFailing - true if the condition is active (something wrong)
   * @param ctx - Rule check context for getMessage
   */
  async processRuleResult(rule: Rule, isFailing: boolean, ctx: RuleCheckContext): Promise<void> {
    const existing = await this.getActiveAlert(rule.id)

    if (isFailing && !existing) {
      // NEW ALERT — trigger
      await this.triggerAlert(rule, ctx)
    } else if (isFailing && existing) {
      // STILL FAILING — check for escalation (Ola 2)
      // For Ola 1, just log
      logger.debug({ rule: rule.id }, 'Alert still active')
    } else if (!isFailing && existing) {
      // RESOLVED
      await this.resolveAlert(rule.id, existing)
    }
    // !isFailing && !existing → all good, nothing to do
  }

  private async triggerAlert(rule: Rule, ctx: RuleCheckContext): Promise<void> {
    // Deduplication check
    if (await this.isDeduped(rule.id)) {
      logger.debug({ rule: rule.id }, 'Alert deduped, skipping')
      return
    }

    const message = await rule.getMessage(ctx)
    const logs = this.ringBuffer.formatLines(
      this.ringBuffer.filterByComponent(rule.component, 10),
    )

    const alert: Alert = {
      rule: rule.id,
      severity: rule.severity,
      state: 'triggered',
      message,
      triggeredAt: Date.now(),
      resolvedAt: null,
      escalatedAt: null,
      flapCount: 0,
      lastFlapAt: null,
      logs,
    }

    // Store in Redis
    try {
      await this.redis.hset(ACTIVE_KEY, rule.id, JSON.stringify(alert))
      await this.setDedupKey(rule.id)
    } catch (err) {
      logger.error({ err, rule: rule.id }, 'Failed to store alert in Redis')
      // Still try to dispatch even if Redis storage fails
    }

    // Determine which components are down for dependency filtering
    const failedComponents = [rule.component]

    // Dispatch
    await dispatchAlert(alert, failedComponents, this.config, this.registry, CHANNEL_DEPENDENCIES)

    logger.warn({ rule: rule.id, severity: rule.severity }, 'Alert triggered')
  }

  private async resolveAlert(ruleId: string, alert: Alert): Promise<void> {
    alert.state = 'resolved'
    alert.resolvedAt = Date.now()

    try {
      // Move from active to history
      await this.redis.hdel(ACTIVE_KEY, ruleId)
      await this.redis.zadd(HISTORY_KEY, String(Date.now()), JSON.stringify(alert))

      // Trim history to 7 days
      const cutoff = Date.now() - (HISTORY_TTL * 1000)
      await this.redis.zremrangebyscore(HISTORY_KEY, '-inf', String(cutoff))
    } catch (err) {
      logger.error({ err, rule: ruleId }, 'Failed to update alert state in Redis')
    }

    // Dispatch resolution
    await dispatchResolution(alert, this.config, this.registry, CHANNEL_DEPENDENCIES)

    logger.info({ rule: ruleId }, 'Alert resolved')
  }

  // ─── Redis helpers ─────────────────────

  private async getActiveAlert(ruleId: string): Promise<Alert | null> {
    try {
      const raw = await this.redis.hget(ACTIVE_KEY, ruleId)
      if (!raw) return null
      return JSON.parse(raw) as Alert
    } catch {
      return null
    }
  }

  private async isDeduped(ruleId: string): Promise<boolean> {
    try {
      const exists = await this.redis.exists(`reflex:dedup:${ruleId}`)
      return exists === 1
    } catch {
      return false // On Redis error, allow the alert through
    }
  }

  private async setDedupKey(ruleId: string): Promise<void> {
    const ttlMs = this.config.CORTEX_REFLEX_DEDUP_WINDOW_MS
    const ttlSec = Math.max(1, Math.floor(ttlMs / 1000))
    try {
      await this.redis.set(`reflex:dedup:${ruleId}`, '1', 'EX', ttlSec)
    } catch { /* best effort */ }
  }

  // ─── Public queries ────────────────────

  async getActiveAlerts(): Promise<Alert[]> {
    try {
      const all = await this.redis.hgetall(ACTIVE_KEY)
      return Object.values(all).map((raw) => JSON.parse(raw as string) as Alert)
    } catch {
      return []
    }
  }

  async getAlertHistory(limit = 50): Promise<Alert[]> {
    try {
      const raw = await this.redis.zrevrange(HISTORY_KEY, 0, limit - 1)
      return raw.map((r: string) => JSON.parse(r) as Alert)
    } catch {
      return []
    }
  }
}
