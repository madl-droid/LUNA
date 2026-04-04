// LUNA Engine — Subagent v2.1
// Loop principal con verificación iterativa (max 3 retries con conversación continua),
// spawn recursivo (1 nivel), guardrails soft/hard, y Google Search Grounding.

import pino from 'pino'
import type { Registry } from '../../kernel/registry.js'
import type {
  ContextBundle,
  ExecutionStep,
  EngineConfig,
  ToolDefinition,
} from '../types.js'
import type { SubagentResultV2, SubagentRunConfig } from './types.js'
import { SUBAGENT_HARD_LIMITS } from './types.js'
import { buildGuardrails, checkGuardrails } from './guardrails.js'
import { verifySubagentResult } from './verifier.js'
import { buildSubagentPrompt } from '../prompts/subagent.js'
import { callLLM } from '../utils/llm-client.js'
import { SKILL_READ_TOOL_NAME, executeSkillReadTool } from '../agentic/skill-delegation.js'
import { loadSkillCatalog } from '../prompts/skills.js'
import type { SubagentCatalogEntry } from '../../modules/subagents/types.js'

const logger = pino({ name: 'engine:subagent' })

// ── Tool executor interface ──
interface ToolExecutor {
  executeTool(name: string, input: Record<string, unknown>, ctx: unknown): Promise<{ success: boolean; data?: unknown; error?: string }>
}

// ── Catalog service interface ──
interface SubagentCatalog {
  getEnabledTypes(): SubagentCatalogEntry[]
  getBySlug(slug: string): SubagentCatalogEntry | null
}

// ── Retry context for iterative verification ──
interface RetryContext {
  /** Full conversation from the previous attempt */
  previousMessages: Array<{ role: 'user' | 'assistant'; content: string }>
  /** The result data from the previous attempt */
  previousResult: unknown
  /** Verifier's feedback on what to improve */
  feedback?: string
  /** Specific issues found by the verifier */
  issues?: string[]
  /** Which retry attempt this is (1-based) */
  attempt: number
}

/**
 * Build a minimal context for subagent execution.
 * Keeps identity and permissions but strips history, knowledge matches,
 * buffer summary, and relevant summaries to prevent context bloat.
 * The subagent gets a clean slate focused on its specific task.
 */
function buildSubagentContext(
  parentCtx: ContextBundle,
  taskDescription: string,
  freshContext: boolean,
): ContextBundle {
  if (!freshContext) {
    return {
      ...parentCtx,
      knowledgeMatches: [...parentCtx.knowledgeMatches],
      freshdeskMatches: [...parentCtx.freshdeskMatches],
      assignmentRules: parentCtx.assignmentRules ? [...parentCtx.assignmentRules] : null,
      history: [...parentCtx.history],
      pendingCommitments: [...parentCtx.pendingCommitments],
      relevantSummaries: [...parentCtx.relevantSummaries],
      attachmentMeta: [...parentCtx.attachmentMeta],
      normalizedText: taskDescription,
      messageType: 'text',
      responseFormat: 'text',
    }
  }

  return {
    // Original message — keep for traceId and channel info
    message: parentCtx.message,
    traceId: parentCtx.traceId,

    // Identity — keep all
    userType: parentCtx.userType,
    userPermissions: parentCtx.userPermissions,
    contactId: parentCtx.contactId,

    // Contact & session — keep for identity context
    contact: parentCtx.contact,
    session: parentCtx.session,
    isNewContact: parentCtx.isNewContact,

    // Campaign — keep (may be relevant to subagent task)
    campaign: parentCtx.campaign,

    // RAG and knowledge — STRIP (subagent searches its own if needed)
    knowledgeMatches: [],
    knowledgeInjection: null,
    freshdeskMatches: [],

    // Assignment rules — STRIP
    assignmentRules: null,

    // History — STRIP (clean slate)
    history: [],

    // Buffer summary — STRIP
    bufferSummary: null,

    // Memory — STRIP (subagent can use tools to query memory if needed)
    contactMemory: null,
    pendingCommitments: [],
    relevantSummaries: [],
    leadStatus: parentCtx.leadStatus,

    // Normalized text — replace with task description
    normalizedText: taskDescription,
    messageType: 'text',

    // Response format — always text for subagents
    responseFormat: 'text',

    // Attachments — STRIP (subagent doesn't process parent's attachments)
    attachmentMeta: [],
    attachmentContext: null,

    // Injection — inherit from parent
    possibleInjection: parentCtx.possibleInjection,

    // HITL — STRIP
    hitlPendingContext: null,
  }
}

