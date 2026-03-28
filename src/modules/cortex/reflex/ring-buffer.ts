// cortex/reflex/ring-buffer.ts — Circular buffer for recent WARN/ERROR logs
// Fixed-size, in-memory, zero I/O. ~20KB at capacity.

import type { RingBufferEntry } from '../types.js'

export class RingBuffer {
  private buffer: Array<RingBufferEntry | null>
  private head = 0
  private count = 0

  constructor(private readonly capacity: number) {
    this.buffer = new Array<RingBufferEntry | null>(capacity).fill(null)
  }

  push(entry: RingBufferEntry): void {
    this.buffer[this.head] = entry
    this.head = (this.head + 1) % this.capacity
    if (this.count < this.capacity) this.count++
  }

  /** Get all entries in chronological order */
  getAll(): RingBufferEntry[] {
    if (this.count === 0) return []
    const result: RingBufferEntry[] = []
    const start = this.count < this.capacity ? 0 : this.head
    for (let i = 0; i < this.count; i++) {
      const idx = (start + i) % this.capacity
      const entry = this.buffer[idx]
      if (entry) result.push(entry)
    }
    return result
  }

  /** Get entries filtered by component, max N */
  filterByComponent(component: string, max = 10): RingBufferEntry[] {
    const all = this.getAll()
    const filtered: RingBufferEntry[] = []
    // Walk backwards (most recent first) to get latest entries
    for (let i = all.length - 1; i >= 0 && filtered.length < max; i--) {
      if (all[i]!.component === component) {
        filtered.unshift(all[i]!)
      }
    }
    return filtered
  }

  /** Format entries as log lines for alert messages */
  formatLines(entries: RingBufferEntry[]): string[] {
    return entries.map(e => {
      const ts = new Date(e.timestamp).toISOString().slice(11, 19) // HH:MM:SS
      return `  [${ts}] [${e.component}] ${e.message}`
    })
  }

  get size(): number {
    return this.count
  }
}
