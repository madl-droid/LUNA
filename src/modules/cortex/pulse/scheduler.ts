// cortex/pulse/scheduler.ts — Pulse scheduling: batch, sync, and immediate triggers.
// Uses setInterval (like Reflex). No BullMQ dependency.

import type { Pool } from 'pg'
import type { Redis } from 'ioredis'
import type { Registry } from '../../../kernel/registry.js'
import type { CortexConfig, PulseConfig, PulseReportMode } from '../types.js'
import type { AlertManager } from '../reflex/alert-manager.js'
import type { RingBuffer } from '../reflex/ring-buffer.js'
import { collectData, isQuietPeriod } from './collector.js'
import { analyze, generateQuietReport } from './analyzer.js'
import { formatNotification, formatQuietNotification } from './formatter.js'
import { saveReport } from './store.js'
import * as notifStore from '../notifications.js'
import pino from 'pino'

const logger = pino({ name: 'cortex:pulse:scheduler' })

const CHECK_INTERVAL_MS = 60_000 // Check every minute if it's time to run

export class PulseScheduler {
  private checkTimer: ReturnType<typeof setInterval> | null = null
  private running = false
  private lastReportAt = 0
  private lastBatchGenerated = false // tracks if batch was generated but not yet delivered

  // Immediate trigger tracking
  private recentCriticals: Array<{ rule: string; time: number }> = []
  private flappingStart: Map<string, number> = new Map()

  constructor(
    private readonly db: Pool,
    private readonly redis: Redis,
    private readonly registry: Registry,
    private readonly pulseConfig: PulseConfig,
    private readonly cortexConfig: CortexConfig,
    private readonly alertManager: AlertManager,
    private readonly ringBuffer: RingBuffer,
  ) {}

  start(): void {
    if (this.running) return
    this.running = true

    this.checkTimer = setInterval(() => {
      void this.tick()
    }, CHECK_INTERVAL_MS)

    logger.info({
      mode: this.pulseConfig.CORTEX_PULSE_MODE,
      batchTime: this.pulseConfig.CORTEX_PULSE_BATCH_TIME,
      deliveryTime: this.pulseConfig.CORTEX_PULSE_DELIVERY_TIME,
      syncIntervalH: this.pulseConfig.CORTEX_PULSE_SYNC_INTERVAL_HOURS,
    }, 'Pulse scheduler started')
  }

  stop(): void {
    if (!this.running) return
    this.running = false
    if (this.checkTimer) {
      clearInterval(this.checkTimer)
      this.checkTimer = null
    }
    logger.info('Pulse scheduler stopped')
  }

  /**
   * Called by Reflex evaluator when alerts change.
   * Checks if immediate analysis triggers are met.
   */
  async onAlertChange(rule: string, severity: string, state: string, flapCount: number): Promise<void> {
    if (!this.running) return

    // Track critical alerts for immediate trigger
    if (severity === 'critical' && state === 'triggered') {
      this.recentCriticals.push({ rule, time: Date.now() })
      // Prune old entries (older than 1 hour)
      const oneHourAgo = Date.now() - 3_600_000
      this.recentCriticals = this.recentCriticals.filter(c => c.time > oneHourAgo)

      // Check: 3+ distinct critical rules in 1 hour
      const distinctRules = new Set(this.recentCriticals.map(c => c.rule))
      if (distinctRules.size >= this.pulseConfig.CORTEX_PULSE_IMMEDIATE_CRITICAL_COUNT) {
        logger.warn({ distinctRules: Array.from(distinctRules) }, 'Pulse immediate trigger: multiple criticals')
        this.recentCriticals = [] // Reset after triggering
        await this.generateImmediate('critical_cluster')
        return
      }
    }

    // Track flapping for immediate trigger
    if (flapCount > 0 && state === 'triggered') {
      if (!this.flappingStart.has(rule)) {
        this.flappingStart.set(rule, Date.now())
      }
      const flapStart = this.flappingStart.get(rule)!
      const flapDuration = Date.now() - flapStart
      if (flapDuration >= this.pulseConfig.CORTEX_PULSE_IMMEDIATE_FLAP_TIMEOUT_MS) {
        logger.warn({ rule, flapDuration }, 'Pulse immediate trigger: prolonged flapping')
        this.flappingStart.delete(rule)
        await this.generateImmediate('prolonged_flapping')
      }
    } else if (state === 'resolved') {
      this.flappingStart.delete(rule)
    }
  }

  // ─── Tick: periodic check ──────────────

