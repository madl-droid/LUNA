// LUNA — WhatsApp Message Batcher
// Accumulates messages from the same sender within a configurable window
// and dispatches them as a single concatenated message to the pipeline.

import pino from 'pino'
import type { IncomingMessage } from './adapter.js'

const logger = pino({ name: 'whatsapp:batcher' })

interface PendingBatch {
  messages: IncomingMessage[]
  timer: ReturnType<typeof setTimeout>
}

export type BatchHandler = (messages: IncomingMessage[]) => Promise<void>

export class MessageBatcher {
  private pending = new Map<string, PendingBatch>()
  private waitMs: number
  private handler: BatchHandler

  constructor(waitSeconds: number, handler: BatchHandler) {
    // Clamp to 15-120s range
    this.waitMs = Math.max(15, Math.min(120, waitSeconds)) * 1000
    this.handler = handler
  }

  /**
   * Add an incoming message to the batch for its sender.
   * If no pending batch exists, starts a new timer.
   * If a batch already exists, adds to it and resets the timer (debounce).
   */
  add(message: IncomingMessage): void {
    const key = message.from
    const existing = this.pending.get(key)

    if (existing) {
      // Add to existing batch and reset timer (debounce)
      existing.messages.push(message)
      clearTimeout(existing.timer)
      existing.timer = setTimeout(() => this.flush(key), this.waitMs)
      logger.debug({ from: key, count: existing.messages.length }, 'Message added to batch')
    } else {
      // Start new batch
      const batch: PendingBatch = {
        messages: [message],
        timer: setTimeout(() => this.flush(key), this.waitMs),
      }
      this.pending.set(key, batch)
      logger.debug({ from: key, waitMs: this.waitMs }, 'New batch started')
    }
  }

  /**
   * Flush a pending batch — concatenate messages and dispatch.
   */
  private async flush(key: string): Promise<void> {
    const batch = this.pending.get(key)
    if (!batch) return
    this.pending.delete(key)

    const messages = batch.messages
    if (messages.length === 0) return

    logger.info({ from: key, count: messages.length }, 'Flushing message batch')

    try {
      await this.handler(messages)
    } catch (err) {
      logger.error({ err, from: key, count: messages.length }, 'Batch handler failed')
    }
  }

  /**
   * Clear all pending batches (for shutdown).
   */
  clearAll(): void {
    for (const batch of this.pending.values()) {
      clearTimeout(batch.timer)
    }
    this.pending.clear()
  }

  /**
   * Update wait time (for hot-reload).
   */
  updateWaitSeconds(seconds: number): void {
    this.waitMs = Math.max(15, Math.min(120, seconds)) * 1000
  }
}
