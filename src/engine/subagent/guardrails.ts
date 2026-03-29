// LUNA Engine — Subagent Guardrails v2
// Soft limits: warn + continue. Hard limits: crash protection.

import pino from 'pino'
import type { SubagentGuardrails, GuardrailCheck } from './types.js'
import { SUBAGENT_HARD_LIMITS } from './types.js'

const logger = pino({ name: 'engine:guardrails' })

/**
 * Build guardrails for a subagent run.
 * Token budget comes from the catalog entry (user-configurable),
 * but clamped to hard limits.
 */
export function buildGuardrails(
  tokenBudget: number,
  allowedTools: string[],
): SubagentGuardrails {
  // Clamp token budget between min and hard max
  const clampedBudget = Math.max(
    SUBAGENT_HARD_LIMITS.MIN_TOKEN_BUDGET,
    Math.min(tokenBudget, SUBAGENT_HARD_LIMITS.HARD_MAX_TOKEN_BUDGET),
  )

  // Soft token budget = user's configured budget
  // Hard token budget = absolute max (crash protection)
  return {
    softMaxIterations: SUBAGENT_HARD_LIMITS.SOFT_MAX_ITERATIONS,
    softTokenBudget: clampedBudget,
    hardMaxIterations: SUBAGENT_HARD_LIMITS.HARD_MAX_ITERATIONS,
    hardTimeoutMs: SUBAGENT_HARD_LIMITS.HARD_TIMEOUT_MS,
    hardTokenBudget: SUBAGENT_HARD_LIMITS.HARD_MAX_TOKEN_BUDGET,
    allowedTools,
  }
}

/**
 * Check guardrails before each iteration.
 * Returns soft checks (warn + continue) and hard checks (stop).
 */
export function checkGuardrails(
  guardrails: SubagentGuardrails,
  iterations: number,
  tokensUsed: number,
  startTimeMs: number,
): GuardrailCheck {
  const elapsed = Date.now() - startTimeMs

  // ── Hard limits (stop execution) ──

  if (iterations >= guardrails.hardMaxIterations) {
    return {
      hit: true,
      level: 'hard',
      reason: `Hard iteration limit reached (${iterations}/${guardrails.hardMaxIterations})`,
    }
  }

  if (elapsed >= guardrails.hardTimeoutMs) {
    return {
      hit: true,
      level: 'hard',
      reason: `Hard timeout (${elapsed}ms/${guardrails.hardTimeoutMs}ms)`,
    }
  }

  if (tokensUsed >= guardrails.hardTokenBudget) {
    return {
      hit: true,
      level: 'hard',
      reason: `Hard token budget exceeded (${tokensUsed}/${guardrails.hardTokenBudget})`,
    }
  }

  // ── Soft limits (warn + continue) ──

  if (iterations === guardrails.softMaxIterations) {
    logger.warn(
      { iterations, softMax: guardrails.softMaxIterations },
      'Subagent hit soft iteration limit — continuing',
    )
    return { hit: false, level: 'soft', reason: `Soft iteration limit (${iterations})` }
  }

  if (tokensUsed >= guardrails.softTokenBudget && tokensUsed < guardrails.hardTokenBudget) {
    logger.warn(
      { tokensUsed, softBudget: guardrails.softTokenBudget },
      'Subagent hit soft token budget — continuing',
    )
    return { hit: false, level: 'soft', reason: `Soft token budget (${tokensUsed}/${guardrails.softTokenBudget})` }
  }

  return { hit: false, level: 'soft' }
}