/**
 * Resolve the run config for a subagent execution.
 * Maps catalog entry + engine config → SubagentRunConfig.
 */
function resolveRunConfig(
  entry: SubagentCatalogEntry,
  config: EngineConfig,
  step: ExecutionStep,
  isChild: boolean,
): SubagentRunConfig {
  // Model tier: 'normal' = classifyModel (Phase 2), 'complex' = complexModel
  const isComplex = entry.modelTier === 'complex' || step.useThinking === true
  const model = isComplex ? config.complexModel : config.classifyModel
  const provider = isComplex ? config.complexProvider : config.classifyProvider

  return {
    entry,
    model,
    provider,
    temperature: 0.1,
    maxOutputTokens: 2048,
    useThinking: isComplex,
    thinkingBudget: 4096,
    useGrounding: entry.googleSearchGrounding === true,
    guardrails: buildGuardrails(entry.tokenBudget, entry.allowedTools),
    isChild,
  }
}

/**
 * Run a subagent from the catalog.
 * Resolves the subagent type, builds config, runs the loop with iterative verification.
 */
export async function runSubagentV2(
  ctx: ContextBundle,
  step: ExecutionStep,
  toolDefs: ToolDefinition[],
  config: EngineConfig,
  registry: Registry,
  isChild = false,
): Promise<SubagentResultV2> {
  const slug = step.subagentSlug ?? 'default'
  const startMs = Date.now()

  // Resolve catalog entry
  const catalog = registry.getOptional<SubagentCatalog>('subagents:catalog')
  const entry = catalog?.getBySlug(slug) ?? null

  if (!entry) {
    logger.warn({ slug, traceId: ctx.traceId }, 'Subagent type not found in catalog')
    return {
      success: false,
      iterations: 0,
      tokensUsed: 0,
      durationMs: Date.now() - startMs,
      subagentSlug: slug,
      softLimitsHit: [],
      childSpawned: false,
      costUsd: 0,
      error: `Subagent type "${slug}" not found or disabled`,
    }
  }

  const runConfig = resolveRunConfig(entry, config, step, isChild)

  // Filter tool definitions to only allowed tools
  const filteredTools = entry.allowedTools.length > 0
    ? toolDefs.filter(t => entry.allowedTools.includes(t.name))
    : toolDefs

  interface SubagentModuleConfig {
    SUBAGENT_FRESH_CONTEXT: boolean
  }
  const subagentModuleConfig = registry.getConfig<SubagentModuleConfig>('subagents')
  const freshContext = subagentModuleConfig.SUBAGENT_FRESH_CONTEXT ?? true

  // Build subagent context according to console toggle
  const taskDescription = step.description ?? 'Execute task'
  const subagentCtx = buildSubagentContext(ctx, taskDescription, freshContext)

  // Run the main loop (first attempt) with minimal context
  let result = await runSubagentLoop(subagentCtx, step, filteredTools, config, runConfig, registry)

  // ── Iterative verification (max MAX_VERIFY_RETRIES retries with conversation continuity) ──
  if (entry.verifyResult && result.success) {
    let retryCount = 0
    const taskDescription = step.description ?? 'Ejecutar tarea'

    while (retryCount < SUBAGENT_HARD_LIMITS.MAX_VERIFY_RETRIES) {
      const verification = await verifySubagentResult(
        taskDescription,
        result.data,
        result.success,
        config,
        retryCount,
        registry,
      )

      result.verification = verification
      result.tokensUsed += verification.tokensUsed

      if (verification.verdict === 'accept') {
        break
      }

      if (verification.verdict === 'fail') {
        logger.warn({
          traceId: ctx.traceId,
          slug,
          retryCount,
          feedback: verification.feedback,
          issues: verification.issues,
        }, 'Verifier failed the result')
        result.success = false
        result.error = verification.feedback ?? 'Verification failed'
        break
      }

      // verdict === 'retry' → continue conversation with feedback
      retryCount++
      logger.info({
        traceId: ctx.traceId,
        slug,
        retryCount,
        maxRetries: SUBAGENT_HARD_LIMITS.MAX_VERIFY_RETRIES,
        feedback: verification.feedback,
      }, 'Verifier requested retry — continuing conversation')

      const retryResult = await runSubagentLoop(
        subagentCtx, step, filteredTools, config, runConfig, registry,
        {
          previousMessages: result.conversationHistory ?? [],
          previousResult: result.data,
          feedback: verification.feedback,
          issues: verification.issues,
          attempt: retryCount,
        },
      )

      // Merge metrics cumulatively
      result = {
        ...retryResult,
        iterations: result.iterations + retryResult.iterations,
        tokensUsed: result.tokensUsed + retryResult.tokensUsed,
        softLimitsHit: [...result.softLimitsHit, ...retryResult.softLimitsHit],
        childSpawned: result.childSpawned || retryResult.childSpawned,
        childResults: [...(result.childResults ?? []), ...(retryResult.childResults ?? [])],
        costUsd: result.costUsd + retryResult.costUsd,
        retryAttempt: retryCount,
      }

      // If the retry itself failed, don't try to verify again
      if (!result.success) break
    }
  }

  result.durationMs = Date.now() - startMs
  return result
}

