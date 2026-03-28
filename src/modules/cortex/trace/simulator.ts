// cortex/trace/simulator.ts — Executes one full simulation (Shadow Phase 2+3+4)
// Imports the same prompt builders as the real engine, calls LLM directly.
// NEVER touches processMessage(). NEVER sends real messages.

import type { Pool } from 'pg'
import type { Registry } from '../../../kernel/registry.js'
import type {
  ContextBundle, EvaluatorOutput, ExecutionOutput, ExecutionStep,
  HistoryMessage, ToolCatalogEntry,
} from '../../../engine/types.js'
import { buildEvaluatorPrompt } from '../../../engine/prompts/evaluator.js'
import { buildCompositorPrompt } from '../../../engine/prompts/compositor.js'
import { buildSimContext } from './context-builder.js'
import { executeSandboxPlan } from './tool-sandbox.js'
import { insertResult } from './store.js'
import type { ScenarioConfig, PromptOverrides, ResultRow, TraceConfig } from './types.js'
import pino from 'pino'

const logger = pino({ name: 'cortex:trace:simulator' })

const KNOWLEDGE_DIR = 'instance/knowledge'

export interface SimulationConfig {
  runId: string
  simIndex: number
  modelOverride?: string
  traceConfig: TraceConfig
}

export interface SimulationResult {
  results: ResultRow[]
  totalTokensInput: number
  totalTokensOutput: number
}

/**
 * Run a single full simulation: all messages in the scenario, sequentially.
 * Returns result rows (already persisted to DB).
 */
export async function runSingleSimulation(
  db: Pool,
  registry: Registry,
  scenario: ScenarioConfig,
  variantOverrides: PromptOverrides | undefined,
  config: SimulationConfig,
): Promise<SimulationResult> {
  const results: ResultRow[] = []
  let accumulatedHistory: HistoryMessage[] = []
  let totalTokensInput = 0
  let totalTokensOutput = 0

  for (let msgIdx = 0; msgIdx < scenario.messages.length; msgIdx++) {
    const msg = scenario.messages[msgIdx]!

    // Merge variant overrides with per-message overrides (message wins)
    const mergedOverrides: PromptOverrides = {
      ...variantOverrides,
      ...msg.promptOverrides,
    }

    const start = Date.now()
    let resultId: string | undefined

    try {
      // ── Build context ──
      const { ctx, toolCatalog } = await buildSimContext(db, registry, msg, accumulatedHistory)

      // ── Shadow Phase 2: Evaluate ──
      const phase2Start = Date.now()
      const { evaluatorOutput, p2TokensIn, p2TokensOut } = await shadowPhase2(
        registry, ctx, toolCatalog, mergedOverrides, config,
      )
      const phase2Ms = Date.now() - phase2Start

      // ── Shadow Phase 3: Execute (hybrid sandbox) ──
      const phase3Start = Date.now()
      const { executionOutput, sandboxResults } = await shadowPhase3(
        registry, evaluatorOutput.executionPlan, ctx, msg.toolMode, msg.mockToolResults,
      )
      const phase3Ms = Date.now() - phase3Start

      // ── Shadow Phase 4: Compose ──
      const phase4Start = Date.now()
      const { responseText, p4TokensIn, p4TokensOut } = await shadowPhase4(
        registry, ctx, evaluatorOutput, executionOutput, mergedOverrides, config,
      )
      const phase4Ms = Date.now() - phase4Start

      const totalMs = Date.now() - start
      const tokensIn = p2TokensIn + p4TokensIn
      const tokensOut = p2TokensOut + p4TokensOut
      totalTokensInput += tokensIn
      totalTokensOutput += tokensOut

      // ── Persist result ──
      resultId = await insertResult(db, {
        runId: config.runId,
        simIndex: config.simIndex,
        messageIndex: msgIdx,
        messageText: msg.text,
        intent: evaluatorOutput.intent,
        emotion: evaluatorOutput.emotion,
        toolsPlanned: evaluatorOutput.toolsNeeded,
        executionPlan: evaluatorOutput.executionPlan,
        injectionRisk: evaluatorOutput.injectionRisk,
        onScope: evaluatorOutput.onScope,
        toolsExecuted: sandboxResults,
        responseText,
        phase2Ms,
        phase3Ms,
        phase4Ms,
        totalMs,
        tokensInput: tokensIn,
        tokensOutput: tokensOut,
        rawPhase2: evaluatorOutput,
        rawPhase4: responseText,
      })

      // ── Multi-turn: accumulate history ──
      accumulatedHistory = [
        ...accumulatedHistory,
        { role: 'user' as const, content: msg.text, timestamp: new Date() },
        ...(responseText
          ? [{ role: 'assistant' as const, content: responseText, timestamp: new Date() }]
          : []),
      ]

      // Fetch the persisted row to return
      const row = await db.query(`SELECT * FROM trace_results WHERE id = $1`, [resultId])
      if (row.rows[0]) results.push(row.rows[0] as ResultRow)

    } catch (err) {
      logger.error({ err, runId: config.runId, simIndex: config.simIndex, msgIdx }, 'Simulation message failed')

      // Persist partial result with error
      resultId = await insertResult(db, {
        runId: config.runId,
        simIndex: config.simIndex,
        messageIndex: msgIdx,
        messageText: msg.text,
        totalMs: Date.now() - start,
        rawPhase4: err instanceof Error ? err.message : 'Unknown error',
      })

      const row = await db.query(`SELECT * FROM trace_results WHERE id = $1`, [resultId])
      if (row.rows[0]) results.push(row.rows[0] as ResultRow)
    }
  }

  return { results, totalTokensInput, totalTokensOutput }
}

