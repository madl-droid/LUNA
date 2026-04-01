// cortex/reflex/alert-manager.ts — Alert state machine
// States: triggered → resolved | escalated
// Features: deduplication, escalation, anti-flapping

import type { Pool } from 'pg'
import type { Redis } from 'ioredis'
import type { Registry } from '../../../kernel/registry.js'
import type { Alert, CortexConfig, Rule, RuleCheckContext } from '../types.js'
import { CHANNEL_DEPENDENCIES } from '../types.js'
import { RingBuffer } from './ring-buffer.js'
import { dispatchAlert, dispatchResolution } from './dispatcher.js'
import * as notifStore from '../notifications.js'
import pino from 'pino'

const logger = pino({ name: 'cortex:alerts' })

const ACTIVE_KEY = 'reflex:alerts:active'
const HISTORY_KEY = 'reflex:alerts:history'
const HISTORY_TTL = 604800 // 7 days in seconds
const FLAP_WINDOW_MS = 300_000 // 5 min — if re-triggers within this window, it's flapping

export class AlertManager {
  constructor(
    private readonly redis: Redis,
    private readonly registry: Registry,
    private readonly config: CortexConfig,
    private readonly ringBuffer: RingBuffer,
    private readonly db: Pool,
  ) {}

  /**
   * Evaluate a rule result and manage alert state.
   */
  async processRuleResult(rule: Rule, isFailing: boolean, ctx: RuleCheckContext): Promise<void> {
    const existing = await this.getActiveAlert(rule.id)

    if (isFailing && !existing) {
      // Check if this is a flap (resolved recently and re-triggering)
      const recentResolve = await this.getRecentResolveTime(rule.id)
      if (recentResolve && (Date.now() - recentResolve) < FLAP_WINDOW_MS) {
        await this.handleFlap(rule, ctx, recentResolve)
      } else {
        await this.triggerAlert(rule, ctx)
      }
    } else if (isFailing && existing) {
      // STILL FAILING — check for escalation
      await this.checkEscalation(existing)
    } else if (!isFailing && existing) {
      // RESOLVED
      await this.resolveAlert(rule.id, existing)
    }
    // !isFailing && !existing → all good
  }

  // ─── Alert lifecycle ───────────────────

  private async triggerAlert(rule: Rule, ctx: RuleCheckContext): Promise<void> {
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

    try {
      await this.redis.hset(ACTIVE_KEY, rule.id, JSON.stringify(alert))
      await this.setDedupKey(rule.id)
    } catch (err) {
      logger.error({ err, rule: rule.id }, 'Failed to store alert in Redis')
    }

    const failedComponents = [rule.component]
    await dispatchAlert(alert, failedComponents, this.config, this.registry, CHANNEL_DEPENDENCIES)

    // Push notification to console bell
    const sevIcon = alert.severity === 'critical' ? '🔴' : alert.severity === 'degraded' ? '🟡' : 'ℹ️'
    void notifStore.create(this.db, {
      source: 'reflex',
      severity: alert.severity,
      title: `${sevIcon} ${alert.rule}`,
      body: alert.message,
      metadata: { rule: rule.id, state: 'triggered' },
    })

    logger.warn({ rule: rule.id, severity: rule.severity }, 'Alert triggered')
  }

  private async resolveAlert(ruleId: string, alert: Alert): Promise<void> {
    alert.state = 'resolved'
    alert.resolvedAt = Date.now()

    try {
      await this.redis.hdel(ACTIVE_KEY, ruleId)
      await this.redis.zadd(HISTORY_KEY, String(Date.now()), JSON.stringify(alert))

      // Store resolve time for flap detection
      await this.redis.set(
        `reflex:resolved_at:${ruleId}`,
        String(Date.now()),
        'EX',
        Math.ceil(FLAP_WINDOW_MS / 1000) + 60, // TTL slightly longer than flap window
      )

      // Trim history to 7 days
      const cutoff = Date.now() - (HISTORY_TTL * 1000)
      await this.redis.zremrangebyscore(HISTORY_KEY, '-inf', String(cutoff))
    } catch (err) {
      logger.error({ err, rule: ruleId }, 'Failed to update alert state in Redis')
    }

    // Only dispatch resolution if not flapping
    if (alert.flapCount === 0) {
      await dispatchResolution(alert, this.config, this.registry, CHANNEL_DEPENDENCIES)
    }

    const duration = alert.resolvedAt ? Math.round((alert.resolvedAt - alert.triggeredAt) / 1000) : 0
    void notifStore.create(this.db, {
      source: 'reflex',
      severity: 'success',
      title: `✅ Resuelto: ${ruleId}`,
      body: `Duración: ${duration}s`,
      metadata: { rule: ruleId, state: 'resolved' },
    })

    logger.info({ rule: ruleId, flapCount: alert.flapCount }, 'Alert resolved')
  }

