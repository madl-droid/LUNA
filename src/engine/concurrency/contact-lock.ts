// LUNA Engine — Per-Contact Serialization
// Ensures only one pipeline runs at a time per contact.
// Prevents race conditions on session, history, and lead status.

import pino from 'pino'

const logger = pino({ name: 'engine:contact-lock' })

// FIX-E2: 150s — must exceed pipeline timeout (120s default) + 30s margin to prevent
// lock expiry before pipeline completes (which would allow a second pipeline to enter).
const DEFAULT_LOCK_TIMEOUT_MS = 150_000

export class ContactLock {
  private locks = new Map<string, Promise<unknown>>()
  private timeoutMs: number

  constructor(timeoutMs?: number) {
    this.timeoutMs = timeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS
  }

  /**
   * Execute `fn` with exclusive access for `contactId`.
   * If another pipeline for the same contact is running, waits for it to finish first.
   * Different contacts run in parallel (no blocking).
   *
   * Uses promise chaining to guarantee serialization: each new call chains
   * onto the previous promise, ensuring FIFO ordering without TOCTOU gaps.
   *
   * Includes a timeout to prevent deadlocks if fn() hangs.
   */
  async withLock<T>(contactId: string, fn: () => Promise<T>): Promise<T> {
    const existing = this.locks.get(contactId) ?? Promise.resolve()

    const resultPromise = existing
      .catch(() => {}) // swallow previous errors — we just need ordering
      .then(() => this.withTimeout(contactId, fn))

    // Atomically replace the lock — no gap between check and set
    this.locks.set(contactId, resultPromise)

    try {
      return await resultPromise
    } finally {
      // Only delete if our promise is still the current one
      if (this.locks.get(contactId) === resultPromise) {
        this.locks.delete(contactId)
      }
    }
  }

  /** Wrap fn() with a timeout to prevent indefinite blocking. */
  private withTimeout<T>(contactId: string, fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      // Warn at 80% of timeout — signals a slow pipeline before it hits the hard limit
      const warnAt = this.timeoutMs * 0.8
      const warnTimer = setTimeout(() => {
        logger.warn({ contactId, timeoutMs: this.timeoutMs, warnAt }, 'Contact lock approaching timeout (80%) — pipeline may be slow')
      }, warnAt)

      const timer = setTimeout(() => {
        clearTimeout(warnTimer)
        logger.error({ contactId, timeoutMs: this.timeoutMs }, 'Contact lock timeout — releasing to prevent deadlock')
        reject(new Error(`Contact lock timeout after ${this.timeoutMs}ms for ${contactId}`))
      }, this.timeoutMs)

      fn()
        .then(result => { clearTimeout(warnTimer); clearTimeout(timer); resolve(result) })
        .catch(err => { clearTimeout(warnTimer); clearTimeout(timer); reject(err) })
    })
  }

  /** Returns true if contactId currently holds a pipeline lock. */
  hasLock(contactId: string): boolean {
    return this.locks.has(contactId)
  }

  /** Number of contacts currently locked. */
  activeCount(): number {
    return this.locks.size
  }
}
