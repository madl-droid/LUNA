// LUNA Engine — Proactive Runner
// Orquestador de flujos proactivos. Usa setInterval por ahora (sin BullMQ).

import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import type { Redis } from 'ioredis'
import pino from 'pino'
import type { EngineConfig, ProactiveJobContext } from '../types.js'
import { getProactiveJobs } from './triggers.js'

const logger = pino({ name: 'engine:proactive' })

const activeIntervals: NodeJS.Timeout[] = []

/**
 * Start all proactive job runners.
 * Uses setInterval for interval-based jobs.
 * Cron-based jobs use a 60s polling loop that checks if it's time to run.
 */
export function startProactiveRunner(
  db: Pool,
  redis: Redis,
  config: EngineConfig,
): void {
  if (!config.followupEnabled && !config.batchEnabled) {
    logger.info('Proactive runner disabled by config')
    return
  }

  const jobs = getProactiveJobs()

  for (const job of jobs) {
    // Skip disabled jobs
    if (job.triggerType === 'follow_up' && !config.followupEnabled) continue
    if (job.triggerType === 'nightly_batch' && !config.batchEnabled) continue

    if (job.intervalMs) {
      // Override interval from config if applicable
      let intervalMs = job.intervalMs
      if (job.triggerType === 'follow_up') {
        intervalMs = config.followupDelayMinutes * 60 * 1000
      }

      const interval = setInterval(async () => {
        const ctx: ProactiveJobContext = {
          db,
          redis,
          traceId: randomUUID(),
          runAt: new Date(),
        }

        try {
          await job.handler(ctx)
        } catch (err) {
          logger.error({ job: job.name, err }, 'Proactive job failed')
        }
      }, intervalMs)

      activeIntervals.push(interval)
      logger.info({ job: job.name, intervalMs }, 'Proactive job scheduled (interval)')
    } else if (job.cron) {
      // Simple cron: poll every 60s and check if the minute matches
      const cronInterval = setInterval(async () => {
        if (shouldRunCron(job.cron!, config.batchTimezone)) {
          const ctx: ProactiveJobContext = {
            db,
            redis,
            traceId: randomUUID(),
            runAt: new Date(),
          }

          try {
            await job.handler(ctx)
          } catch (err) {
            logger.error({ job: job.name, err }, 'Proactive cron job failed')
          }
        }
      }, 60000)

      activeIntervals.push(cronInterval)
      logger.info({ job: job.name, cron: job.cron }, 'Proactive job scheduled (cron)')
    }
  }

  logger.info({ totalJobs: jobs.length }, 'Proactive runner started')
}

/**
 * Stop all proactive job runners.
 */
export function stopProactiveRunner(): void {
  for (const interval of activeIntervals) {
    clearInterval(interval)
  }
  activeIntervals.length = 0
  logger.info('Proactive runner stopped')
}

/**
 * Simple cron matcher. Supports: "M H * * *" format.
 * Checks if current time matches the cron expression.
 */
function shouldRunCron(cron: string, _timezone: string): boolean {
  const parts = cron.split(' ')
  if (parts.length < 5) return false

  const now = new Date()
  const cronMin = parts[0]!
  const cronHour = parts[1]!

  const currentMin = now.getMinutes()
  const currentHour = now.getHours()

  const minMatch = cronMin === '*' || parseInt(cronMin) === currentMin
  const hourMatch = cronHour === '*' || parseInt(cronHour) === currentHour

  return minMatch && hourMatch
}