  // ─── Escalation (DEGRADED → CRITICAL after timeout) ───

  private async checkEscalation(alert: Alert): Promise<void> {
    // Only escalate DEGRADED alerts
    if (alert.severity !== 'degraded') return
    // Don't escalate twice
    if (alert.escalatedAt) return

    const elapsed = Date.now() - alert.triggeredAt
    if (elapsed < this.config.CORTEX_REFLEX_ESCALATION_MS) return

    // Escalate: re-dispatch as CRITICAL
    alert.state = 'escalated'
    alert.escalatedAt = Date.now()

    try {
      await this.redis.hset(ACTIVE_KEY, alert.rule, JSON.stringify(alert))
    } catch (err) {
      logger.error({ err, rule: alert.rule }, 'Failed to persist escalation')
    }

    // Create escalated copy for dispatch
    const escalatedAlert: Alert = {
      ...alert,
      severity: 'critical',
      message: `🔺 ESCALADO (${Math.round(elapsed / 60000)} min sin resolver)\n${alert.message}`,
    }

    const failedComponents = [alert.rule.split('-')[0] ?? 'unknown']
    await dispatchAlert(escalatedAlert, failedComponents, this.config, this.registry, CHANNEL_DEPENDENCIES)

    void notifStore.create(this.db, {
      source: 'reflex',
      severity: 'critical',
      title: `🔺 Escalado: ${alert.rule}`,
      body: `${Math.round(elapsed / 60000)} min sin resolver`,
      metadata: { rule: alert.rule, state: 'escalated' },
    })

    logger.warn({ rule: alert.rule, elapsed: Math.round(elapsed / 1000) }, 'Alert escalated to CRITICAL')
  }

  // ─── Anti-flapping ─────────────────────

  private async handleFlap(rule: Rule, ctx: RuleCheckContext, lastResolveTime: number): Promise<void> {
    // Check if there's already an active flapping alert
    const existing = await this.getActiveAlert(rule.id)
    if (existing) return // already tracked

    const message = await rule.getMessage(ctx)
    const logs = this.ringBuffer.formatLines(
      this.ringBuffer.filterByComponent(rule.component, 10),
    )

    // Get current flap count from Redis
    let flapCount = 1
    try {
      const countStr = await this.redis.get(`reflex:flap_count:${rule.id}`)
      flapCount = countStr ? parseInt(countStr, 10) + 1 : 1
      await this.redis.set(`reflex:flap_count:${rule.id}`, String(flapCount), 'EX', 3600)
    } catch { /* best effort */ }

    const alert: Alert = {
      rule: rule.id,
      severity: rule.severity,
      state: 'triggered',
      message: `⚡ INESTABLE (${flapCount}x en ${Math.round((Date.now() - lastResolveTime) / 1000)}s)\n${message}`,
      triggeredAt: Date.now(),
      resolvedAt: null,
      escalatedAt: null,
      flapCount,
      lastFlapAt: Date.now(),
      logs,
    }

    try {
      await this.redis.hset(ACTIVE_KEY, rule.id, JSON.stringify(alert))
      await this.setDedupKey(rule.id)
    } catch (err) {
      logger.error({ err, rule: rule.id }, 'Failed to store flapping alert')
    }

    // Only dispatch on first flap occurrence, then every 3rd
    if (flapCount === 1 || flapCount % 3 === 0) {
      const failedComponents = [rule.component]
      await dispatchAlert(alert, failedComponents, this.config, this.registry, CHANNEL_DEPENDENCIES)
    }

    logger.warn({ rule: rule.id, flapCount }, 'Alert flapping detected')
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

  private async getRecentResolveTime(ruleId: string): Promise<number | null> {
    try {
      const val = await this.redis.get(`reflex:resolved_at:${ruleId}`)
      return val ? parseInt(val, 10) : null
    } catch {
      return null
    }
  }

  private async isDeduped(ruleId: string): Promise<boolean> {
    try {
      const exists = await this.redis.exists(`reflex:dedup:${ruleId}`)
      return exists === 1
    } catch {
      return false
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
