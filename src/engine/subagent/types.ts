// LUNA Engine — Subagent v2 Types
// Tipos para el sistema de subagents especializados con verificación y spawn recursivo.

// ═══════════════════════════════════════════
// Subagent type presets (inspirado en Claude Code)
// ═══════════════════════════════════════════

/** Tipos de subagent disponibles */
export type SubagentType =
  | 'research'    // Deep search, multiple tool calls, high iteration
  | 'executor'    // Multi-step task execution with tools
  | 'analyst'     // Data analysis, optional code execution, uses thinking
  | 'writer'      // Content drafting, single-shot, no tools
  | 'validator'   // Quality check of other subagent results

/** Preset de configuración para cada tipo de subagent */
export interface SubagentPreset {
  type: SubagentType
  description: { es: string; en: string }
  /** Default model for this type (overridable) */
  defaultModel: string
  defaultProvider: string
  /** Max LLM iterations in the loop */
  maxIterations: number
  /** Timeout for the entire subagent run (ms) */
  timeoutMs: number
  /** Max tokens across all iterations */
  maxTokenBudget: number
  /** Temperature for LLM calls */
  temperature: number
  /** Max output tokens per LLM call */
  maxOutputTokens: number
  /** Enable extended thinking */
  useThinking: boolean
  /** Thinking budget tokens (if useThinking=true) */
  thinkingBudget: number
  /** Enable code execution sandbox */
  useCoding: boolean
  /** Whether this type can spawn child subagents */
  canSpawnChildren: boolean
  /** Whether to run verifier after completion */
  verifyResult: boolean
  /** System prompt template key (from prompts module) */
  promptKey: string
}

// ═══════════════════════════════════════════
// Guardrails v2 — soft vs hard
// ═══════════════════════════════════════════

export type GuardrailLevel = 'soft' | 'hard'

export interface GuardrailCheck {
  hit: boolean
  level: GuardrailLevel
  reason?: string
}

export interface SubagentGuardrails {
  // Soft limits — warn + continue (logged but don't stop)
  softMaxIterations: number
  softTokenBudget: number
  // Hard limits — stop execution (crash protection)
  hardMaxIterations: number
  hardTimeoutMs: number
  hardTokenBudget: number
  // Tool access
  allowedTools: string[]
  // Recursive spawn limits
  maxDepth: number
}

// ═══════════════════════════════════════════
// Subagent config (resolved from env + presets)
// ═══════════════════════════════════════════

export interface SubagentConfigV2 {
  // Per-type overrides (from env/console)
  maxIterations: number
  timeoutMs: number
  maxTokenBudget: number
  temperature: number
  maxOutputTokens: number
  useThinking: boolean
  thinkingBudget: number
  useCoding: boolean
  canSpawnChildren: boolean
  verifyResult: boolean
  maxVerifyRetries: number
  maxDepth: number
  model: string
  provider: string
  allowedTools: string[]
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
  /** Subagent type that ran */
  subagentType: SubagentType
  /** Current recursion depth */
  depth: number
  /** Whether soft limits were hit (continued anyway) */
  softLimitsHit: string[]
  /** Whether hard limits stopped execution */
  hardLimitHit?: string
  /** Verification result (if verify was enabled) */
  verification?: VerificationResult
  /** Child subagent results (if any were spawned) */
  childResults?: SubagentResultV2[]
  error?: string
}

// ═══════════════════════════════════════════
// Verification
// ═══════════════════════════════════════════

export type VerificationVerdict = 'accept' | 'retry' | 'fail'

export interface VerificationResult {
  verdict: VerificationVerdict
  confidence: number  // 0-1
  feedback?: string   // Why retry/fail, used as input for retry
  issues?: string[]   // Specific issues found
}

// ═══════════════════════════════════════════
// Spawn context (for recursive subagents)
// ═══════════════════════════════════════════

export interface SpawnContext {
  /** Current recursion depth (0 = root) */
  depth: number
  /** Max allowed depth */
  maxDepth: number
  /** Parent subagent type */
  parentType?: SubagentType
  /** Accumulated token budget used by parent + siblings */
  parentTokensUsed: number
  /** Trace ID for logging correlation */
  traceId: string
}
