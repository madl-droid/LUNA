// scheduled-tasks/scheduler.ts — BullMQ scheduler for user-defined tasks

import { Queue, Worker, type Job } from 'bullmq'
import type { Pool } from 'pg'
import type { Redis } from 'ioredis'
import pino from 'pino'
import type { Registry } from '../../kernel/registry.js'
import type { ScheduledTask, ScheduledTasksConfig } from './types.js'
import * as store from './store.js'
import { executeTask } from './executor.js'

const logger = pino({ name: 'scheduled-tasks' })

const QUEUE_NAME = 'luna-scheduled-tasks'

let queue: Queue | null = null
let worker: Worker | null = null
const repeatJobKeys: string[] = []

interface TaskJobPayload {
  taskId: string
  taskName: string
}

function getConnection(redis: Redis) {
  return {
    host: redis.options.host ?? 'localhost',
    port: redis.options.port ?? 6379,
    password: redis.options.password as string | undefined,
    db: redis.options.db ?? 0,
  }
}

export async function startScheduler(
  db: Pool,
  redis: Redis,
  registry: Registry,
  config: ScheduledTasksConfig,
): Promise<void> {
  const connection = getConnection(redis)

  queue = new Queue<TaskJobPayload>(QUEUE_NAME, {
    connection,
    defaultJobOptions: {
      removeOnComplete: { count: 200 },
      removeOnFail: { count: 100 },
      attempts: 1, // user tasks don't retry by default
    },
  })

  worker = new Worker<TaskJobPayload>(
    QUEUE_NAME,
    async (job: Job<TaskJobPayload>) => {
      const task = await store.getTask(db, job.data.taskId)
      if (!task || !task.enabled) {
        logger.debug({ taskId: job.data.taskId }, 'Task disabled or deleted, skipping')
        return
      }

      logger.info({ taskId: task.id, taskName: task.name }, 'Executing scheduled task')
      await executeTask(db, registry, task, config)
    },
    {
      connection,
      concurrency: config.SCHEDULED_TASKS_MAX_CONCURRENT,
    },
  )

  worker.on('failed', (job: Job<TaskJobPayload> | undefined, err: Error) => {
    logger.error({ taskId: job?.data?.taskId, err }, 'Scheduled task job failed')
  })

  worker.on('completed', (job: Job<TaskJobPayload>) => {
    logger.debug({ taskId: job.data.taskId }, 'Scheduled task job completed')
  })

  // Load and schedule all enabled tasks
  const tasks = await store.listTasks(db)
  for (const task of tasks) {
    if (task.enabled) {
      await scheduleTask(task)
    }
  }

  logger.info({ count: tasks.filter(t => t.enabled).length }, 'Scheduler started')
}

export async function stopScheduler(): Promise<void> {
  if (queue) {
    for (const key of repeatJobKeys) {
      try { await queue.removeRepeatableByKey(key) } catch { /* ignore */ }
    }
    repeatJobKeys.length = 0
    await queue.close()
    queue = null
  }

  if (worker) {
    await worker.close()
    worker = null
  }

  logger.info('Scheduler stopped')
}

export async function scheduleTask(task: ScheduledTask): Promise<void> {
  if (!queue) return

  const jobId = `scheduled:${task.id}`

  // Remove existing repeatable if any
  await unscheduleTask(task.id)

  if (!task.enabled) return

  const repeatJob = await queue.add(
    task.name,
    { taskId: task.id, taskName: task.name },
    {
      repeat: { pattern: task.cron },
      jobId,
    },
  )

  if (repeatJob.repeatJobKey) {
    repeatJobKeys.push(repeatJob.repeatJobKey)
  }

  logger.info({ taskId: task.id, cron: task.cron }, 'Task scheduled')
}

export async function unscheduleTask(taskId: string): Promise<void> {
  if (!queue) return

  // Find and remove the repeatable job for this task
  const repeatables = await queue.getRepeatableJobs()
  for (const r of repeatables) {
    if (r.id === `scheduled:${taskId}`) {
      await queue.removeRepeatableByKey(r.key)
      const idx = repeatJobKeys.indexOf(r.key)
      if (idx >= 0) repeatJobKeys.splice(idx, 1)
      break
    }
  }
}

export async function triggerNow(
  db: Pool,
  registry: Registry,
  task: ScheduledTask,
  config: ScheduledTasksConfig,
): Promise<string> {
  return executeTask(db, registry, task, config)
}