// ═══════════════════════════════════════════
// Shadow Phase 2: Evaluate
// ═══════════════════════════════════════════

async function shadowPhase2(
  registry: Registry,
  ctx: ContextBundle,
  toolCatalog: ToolCatalogEntry[],
  promptOverrides: PromptOverrides | undefined,
  config: SimulationConfig,
): Promise<{ evaluatorOutput: EvaluatorOutput; p2TokensIn: number; p2TokensOut: number }> {
  // Build prompt using the same builder as the real engine
  // If there are prompt overrides, we create a wrapper registry that returns overridden prompts
  const regForPrompts = promptOverrides
    ? createOverrideRegistry(registry, promptOverrides)
    : registry

  const { system, userMessage } = await buildEvaluatorPrompt(ctx, toolCatalog, regForPrompts)

  const model = config.modelOverride ?? config.traceConfig.CORTEX_TRACE_MODEL
  const maxTokens = config.traceConfig.CORTEX_TRACE_MAX_TOKENS_PHASE2

  // Call LLM via hook
  const llmResult = await registry.callHook('llm:chat', {
    task: 'trace-evaluate',
    system,
    messages: [{ role: 'user', content: userMessage }],
    maxTokens,
    temperature: 0.1,
    jsonMode: true,
    model,
  }) as { text: string; inputTokens?: number; outputTokens?: number } | null

  if (!llmResult?.text) {
    throw new Error('LLM returned empty response for Phase 2 evaluation')
  }

  // Parse JSON response (same as real Phase 2)
  const cleaned = llmResult.text.replace(/```json\s*/g, '').replace(/```/g, '').trim()
  const parsed = JSON.parse(cleaned) as EvaluatorOutput

  // Ensure defaults
  const evaluatorOutput: EvaluatorOutput = {
    intent: parsed.intent ?? 'unknown',
    emotion: parsed.emotion ?? 'neutral',
    injectionRisk: parsed.injectionRisk ?? false,
    onScope: parsed.onScope ?? true,
    executionPlan: parsed.executionPlan ?? [{ type: 'respond_only' }],
    toolsNeeded: parsed.toolsNeeded ?? [],
    needsAcknowledgment: parsed.needsAcknowledgment ?? false,
    searchQuery: parsed.searchQuery,
    searchHint: parsed.searchHint,
    subIntent: parsed.subIntent,
    objectionType: parsed.objectionType,
    objectionStep: parsed.objectionStep,
    rawResponse: llmResult.text,
  }

  return {
    evaluatorOutput,
    p2TokensIn: llmResult.inputTokens ?? 0,
    p2TokensOut: llmResult.outputTokens ?? 0,
  }
}

// ═══════════════════════════════════════════
// Shadow Phase 3: Execute (hybrid sandbox)
// ═══════════════════════════════════════════