  private async tick(): Promise<void> {
    try {
      const now = new Date()
      const currentTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`

      if (this.pulseConfig.CORTEX_PULSE_MODE === 'batch') {
        await this.tickBatch(currentTime)
      } else {
        await this.tickSync()
      }
    } catch (err) {
      logger.error({ err }, 'Pulse tick error')
    }
  }

  private async tickBatch(currentTime: string): Promise<void> {
    // Generate at batch_time (default 2AM)
    if (currentTime === this.pulseConfig.CORTEX_PULSE_BATCH_TIME && !this.lastBatchGenerated) {
      logger.info('Pulse batch: generating report')
      await this.generateScheduled('batch')
      this.lastBatchGenerated = true
    }

    // Deliver at delivery_time (default 7AM)
    if (currentTime === this.pulseConfig.CORTEX_PULSE_DELIVERY_TIME && this.lastBatchGenerated) {
      logger.info('Pulse batch: delivering report')
      await this.deliverLatestReport('batch')
      this.lastBatchGenerated = false
    }

    // Reset flag after delivery time passes
    if (currentTime > this.pulseConfig.CORTEX_PULSE_DELIVERY_TIME) {
      this.lastBatchGenerated = false
    }
  }

  private async tickSync(): Promise<void> {
    const intervalMs = this.pulseConfig.CORTEX_PULSE_SYNC_INTERVAL_HOURS * 3_600_000
    const elapsed = Date.now() - this.lastReportAt

    if (elapsed >= intervalMs) {
      logger.info({ intervalH: this.pulseConfig.CORTEX_PULSE_SYNC_INTERVAL_HOURS }, 'Pulse sync: generating report')
      await this.generateScheduled('sync')
      // Sync mode delivers immediately after generation
      await this.deliverLatestReport('sync')
    }
  }

  // ─── Report generation ─────────────────

  private async generateScheduled(mode: PulseReportMode): Promise<void> {
    const now = new Date()
    let periodStart: Date

    if (mode === 'batch') {
      // Batch covers the full previous day
      periodStart = new Date(now)
      periodStart.setDate(periodStart.getDate() - 1)
      periodStart.setHours(0, 0, 0, 0)
    } else {
      // Sync covers since last report
      periodStart = this.lastReportAt > 0
        ? new Date(this.lastReportAt)
        : new Date(now.getTime() - this.pulseConfig.CORTEX_PULSE_SYNC_INTERVAL_HOURS * 3_600_000)
    }

    await this.generateAndSave(periodStart, now, mode)
  }

  private async generateImmediate(trigger: string): Promise<void> {
    // Cooldown: don't generate more than once per 30 minutes
    if (Date.now() - this.lastReportAt < 1_800_000) {
      logger.debug({ trigger }, 'Pulse immediate skipped (cooldown)')
      return
    }

    const now = new Date()
    const periodStart = new Date(now.getTime() - 3_600_000) // Last 1 hour

    logger.info({ trigger }, 'Pulse generating immediate analysis')
    const result = await this.generateAndSave(periodStart, now, 'immediate')

    if (result) {
      const message = formatNotification(result.report, 'immediate')
      await this.dispatch(message)
    }
  }

  private async generateAndSave(
    periodStart: Date,
    periodEnd: Date,
    mode: PulseReportMode,
  ): Promise<{ report: import('../types.js').PulseReport } | null> {
    try {
      const data = await collectData(
        this.redis,
        this.alertManager,
        this.ringBuffer,
        this.pulseConfig,
        periodStart,
        periodEnd,
      )

      let result: import('./analyzer.js').AnalysisResult

      if (isQuietPeriod(data)) {
        result = generateQuietReport(data)
      } else {
        result = await analyze(this.registry, data, this.pulseConfig, mode)
      }

      const id = `pulse-${mode}-${Date.now()}`

      await saveReport(
        this.db,
        id,
        periodStart,
        periodEnd,
        mode,
        result.report,
        result.modelUsed,
        result.tokensUsed,
      )

      this.lastReportAt = Date.now()

      // Push notification to console bell
      const healthIcon = result.report.overall_health === 'healthy' ? '🟢'
        : result.report.overall_health === 'degraded' ? '🟡' : '🔴'
      void notifStore.create(this.db, {
        source: 'pulse',
        severity: result.report.overall_health === 'healthy' ? 'info'
          : result.report.overall_health === 'degraded' ? 'degraded' : 'critical',
        title: `${healthIcon} Pulse — ${mode}`,
        body: result.report.summary.slice(0, 200),
        metadata: { reportId: id, mode, incidents: result.report.incidents.length },
      })

      logger.info({
        id,
        mode,
        health: result.report.overall_health,
        incidents: result.report.incidents.length,
        model: result.modelUsed,
        tokens: result.tokensUsed,
      }, 'Pulse report generated')

      return { report: result.report }
    } catch (err) {
      logger.error({ err, mode }, 'Failed to generate Pulse report')
      return null
    }
  }

  // ─── Report delivery ───────────────────

  private async deliverLatestReport(mode: PulseReportMode): Promise<void> {
    try {
      const { getLatestReport } = await import('./store.js')
      const latest = await getLatestReport(this.db)
      if (!latest) {
        logger.debug('No report to deliver')
        return
      }

      const report = latest.report_json
      if (report.overall_health === 'healthy' && report.incidents.length === 0) {
        const message = formatQuietNotification(report.metrics_summary.messages_processed)
        await this.dispatch(message)
      } else {
        const message = formatNotification(report, mode)
        await this.dispatch(message)
      }

      logger.info({ mode, health: report.overall_health }, 'Pulse report delivered')
    } catch (err) {
      logger.error({ err }, 'Failed to deliver Pulse report')
    }
  }

  // ─── Dispatch through Reflex channels ──

  private async dispatch(message: string): Promise<void> {
    // Use the same channel infrastructure as Reflex dispatcher
    const { dispatchPulseMessage } = await import('./dispatch-bridge.js')
    await dispatchPulseMessage(message, this.cortexConfig, this.registry)
  }
}
