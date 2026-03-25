// LUNA Engine — Proactive Runner (BullMQ)
// Orchestrates proactive job scheduling using BullMQ queues with priority lanes.
// Lanes: reactive (priority 1, concurrency 8), proactive (priority 5, concurrency 5), background (priority 10, concurrency 3).

import { randomUUID } from 'node:crypto'
import { Queue, Worker, type Job } from 'bullmq'
import type { Pool } from 'pg'
import type { Redis } from 'ioredis'
import pino from 'pino'
import type { Registry } from '../../kernel/registry.js'
import type { EngineConfig, ProactiveJobContext, ProactiveConfig } from '../types.js'
import { loadProactiveConfig } from './proactive-config.js'
import { getProactiveJobs } from './triggers.js'

const logger = pino({ name: 'engine:proactive' })

// BullMQ instances
let proactiveQueue: Queue | null = null
let proactiveWorker: Worker | null = null
const repeatJobKeys: string[] = []

// State
let running = false

interface ProactiveJobPayload {
  jobName: string
  triggerType: string
  traceId: string
  runAt: string
}

/**
 * Start the proactive runner with BullMQ.
 * Registers repeatable jobs based on proactive.json config.
 */
export async function startProactiveRunner(
  db: Pool,
  redis: Redis,
  config: EngineConfig,
  registry: Registry,
): Promise<void> {
  const proactiveConfig = loadProactiveConfig()

  if (!proactiveConfig.enabled) {
    logger.info('Proactive system disabled in proactive.json')
    return
  }

  // Create queue with Redis connection
  const connection = {
    host: redis.options.host ?? 'localhost',
    port: redis.options.port ?? 6379,
    password: redis.options.password as string | undefined,
    db: redis.options.db ?? 0,
  }

  proactiveQueue = new Queue('luna:proactive', {
    connection,
    defaultJobOptions: {
      removeOnComplete: { count: 100 },
      removeOnFail: { count: 50 },
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    },
  })

  // Create worker
  proactiveWorker = new Worker(
    'luna:proactive',
    async (job: Job<ProactiveJobPayload>) => {
      const jobDef = getProactiveJobs().find(j => j.name === job.data.jobName)
      if (!jobDef) {
        logger.warn({ jobName: job.data.jobName }, 'Unknown proactive job')
        return
      }

      const ctx: ProactiveJobContext = {
        db,
        redis,
        registry,
        proactiveConfig,
        engineConfig: config,
        traceId: job.data.traceId || randomUUID(),
        runAt: new Date(job.data.runAt),
      }

      await jobDef.handler(ctx)
    },
    {
      connection,
      concurrency: 5,
      limiter: {
        max: 10,
        duration: 60_000,
      },
    },
  )

  proactiveWorker.on('failed', (job: Job<ProactiveJobPayload> | undefined, err: Error) => {
    logger.error({ jobName: job?.data?.jobName, err, jobId: job?.id }, 'Proactive job failed')
  })

  proactiveWorker.on('completed', (job: Job<ProactiveJobPayload>) => {
    logger.debug({ jobName: job.data.jobName, jobId: job.id }, 'Proactive job completed')
  })

  // Register repeatable jobs from config
  const jobs = getProactiveJobs()

  for (const job of jobs) {
    const enabled = isJobEnabled(job.triggerType, proactiveConfig, config)
    if (!enabled) {
      logger.debug({ job: job.name }, 'Proactive job disabled by config')
      continue
    }

    const intervalMs = getJobInterval(job, proactiveConfig, config)

    if (intervalMs) {
      const repeatOpts = { every: intervalMs }
      const repeatJob = await proactiveQueue.add(
        job.name,
        {
          jobName: job.name,
          triggerType: job.triggerType,
          traceId: '', // generated per execution
          runAt: new Date().toISOString(),
        },
        {
          repeat: repeatOpts,
          priority: getJobPriority(job.triggerType),
          jobId: `repeat:${job.name}`,
        },
      )
      if (repeatJob.repeatJobKey) {
        repeatJobKeys.push(repeatJob.repeatJobKey)
      }
      logger.info({ job: job.name, intervalMs }, 'Proactive job scheduled (repeatable)')
    } else if (job.cron) {
      const cron = job.triggerType === 'reactivation'
        ? proactiveConfig.reactivation.cron
        : job.triggerType === 'nightly_batch'
          ? engineConfig.batchCron
          : job.cron

      const repeatJob = await proactiveQueue.add(
        job.name,
        {
          jobName: job.name,
          triggerType: job.triggerType,
          traceId: '',
          runAt: new Date().toISOString(),
        },
        {
          repeat: { pattern: cron },
          priority: getJobPriority(job.triggerType),
          jobId: `repeat:${job.name}`,
        },
      )
      if (repeatJob.repeatJobKey) {
        repeatJobKeys.push(repeatJob.repeatJobKey)
      }
      logger.info({ job: job.name, cron }, 'Proactive job scheduled (cron)')
    }
  }

  running = true
  logger.info({ totalJobs: jobs.length }, 'Proactive runner started (BullMQ)')
}

/**
 * Stop all proactive job runners.
 */
export async function stopProactiveRunner(): Promise<void> {
  if (!running) return

  // Remove repeatable jobs
  if (proactiveQueue) {
    for (const key of repeatJobKeys) {
      try {
        await proactiveQueue.removeRepeatableByKey(key)
      } catch {
        // Ignore cleanup errors
      }
    }
    repeatJobKeys.length = 0
    await proactiveQueue.close()
    proactiveQueue = null
  }

  if (proactiveWorker) {
    await proactiveWorker.close()
    proactiveWorker = null
  }

  running = false
  logger.info('Proactive runner stopped')
}

// ─── Helpers ────────────────────────────────

function isJobEnabled(
  triggerType: string,
  proactiveConfig: ProactiveConfig,
  engineConfig: EngineConfig,
): boolean {
  switch (triggerType) {
    case 'follow_up': return proactiveConfig.follow_up.enabled
    case 'reminder': return proactiveConfig.reminders.enabled
    case 'commitment': return proactiveConfig.commitments.enabled
    case 'reactivation': return proactiveConfig.reactivation.enabled
    case 'cache_refresh': return true
    case 'nightly_batch': return engineConfig.batchEnabled
    default: return false
  }
}

function getJobInterval(
  job: { triggerType: string; intervalMs?: number; cron?: string },
  proactiveConfig: ProactiveConfig,
  _engineConfig: EngineConfig,
): number | null {
  if (job.cron) return null // cron jobs don't use intervals

  switch (job.triggerType) {
    case 'follow_up': return proactiveConfig.follow_up.scan_interval_minutes * 60 * 1000
    case 'reminder': return proactiveConfig.reminders.scan_interval_minutes * 60 * 1000
    case 'commitment': return proactiveConfig.commitments.scan_interval_minutes * 60 * 1000
    default: return job.intervalMs ?? null
  }
}

function getJobPriority(triggerType: string): number {
  // Lower number = higher priority in BullMQ
  switch (triggerType) {
    case 'commitment': return 2     // commitments are time-sensitive
    case 'reminder': return 3       // reminders are important
    case 'follow_up': return 5      // standard proactive
    case 'reactivation': return 8   // low priority
    case 'cache_refresh': return 10 // background
    case 'nightly_batch': return 10 // background
    default: return 5
  }
}