/**
 * Core subagent loop: LLM + tool calling with guardrails.
 * Supports iterative retry: when retryContext is provided, the loop continues
 * the previous conversation instead of starting from scratch.
 */
async function runSubagentLoop(
  ctx: ContextBundle,
  step: ExecutionStep,
  toolDefs: ToolDefinition[],
  config: EngineConfig,
  runConfig: SubagentRunConfig,
  registry: Registry,
  retryContext?: RetryContext,
): Promise<SubagentResultV2> {
  const startMs = Date.now()
  const { guardrails, entry } = runConfig

  logger.info({
    traceId: ctx.traceId,
    slug: entry.slug,
    model: runConfig.model,
    tools: toolDefs.map(t => t.name),
    isChild: runConfig.isChild,
    isRetry: !!retryContext,
    retryAttempt: retryContext?.attempt,
    useGrounding: runConfig.useGrounding,
  }, 'Subagent loop starting')

  // Build prompt
  const { system, userMessage, tools } = await buildSubagentPrompt(ctx, step, toolDefs, registry, entry)

  // Add spawn_subagent tool if allowed and not a child
  const allTools = [...tools]
  if (entry.canSpawnChildren && !runConfig.isChild) {
    allTools.push({
      name: 'spawn_subagent',
      description: 'Crea un sub-subagente para dividir trabajo complejo. SOLO usar si la tarea es demasiado compleja o larga para completarla tú mismo. Para tareas simples, resuélvelas directamente.',
      inputSchema: {
        type: 'object',
        properties: {
          subagent_slug: {
            type: 'string',
            description: 'Slug del tipo de subagente a crear (de los disponibles en el catálogo)',
          },
          task: {
            type: 'string',
            description: 'Descripción clara de la sub-tarea que debe completar el hijo',
          },
          tools: {
            type: 'array',
            items: { type: 'string' },
            description: 'Lista de nombres de tools que el hijo necesita (subset de tus tools)',
          },
        },
        required: ['subagent_slug', 'task'],
      },
    })
  }

  // Add skill_read meta-tool if 'skill_read' is in allowed tools
  if (entry.allowedTools.includes(SKILL_READ_TOOL_NAME)) {
    const skills = await loadSkillCatalog(registry, ctx.userType)
    const skillNames = skills.map(s => s.name)
    if (skillNames.length > 0) {
      allTools.push({
        name: SKILL_READ_TOOL_NAME,
        description: 'Obtiene las instrucciones completas de una habilidad especializada. SIEMPRE lee el skill antes de actuar.',
        inputSchema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            skill_name: {
              type: 'string',
              enum: skillNames,
              description: 'Nombre de la habilidad cuyas instrucciones necesitas.',
            },
          },
          required: ['skill_name'],
        },
      })
    }
  }

  let iterations = 0
  let tokensUsed = 0
  let lastData: unknown = null
  const softLimitsHit: string[] = []
  let childSpawned = false
  const childResults: SubagentResultV2[] = []

  // ── Initialize messages: continue conversation on retry, or start fresh ──
  let messages: Array<{ role: 'user' | 'assistant'; content: string }>

  if (retryContext && retryContext.previousMessages.length > 0) {
    // Continue the previous conversation — append correction request
    messages = [...retryContext.previousMessages]

    const correctionParts: string[] = [
      `CORRECCIÓN REQUERIDA (intento ${retryContext.attempt}/${SUBAGENT_HARD_LIMITS.MAX_VERIFY_RETRIES}):`,
      retryContext.feedback ?? 'Mejorar el resultado anterior.',
    ]
    if (retryContext.issues?.length) {
      correctionParts.push(`Problemas específicos: ${retryContext.issues.join(', ')}`)
    }
    correctionParts.push(
      '',
      'Tu resultado anterior fue:',
      JSON.stringify(retryContext.previousResult, null, 2)?.slice(0, 2000) ?? '(sin datos)',
      '',
      'Corrige o mejora el resultado. No repitas pasos que ya completaste correctamente.',
    )

    messages.push({ role: 'user', content: correctionParts.join('\n') })
  } else {
    // Fresh start
    messages = [{ role: 'user', content: userMessage }]
  }

  // Determine LLM task: use 'web_search' for grounding (routes to Gemini Flash chain)
  const llmTask = runConfig.useGrounding ? 'web_search' : 'subagent'

  while (true) {
    // Check guardrails
    const check = checkGuardrails(guardrails, iterations, tokensUsed, startMs)
    if (check.hit) {
      logger.warn({
        traceId: ctx.traceId,
        slug: entry.slug,
        reason: check.reason,
        level: check.level,
        iterations,
        tokensUsed,
      }, 'Subagent guardrail hit')

      if (check.level === 'hard') {
        return {
          success: iterations > 0,
          data: lastData,
          iterations,
          tokensUsed,
          durationMs: Date.now() - startMs,
          subagentSlug: entry.slug,
          softLimitsHit,
          hardLimitHit: check.reason,
          childSpawned,
          childResults: childResults.length > 0 ? childResults : undefined,
          conversationHistory: messages,
          costUsd: 0, // Will be calculated by caller
        }
      }

      // Soft limit — log and continue
      if (check.reason) softLimitsHit.push(check.reason)
    }

    iterations++

    try {
      // Call LLM
      const result = await callLLM({
        task: llmTask,
        provider: runConfig.useGrounding ? undefined : runConfig.provider, // Let task router handle provider for grounding
        model: runConfig.useGrounding ? undefined : runConfig.model,       // Let task router handle model for grounding
        system,
        messages,
        maxTokens: runConfig.maxOutputTokens,
        temperature: runConfig.temperature,
        tools: allTools.length > 0 ? allTools.map(t => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })) : undefined,
        thinking: runConfig.useThinking ? { type: 'adaptive', budgetTokens: runConfig.thinkingBudget } : undefined,
        googleSearchGrounding: runConfig.useGrounding,
        codeExecution: step.useCoding ?? false,
      })

      tokensUsed += result.inputTokens + result.outputTokens

      // Check for tool calls
      if (result.toolCalls && result.toolCalls.length > 0) {
        const toolResults: string[] = []

        for (const toolCall of result.toolCalls) {
          // Handle spawn_subagent meta-tool
          if (toolCall.name === 'spawn_subagent') {
            const spawnInput = toolCall.input as Record<string, unknown>
            if (typeof spawnInput?.subagent_slug !== 'string' || !spawnInput.subagent_slug.trim()
              || typeof spawnInput?.task !== 'string' || !spawnInput.task.trim()) {
              toolResults.push(JSON.stringify({ tool: 'spawn_subagent', error: 'Invalid input: subagent_slug and task are required strings' }))
              continue
            }
            const spawnResult = await handleSpawnSubagent(
              spawnInput as { subagent_slug: string; task: string; tools?: string[] },
              ctx,
              toolDefs,
              config,
              registry,
            )
            childSpawned = true
            childResults.push(spawnResult)
            lastData = spawnResult.data
            toolResults.push(JSON.stringify({
              tool: 'spawn_subagent',
              result: {
                success: spawnResult.success,
                data: spawnResult.data,
                iterations: spawnResult.iterations,
                error: spawnResult.error,
              },
            }))
            continue
          }

          // Handle skill_read meta-tool
          if (toolCall.name === SKILL_READ_TOOL_NAME) {
            const skillResult = await executeSkillReadTool(toolCall.input as Record<string, unknown>)
            toolResults.push(JSON.stringify({
              tool: SKILL_READ_TOOL_NAME,
              result: {
                success: skillResult.success,
                data: skillResult.data,
                error: skillResult.error,
              },
            }))
            continue
          }

          // Check tool allowlist
          if (guardrails.allowedTools.length > 0 && !guardrails.allowedTools.includes(toolCall.name)) {
            toolResults.push(JSON.stringify({
              tool: toolCall.name,
              error: 'Tool not allowed for this subagent type',
            }))
            continue
          }

          // Execute tool via registry
          const toolsRegistry = registry.getOptional<ToolExecutor>('tools:registry')
          if (!toolsRegistry) {
            toolResults.push(JSON.stringify({
              tool: toolCall.name,
              error: 'Tools module not active',
            }))
            continue
          }

          const toolResult = await toolsRegistry.executeTool(toolCall.name, toolCall.input, {
            contactId: ctx.contactId,
            traceId: ctx.traceId,
            correlationId: ctx.traceId,
            db: registry.getDb(),
            redis: registry.getRedis(),
          })
          lastData = toolResult.data
          toolResults.push(JSON.stringify({
            tool: toolCall.name,
            result: toolResult,
          }))
        }

        // Add to conversation
        messages.push({
          role: 'assistant',
          content: result.text || `[Tool calls: ${result.toolCalls.map(t => t.name).join(', ')}]`,
        })
        messages.push({
          role: 'user',
          content: `Resultados de tools:\n${toolResults.join('\n')}`,
        })

        continue // Next iteration
      }

      // No tool calls — LLM is done
      let finalData = lastData
      try {
        const parsed = JSON.parse(result.text)
        finalData = parsed.result ?? parsed
      } catch {
        finalData = result.text || lastData
      }

      // Add final response to conversation history (for potential retry)
      messages.push({ role: 'assistant', content: result.text })

      logger.info({
        traceId: ctx.traceId,
        slug: entry.slug,
        iterations,
        tokensUsed,
        durationMs: Date.now() - startMs,
        childSpawned,
        isRetry: !!retryContext,
      }, 'Subagent loop completed')

      return {
        success: true,
        data: finalData,
        iterations,
        tokensUsed,
        durationMs: Date.now() - startMs,
        subagentSlug: entry.slug,
        softLimitsHit,
        childSpawned,
        childResults: childResults.length > 0 ? childResults : undefined,
        conversationHistory: messages,
        costUsd: 0, // Will be calculated by caller
      }
    } catch (err) {
      logger.error({ traceId: ctx.traceId, slug: entry.slug, iteration: iterations, err }, 'Subagent LLM call failed')

      return {
        success: false,
        data: lastData,
        iterations,
        tokensUsed,
        durationMs: Date.now() - startMs,
        subagentSlug: entry.slug,
        softLimitsHit,
        childSpawned,
        childResults: childResults.length > 0 ? childResults : undefined,
        conversationHistory: messages,
        costUsd: 0,
        error: String(err),
      }
    }
  }
}

