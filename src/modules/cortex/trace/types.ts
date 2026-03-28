// cortex/trace/types.ts — Domain types for Trace simulation subsystem

import type { ChannelName } from '../../../channels/types.js'
import type { HistoryMessage, UserType } from '../../../engine/types.js'

// ═══════════════════════════════════════════
// Config
// ═══════════════════════════════════════════

export interface TraceConfig {
  CORTEX_TRACE_ENABLED: boolean
  CORTEX_TRACE_MODEL: string
  CORTEX_TRACE_ANALYSIS_MODEL: string
  CORTEX_TRACE_MAX_CONCURRENT: number
  CORTEX_TRACE_MAX_TOKENS_PHASE2: number
  CORTEX_TRACE_MAX_TOKENS_PHASE4: number
  CORTEX_TRACE_MAX_TOKENS_ANALYSIS: number
}

// ═══════════════════════════════════════════
// Scenario definition
// ═══════════════════════════════════════════

/** A single message within a scenario */
export interface ScenarioMessage {
  text: string
  channel: ChannelName
  senderName?: string
  /** UUID of a real contact — reads DB data (read-only) for realistic context */
  contactRef?: string
  /** User type for this message (default: 'lead') */
  userType?: UserType
  /** Per-message prompt overrides — NEVER touches global prompt_slots */
  promptOverrides?: PromptOverrides
  /** Override tool classification per-tool */
  toolMode?: Record<string, 'execute' | 'dry-run'>
  /** Manually mocked tool results (bypass sandbox execution) */
  mockToolResults?: MockToolResult[]
  /** Synthetic history override (replaces DB history) */
  history?: HistoryMessage[]
}

export interface PromptOverrides {
  identity?: string
  job?: string
  guardrails?: string
  relationship?: string
}

export interface MockToolResult {
  tool: string
  success: boolean
  data?: unknown
}

/** Full scenario configuration (can be multi-turn) */
export interface ScenarioConfig {
  messages: ScenarioMessage[]
  /** Named prompt variants for A/B testing */
  variants?: PromptVariant[]
}

export interface PromptVariant {
  name: string
  promptOverrides?: PromptOverrides
}

// ═══════════════════════════════════════════
// Run request & progress
// ═══════════════════════════════════════════

export interface RunRequest {
  scenarioId: string
  variantName?: string
  simCount: SimCount
  /** Admin instructions: what to test/evaluate */
  adminContext: string
  /** Override model for Phase 2+4 */
  modelOverride?: string
  /** Model for Analyst+Synthesizer (default: from config) */
  analysisModel?: string
}

export type SimCount = 1 | 10 | 25 | 50 | 100
export const VALID_SIM_COUNTS: readonly SimCount[] = [1, 10, 25, 50, 100]

export type RunStatus = 'pending' | 'running' | 'analyzing' | 'completed' | 'failed' | 'cancelled'

export interface RunProgress {
  completed: number
  total: number
  analyzing: number
}

// ═══════════════════════════════════════════
// Tool sandbox
// ═══════════════════════════════════════════

export type ToolMode = 'execute' | 'dry-run'

export interface SandboxToolResult {
  tool: string
  mode: 'executed' | 'dry-run'
  params: Record<string, unknown>
  success: boolean
  data?: unknown
  error?: string
  durationMs: number
}

// ═══════════════════════════════════════════
// DB rows
// ═══════════════════════════════════════════

export interface ScenarioRow {
  id: string
  name: string
  description: string | null
  config: ScenarioConfig
  created_at: Date
  updated_at: Date
}

export interface RunRow {
  id: string
  scenario_id: string
  variant_name: string
  status: RunStatus
  sim_count: number
  admin_context: string
  config: Record<string, unknown> | null
  started_at: Date | null
  completed_at: Date | null
  progress: RunProgress | null
  summary: RunSummary | null
  synthesis: string | null
  synthesis_model: string | null
  tokens_input: number
  tokens_output: number
  error: string | null
  created_at: Date
}

export interface ResultRow {
  id: string
  run_id: string
  sim_index: number
  message_index: number
  message_text: string
  // Phase 2 output
  intent: string | null
  emotion: string | null
  tools_planned: string[]
  execution_plan: unknown
  injection_risk: boolean | null
  on_scope: boolean | null
  // Phase 3 output
  tools_executed: SandboxToolResult[]
  // Phase 4 output
  response_text: string | null
  // Timing
  phase2_ms: number | null
  phase3_ms: number | null
  phase4_ms: number | null
  total_ms: number | null
  tokens_input: number
  tokens_output: number
  // Raw outputs
  raw_phase2: unknown
  raw_phase4: string | null
  // Analyst output
  analysis: string | null
  analysis_model: string | null
  analysis_tokens: number
  created_at: Date
}

// ═══════════════════════════════════════════
// Summaries
// ═══════════════════════════════════════════

export interface RunSummary {
  total_simulations: number
  total_messages: number
  intents: Record<string, number>
  avg_phase2_ms: number
  avg_phase4_ms: number
  tools_planned: string[]
  tools_dry_run: string[]
  total_tokens_input: number
  total_tokens_output: number
  duration_ms: number
}
