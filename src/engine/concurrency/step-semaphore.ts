// LUNA Engine — Step Semaphore
// Limits concurrent step executions within the agentic loop.
// Prevents overloading LLM/DB/tool backends.

export class StepSemaphore {
  private running = 0
  private queue: Array<() => void> = []

  constructor(private maxConcurrent: number) {}

  async acquire(): Promise<void> {
    if (this.running < this.maxConcurrent) {
      this.running++
      return
    }
    return new Promise<void>(resolve => {
      this.queue.push(() => { this.running++; resolve() })
    })
  }

  release(): void {
    this.running--
    const next = this.queue.shift()
    if (next) next()
  }

  /** Run a function within the semaphore. */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire()
    try {
      return await fn()
    } finally {
      this.release()
    }
  }
}
