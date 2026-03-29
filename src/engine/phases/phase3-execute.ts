// LUNA Engine — Phase 3: Execute Plan (v2)
// Router que lee el plan y ejecuta cada paso por tipo.
// Concurrencia controlada via StepSemaphore. Soporta process_attachment.

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
import { runSubagent } from '../subagent/subagent.js'
import { callLLMWithFallback } from '../utils/llm-client.js'
import { StepSemaphore } from '../concurrency/step-semaphore.js'
import { processAttachments, buildFallbackMessages } from '../attachments/processor.js'
import type { AttachmentEngineConfig, ChannelAttachmentConfig } from '../attachments/types.js'

const logger = pino({ name: 'engine:phase3' })

// FIX: E-10 — Use real tool registry when available, fail explicitly in production
interface RealToolRegistry {
  executeTool(name: string, input: Record<string, unknown>, context: unknown): Promise<{ success: boolean; data?: unknown; error?: string }>
  getEnabledToolDefinitions(contactType?: string): Array<{ name: string; description: string; parameters: Record<string, unknown> }>
}

function getToolRegistry(registry: Registry): RealToolRegistry | null {
  return registry.getOptional<RealToolRegistry>('tools:registry')
}

async function executeTool(
  toolName: string,
  params: Record<string, unknown>,
  registry: Registry,
  ctx?: { contactId?: string; agentId?: string; traceId?: string },
): Promise<{ success: boolean; data?: unknown; error?: string }> {
  const real = getToolRegistry(registry)
  if (real) {
    return real.executeTool(toolName, params, ctx ?? {})
  }
  // No real registry available — fail explicitly
  logger.error({ toolName }, 'Tool execution requested but tools module is not active')
  return { success: false, error: `Tool "${toolName}" unavailable: tools module not active` }
}

function getDefinition(
  toolName: string,
  registry: Registry,
): { name: string; description: string; parameters: Record<string, unknown> } | null {
  const real = getToolRegistry(registry)
  if (real) {
    const defs = real.getEnabledToolDefinitions()
    return defs.find(d => d.name === toolName) ?? null
  }
  return null
}

/**
 * Count steps in the plan that require sequential LLM calls.
 * Used to determine if the plan is "complex" (3+ LLM steps → Opus)
 * or "simple" (≤2 LLM steps → Sonnet).
 *
 * LLM-requiring step types: subagent, web_search, code_execution
 * Deterministic (no LLM): api_call, workflow, memory_lookup, process_attachment, respond_only
 */
function countLLMSteps(plan: ExecutionStep[]): number {
  const llmTypes = new Set(['subagent', 'web_search', 'code_execution'])
  return plan.filter(s => llmTypes.has(s.type)).length
}

/** Threshold: plans with this many LLM steps or more are "complex" */
const COMPLEX_PLAN_THRESHOLD = 3

