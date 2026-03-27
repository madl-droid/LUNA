// LUNA Engine — Phase 2: Evaluate Situation
// 1 llamada LLM (modelo evaluador). Target: <2s.
// Analiza intención, emoción, riesgo, genera plan de ejecución.

import pino from 'pino'
import type { Registry } from '../../kernel/registry.js'
import type { ContextBundle, EvaluatorOutput, ExecutionStep, EngineConfig, ProactiveContextBundle, ReplanContext } from '../types.js'
import { buildEvaluatorPrompt, buildProactiveEvaluatorPrompt } from '../prompts/evaluator.js'
import { callLLMWithFallback } from '../utils/llm-client.js'
import { getCatalog } from '../mocks/tool-registry.js'

const logger = pino({ name: 'engine:phase2' })

// Default fallback when LLM fails or returns invalid JSON
const DEFAULT_EVALUATOR_OUTPUT: EvaluatorOutput = {
  intent: 'unknown',
  emotion: 'neutral',
  injectionRisk: false,
  onScope: true,
  executionPlan: [{ type: 'respond_only', description: 'Respuesta genérica por fallo del evaluador' }],
  toolsNeeded: [],
  needsAcknowledgment: false,
}

// Proactive fallback: NO_ACTION (safe default — don't send anything)
const PROACTIVE_NO_ACTION: EvaluatorOutput = {
  intent: 'no_action',
  emotion: 'neutral',
  injectionRisk: false,
  onScope: true,
  executionPlan: [],
  toolsNeeded: [],
  needsAcknowledgment: false,
}

/**
 * Check if a ContextBundle is a proactive context.
 */
function isProactiveContext(ctx: ContextBundle): ctx is ProactiveContextBundle {
  return 'isProactive' in ctx && (ctx as ProactiveContextBundle).isProactive === true
}

/**
 * Execute Phase 2: Evaluate the situation with LLM.
 * Supports both reactive (incoming message) and proactive (outbound trigger) modes.
 */
export async function phase2Evaluate(
  ctx: ContextBundle,
  config: EngineConfig,
  replanContext?: ReplanContext,
  registry?: Registry,
): Promise<EvaluatorOutput> {
  const startMs = Date.now()
  const proactive = isProactiveContext(ctx)

  logger.info({ traceId: ctx.traceId, intent: 'evaluating', proactive, replanAttempt: replanContext?.attempt }, 'Phase 2 start')

  // Build prompt (different for proactive vs reactive)
  const toolCatalog = getCatalog()
  let { system, userMessage } = proactive
    ? await buildProactiveEvaluatorPrompt(ctx, toolCatalog, registry)
    : await buildEvaluatorPrompt(ctx, toolCatalog, registry)

  // Inject replanning context if this is a replan attempt
  if (replanContext) {
    const failedList = replanContext.failedSteps
      .map(s => `- Step ${s.stepIndex} (${s.type}): ${s.error ?? 'unknown error'}`)
      .join('\n')
    const partialKeys = Object.keys(replanContext.partialData)
    const partialSummary = partialKeys.length > 0
      ? partialKeys.map(k => `- ${k}: ${JSON.stringify(replanContext.partialData[k]).slice(0, 200)}`).join('\n')
      : '(ninguno)'

    userMessage += `\n\n## REPLANNING (intento ${replanContext.attempt})
El plan anterior falló en estos pasos:
${failedList}
Datos parciales obtenidos:
${partialSummary}
Genera un nuevo plan que tome en cuenta estos resultados. No repitas pasos que ya tuvieron éxito.`
  }

  // Choose model: proactive uses its own model config
  const provider = proactive ? config.proactiveProvider : config.classifyProvider
  const model = proactive ? config.proactiveModel : config.classifyModel

  try {
    const result = await callLLMWithFallback(
      {
        task: proactive ? 'proactive-evaluate' : 'evaluate',
        provider,
        model,
        system,
        messages: [{ role: 'user', content: userMessage }],
        maxTokens: 512,
        temperature: config.temperatureClassify,
      },
      config.fallbackClassifyProvider,
      config.fallbackClassifyModel,
    )

    // Parse JSON response
    const parsed = parseEvaluatorResponse(result.text, ctx)

    const durationMs = Date.now() - startMs
    logger.info({
      traceId: ctx.traceId,
      durationMs,
      intent: parsed.intent,
      emotion: parsed.emotion,
      planSteps: parsed.executionPlan.length,
      provider: result.provider,
      model: result.model,
      proactive,
    }, 'Phase 2 complete')

    return parsed
  } catch (err) {
    const durationMs = Date.now() - startMs
    logger.error({ traceId: ctx.traceId, durationMs, err, proactive }, 'Phase 2 LLM failed')
    // Proactive: safe default is NO_ACTION (don't send anything on failure)
    // Reactive: safe default is respond_only (still answer the human)
    return proactive
      ? { ...PROACTIVE_NO_ACTION, rawResponse: String(err) }
      : { ...DEFAULT_EVALUATOR_OUTPUT, rawResponse: String(err) }
  }
}

/**
 * Parse the LLM evaluator response into structured output.
 */
function parseEvaluatorResponse(text: string, ctx: ContextBundle): EvaluatorOutput {
  // Try to extract JSON from the response
  let jsonStr = text.trim()

  // Strip markdown code fences if present
  if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '')
  }

  try {
    const parsed = JSON.parse(jsonStr)

    const output: EvaluatorOutput = {
      intent: parsed.intent ?? 'unknown',
      emotion: parsed.emotion ?? 'neutral',
      injectionRisk: parsed.injection_risk ?? false,
      onScope: parsed.on_scope ?? true,
      executionPlan: parseExecutionPlan(parsed.execution_plan),
      toolsNeeded: Array.isArray(parsed.tools_needed) ? parsed.tools_needed : [],
      needsAcknowledgment: parsed.needs_acknowledgment ?? false,
      rawResponse: text,
    }

    // Override plan if injection risk
    if (output.injectionRisk || ctx.possibleInjection) {
      output.injectionRisk = true
      output.executionPlan = [{ type: 'respond_only', description: 'Respuesta genérica por riesgo de inyección' }]
    }

    // Override plan if off-scope
    if (!output.onScope) {
      output.executionPlan = [{ type: 'respond_only', description: 'Redirección suave al tema del negocio' }]
    }

    return output
  } catch (err) {
    logger.warn({ err, text: text.substring(0, 200) }, 'Failed to parse evaluator JSON')
    return { ...DEFAULT_EVALUATOR_OUTPUT, rawResponse: text }
  }
}

/**
 * Parse execution plan from LLM response.
 */
function parseExecutionPlan(plan: unknown): ExecutionStep[] {
  if (!Array.isArray(plan)) {
    return [{ type: 'respond_only', description: 'Default respond_only' }]
  }

  return plan.map((step: Record<string, unknown>) => ({
    type: (step.type as ExecutionStep['type']) ?? 'respond_only',
    tool: step.tool as string | undefined,
    params: (step.params as Record<string, unknown>) ?? undefined,
    description: (step.description as string) ?? undefined,
    dependsOn: step.depends_on as number[] | undefined,
  }))
}

