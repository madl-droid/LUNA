// LUNA Engine — Task Pool with concurrency control and retries
// Generic utility for processing arrays of items in parallel with error isolation.

import pino from 'pino'

const logger = pino({ name: 'engine:task-pool' })

export interface TaskPoolOptions<T> {
  /** Items to process */
  items: T[]
  /** Async worker function for each item */
  worker: (item: T, index: number) => Promise<void>
  /** Max tasks running in parallel */
  concurrency: number
  /** Max retry attempts per item. 0 = no retries. */
  maxRetries: number
  /** Label for logging */
  label: string
}

export interface TaskPoolResult {
  total: number
  succeeded: number
  failed: number
  errors: Array<{ index: number; error: unknown }>
}

export async function taskPool<T>(opts: TaskPoolOptions<T>): Promise<TaskPoolResult> {
  const { items, worker, concurrency, maxRetries, label } = opts
  const result: TaskPoolResult = { total: items.length, succeeded: 0, failed: 0, errors: [] }

  if (items.length === 0) return result

  let cursor = 0

  async function runNext(): Promise<void> {
    while (cursor < items.length) {
      const index = cursor++
      const item = items[index]!
      let lastErr: unknown

      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
          await worker(item, index)
          lastErr = undefined
          result.succeeded++
          break
        } catch (err) {
          lastErr = err
          if (attempt < maxRetries) {
            const delayMs = 1000 * Math.pow(2, attempt) // 1s, 2s, 4s...
            logger.warn({ label, index, attempt: attempt + 1, maxRetries, err }, 'Task failed, retrying')
            await new Promise(r => setTimeout(r, delayMs))
          }
        }
      }

      if (lastErr !== undefined) {
        result.failed++
        result.errors.push({ index, error: lastErr })
        logger.warn({ label, index, err: lastErr }, 'Task exhausted retries')
      }
    }
  }

  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    () => runNext(),
  )
  await Promise.all(workers)

  logger.info({ label, total: result.total, succeeded: result.succeeded, failed: result.failed }, 'Task pool complete')
  return result
}
