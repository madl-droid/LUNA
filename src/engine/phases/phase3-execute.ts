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
import type { CheckpointManager } from '../checkpoints/checkpoint-manager.js'
import type { MemoryManager } from '../../modules/memory/memory-manager.js'
import { runSubagent, runSubagentV2 } from '../subagent/subagent.js'
import type { SubagentCatalogEntry, RecordSubagentUsage } from '../../modules/subagents/types.js'
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

/** Options for checkpoint-aware Phase 3 execution */
export interface Phase3Options {
  /** Checkpoint manager for persisting step results */
  checkpointManager?: CheckpointManager
  /** Checkpoint ID for this pipeline execution */
  checkpointId?: string
  /** Already-completed step results from a previous (crashed) run */
  completedSteps?: StepResult[]
}

/**
 * Count steps in the plan that require sequential LLM calls.
 * Used to determine if the plan is "complex" (3+ LLM steps → Opus)
 * or "simple" (≤2 LLM steps → Sonnet).
 *
 * LLM-requiring step types: subagent, web_search, code_execution
 * Deterministic (no LLM): api_call, workflow, memory_lookup, process_attachment, respond_only
 */
/** LLM step types that count for complexity routing */
const LLM_STEP_TYPES = new Set(['subagent', 'web_search', 'code_execution'])

/** Threshold: plans with this many LLM steps or more are "complex" */
export const COMPLEX_PLAN_THRESHOLD = 3

export function countLLMSteps(plan: ExecutionStep[]): number {
  return plan.filter(s => LLM_STEP_TYPES.has(s.type)).length
}

/** Check if an evaluation plan is complex (3+ LLM steps) */
export function isComplexPlan(evaluation: EvaluatorOutput): boolean {
  const llmSteps = evaluation.executionPlan.filter(s => LLM_STEP_TYPES.has(s.type)).length
  return llmSteps >= COMPLEX_PLAN_THRESHOLD
}

/**
 * Execute Phase 3: Run the execution plan from Phase 2.
 * Steps run with concurrency controlled by StepSemaphore.
 * If checkpoint options are provided, skips already-completed steps and persists new results.
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
  opts?: Phase3Options,
): Promise<ExecutionOutput> {
  const startMs = Date.now()
  const cpMgr = opts?.checkpointManager
  const cpId = opts?.checkpointId

  const { executionPlan } = evaluation
  const llmStepCount = countLLMSteps(executionPlan)
  const planIsComplex = llmStepCount >= COMPLEX_PLAN_THRESHOLD
  const stepLlmTask = planIsComplex ? 'complex' : 'tools'

  logger.info({
    traceId: ctx.traceId,
    planSteps: executionPlan.length,
    llmSteps: llmStepCount,
    complexity: planIsComplex ? 'complex' : 'simple',
    resumingSteps: opts?.completedSteps?.length ?? 0,
  }, 'Phase 3 start')

  // If respond_only, skip execution
  if (executionPlan.length === 1 && executionPlan[0]!.type === 'respond_only') {
    const durationMs = Date.now() - startMs
    logger.info({ traceId: ctx.traceId, durationMs }, 'Phase 3 skip (respond_only)')
    return { results: [], allSucceeded: true, partialData: {} }
  }

  // Build set of already-completed step indices (from checkpoint resume).
  // Only trust a completed step if the plan step at that index has the same type —
  // if Phase 2 generated a different plan on resume, indices may not correspond.
  const { validIndices: completedIndices, validSteps: validCompletedSteps } =
    validateCompletedSteps(executionPlan, opts?.completedSteps ?? [])
  for (const sr of opts?.completedSteps ?? []) {
    const planStep = executionPlan[sr.stepIndex]
    if (!(planStep && planStep.type === sr.type && (planStep.tool ?? undefined) === (sr.tool ?? undefined))) {
      logger.warn({
        traceId: ctx.traceId,
        stepIndex: sr.stepIndex,
        expectedType: planStep?.type,
        expectedTool: planStep?.tool,
        actualType: sr.type,
        actualTool: sr.tool,
      }, 'Discarding mismatched completed step from checkpoint')
    }
  }

  // Group steps by dependency
  const { independent, dependent } = groupStepsByDependency(executionPlan)

  const results: StepResult[] = [...validCompletedSteps]
  const stepSemaphore = new StepSemaphore(config.maxConcurrentSteps)

  // Helper: execute step with checkpoint persistence
  async function executeWithCheckpoint(step: ExecutionStep, index: number): Promise<StepResult> {
    // Skip if already completed in a previous run
    if (completedIndices.has(index)) {
      const prev = results.find(r => r.stepIndex === index)
      if (prev) return prev
    }

    const result = await executeStep(step, index, ctx, db, redis, config, registry, stepLlmTask)

    // Persist step result to checkpoint (fire-and-forget, never blocks)
    if (cpMgr && cpId) {
      cpMgr.appendStep(cpId, result).catch(err =>
        logger.warn({ err, checkpointId: cpId, stepIndex: index }, 'Failed to save step checkpoint'),
      )
    }

    return result
  }

  // Execute independent steps in parallel (concurrency-limited)
  if (independent.length > 0) {
    // Filter out already-completed independent steps
    const toRun = independent.filter(({ index }) => !completedIndices.has(index))

    const parallelResults = await Promise.allSettled(
      toRun.map(({ step, index }) =>
        stepSemaphore.run(() => executeWithCheckpoint(step, index)),
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
    // Skip if already completed in a previous run
    if (completedIndices.has(index)) continue

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

    const result = await stepSemaphore.run(() => executeWithCheckpoint(step, index))
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
  llmTask = 'tools',
): Promise<StepResult> {
  const startMs = Date.now()

  try {
    let result: StepResult

    switch (step.type) {
      case 'api_call':
        result = await executeApiCall(step, index, startMs, config, registry, { contactId: ctx.contactId ?? undefined, agentId: ctx.agentId, traceId: ctx.traceId })
        break

      case 'workflow':
        result = await executeWorkflow(step, index, startMs, registry)
        break

      case 'subagent':
        result = await executeSubagent(step, index, ctx, config, startMs, registry, llmTask)
        break

      case 'memory_lookup':
        result = await executeMemoryLookup(step, index, db, ctx, registry, startMs)
        break

      case 'web_search': {
        // Auto-route to web-researcher subagent if available and enabled
        const webCatalog = registry?.getOptional<{ getBySlug(slug: string): { slug: string } | null }>('subagents:catalog')
        const webResearcher = webCatalog?.getBySlug('web-researcher')
        if (webResearcher) {
          const webStep: ExecutionStep = {
            ...step,
            type: 'subagent',
            subagentSlug: 'web-researcher',
            description: step.description ?? (step.params?.query as string) ?? '',
          }
          result = await executeSubagent(webStep, index, ctx, config, startMs, registry, llmTask)
        } else {
          // Fallback: legacy direct web search (no subagent module or web-researcher disabled)
          result = await executeWebSearch(step, index, config, startMs, llmTask)
        }
        break
      }

      case 'process_attachment':
        result = await executeProcessAttachment(step, index, ctx, db, redis, config, registry, startMs)
        break

      case 'code_execution':
        result = await executeCodeExecution(step, index, config, startMs, llmTask)
        break

      case 'respond_only':
        result = {
          stepIndex: index,
          type: 'respond_only',
          success: true,
          durationMs: Date.now() - startMs,
        }
        break

      default:
        result = {
          stepIndex: index,
          type: step.type,
          success: false,
          error: `Unknown step type: ${step.type}`,
          durationMs: Date.now() - startMs,
        }
    }

    // Attach tool name to result for checkpoint step validation
    if (step.tool) result.tool = step.tool
    return result
  } catch (err) {
    return {
      stepIndex: index,
      type: step.type,
      tool: step.tool,
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
 * Execute subagent v2 (catalog-based with verification and spawn).
 * Falls back to legacy runSubagent if subagents module is not active.
 */
