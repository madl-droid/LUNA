// LUNA Engine — Checkpoint Types
// Lightweight types for Phase 3 execution plan checkpoints.

import type { ExecutionStep, StepResult } from '../types.js'

export type CheckpointStatus = 'running' | 'completed' | 'failed'

export interface TaskCheckpoint {
  id: string
  traceId: string
  messageId: string
  contactId: string | null
  channel: string
  status: CheckpointStatus

  messageFrom: string
  messageText: string | null

  executionPlan: ExecutionStep[]
  stepResults: StepResult[]

  error: string | null
  createdAt: Date
  updatedAt: Date
}
