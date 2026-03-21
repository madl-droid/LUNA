// LUNA Engine — Subagent Guardrails
// Límites configurables del mini-loop subagent.

import { readFile } from 'node:fs/promises'
import pino from 'pino'
import type { SubagentConfig } from '../types.js'

const logger = pino({ name: 'engine:guardrails' })

// Default guardrails
const DEFAULTS: SubagentConfig = {
  maxIterations: 5,
  timeoutMs: 20000,
  maxTokenBudget: 15000,
  allowedTools: [],
}

// Hard ceiling — even if tenant sets higher, never exceed this
const MAX_ITERATIONS_CEILING = 10

/**
 * Load subagent guardrails from instance/config.json or use defaults.
 */
export async function loadGuardrails(
  defaults: Partial<SubagentConfig>,
): Promise<SubagentConfig> {
  // Try to read from instance/config.json
  try {
    const raw = await readFile('instance/config.json', 'utf-8')
    const config = JSON.parse(raw)
    const subagent = config.subagent ?? {}

    return {
      maxIterations: Math.min(subagent.maxIterations ?? defaults.maxIterations ?? DEFAULTS.maxIterations, MAX_ITERATIONS_CEILING),
      timeoutMs: subagent.timeoutMs ?? defaults.timeoutMs ?? DEFAULTS.timeoutMs,
      maxTokenBudget: subagent.maxTokenBudget ?? defaults.maxTokenBudget ?? DEFAULTS.maxTokenBudget,
      allowedTools: subagent.allowedTools ?? defaults.allowedTools ?? DEFAULTS.allowedTools,
    }
  } catch {
    logger.debug('No subagent config in instance/config.json, using defaults')
    return {
      maxIterations: Math.min(defaults.maxIterations ?? DEFAULTS.maxIterations, MAX_ITERATIONS_CEILING),
      timeoutMs: defaults.timeoutMs ?? DEFAULTS.timeoutMs,
      maxTokenBudget: defaults.maxTokenBudget ?? DEFAULTS.maxTokenBudget,
      allowedTools: defaults.allowedTools ?? DEFAULTS.allowedTools,
    }
  }
}

/**
 * Check if a guardrail has been hit.
 */
export function checkGuardrails(
  config: SubagentConfig,
  iterations: number,
  tokensUsed: number,
  startTimeMs: number,
): { hit: boolean; reason?: string } {
  if (iterations >= config.maxIterations) {
    return { hit: true, reason: `Max iterations reached (${config.maxIterations})` }
  }

  if (tokensUsed >= config.maxTokenBudget) {
    return { hit: true, reason: `Token budget exceeded (${tokensUsed}/${config.maxTokenBudget})` }
  }

  const elapsed = Date.now() - startTimeMs
  if (elapsed >= config.timeoutMs) {
    return { hit: true, reason: `Timeout (${elapsed}ms/${config.timeoutMs}ms)` }
  }

  return { hit: false }
}
