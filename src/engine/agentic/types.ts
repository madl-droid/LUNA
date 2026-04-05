// LUNA Engine — Agentic Loop Types
// Internal types for the agentic loop (v2). Do NOT duplicate types from engine/types.ts.

/**
 * Effort level determines which canonical task (and thus model) handles the message.
 * Classified deterministically (no LLM call) by effort-router.ts.
 *
 * - 'normal' → task 'main' (Sonnet — default for most messages)
 * - 'complex' → task 'complex' (Opus — objections, multi-step, HITL, long messages)
 *
 * The low/ack task is selected separately when needed, not via effort routing.
 * See docs/architecture/task-routing.md for the full model routing design.
 */
export type EffortLevel = 'normal' | 'complex'

/**
 * Agentic loop configuration.
 * Assembled by the engine — model/provider selection delegated to the task router.
 */
export interface AgenticConfig {
  /** Max tool-calling turns before forcing a text response */
  maxToolTurns: number
  /** Max concurrent tool executions within a single turn (reuses StepSemaphore) */
  maxConcurrentTools: number
  /** Effort level for this pipeline run */
  effort: EffortLevel
  /** Task name for LLM calls (resolved from effort: 'normal'→'main', 'complex'→'complex') */
  task: string
  /** Max output tokens per LLM call */
  maxOutputTokens: number
  /** Criticizer mode: 'disabled' | 'complex_only' | 'always' */
  criticizerMode: 'disabled' | 'complex_only' | 'always'
}

/**
 * Record of a single tool call within the agentic loop.
 */
export interface ToolCallLog {
  /** Tool name */
  name: string
  /** Input parameters passed to the tool */
  input: Record<string, unknown>
  /** Output from the tool (ToolResult.data) */
  output: unknown
  /** Whether the tool call succeeded */
  success: boolean
  /** Error message if failed */
  error?: string
  /** Wall-clock duration in ms */
  durationMs: number
  /** Whether result came from dedup cache */
  fromCache: boolean
  /** Whether the call was blocked by loop detector */
  blocked?: boolean
  /** Reason for blocking (from loop detector) */
  blockReason?: string
}

/**
 * Output of the agentic loop (runAgenticLoop).
 * This is an intermediate result; post-processor converts it to CompositorOutput.
 */
export interface AgenticResult {
  /** Final response text from the LLM */
  responseText: string
  /** Log of every tool call made during the loop */
  toolCallsLog: ToolCallLog[]
  /** Number of LLM turns (each turn = one callLLM invocation) */
  turns: number
  /** Total tokens consumed (input + output across all turns) */
  tokensUsed: number
  /** Effort level used for this run */
  effortUsed: EffortLevel
  /** Partial text if the loop was cut short (timeout or turn limit) */
  partialText?: string
  /** Names of all tools called (deduplicated, for pipeline log) */
  toolsUsed: string[]
}

/**
 * Loop detector action. Graduated response to repetitive tool calls.
 */
// ── Email Triage ──

/** Pre-agentic triage decision for email channel. Deterministic, <5ms. */
export type TriageDecision = 'respond' | 'observe' | 'ignore'

export interface TriageResult {
  decision: TriageDecision
  /** Log-friendly reason (e.g. 'auto-reply-header', 'cc-only', 'rule:my-rule') */
  reason: string
}

// ── Loop Detector ──

export type LoopAction = 'allow' | 'warn' | 'block' | 'circuit_break'

/**
 * Result from the loop detector check.
 */
export interface LoopDetectorResult {
  action: LoopAction
  reason?: string
}

/**
 * Internal tracking entry for the loop detector.
 */
export interface LoopCallEntry {
  toolName: string
  inputHash: string
  resultHash: string
  timestamp: number
}
