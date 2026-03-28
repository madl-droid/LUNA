// cortex/alter-ego/tool-sandbox.ts — Hybrid tool execution for simulation
// Read tools execute for real (faithful data), write tools are dry-run (safe).
// Classification: regex on tool name, with per-tool overrides from scenario.

import type { Registry } from '../../../kernel/registry.js'
import type { ExecutionStep, StepResult } from '../../../engine/types.js'
import type { SandboxToolResult, MockToolResult } from './types.js'
import pino from 'pino'

const logger = pino({ name: 'cortex:alter-ego:sandbox' })

// ═══════════════════════════════════════════
// Tool classification: read vs write
// ═══════════════════════════════════════════

const READ_PATTERNS = /^(search_|get_|list_|check_|query_|find_|lookup_|freshdesk_search|freshdesk_get_|search_knowledge)/
const WRITE_PATTERNS = /^(send_|create_|update_|delete_|schedule_|forward_|reply_|set_|cancel_|book_|register_)/

export function classifyTool(
  name: string,
  overrides?: Record<string, 'execute' | 'dry-run'>,
): 'execute' | 'dry-run' {
  if (overrides?.[name]) return overrides[name]!
  if (READ_PATTERNS.test(name)) return 'execute'
  if (WRITE_PATTERNS.test(name)) return 'dry-run'
  return 'dry-run' // safe by default
}

// ═══════════════════════════════════════════
// Execute a single plan step in sandbox mode
// ═══════════════════════════════════════════

interface SandboxContext {
  contactId?: string
  agentId?: string
  traceId?: string
}

export async function executeSandboxStep(
  registry: Registry,
  step: ExecutionStep,
  ctx: SandboxContext,
  toolMode?: Record<string, 'execute' | 'dry-run'>,
  mockResults?: MockToolResult[],
): Promise<SandboxToolResult | null> {
  // Only process steps that have a tool
  if (!step.tool) return null

  const toolName = step.tool
  const params = step.params ?? {}

  // Check for manual mock results first
  const mock = mockResults?.find(m => m.tool === toolName)
  if (mock) {
    return {
      tool: toolName,
      mode: 'dry-run',
      params,
      success: mock.success,
      data: mock.data,
      durationMs: 0,
    }
  }

  const mode = classifyTool(toolName, toolMode)

  if (mode === 'execute') {
    return executeReal(registry, toolName, params, ctx)
  }

  // Dry-run: return synthetic success without executing
  return {
    tool: toolName,
    mode: 'dry-run',
    params,
    success: true,
    data: { _dryRun: true, wouldHaveCalled: toolName, withParams: params },
    durationMs: 0,
  }
}

/**
 * Execute all steps from an execution plan in sandbox mode.
 * Returns StepResult[] compatible with ExecutionOutput + SandboxToolResult[] for analysis.
 */
export async function executeSandboxPlan(
  registry: Registry,
  steps: ExecutionStep[],
  ctx: SandboxContext,
  toolMode?: Record<string, 'execute' | 'dry-run'>,
  mockResults?: MockToolResult[],
): Promise<{
  stepResults: StepResult[]
  sandboxResults: SandboxToolResult[]
  partialData: Record<string, unknown>
}> {
  const stepResults: StepResult[] = []
  const sandboxResults: SandboxToolResult[] = []
  const partialData: Record<string, unknown> = {}

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!
    const start = Date.now()

    if (step.type === 'respond_only') {
      stepResults.push({ stepIndex: i, type: 'respond_only', success: true, durationMs: 0 })
      continue
    }

    if (step.type === 'api_call' && step.tool) {
      const result = await executeSandboxStep(registry, step, ctx, toolMode, mockResults)
      if (result) {
        sandboxResults.push(result)

        // For the compositor: read tools get real data, write tools get synthetic success
        const stepResult: StepResult = {
          stepIndex: i,
          type: 'api_call',
          success: result.success,
          data: result.mode === 'executed' ? result.data : { success: true },
          error: result.error,
          durationMs: result.durationMs,
        }
        stepResults.push(stepResult)

        if (result.success && result.data) {
          partialData[step.tool] = result.data
        }
      }
      continue
    }

    // memory_lookup, web_search → execute real (read-only)
    if (step.type === 'memory_lookup' || step.type === 'web_search') {
      if (step.tool) {
        const result = await executeReal(registry, step.tool, step.params ?? {}, ctx)
        if (result) {
          sandboxResults.push(result)
          stepResults.push({
            stepIndex: i, type: step.type, success: result.success,
            data: result.data, durationMs: result.durationMs,
          })
          if (result.success && result.data && step.tool) {
            partialData[step.tool] = result.data
          }
        }
      }
      continue
    }

    // subagent, process_attachment, code_execution → dry-run
    stepResults.push({
      stepIndex: i,
      type: step.type,
      success: true,
      data: { _simulated: true, type: step.type },
      durationMs: Date.now() - start,
    })
  }

  return { stepResults, sandboxResults, partialData }
}

// ─── Internal ─────────────────────────────

async function executeReal(
  registry: Registry,
  toolName: string,
  params: Record<string, unknown>,
  ctx: SandboxContext,
): Promise<SandboxToolResult> {
  const start = Date.now()
  try {
    const toolsReg = registry.getOptional<{
      executeTool: (name: string, input: Record<string, unknown>, context: unknown) => Promise<{ success: boolean; data?: unknown; error?: string }>
    }>('tools:registry')

    if (!toolsReg) {
      return {
        tool: toolName, mode: 'executed', params,
        success: false, error: 'tools:registry not available',
        durationMs: Date.now() - start,
      }
    }

    const result = await toolsReg.executeTool(toolName, params, ctx)
    return {
      tool: toolName,
      mode: 'executed',
      params,
      success: result.success,
      data: result.data,
      error: result.error,
      durationMs: Date.now() - start,
    }
  } catch (err) {
    logger.warn({ err, toolName }, 'Tool execution failed in sandbox')
    return {
      tool: toolName, mode: 'executed', params,
      success: false, error: err instanceof Error ? err.message : 'Unknown error',
      durationMs: Date.now() - start,
    }
  }
}
