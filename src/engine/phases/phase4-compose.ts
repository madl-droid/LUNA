// LUNA Engine — Phase 4: Compose Response
// 1 llamada LLM (modelo compositor). Genera respuesta conversacional.
// El LLM NO tiene tools. Solo recibe datos y escribe.

import pino from 'pino'
import type { Registry } from '../../kernel/registry.js'
import type {
  ContextBundle,
  EvaluatorOutput,
  ExecutionOutput,
  CompositorOutput,
  EngineConfig,
} from '../types.js'
import { buildCompositorPrompt, clearPromptCache } from '../prompts/compositor.js'
import { callLLMWithFallback } from '../utils/llm-client.js'
import { loadFallback } from '../fallbacks/fallback-loader.js'

const logger = pino({ name: 'engine:phase4' })

/**
 * Execute Phase 4: Compose the response with LLM.
 */
export async function phase4Compose(
  ctx: ContextBundle,
  evaluation: EvaluatorOutput,
  execution: ExecutionOutput,
  config: EngineConfig,
  registry?: Registry,
): Promise<CompositorOutput> {
  const startMs = Date.now()

  logger.info({ traceId: ctx.traceId, intent: evaluation.intent }, 'Phase 4 start')

  // Build the compositor prompt
  const { system, userMessage } = await buildCompositorPrompt(
    ctx,
    evaluation,
    execution,
    config.knowledgeDir,
    registry,
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

    // Use fallback template with per-channel cascade
    const channelName = ctx.message.channelName
    const contactName = ctx.contact?.displayName ?? undefined
    const fallbackDir = config.knowledgeDir.replace(/\/knowledge\/?$/, '/fallbacks')
    const fallbackText = await loadFallback(
      evaluation.intent,
      channelName,
      { name: contactName, channel: channelName },
      fallbackDir,
    )

    return {
      responseText: fallbackText,
      rawResponse: `FALLBACK: ${String(err)}`,
    }
  }
}
