// cortex/pulse/collector.ts — Curate data from Reflex for LLM analysis
// Produces a ~4-8K token package: alerts, metrics, logs, health, circuit breakers.

import type { Redis } from 'ioredis'
import type { Alert, PulseConfig, PulseDataPackage, RingBufferEntry } from '../types.js'
import { getMetricsSummary, readHealthSnapshot } from '../reflex/metrics-store.js'
import type { RingBuffer } from '../reflex/ring-buffer.js'
import type { AlertManager } from '../reflex/alert-manager.js'
import pino from 'pino'

const logger = pino({ name: 'cortex:pulse:collector' })

/**
 * Collect and curate data from Reflex for a given period.
 * Returns a structured package ready for LLM analysis.
 */
export async function collectData(
  redis: Redis,
  alertManager: AlertManager,
  ringBuffer: RingBuffer,
  config: PulseConfig,
  periodStart: Date,
  periodEnd: Date,
): Promise<PulseDataPackage> {
  const [alerts, metrics, healthSnapshot, hourlyMetrics] = await Promise.all([
    collectAlerts(alertManager, periodStart, periodEnd),
    getMetricsSummary(redis),
    readHealthSnapshot(redis),
    collectHourlyMetrics(redis, periodStart, periodEnd),
  ])

  const logs = collectLogs(ringBuffer, config.CORTEX_PULSE_LOGS_MAX_UNIQUE)
  const circuitBreakers = extractCircuitBreakers(healthSnapshot)

  const pkg: PulseDataPackage = {
    alerts,
    metrics,
    hourly_metrics: hourlyMetrics,
    logs,
    health_snapshot: healthSnapshot,
    circuit_breakers: circuitBreakers,
    period_start: periodStart.toISOString(),
    period_end: periodEnd.toISOString(),
  }

  logger.debug({
    alertCount: alerts.length,
    logCount: logs.length,
    period: `${periodStart.toISOString()} → ${periodEnd.toISOString()}`,
  }, 'Pulse data collected')

  return pkg
}

/**
 * Check if the period has enough data to warrant an LLM call.
 * If nothing happened, return a simple "healthy" report without calling the LLM.
 */
export function isQuietPeriod(pkg: PulseDataPackage): boolean {
  return (
    pkg.alerts.length === 0 &&
    pkg.logs.length === 0 &&
    pkg.metrics.pipeline.errors === 0 &&
    pkg.metrics.llm.errors === 0 &&
    pkg.metrics.llm.fallbacks === 0 &&
    pkg.metrics.tools.errors === 0
  )
}

// ─── Alert collection ────────────────────

async function collectAlerts(
  alertManager: AlertManager,
  periodStart: Date,
  periodEnd: Date,
): Promise<PulseDataPackage['alerts']> {
  const [active, history] = await Promise.all([
    alertManager.getActiveAlerts(),
    alertManager.getAlertHistory(100),
  ])

  const startMs = periodStart.getTime()
  const endMs = periodEnd.getTime()

  const allAlerts = [...active, ...history].filter(
    (a) => a.triggeredAt >= startMs && a.triggeredAt <= endMs,
  )

  // Deduplicate by rule (keep latest)
  const seen = new Map<string, Alert>()
  for (const alert of allAlerts) {
    const existing = seen.get(alert.rule)
    if (!existing || alert.triggeredAt > existing.triggeredAt) {
      seen.set(alert.rule, alert)
    }
  }

  return Array.from(seen.values()).map((a) => ({
    rule: a.rule,
    severity: a.severity,
    state: a.state,
    message: a.message,
    triggeredAt: a.triggeredAt,
    resolvedAt: a.resolvedAt,
    duration_seconds: a.resolvedAt
      ? Math.round((a.resolvedAt - a.triggeredAt) / 1000)
      : null,
    flapCount: a.flapCount,
  }))
}

// ─── Hourly metrics from Redis ───────────

async function collectHourlyMetrics(
  redis: Redis,
  periodStart: Date,
  periodEnd: Date,
): Promise<PulseDataPackage['hourly_metrics']> {
  const results: PulseDataPackage['hourly_metrics'] = []

  const start = new Date(periodStart)
  start.setMinutes(0, 0, 0)
  const end = new Date(periodEnd)

  const hours: string[] = []
  const cursor = new Date(start)
  while (cursor <= end && hours.length < 48) {
    hours.push(cursor.toISOString().slice(0, 13))
    cursor.setHours(cursor.getHours() + 1)
  }

  if (hours.length === 0) return results

  const keys: string[] = []
  for (const h of hours) {
    keys.push(`reflex:metrics:hourly:${h}:pipeline`)
    keys.push(`reflex:metrics:hourly:${h}:llm_errors`)
    keys.push(`reflex:metrics:hourly:${h}:llm_fallbacks`)
  }

  try {
    const values = await redis.mget(...keys)
    for (let i = 0; i < hours.length; i++) {
      const pipeline = parseInt(values[i * 3] ?? '0', 10)
      const llmErrors = parseInt(values[i * 3 + 1] ?? '0', 10)
      const llmFallbacks = parseInt(values[i * 3 + 2] ?? '0', 10)

      // Only include hours with data
      if (pipeline > 0 || llmErrors > 0 || llmFallbacks > 0) {
        results.push({
          hour: hours[i]!,
          pipeline,
          llm_errors: llmErrors,
          llm_fallbacks: llmFallbacks,
        })
      }
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to collect hourly metrics')
  }

  return results
}

// ─── Log deduplication ───────────────────

interface DeduplicatedLog {
  component: string
  level: string
  message: string
  count: number
  first_seen: string
  last_seen: string
}

function collectLogs(ringBuffer: RingBuffer, maxUnique: number): DeduplicatedLog[] {
  const allEntries = ringBuffer.getAll()
  if (allEntries.length === 0) return []

  // Deduplicate by component+message
  const dedupMap = new Map<string, {
    entry: RingBufferEntry
    count: number
    firstSeen: number
    lastSeen: number
  }>()

  for (const entry of allEntries) {
    const key = `${entry.component}:${entry.message}`
    const existing = dedupMap.get(key)
    if (existing) {
      existing.count++
      if (entry.timestamp < existing.firstSeen) existing.firstSeen = entry.timestamp
      if (entry.timestamp > existing.lastSeen) existing.lastSeen = entry.timestamp
    } else {
      dedupMap.set(key, {
        entry,
        count: 1,
        firstSeen: entry.timestamp,
        lastSeen: entry.timestamp,
      })
    }
  }

  // Sort: errors first, then by count descending, limit to maxUnique
  const sorted = Array.from(dedupMap.values())
    .sort((a, b) => {
      if (a.entry.level !== b.entry.level) {
        return a.entry.level === 'error' ? -1 : 1
      }
      return b.count - a.count
    })
    .slice(0, maxUnique)

  return sorted.map((d) => ({
    component: d.entry.component,
    level: d.entry.level,
    message: d.entry.message,
    count: d.count,
    first_seen: new Date(d.firstSeen).toISOString(),
    last_seen: new Date(d.lastSeen).toISOString(),
  }))
}

// ─── Circuit breaker extraction ──────────

function extractCircuitBreakers(snapshot: Record<string, unknown> | null): Record<string, string> {
  if (!snapshot) return {}
  const cbs = snapshot['circuit_breakers']
  if (cbs && typeof cbs === 'object' && !Array.isArray(cbs)) {
    return cbs as Record<string, string>
  }
  return {}
}