/**
 * Handle spawn_subagent meta-tool call.
 * Creates a child subagent (depth 1, cannot spawn further).
 */
async function handleSpawnSubagent(
  input: { subagent_slug: string; task: string; tools?: string[] },
  ctx: ContextBundle,
  parentToolDefs: ToolDefinition[],
  config: EngineConfig,
  registry: Registry,
): Promise<SubagentResultV2> {
  logger.info({
    traceId: ctx.traceId,
    childSlug: input.subagent_slug,
    task: input.task?.slice(0, 100),
  }, 'Spawning child subagent')

  // Filter tools: child can only use subset of parent's tools
  const childToolDefs = input.tools?.length
    ? parentToolDefs.filter(t => input.tools!.includes(t.name))
    : parentToolDefs

  const childStep: ExecutionStep = {
    type: 'subagent',
    subagentSlug: input.subagent_slug,
    description: input.task,
    params: { tools: childToolDefs.map(t => t.name) },
  }

  // ctx is already minimal (came from buildSubagentContext in runSubagentV2),
  // so child subagents automatically get a clean context too.
  return runSubagentV2(ctx, childStep, childToolDefs, config, registry, true)
}

// ── Legacy compatibility wrapper ──

/**
 * Legacy runSubagent wrapper for backward compatibility.
 * Called by Phase 3 when no catalog is available (graceful fallback).
 */
export async function runSubagent(
  ctx: ContextBundle,
  step: ExecutionStep,
  toolDefs: ToolDefinition[],
  config: EngineConfig,
  registry?: Registry,
  _llmTask = 'subagent',
): Promise<{ success: boolean; data?: unknown; iterations: number; tokensUsed: number; timedOut: boolean; hitTokenLimit: boolean; error?: string }> {
  if (!registry) {
    return { success: false, data: null, iterations: 0, tokensUsed: 0, timedOut: false, hitTokenLimit: false, error: 'Registry not available' }
  }

  const result = await runSubagentV2(ctx, step, toolDefs, config, registry)

  return {
    success: result.success,
    data: result.data,
    iterations: result.iterations,
    tokensUsed: result.tokensUsed,
    timedOut: result.hardLimitHit?.includes('timeout') ?? false,
    hitTokenLimit: result.hardLimitHit?.includes('token') ?? false,
    error: result.error,
  }
}
