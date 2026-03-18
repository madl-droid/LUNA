// LUNA Engine — Phase 4: Compose Response
// 1 llamada LLM (modelo compositor). Genera respuesta conversacional.
// El LLM NO tiene tools. Solo recibe datos y escribe.

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import pino from 'pino'
import type {
  ContextBundle,
  EvaluatorOutput,
  ExecutionOutput,
  CompositorOutput,
  EngineConfig,
} from '../types.js'
import { buildCompositorPrompt, clearPromptCache } from '../prompts/compositor.js'
import { callLLMWithFallback } from '../utils/llm-client.js'

const logger = pino({ name: 'engine:phase4' })

// Fallback templates loaded from instance/fallbacks/
const fallbackTemplates = new Map<string, string>()

/**
 * Execute Phase 4: Compose the response with LLM.
 */
export async function phase4Compose(
  ctx: ContextBundle,
  evaluation: EvaluatorOutput,
  execution: ExecutionOutput,
  config: EngineConfig,
): Promise<CompositorOutput> {
  const startMs = Date.now()

  logger.info({ traceId: ctx.traceId, intent: evaluation.intent }, 'Phase 4 start')

  // Build the compositor prompt
  const { system, userMessage } = await buildCompositorPrompt(
    ctx,
    evaluation,
    execution,
    config.knowledgeDir,
  )

  try {
    const result = await callLLMWithFallback(
      {
        task: 'compose',
        provider: config.respondProvider,
        model: config.respondModel,
        system,
        messages: [{ role: 'user', content: userMessage }],
        maxTokens: config.maxOutputTokens,
        temperature: config.temperatureRespond,
      },
      config.fallbackRespondProvider,
      config.fallbackRespondModel,
    )

    const durationMs = Date.now() - startMs
    logger.info({
      traceId: ctx.traceId,
      durationMs,
      responseLength: result.text.length,
      provider: result.provider,
      model: result.model,
    }, 'Phase 4 complete')

    return {
      responseText: result.text,
      rawResponse: result.text,
    }
  } catch (err) {
    const durationMs = Date.now() - startMs
    logger.error({ traceId: ctx.traceId, durationMs, err }, 'Phase 4 LLM failed, using fallback template')

    // Use fallback template
    const fallbackText = await getFallbackTemplate(evaluation.intent, config.knowledgeDir)

    return {
      responseText: fallbackText,
      rawResponse: `FALLBACK: ${String(err)}`,
    }
  }
}

/**
 * Get a fallback template for a given intent.
 */
async function getFallbackTemplate(intent: string, knowledgeDir: string): Promise<string> {
  // Check cache
  const cached = fallbackTemplates.get(intent)
  if (cached) return cached

  // Try to load from instance/fallbacks/
  const fallbackDir = join(knowledgeDir, '..', 'fallbacks')
  try {
    const content = await readFile(join(fallbackDir, `${intent}.txt`), 'utf-8')
    fallbackTemplates.set(intent, content.trim())
    return content.trim()
  } catch {
    // Generic fallback
  }

  // Try generic fallback
  try {
    const content = await readFile(join(fallbackDir, 'generic.txt'), 'utf-8')
    fallbackTemplates.set('_generic', content.trim())
    return content.trim()
  } catch {
    // Hardcoded last resort
  }

  return 'Disculpa, estoy teniendo dificultades técnicas en este momento. ¿Podrías intentar de nuevo en unos minutos?'
}