/**
 * Execute Phase 3: Run the execution plan from Phase 2.
 * Steps run with concurrency controlled by StepSemaphore.
 *
 * Plan complexity routing:
 * - Simple plans (≤2 LLM steps): LLM calls in steps use task 'tools' → Sonnet
 * - Complex plans (3+ LLM steps): LLM calls in steps use task 'complex' → Opus
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

  const { executionPlan } = evaluation
  const llmStepCount = countLLMSteps(executionPlan)
  const isComplexPlan = llmStepCount >= COMPLEX_PLAN_THRESHOLD

  logger.info({
    traceId: ctx.traceId,
    planSteps: executionPlan.length,
    llmSteps: llmStepCount,
    complexity: isComplexPlan ? 'complex' : 'simple',
  }, 'Phase 3 start')

  // If respond_only, skip execution
  if (executionPlan.length === 1 && executionPlan[0]!.type === 'respond_only') {
    const durationMs = Date.now() - startMs
    logger.info({ traceId: ctx.traceId, durationMs }, 'Phase 3 skip (respond_only)')
    return { results: [], allSucceeded: true, partialData: {} }
  }

  // Group steps by dependency
  const { independent, dependent } = groupStepsByDependency(executionPlan)

  const results: StepResult[] = []
  const stepSemaphore = new StepSemaphore(config.maxConcurrentSteps)

  // Execute independent steps in parallel (concurrency-limited)
  if (independent.length > 0) {
    const parallelResults = await Promise.allSettled(
      independent.map(({ step, index }) =>
        stepSemaphore.run(() =>
          executeStep(step, index, ctx, db, redis, config, registry, isComplexPlan),
        ),
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

  // Execute dependent steps sequentially (still through semaphore for resource control)
  for (const { step, index } of dependent) {
    // Check if all dependencies succeeded before executing
    const depsFailed = step.dependsOn?.some(depIdx => {
      const depResult = results.find(r => r.stepIndex === depIdx)
      return depResult && !depResult.success
    })

    if (depsFailed) {
      results.push({
        stepIndex: index,
        type: step.type,
        success: false,
        error: `Skipped: dependency step(s) [${step.dependsOn!.join(', ')}] failed`,
        durationMs: 0,
      })
      continue
    }

    const result = await stepSemaphore.run(() =>
      executeStep(step, index, ctx, db, redis, config, registry, isComplexPlan),
    )
    results.push(result)
  }

  const allSucceeded = results.every(r => r.success)
  const partialData: Record<string, unknown> = {}
  for (const r of results) {
    if (r.success && r.data) {
      partialData[`step_${r.stepIndex}_${r.type}`] = r.data
    }
  }

  // If attachments were processed, update ctx.attachmentContext for Phase 4
  for (const r of results) {
    if (r.type === 'process_attachment' && r.success && r.data) {
      const attData = r.data as { attachmentContext: import('../attachments/types.js').AttachmentContext }
      if (attData.attachmentContext) {
        ctx.attachmentContext = attData.attachmentContext
      }
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
  redis: Redis,
  config: EngineConfig,
  registry: Registry,
  isComplexPlan = false,
): Promise<StepResult> {
  const startMs = Date.now()
  // LLM task type for steps: 'complex' (Opus) for complex plans, 'tools' (Sonnet) for simple
  const stepLlmTask = isComplexPlan ? 'complex' : 'tools'

  try {
    switch (step.type) {
      case 'api_call':
        return await executeApiCall(step, index, startMs, config, registry, { contactId: ctx.contactId ?? undefined, agentId: ctx.agentId, traceId: ctx.traceId })

      case 'workflow':
        return await executeWorkflow(step, index, startMs, registry)

      case 'subagent':
        return await executeSubagent(step, index, ctx, config, startMs, registry)

      case 'memory_lookup':
        return await executeMemoryLookup(step, index, db, ctx, registry, startMs)

      case 'web_search':
        return await executeWebSearch(step, index, config, startMs)

      case 'process_attachment':
        return await executeProcessAttachment(step, index, ctx, db, redis, config, registry, startMs)

      case 'code_execution':
        return await executeCodeExecution(step, index, config, startMs, stepLlmTask)

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
  registry: Registry,
  ctx?: { contactId?: string; agentId?: string; traceId?: string },
): Promise<StepResult> {
  if (!step.tool) {
    return { stepIndex: index, type: 'api_call', success: false, error: 'No tool specified', durationMs: Date.now() - startMs }
  }

  // First attempt
  let result = await executeTool(step.tool, step.params ?? {}, registry, ctx)

  // Retry once on failure
  if (!result.success) {
    logger.warn({ tool: step.tool, error: result.error }, 'Tool failed, retrying once')
    result = await executeTool(step.tool, step.params ?? {}, registry, ctx)
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
  registry: Registry,
): Promise<StepResult> {
  if (step.tool) {
    const result = await executeTool(step.tool, step.params ?? {}, registry)
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
  registry: Registry,
): Promise<StepResult> {
  const toolNames = ctx.userPermissions.tools.includes('*')
    ? (step.params?.tools as string[] ?? [])
    : ctx.userPermissions.tools

  const toolDefs = toolNames
    .map(name => getDefinition(name, registry))
    .filter((d): d is NonNullable<typeof d> => d !== null)

  const result = await runSubagent(ctx, step, toolDefs, config, registry)

  return {
    stepIndex: index,
    type: 'subagent',
    success: result.success,
    data: { result: result.data, iterations: result.iterations, tokensUsed: result.tokensUsed },
    error: result.error,
    durationMs: Date.now() - startMs,
  }
}

/**
 * Execute memory lookup via memory:manager (hybrid search + contact memory).
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
      `SELECT s.id, s.started_at, s.last_activity_at, s.message_count,
              ss.summary_text AS compressed_summary
       FROM sessions s
       LEFT JOIN LATERAL (
         SELECT summary_text FROM session_summaries
         WHERE session_id = s.id ORDER BY created_at DESC LIMIT 1
       ) ss ON true
       WHERE s.contact_id = $1 AND s.id != $2
       ORDER BY s.last_activity_at DESC
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
 * Execute web search via Gemini Flash with grounding, fallback to Anthropic.
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
    const result = await callLLMWithFallback(
      {
        task: 'web_search',
        provider: 'google',
        model: 'gemini-2.5-flash',
        messages: [{ role: 'user', content: `Busca información actualizada sobre: ${query}` }],
        maxTokens: 1024,
        temperature: 0.1,
        googleSearchGrounding: true, // Use native Google Search grounding for real-time results
      },
      'anthropic',
      config.classifyModel,
    )

    return {
      stepIndex: index,
      type: 'web_search',
      success: true,
      data: {
        searchResult: result.text,
        provider: result.provider,
        sources: result.groundingMetadata?.sources,
      },
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
 * Execute code via LLM's built-in code execution sandbox (Python).
 * Phase 2 decides when to use this (e.g. math calculations, data analysis).
 */