async function shadowPhase3(
  registry: Registry,
  plan: ExecutionStep[],
  ctx: ContextBundle,
  toolMode?: Record<string, 'execute' | 'dry-run'>,
  mockResults?: Array<{ tool: string; success: boolean; data?: unknown }>,
): Promise<{
  executionOutput: ExecutionOutput
  sandboxResults: import('./types.js').SandboxToolResult[]
}> {
  const { stepResults, sandboxResults, partialData } = await executeSandboxPlan(
    registry,
    plan,
    { contactId: ctx.contactId ?? undefined, agentId: ctx.agentId, traceId: ctx.traceId },
    toolMode,
    mockResults,
  )

  const executionOutput: ExecutionOutput = {
    results: stepResults,
    allSucceeded: stepResults.every(r => r.success),
    partialData,
  }

  return { executionOutput, sandboxResults }
}

// ═══════════════════════════════════════════
// Shadow Phase 4: Compose
// ═══════════════════════════════════════════

async function shadowPhase4(
  registry: Registry,
  ctx: ContextBundle,
  evaluation: EvaluatorOutput,
  execution: ExecutionOutput,
  promptOverrides: PromptOverrides | undefined,
  config: SimulationConfig,
): Promise<{ responseText: string; p4TokensIn: number; p4TokensOut: number }> {
  const regForPrompts = promptOverrides
    ? createOverrideRegistry(registry, promptOverrides)
    : registry

  const { system, userMessage } = await buildCompositorPrompt(
    ctx, evaluation, execution, KNOWLEDGE_DIR, regForPrompts,
  )

  const model = config.modelOverride ?? config.traceConfig.CORTEX_TRACE_MODEL
  const maxTokens = config.traceConfig.CORTEX_TRACE_MAX_TOKENS_PHASE4

  const llmResult = await registry.callHook('llm:chat', {
    task: 'trace-compose',
    system,
    messages: [{ role: 'user', content: userMessage }],
    maxTokens,
    temperature: 0.3,
    model,
  }) as { text: string; inputTokens?: number; outputTokens?: number } | null

  if (!llmResult?.text) {
    throw new Error('LLM returned empty response for Phase 4 composition')
  }

  return {
    responseText: llmResult.text.trim(),
    p4TokensIn: llmResult.inputTokens ?? 0,
    p4TokensOut: llmResult.outputTokens ?? 0,
  }
}

// ═══════════════════════════════════════════
// Override registry wrapper
// ═══════════════════════════════════════════

/**
 * Creates a lightweight proxy around the real registry that intercepts
 * prompts:service calls to return overridden prompts.
 * NEVER modifies global state — overrides are per-simulation.
 */
function createOverrideRegistry(registry: Registry, overrides: PromptOverrides): Registry {
  // We create a Proxy that intercepts getOptional('prompts:service')
  return new Proxy(registry, {
    get(target, prop, receiver) {
      if (prop === 'getOptional') {
        return (name: string) => {
          if (name === 'prompts:service') {
            const realService = target.getOptional<Record<string, unknown>>(name)
            if (!realService) return null
            // Return a proxy of the prompts service that overrides specific methods
            return createPromptServiceProxy(realService, overrides)
          }
          return target.getOptional(name)
        }
      }
      return Reflect.get(target, prop, receiver)
    },
  })
}

function createPromptServiceProxy(
  realService: Record<string, unknown>,
  overrides: PromptOverrides,
): Record<string, unknown> {
  return new Proxy(realService, {
    get(target, prop, receiver) {
      // Override getCompositorPrompts to merge our overrides
      if (prop === 'getCompositorPrompts') {
        return async (userType: string) => {
          const real = await (target.getCompositorPrompts as (ut: string) => Promise<Record<string, string>>)(userType)
          return {
            ...real,
            ...(overrides.identity && { identity: overrides.identity }),
            ...(overrides.job && { job: overrides.job }),
            ...(overrides.guardrails && { guardrails: overrides.guardrails }),
            ...(overrides.relationship && { relationship: overrides.relationship }),
          }
        }
      }
      // Override getPrompt for individual slot reads
      if (prop === 'getPrompt') {
        return async (slot: string, variant: string) => {
          const overrideMap: Record<string, string | undefined> = {
            identity: overrides.identity,
            job: overrides.job,
            guardrails: overrides.guardrails,
            relationship: overrides.relationship,
          }
          if (overrideMap[slot]) return overrideMap[slot]
          return (target.getPrompt as (s: string, v: string) => Promise<string>)(slot, variant)
        }
      }
      return Reflect.get(target, prop, receiver)
    },
  })
}
