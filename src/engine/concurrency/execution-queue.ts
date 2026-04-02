// LUNA Engine — Execution Queue
// Priority-based queue with reactive / proactive / background lanes.
// Wraps PipelineSemaphore + ContactLock — does NOT replace them.
//
// Lanes:
//   reactive   — customer messages (highest priority, most concurrency)
//   proactive  — follow-ups, reminders, commitments (medium)
//   background — subagents, batch processing, cache refresh (lowest)

import { randomUUID } from 'node:crypto'
import pino from 'pino'

const logger = pino({ name: 'engine:concurrency:execution-queue' })

// ─── Types ──────────────────────────────────

export type QueueLane = 'reactive' | 'proactive' | 'background'

export interface QueuedItem {
  id: string
  lane: QueueLane
  priority: number       // higher = more urgent
  handler: () => Promise<void>
  contactId?: string
  enqueuedAt: Date
}

export interface LaneConfig {
  concurrency: number
  priority: number
}

export interface LaneStats {
  running: number
  queued: number
  concurrency: number
}

export interface RunningStats {
  running: number
  max: number
}

interface LaneState {
  config: LaneConfig
  running: number
  queue: QueuedItem[]
}

// ─── ExecutionQueue ──────────────────────────

export class ExecutionQueue {
  private lanes: Record<QueueLane, LaneState>
  private globalRunning = 0

  constructor(private config: {
    reactive: LaneConfig
    proactive: LaneConfig
    background: LaneConfig
    globalMax: number
  }) {
    this.lanes = {
      reactive: { config: config.reactive, running: 0, queue: [] },
      proactive: { config: config.proactive, running: 0, queue: [] },
      background: { config: config.background, running: 0, queue: [] },
    }
  }

  /**
   * Enqueue a handler in the specified lane.
   * Returns the item ID assigned.
   *
   * Execution respects:
   * 1. Global concurrency cap (globalMax)
   * 2. Per-lane concurrency cap
   * 3. Priority ordering: reactive > proactive > background
   * 4. FIFO within each lane
   */
  async enqueue(
    lane: QueueLane,
    item: Omit<QueuedItem, 'id' | 'enqueuedAt' | 'priority'>,
  ): Promise<string> {
    const laneState = this.lanes[lane]
    const id = randomUUID()
    const queued: QueuedItem = {
      ...item,
      id,
      lane,
      priority: laneState.config.priority,
      enqueuedAt: new Date(),
    }

    // Try to run immediately, otherwise queue it
    if (this.canRun(lane)) {
      this.runItem(queued, laneState)
    } else {
      laneState.queue.push(queued)
      logger.debug({
        id,
        lane,
        queuedItems: laneState.queue.length,
        globalRunning: this.globalRunning,
      }, 'Item queued — lane or global capacity reached')
    }

    return id
  }

  /**
   * Current stats across all lanes.
   */
  getStats(): {
    reactive: LaneStats
    proactive: LaneStats
    background: LaneStats
    global: RunningStats
  } {
    return {
      reactive: this.laneStats('reactive'),
      proactive: this.laneStats('proactive'),
      background: this.laneStats('background'),
      global: { running: this.globalRunning, max: this.config.globalMax },
    }
  }

  /**
   * Wait for all currently running and queued items to complete.
   * Useful for graceful shutdown.
   */
  async drain(timeoutMs = 30_000): Promise<void> {
    const deadline = Date.now() + timeoutMs
    while (this.globalRunning > 0 || this.hasQueued()) {
      if (Date.now() > deadline) {
        logger.warn({
          globalRunning: this.globalRunning,
          stats: this.getStats(),
        }, 'ExecutionQueue.drain() timed out')
        return
      }
      await new Promise<void>((resolve) => setTimeout(resolve, 100))
    }
  }

  // ─── Private ────────────────────────────────

  private canRun(lane: QueueLane): boolean {
    const laneState = this.lanes[lane]
    return (
      this.globalRunning < this.config.globalMax &&
      laneState.running < laneState.config.concurrency
    )
  }

  private runItem(item: QueuedItem, laneState: LaneState): void {
    laneState.running++
    this.globalRunning++

    const start = Date.now()
    item.handler()
      .catch((err: unknown) => {
        logger.error({ err, id: item.id, lane: item.lane, contactId: item.contactId }, 'Queued item failed')
      })
      .finally(() => {
        laneState.running--
        this.globalRunning--
        const durationMs = Date.now() - start

        logger.debug({
          id: item.id,
          lane: item.lane,
          contactId: item.contactId,
          durationMs,
        }, 'Queued item completed')

        // Dispatch next items: prioritize higher-priority lanes first
        this.dispatchNext()
      })
  }

  /**
   * After an item finishes, dispatch the next pending item across lanes
   * in priority order (reactive > proactive > background).
   */
  private dispatchNext(): void {
    const lanePriority: QueueLane[] = ['reactive', 'proactive', 'background']

    for (const lane of lanePriority) {
      const laneState = this.lanes[lane]
      if (laneState.queue.length > 0 && this.canRun(lane)) {
        const next = laneState.queue.shift()!
        this.runItem(next, laneState)
        return  // dispatch one at a time; next completion will trigger another dispatch
      }
    }
  }

  private laneStats(lane: QueueLane): LaneStats {
    const s = this.lanes[lane]
    return {
      running: s.running,
      queued: s.queue.length,
      concurrency: s.config.concurrency,
    }
  }

  private hasQueued(): boolean {
    return (
      this.lanes.reactive.queue.length > 0 ||
      this.lanes.proactive.queue.length > 0 ||
      this.lanes.background.queue.length > 0
    )
  }
}

// ─── Default instance factory ────────────────

/**
 * Create a default execution queue with recommended lane configs.
 * Called once at engine startup.
 */
export function createExecutionQueue(overrides?: Partial<{
  reactive: Partial<LaneConfig>
  proactive: Partial<LaneConfig>
  background: Partial<LaneConfig>
  globalMax: number
}>): ExecutionQueue {
  return new ExecutionQueue({
    reactive: {
      concurrency: overrides?.reactive?.concurrency ?? 8,
      priority: overrides?.reactive?.priority ?? 100,
    },
    proactive: {
      concurrency: overrides?.proactive?.concurrency ?? 3,
      priority: overrides?.proactive?.priority ?? 50,
    },
    background: {
      concurrency: overrides?.background?.concurrency ?? 2,
      priority: overrides?.background?.priority ?? 10,
    },
    globalMax: overrides?.globalMax ?? 12,
  })
}
