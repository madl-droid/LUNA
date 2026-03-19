// LUNA Engine — Phase 3: Execute Plan
// Router que lee el plan y ejecuta cada paso por tipo.
// Ejecución paralela con Promise.allSettled cuando pasos son independientes.

import pino from 'pino'
import type { Pool } from 'pg'
import type { Redis } from 'ioredis'
import type { Registry } from '../../kernel/registry.js'
import type {
  ContextBundle,
  EvaluatorOutput,
  ExecutionOutput,
  StepResult,
  ExecutionStep,
  EngineConfig,
} from '../types.js'
import type { MemoryManager } from '../../modules/memory/memory-manager.js'
import { executeTool, getDefinition } from '../mocks/tool-registry.js'
import { runSubagent } from '../subagent/subagent.js'
import { callLLMWithFallback } from '../utils/llm-client.js'

const logger = pino({ name: 'engine:phase3' })

/**
 * Execute Phase 3: Run the execution plan from Phase 2.
 */
export async function phase3Execute(
  ctx: ContextBundle,
  evaluation: EvaluatorOutput,
  db: Pool,
  redis: Redis,
  config: EngineConfig,
  registry: Registry,
): Promise<ExecutionOutput> {
  const startMs = Date.now()

  logger.info({
    traceId: ctx.traceId,
    planSteps: evaluation.executionPlan.length,
  }, 'Phase 3 start')

  const { executionPlan } = evaluation

  // If respond_only, skip execution
  if (executionPlan.length === 1 && executionPlan[0]!.type === 'respond_only') {
    const durationMs = Date.now() - startMs
    logger.info({ traceId: ctx.traceId, durationMs }, 'Phase 3 skip (respond_only)')
    return { results: [], allSucceeded: true, partialData: {} }
  }

  // Send acknowledgment if needed (before slow operations)
  if (evaluation.needsAcknowledgment) {
    await sendAcknowledgment(ctx)
  }

  // Group steps by dependency
  const { independent, dependent } = groupStepsByDependency(executionPlan)

  const results: StepResult[] = []

  // Execute independent steps in parallel
  if (independent.length > 0) {
    const parallelResults = await Promise.allSettled(
      independent.map(({ step, index }) =>
        executeStep(step, index, ctx, db, redis, config, registry),
      ),
    )

    for (const settled of parallelResults) {
      if (settled.status === 'fulfilled') {
        results.push(settled.value)
      } else {
        results.push({
          stepIndex: -1,
          type: 'respond_only',
          success: false,
          error: String(settled.reason),
          durationMs: 0,
        })
      }
    }
  }

  // Execute dependent steps sequentially
  for (const { step, index } of dependent) {
    const result = await executeStep(step, index, ctx, db, redis, config, registry)
    results.push(result)
  }

  const allSucceeded = results.every(r => r.success)
  const partialData: Record<string, unknown> = {}
  for (const r of results) {
    if (r.success && r.data) {
      partialData[`step_${r.stepIndex}_${r.type}`] = r.data
    }
  }

  const durationMs = Date.now() - startMs
  logger.info({
    traceId: ctx.traceId,
    durationMs,
    totalSteps: results.length,
    succeeded: results.filter(r => r.success).length,
    failed: results.filter(r => !r.success).length,
  }, 'Phase 3 complete')

  return { results, allSucceeded, partialData }
}

/**
 * Execute a single step based on its type.
 */
async function executeStep(
  step: ExecutionStep,
  index: number,
  ctx: ContextBundle,
  db: Pool,
  _redis: Redis,
  config: EngineConfig,
  registry: Registry,
): Promise<StepResult> {
  const startMs = Date.now()

  try {
    switch (step.type) {
      case 'api_call':
        return await executeApiCall(step, index, startMs, config)

      case 'workflow':
        return await executeWorkflow(step, index, startMs)

      case 'subagent':
        return await executeSubagent(step, index, ctx, config, startMs)

      case 'memory_lookup':
        return await executeMemoryLookup(step, index, db, ctx, registry, startMs)

      case 'web_search':
        return await executeWebSearch(step, index, config, startMs)

      case 'respond_only':
        return {
          stepIndex: index,
          type: 'respond_only',
          success: true,
          durationMs: Date.now() - startMs,
        }

      default:
        return {
          stepIndex: index,
          type: step.type,
          success: false,
          error: `Unknown step type: ${step.type}`,
          durationMs: Date.now() - startMs,
        }
    }
  } catch (err) {
    return {
      stepIndex: index,
      type: step.type,
      success: false,
      error: String(err),
      durationMs: Date.now() - startMs,
    }
  }
}

/**
 * Execute tool via ToolRegistry with 1 retry.
 */
async function executeApiCall(
  step: ExecutionStep,
  index: number,
  startMs: number,
  _config: EngineConfig,
): Promise<StepResult> {
  if (!step.tool) {
    return { stepIndex: index, type: 'api_call', success: false, error: 'No tool specified', durationMs: Date.now() - startMs }
  }

  // First attempt
  let result = await executeTool(step.tool, step.params ?? {})

  // Retry once on failure
  if (!result.success) {
    logger.warn({ tool: step.tool, error: result.error }, 'Tool failed, retrying once')
    result = await executeTool(step.tool, step.params ?? {})
  }

  return {
    stepIndex: index,
    type: 'api_call',
    success: result.success,
    data: result.data,
    error: result.error,
    durationMs: Date.now() - startMs,
  }
}

/**
 * Execute a deterministic workflow.
 */
