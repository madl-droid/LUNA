// LUNA Engine — Per-Contact Serialization
// Ensures only one pipeline runs at a time per contact.
// Prevents race conditions on session, history, and lead status.

import pino from 'pino'

const logger = pino({ name: 'engine:contact-lock' })

export class ContactLock {
  private locks = new Map<string, Promise<void>>()

  /**
   * Execute `fn` with exclusive access for `contactId`.
   * If another pipeline for the same contact is running, waits for it to finish first.
   * Different contacts run in parallel (no blocking).
   */
  async withLock<T>(contactId: string, fn: () => Promise<T>): Promise<T> {
    // Wait for any existing pipeline for this contact
    const existing = this.locks.get(contactId)
    if (existing) {
      logger.debug({ contactId }, 'Waiting for existing pipeline to finish')
      await existing.catch(() => {})  // swallow — we just need to wait
    }

    let releaseFn!: () => void
    const lockPromise = new Promise<void>(r => { releaseFn = r })
    this.locks.set(contactId, lockPromise)

    try {
      return await fn()
    } finally {
      releaseFn()
      // Only delete if our lock is still the current one
      if (this.locks.get(contactId) === lockPromise) {
        this.locks.delete(contactId)
      }
    }
  }

  /** Number of contacts currently locked. */
  activeCount(): number {
    return this.locks.size
  }
}
