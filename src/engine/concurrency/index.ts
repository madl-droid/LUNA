// LUNA Engine — Concurrency primitives
export { PipelineSemaphore } from './pipeline-semaphore.js'
export type { AcquireResult } from './pipeline-semaphore.js'
export { ContactLock } from './contact-lock.js'
export { StepSemaphore } from './step-semaphore.js'
export { ExecutionQueue, createExecutionQueue } from './execution-queue.js'
export type { QueueLane, QueuedItem, LaneConfig, LaneStats, RunningStats } from './execution-queue.js'
