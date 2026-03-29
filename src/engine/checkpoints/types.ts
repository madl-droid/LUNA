// LUNA Engine — Checkpoint Types
// Types for the task checkpoint system that enables resumable pipeline execution.

import type { StepResult } from '../types.js'

export type CheckpointStatus = 'running' | 'completed' | 'failed' | 'resuming'

export interface TaskCheckpoint {
  id: string
  traceId: string
  messageId: string
  contactId: string | null
  agentId: string
  channel: string

  currentPhase: number           // 1-5
  status: CheckpointStatus

  messagePayload: unknown        // serialized IncomingMessage
  phase1Result: unknown | null   // serialized ContextBundle essentials
  phase2Result: unknown | null   // serialized EvaluatorOutput
  phase3Result: unknown | null   // serialized ExecutionOutput
  phase4Result: unknown | null   // serialized CompositorOutput
  stepResults: StepResult[]      // completed steps within Phase 3

  replanAttempt: number
  error: string | null
  createdAt: Date
  updatedAt: Date
  completedAt: Date | null
}

/** Minimal context needed to serialize for Phase 1 resume */
export interface Phase1Snapshot {
  traceId: string
  userType: string
  contactId: string | null
  agentId: string
  isNewContact: boolean
  contact: unknown | null
  session: unknown
  campaign: unknown | null
  normalizedText: string | null
  history: unknown[]
  attachmentMeta: unknown[]
  knowledgeMatches: unknown[]
  attachmentContext: unknown | null
}