async function executeSubagent(
  step: ExecutionStep,
  index: number,
  ctx: ContextBundle,
  config: EngineConfig,
  startMs: number,
  registry: Registry,
  llmTask = 'tools',
): Promise<StepResult> {
  const toolNames = ctx.userPermissions.tools.includes('*')
    ? (step.params?.tools as string[] ?? [])
    : ctx.userPermissions.tools

  const toolDefs = toolNames
    .map(name => getDefinition(name, registry))
    .filter((d): d is NonNullable<typeof d> => d !== null)

  // Check if subagents catalog is available (module active)
  const catalog = registry.getOptional<{
    getBySlug(slug: string): SubagentCatalogEntry | null
    recordUsage(record: RecordSubagentUsage): Promise<void>
  }>('subagents:catalog')

  if (catalog && step.subagentSlug) {
    // v2 path: catalog-based subagent with verification + spawn
    const result = await runSubagentV2(ctx, step, toolDefs, config, registry)

    // Record usage for metrics
    try {
      const entry = catalog.getBySlug(step.subagentSlug)
      await catalog.recordUsage({
        subagentTypeId: entry?.id ?? null,
        subagentSlug: step.subagentSlug,
        traceId: ctx.traceId,
        iterations: result.iterations,
        tokensUsed: result.tokensUsed,
        durationMs: result.durationMs,
        success: result.success,
        verified: !!result.verification,
        verificationVerdict: result.verification?.verdict,
        childSpawned: result.childSpawned,
        costUsd: result.costUsd,
        error: result.error,
      })
    } catch (err) {
      logger.warn({ err, traceId: ctx.traceId }, 'Failed to record subagent usage')
    }

    return {
      stepIndex: index,
      type: 'subagent',
      success: result.success,
      data: {
        result: result.data,
        iterations: result.iterations,
        tokensUsed: result.tokensUsed,
        subagentSlug: result.subagentSlug,
        verification: result.verification,
        childSpawned: result.childSpawned,
      },
      error: result.error,
      durationMs: Date.now() - startMs,
    }
  }

  // Legacy fallback: no catalog module
  const result = await runSubagent(ctx, step, toolDefs, config, registry, llmTask)

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
  _llmTask = 'tools', // accepted for consistency but web_search always uses its own task (needs grounding)
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
 * Validate which completed steps from a previous run can be trusted for the current plan.
 * A step is valid if the plan step at that index has the same type and tool.
 */
export function validateCompletedSteps(
  executionPlan: ExecutionStep[],
  completedSteps: StepResult[],
): { validIndices: Set<number>; validSteps: StepResult[]; discarded: number } {
  const validIndices = new Set<number>()
  const validSteps: StepResult[] = []
  let discarded = 0

  for (const sr of completedSteps) {
    const planStep = executionPlan[sr.stepIndex]
    if (planStep && planStep.type === sr.type && (planStep.tool ?? undefined) === (sr.tool ?? undefined)) {
      validIndices.add(sr.stepIndex)
      validSteps.push(sr)
    } else {
      discarded++
    }
  }

  return { validIndices, validSteps, discarded }
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
