// LUNA Engine — Subagent v2
// Loop principal con verificación, spawn recursivo (1 nivel), y guardrails soft/hard.

import pino from 'pino'
import type { Registry } from '../../kernel/registry.js'
import type {
  ContextBundle,
  ExecutionStep,
  EngineConfig,
  ToolDefinition,
} from '../types.js'
import type { SubagentResultV2, SubagentRunConfig } from './types.js'
import { buildGuardrails, checkGuardrails } from './guardrails.js'
import { verifySubagentResult } from './verifier.js'
import { buildSubagentPrompt } from '../prompts/subagent.js'
import { callLLM } from '../utils/llm-client.js'
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
    guardrails: buildGuardrails(entry.tokenBudget, entry.allowedTools),
    isChild,
  }
}

/**
 * Run a subagent from the catalog.
 * Resolves the subagent type, builds config, runs the loop with verification.
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

  // Run the main loop
  let result = await runSubagentLoop(ctx, step, filteredTools, config, runConfig, registry)

  // ── Verification ──
  if (entry.verifyResult && result.success) {
    const verification = await verifySubagentResult(
      step.description ?? 'Ejecutar tarea',
      result.data,
      result.success,
      config,
    )

    result.verification = verification

    if (verification.verdict === 'retry') {
      logger.info({
        traceId: ctx.traceId,
        slug,
        feedback: verification.feedback,
      }, 'Verifier requested retry')

      // Retry once with verifier feedback
      const retryStep: ExecutionStep = {
        ...step,
        description: [
          step.description ?? 'Ejecutar tarea',
          '',
          'CORRECCIÓN REQUERIDA:',
          verification.feedback ?? 'Mejorar el resultado anterior.',
          verification.issues?.length
            ? `Problemas específicos: ${verification.issues.join(', ')}`
            : '',
        ].filter(Boolean).join('\n'),
      }

      const retryResult = await runSubagentLoop(ctx, retryStep, filteredTools, config, runConfig, registry)

      // Re-verify the retry result
      let retryVerification = verification // Keep original if re-verify fails
      if (retryResult.success) {
        retryVerification = await verifySubagentResult(
          step.description ?? 'Ejecutar tarea',
          retryResult.data,
          retryResult.success,
          config,
        )
      }

      // Merge retry into result
      result = {
        ...retryResult,
        iterations: result.iterations + retryResult.iterations,
        tokensUsed: result.tokensUsed + retryResult.tokensUsed,
        softLimitsHit: [...result.softLimitsHit, ...retryResult.softLimitsHit],
        childSpawned: result.childSpawned || retryResult.childSpawned,
        childResults: [...(result.childResults ?? []), ...(retryResult.childResults ?? [])],
        costUsd: result.costUsd + retryResult.costUsd,
        verification: retryVerification,
      }
    } else if (verification.verdict === 'fail') {
      logger.warn({
        traceId: ctx.traceId,
        slug,
        feedback: verification.feedback,
        issues: verification.issues,
      }, 'Verifier failed the result')
      result.success = false
      result.error = verification.feedback ?? 'Verification failed'
    }
  }

  result.durationMs = Date.now() - startMs
  return result
}

/**
 * Core subagent loop: LLM + tool calling with guardrails.
 */
async function runSubagentLoop(
  ctx: ContextBundle,
  step: ExecutionStep,
  toolDefs: ToolDefinition[],
  config: EngineConfig,
  runConfig: SubagentRunConfig,
  registry: Registry,
): Promise<SubagentResultV2> {
  const startMs = Date.now()
  const { guardrails, entry } = runConfig

  logger.info({
    traceId: ctx.traceId,
    slug: entry.slug,
    model: runConfig.model,
    tools: toolDefs.map(t => t.name),
    isChild: runConfig.isChild,
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

  let iterations = 0
  let tokensUsed = 0
  let lastData: unknown = null
  const softLimitsHit: string[] = []
  let childSpawned = false
  const childResults: SubagentResultV2[] = []

  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
    { role: 'user', content: userMessage },
  ]

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
        task: 'subagent',
        provider: runConfig.provider,
        model: runConfig.model,
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
            agentId: ctx.agentId,
            traceId: ctx.traceId,
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

      logger.info({
        traceId: ctx.traceId,
        slug: entry.slug,
        iterations,
        tokensUsed,
        durationMs: Date.now() - startMs,
        childSpawned,
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