async function executeWorkflow(
  step: ExecutionStep,
  index: number,
  startMs: number,
): Promise<StepResult> {
  // Workflows are sequences of deterministic steps
  // For now, just execute as a tool call if tool is specified
  if (step.tool) {
    const result = await executeTool(step.tool, step.params ?? {})
    return {
      stepIndex: index,
      type: 'workflow',
      success: result.success,
      data: result.data,
      error: result.error,
      durationMs: Date.now() - startMs,
    }
  }

  return {
    stepIndex: index,
    type: 'workflow',
    success: true,
    data: { description: step.description },
    durationMs: Date.now() - startMs,
  }
}

/**
 * Execute subagent mini-loop.
 */
async function executeSubagent(
  step: ExecutionStep,
  index: number,
  ctx: ContextBundle,
  config: EngineConfig,
  startMs: number,
): Promise<StepResult> {
  // Get tool definitions for allowed tools
  const toolNames = ctx.userPermissions.tools.includes('*')
    ? (step.params?.tools as string[] ?? [])
    : ctx.userPermissions.tools

  const toolDefs = toolNames
    .map(name => getDefinition(name))
    .filter((d): d is NonNullable<typeof d> => d !== null)

  const result = await runSubagent(ctx, step, toolDefs, config)

  return {
    stepIndex: index,
    type: 'subagent',
    success: result.success,
    data: result.data,
    error: result.error,
    durationMs: Date.now() - startMs,
  }
}

/**
 * Execute memory lookup via memory:manager (hybrid search + contact memory).
 * Falls back to direct DB query if memory module is not active.
 */
async function executeMemoryLookup(
  step: ExecutionStep,
  index: number,
  db: Pool,
  ctx: ContextBundle,
  registry: Registry,
  startMs: number,
): Promise<StepResult> {
  const memoryManager = registry.getOptional<MemoryManager>('memory:manager')

  if (memoryManager && ctx.contactId) {
    try {
      const query = step.description ?? (step.params?.query as string) ?? ctx.normalizedText
      const [searchResults, contactMemory] = await Promise.all([
        memoryManager.hybridSearch(ctx.contactId, query, 'es', 5),
        memoryManager.getAgentContact(ctx.agentId, ctx.contactId),
      ])

      return {
        stepIndex: index,
        type: 'memory_lookup',
        success: true,
        data: {
          searchResults,
          contactMemory: contactMemory?.contactMemory ?? null,
          query,
        },
        durationMs: Date.now() - startMs,
      }
    } catch (err) {
      logger.warn({ err, traceId: ctx.traceId }, 'memory:manager lookup failed, falling back to direct DB')
    }
  }

  // Fallback: direct DB query (legacy)
  try {
    const result = await db.query(
      `SELECT id, started_at, last_activity_at, message_count, compressed_summary
       FROM sessions
       WHERE contact_id = $1 AND id != $2
       ORDER BY last_activity_at DESC
       LIMIT 5`,
      [ctx.contactId, ctx.session.id],
    )

    return {
      stepIndex: index,
      type: 'memory_lookup',
      success: true,
      data: { previousSessions: result.rows, query: step.description },
      durationMs: Date.now() - startMs,
    }
  } catch (err) {
    return {
      stepIndex: index,
      type: 'memory_lookup',
      success: false,
      error: String(err),
      durationMs: Date.now() - startMs,
    }
  }
}

/**
 * Execute web search via Gemini Flash with grounding, fallback to Anthropic web_search.
 */
async function executeWebSearch(
  step: ExecutionStep,
  index: number,
  config: EngineConfig,
  startMs: number,
): Promise<StepResult> {
  const query = step.description ?? step.params?.query as string ?? ''
  if (!query) {
    return { stepIndex: index, type: 'web_search', success: false, error: 'No search query', durationMs: Date.now() - startMs }
  }

  try {
    // Try Google Gemini first (grounding)
    const result = await callLLMWithFallback(
      {
        task: 'web_search',
        provider: 'google',
        model: 'gemini-2.5-flash',
        messages: [{ role: 'user', content: `Busca información actualizada sobre: ${query}` }],
        maxTokens: 1024,
        temperature: 0.1,
      },
      'anthropic',
      config.classifyModel,
    )

    return {
      stepIndex: index,
      type: 'web_search',
      success: true,
      data: { searchResult: result.text, provider: result.provider },
      durationMs: Date.now() - startMs,
    }
  } catch (err) {
    return {
      stepIndex: index,
      type: 'web_search',
      success: false,
      error: String(err),
      durationMs: Date.now() - startMs,
    }
  }
}

/**
 * Group steps into independent (can run in parallel) and dependent (must be sequential).
 */
function groupStepsByDependency(steps: ExecutionStep[]): {
  independent: Array<{ step: ExecutionStep; index: number }>
  dependent: Array<{ step: ExecutionStep; index: number }>
} {
  const independent: Array<{ step: ExecutionStep; index: number }> = []
  const dependent: Array<{ step: ExecutionStep; index: number }> = []

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!
    if (step.dependsOn && step.dependsOn.length > 0) {
      dependent.push({ step, index: i })
    } else {
      independent.push({ step, index: i })
    }
  }

  return { independent, dependent }
}

/**
 * Send an acknowledgment message before slow operations.
 */
async function sendAcknowledgment(ctx: ContextBundle): Promise<void> {
  // TODO: wire to registry.runHook('message:send', ...) when integrated
  logger.info({ traceId: ctx.traceId, to: ctx.message.from }, 'Sending acknowledgment')
}