async function executeCodeExecution(
  step: ExecutionStep,
  index: number,
  config: EngineConfig,
  startMs: number,
  llmTask = 'tools',
): Promise<StepResult> {
  const task = step.description ?? step.params?.task as string ?? ''
  if (!task) {
    return { stepIndex: index, type: 'code_execution', success: false, error: 'No task description', durationMs: Date.now() - startMs }
  }

  try {
    const result = await callLLMWithFallback(
      {
        task: llmTask,
        messages: [{ role: 'user', content: `Ejecuta código Python para: ${task}` }],
        maxTokens: 2048,
        temperature: 0.1,
        codeExecution: true,
        thinking: step.useThinking ? { type: 'adaptive', budgetTokens: 4096 } : undefined,
      },
      config.fallbackClassifyProvider,
      config.fallbackClassifyModel,
    )

    return {
      stepIndex: index,
      type: 'code_execution',
      success: true,
      data: {
        text: result.text,
        codeResults: result.codeResults,
        provider: result.provider,
      },
      durationMs: Date.now() - startMs,
    }
  } catch (err) {
    return {
      stepIndex: index,
      type: 'code_execution',
      success: false,
      error: String(err),
      durationMs: Date.now() - startMs,
    }
  }
}

/**
 * Process attachments (downloads, extraction, transcription, summarization).
 * This is the heavy processing that was previously in Phase 1.
 * Now runs as a Phase 3 step so it can be planned by the evaluator.
 */
async function executeProcessAttachment(
  _step: ExecutionStep,
  index: number,
  ctx: ContextBundle,
  db: Pool,
  redis: Redis,
  config: EngineConfig,
  registry: Registry,
  startMs: number,
): Promise<StepResult> {
  const message = ctx.message
  if (!message.attachments?.length) {
    return { stepIndex: index, type: 'process_attachment', success: true, data: { attachmentContext: null }, durationMs: Date.now() - startMs }
  }

  try {
    const channelAttConfig = getChannelAttachmentConfig(registry, message.channelName)
    const attEngineConfig = getAttachmentEngineConfig(registry, config)

    const attachmentContext = await processAttachments(
      message.attachments,
      ctx.normalizedText,
      channelAttConfig,
      attEngineConfig,
      message.channelName,
      ctx.session.id,
      message.id,
      registry,
      db,
      redis,
    )

    // Build fallback messages for disabled/failed attachments
    const fallbacks = buildFallbackMessages(attachmentContext.attachments, channelAttConfig)
    attachmentContext.fallbackMessages.push(...fallbacks)

    return {
      stepIndex: index,
      type: 'process_attachment',
      success: true,
      data: {
        attachmentContext,
        processedCount: attachmentContext.attachments.length,
        totalTokens: attachmentContext.totalTokens,
      },
      durationMs: Date.now() - startMs,
    }
  } catch (err) {
    logger.warn({ err, traceId: ctx.traceId }, 'Attachment processing failed in Phase 3')
    return {
      stepIndex: index,
      type: 'process_attachment',
      success: false,
      error: String(err),
      durationMs: Date.now() - startMs,
    }
  }
}

// ─── Helpers ──────────────────────────────

/** Default attachment config when no channel-specific config exists */
const DEFAULT_ATTACHMENT_CONFIG: ChannelAttachmentConfig = {
  enabledCategories: ['documents', 'images', 'text'],
  maxFileSizeMb: 25,
  maxAttachmentsPerMessage: 10,
}

function getChannelAttachmentConfig(registry: Registry, channel: string): ChannelAttachmentConfig {
  const svc = registry.getOptional<{ get(): { attachments?: ChannelAttachmentConfig } }>(`channel-config:${channel}`)
  if (svc) {
    const config = svc.get().attachments
    if (config) return config
  }
  return DEFAULT_ATTACHMENT_CONFIG
}

function getAttachmentEngineConfig(registry: Registry, fallback: EngineConfig): AttachmentEngineConfig {
  const svc = registry.getOptional<{ get(): AttachmentEngineConfig }>('engine:attachment-config')
  if (svc) return svc.get()
  return {
    enabled: fallback.attachmentEnabled,
    smallDocTokens: fallback.attachmentSmallDocTokens,
    mediumDocTokens: fallback.attachmentMediumDocTokens,
    summaryMaxTokens: fallback.attachmentSummaryMaxTokens,
    cacheTtlMs: fallback.attachmentCacheTtlMs,
    urlFetchTimeoutMs: fallback.attachmentUrlFetchTimeoutMs,
    urlMaxSizeMb: fallback.attachmentUrlMaxSizeMb,
    urlEnabled: fallback.attachmentUrlEnabled,
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
