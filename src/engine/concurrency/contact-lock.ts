// LUNA Engine — Per-Contact Serialization
// Ensures only one pipeline runs at a time per contact.
// Prevents race conditions on session, history, and lead status.

import pino from 'pino'

const logger = pino({ name: 'engine:contact-lock' })

export class ContactLock {
  private locks = new Map<string, Promise<unknown>>()

  /**
   * Execute `fn` with exclusive access for `contactId`.
   * If another pipeline for the same contact is running, waits for it to finish first.
   * Different contacts run in parallel (no blocking).
   *
   * Uses promise chaining to guarantee serialization: each new call chains
   * onto the previous promise, ensuring FIFO ordering without TOCTOU gaps.
   */
  async withLock<T>(contactId: string, fn: () => Promise<T>): Promise<T> {
    // Chain onto the existing promise (if any) to guarantee serialization.
    // This avoids the TOCTOU race of check-then-set: we atomically replace
    // the lock with a new promise that waits for the previous one first.
    const existing = this.locks.get(contactId) ?? Promise.resolve()

    const resultPromise = existing
      .catch(() => {}) // swallow previous errors — we just need ordering
      .then(() => fn())

    // Atomically replace the lock — no gap between check and set
    this.locks.set(contactId, resultPromise)

    try {
      return await resultPromise
    } finally {
      // Only delete if our promise is still the current one
      // (a newer call may have already chained onto ours)
      if (this.locks.get(contactId) === resultPromise) {
        this.locks.delete(contactId)
      }
    }
  }

  /** Number of contacts currently locked. */
  activeCount(): number {
    return this.locks.size
  }
}
