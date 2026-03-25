// LUNA Engine — Pipeline Semaphore
// Limits concurrent pipeline executions system-wide.
// Excess messages queue up; if queue overflows → backpressure (reject).

import pino from 'pino'

const logger = pino({ name: 'engine:semaphore' })

export type AcquireResult = 'ok' | 'queued' | 'rejected'

interface QueueEntry {
  resolve: (result: AcquireResult) => void
  contactId: string
  enqueuedAt: number
}

export class PipelineSemaphore {
  private running = 0
  private queue: QueueEntry[] = []

  constructor(
    private maxConcurrent: number,
    private maxQueueSize: number,
  ) {}

  /** Try to acquire a slot. Returns immediately if available, queues otherwise. */
  async acquire(contactId: string): Promise<AcquireResult> {
    if (this.running < this.maxConcurrent) {
      this.running++
      return 'ok'
    }
    if (this.queue.length >= this.maxQueueSize) {
      logger.warn({ contactId, running: this.running, queued: this.queue.length }, 'Backpressure — queue full')
      return 'rejected'
    }

    return new Promise<AcquireResult>(resolve => {
      this.queue.push({ resolve, contactId, enqueuedAt: Date.now() })
      logger.debug({ contactId, position: this.queue.length }, 'Queued for pipeline slot')
    })
  }

  /** Release a slot. Wakes up the next queued message. */
  release(): void {
    this.running--
    const next = this.queue.shift()
    if (next) {
      this.running++
      const waitMs = Date.now() - next.enqueuedAt
      logger.debug({ contactId: next.contactId, waitMs }, 'Dequeued — pipeline slot available')
      next.resolve('queued')
    }
  }

  /** Current stats for monitoring. */
  stats(): { running: number; queued: number; maxConcurrent: number; maxQueue: number } {
    return {
      running: this.running,
      queued: this.queue.length,
      maxConcurrent: this.maxConcurrent,
      maxQueue: this.maxQueueSize,
    }
  }
}
