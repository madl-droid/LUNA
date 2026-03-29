// LUNA Engine — Subagent v2 Types
// Tipos internos del engine para el sistema de subagents.

import type { SubagentCatalogEntry } from '../../modules/subagents/types.js'
import type { LLMProvider } from '../types.js'

// ═══════════════════════════════════════════
// Guardrails — soft (warn) vs hard (stop)
// ═══════════════════════════════════════════

export type GuardrailLevel = 'soft' | 'hard'

export interface GuardrailCheck {
  hit: boolean
  level: GuardrailLevel
  reason?: string
}

export interface SubagentGuardrails {
  /** Soft limit: warn + continue */
  softMaxIterations: number
  softTokenBudget: number
  /** Hard limit: stop execution (crash protection) */
  hardMaxIterations: number
  hardTimeoutMs: number
  hardTokenBudget: number
  /** Tool access control */
  allowedTools: string[]
}

// ═══════════════════════════════════════════
// Resolved config for a subagent execution
// ═══════════════════════════════════════════

export interface SubagentRunConfig {
  /** Catalog entry this run is based on */
  entry: SubagentCatalogEntry
  /** Resolved model name */
  model: string
  /** Resolved provider */
  provider: LLMProvider
  /** Temperature */
  temperature: number
  /** Max output tokens per LLM call */
  maxOutputTokens: number
  /** Whether extended thinking is active */
  useThinking: boolean
  /** Thinking budget tokens */
  thinkingBudget: number
  /** Guardrails for this run */
  guardrails: SubagentGuardrails
  /** Whether this is a child subagent (cannot spawn more) */
  isChild: boolean
}

// ═══════════════════════════════════════════
// Subagent result v2
// ═══════════════════════════════════════════

export interface SubagentResultV2 {
  success: boolean
  data?: unknown
  iterations: number
  tokensUsed: number
  durationMs: number
  /** Subagent slug that ran */
  subagentSlug: string
  /** Whether soft limits were hit (continued anyway) */
  softLimitsHit: string[]
  /** Whether a hard limit stopped execution */
  hardLimitHit?: string
  /** Verification result (if verify was enabled) */
  verification?: VerificationResult
  /** Whether a child subagent was spawned */
  childSpawned: boolean
  /** Child subagent results (if any were spawned) */
  childResults?: SubagentResultV2[]
  /** Estimated cost USD */
  costUsd: number
  error?: string
}

// ═══════════════════════════════════════════
// Verification
// ═══════════════════════════════════════════

export type VerificationVerdict = 'accept' | 'retry' | 'fail'

export interface VerificationResult {
  verdict: VerificationVerdict
  confidence: number  // 0-1
  feedback?: string   // Why retry/fail — used as input for retry attempt
  issues?: string[]   // Specific issues found
}

// ═══════════════════════════════════════════
// Fixed hard limits (not configurable)
// ═══════════════════════════════════════════

export const SUBAGENT_HARD_LIMITS = {
  /** Soft iteration limit — warn but continue */
  SOFT_MAX_ITERATIONS: 10,
  /** Hard iteration limit — stop execution */
  HARD_MAX_ITERATIONS: 30,
  /** Hard timeout — stop execution */
  HARD_TIMEOUT_MS: 120_000,
  /** Absolute max token budget — even if user sets higher */
  HARD_MAX_TOKEN_BUDGET: 200_000,
  /** Minimum token budget user can set */
  MIN_TOKEN_BUDGET: 5_000,
  /** Max verification retries */
  MAX_VERIFY_RETRIES: 1,
} as const
