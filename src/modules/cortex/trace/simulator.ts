// cortex/trace/simulator.ts — Executes one full simulation via Shadow Agentic Loop
// Uses buildAgenticPrompt() + callLLMWithFallback() — mirrors the real engine pipeline.
// NEVER touches processMessage(). NEVER sends real messages.

import type { Pool } from 'pg'
import type { Registry } from '../../../kernel/registry.js'
import type {
  ContextBundle, HistoryMessage, ToolCatalogEntry, LLMToolDef, ToolDefinition,
} from '../../../engine/types.js'
import { buildAgenticPrompt } from '../../../engine/prompts/agentic.js'
import { callLLMWithFallback } from '../../../engine/utils/llm-client.js'
import { buildSimContext } from './context-builder.js'
import { executeSandboxToolCall } from './tool-sandbox.js'
import { insertResult } from './store.js'
import type { ScenarioConfig, PromptOverrides, ResultRow, TraceConfig, SandboxToolResult } from './types.js'
import pino from 'pino'

const logger = pino({ name: 'cortex:trace:simulator' })

/** Max agentic tool-calling turns per simulation message (safety limit) */
const MAX_AGENTIC_TURNS = 8

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

      // ── Shadow Agentic Loop ──
      const agenticStart = Date.now()
      const agenticResult = await shadowAgentic(
        registry, ctx, toolCatalog, mergedOverrides, config,
        msg.toolMode, msg.mockToolResults,
      )
      const agenticMs = Date.now() - agenticStart

      const totalMs = Date.now() - start
      totalTokensInput += agenticResult.tokensIn
      totalTokensOutput += agenticResult.tokensOut

      // ── Persist result (map to existing schema) ──
      resultId = await insertResult(db, {
        runId: config.runId,
        simIndex: config.simIndex,
        messageIndex: msgIdx,
        messageText: msg.text,
        // Agentic doesn't produce a separate evaluation — map what we can
        toolsPlanned: agenticResult.toolsUsed,
        toolsExecuted: agenticResult.toolResults,
        responseText: agenticResult.responseText,
        // Timing: total for the agentic loop, no separate phases
        phase4Ms: agenticMs,
        totalMs,
        tokensInput: agenticResult.tokensIn,
        tokensOutput: agenticResult.tokensOut,
        rawPhase2: { toolsUsed: agenticResult.toolsUsed, turns: agenticResult.turns },
        rawPhase4: agenticResult.responseText,
      })

      // ── Multi-turn: accumulate history ──
      accumulatedHistory = [
        ...accumulatedHistory,
        { role: 'user' as const, content: msg.text, timestamp: new Date() },
        ...(agenticResult.responseText
          ? [{ role: 'assistant' as const, content: agenticResult.responseText, timestamp: new Date() }]
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
// Shadow Agentic Loop
// ═══════════════════════════════════════════

interface ShadowAgenticResult {
  responseText: string
  toolsUsed: string[]
  toolResults: SandboxToolResult[]
  turns: number
  tokensIn: number
  tokensOut: number
}

/** Minimal ToolRegistry interface */
interface ToolRegistryLike {
  getEnabledToolDefinitions(contactType?: string): ToolDefinition[]
}

async function shadowAgentic(
  registry: Registry,
  ctx: ContextBundle,
  toolCatalog: ToolCatalogEntry[],
  promptOverrides: PromptOverrides | undefined,
  config: SimulationConfig,
  toolMode?: Record<string, 'execute' | 'dry-run'>,
  mockResults?: Array<{ tool: string; success: boolean; data?: unknown }>,
): Promise<ShadowAgenticResult> {
  const regForPrompts = promptOverrides
    ? createOverrideRegistry(registry, promptOverrides)
    : registry

  // 1. Build system prompt (same builder as the real engine)
  const agenticPrompt = await buildAgenticPrompt(ctx, toolCatalog, regForPrompts, {
    isProactive: false,
  })

  // 2. Get tool definitions for LLM
  const toolsReg = registry.getOptional<ToolRegistryLike>('tools:registry')
  const toolDefs = toolsReg?.getEnabledToolDefinitions(ctx.userType) ?? []
  const llmToolDefs: LLMToolDef[] = toolDefs.map(d => ({
    name: d.name, description: d.description, inputSchema: d.parameters,
  }))

  // 3. Initialize conversation
  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
    { role: 'user', content: ctx.normalizedText },
  ]

  const model = config.modelOverride ?? config.traceConfig.CORTEX_TRACE_MODEL
  const maxTokens = config.traceConfig.CORTEX_TRACE_MAX_TOKENS_PHASE4
  let tokensIn = 0
  let tokensOut = 0
  const toolsUsed: string[] = []
  const toolResults: SandboxToolResult[] = []
  let responseText = ''
  let turns = 0

  // 4. Agentic loop (mirror real engine, but with sandbox tool execution)
  for (let turn = 0; turn < MAX_AGENTIC_TURNS; turn++) {
    turns++

    const llmResult = await callLLMWithFallback(
      {
        task: 'trace-agentic',
        provider: 'anthropic',
        model,
        system: agenticPrompt.system,
        messages,
        maxTokens,
        temperature: 0.3,
        tools: llmToolDefs.length > 0 ? llmToolDefs : undefined,
      },
      'google',
      config.traceConfig.CORTEX_TRACE_MODEL,
    )

    tokensIn += llmResult.inputTokens
    tokensOut += llmResult.outputTokens

    // Text-only response → done
    if (!llmResult.toolCalls || llmResult.toolCalls.length === 0) {
      responseText = llmResult.text
      break
    }

    // Execute tool calls in sandbox
    const turnToolResults: Array<{ name: string; success: boolean; data: unknown; error?: string }> = []
    for (const tc of llmResult.toolCalls) {
      toolsUsed.push(tc.name)

      // Check for mock results first
      const mock = mockResults?.find(m => m.tool === tc.name)
      if (mock) {
        const sandboxResult: SandboxToolResult = {
          tool: tc.name, mode: 'dry-run', params: tc.input,
          success: mock.success, data: mock.data, durationMs: 0,
        }
        toolResults.push(sandboxResult)
        turnToolResults.push({ name: tc.name, success: mock.success, data: mock.data })
        continue
      }

      // Execute in sandbox (read tools execute real, write tools dry-run)
      const sandboxResult = await executeSandboxToolCall(
        registry, tc.name, tc.input,
        { contactId: ctx.contactId ?? undefined, agentId: ctx.agentId, traceId: ctx.traceId },
        toolMode,
      )
      toolResults.push(sandboxResult)
      turnToolResults.push({
        name: tc.name,
        success: sandboxResult.success,
        data: sandboxResult.data,
        error: sandboxResult.error,
      })
    }

    // Append to conversation (same format as real agentic loop)
    const assistantParts: string[] = []
    if (llmResult.text) assistantParts.push(llmResult.text)
    for (const tc of llmResult.toolCalls) {
      assistantParts.push(`[Tool call: ${tc.name}(${JSON.stringify(tc.input).slice(0, 500)})]`)
    }
    messages.push({ role: 'assistant', content: assistantParts.join('\n') })

    const resultParts: string[] = ['Tool results:']
    for (const r of turnToolResults) {
      if (r.success) {
        const dataStr = typeof r.data === 'string' ? r.data : JSON.stringify(r.data)
        resultParts.push(`[${r.name}]: ${(dataStr ?? '(no data)').slice(0, 3000)}`)
      } else {
        resultParts.push(`[${r.name}]: ERROR — ${r.error ?? 'Unknown error'}`)
      }
    }
    messages.push({ role: 'user', content: resultParts.join('\n\n') })
  }

  return { responseText, toolsUsed, toolResults, turns, tokensIn, tokensOut }
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
  return new Proxy(registry, {
    get(target, prop, receiver) {
      if (prop === 'getOptional') {
        return (name: string) => {
          if (name === 'prompts:service') {
            const realService = target.getOptional<Record<string, unknown>>(name)
            if (!realService) return null
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
