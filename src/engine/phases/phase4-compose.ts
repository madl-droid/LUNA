// LUNA Engine — Phase 4: Compose Response (v2)
// LLM compositor + retries + channel formatting + TTS.
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
import { buildCompositorPrompt } from '../prompts/compositor.js'
import { callLLM } from '../utils/llm-client.js'
import { loadFallback } from '../fallbacks/fallback-loader.js'
import { formatForChannel } from '../utils/message-formatter.js'

const logger = pino({ name: 'engine:phase4' })

/**
 * Execute Phase 4: Compose the response with LLM, format for channel, optional TTS.
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

  // ═══ LLM call with retries per provider ═══
  let responseText: string | null = null
  let rawResponse: string | undefined

  // Try primary provider (with retries)
  responseText = await callWithRetries(
    config.respondProvider, config.respondModel,
    system, userMessage, config, ctx.traceId,
  )

  // If primary failed, try fallback provider (with retries)
  if (responseText === null) {
    responseText = await callWithRetries(
      config.fallbackRespondProvider, config.fallbackRespondModel,
      system, userMessage, config, ctx.traceId,
    )
  }

  // If both providers failed, use file-based fallback template
  if (responseText === null) {
    logger.error({ traceId: ctx.traceId }, 'Phase 4 — all LLM providers failed, using fallback template')

    const channelName = ctx.message.channelName
    const contactName = ctx.contact?.displayName ?? undefined
    const fallbackDir = config.knowledgeDir.replace(/\/knowledge\/?$/, '/fallbacks')
    responseText = await loadFallback(
      evaluation.intent,
      channelName,
      { name: contactName, channel: channelName },
      fallbackDir,
    )
    rawResponse = 'FALLBACK: all providers failed'
  }

  // ═══ Channel formatting ═══
  const formattedParts = formatForChannel(responseText, ctx.message.channelName, registry)

  // ═══ TTS (if audio response needed) ═══
  let audioBuffer: Buffer | undefined
  let audioDurationSeconds: number | undefined
  let outputFormat: 'text' | 'audio' = 'text'

  if (registry) {
    const ttsService = registry.getOptional<{
      shouldAutoTTS(channel: string, inputType: string): boolean
      synthesize(text: string): Promise<{ audioBuffer: Buffer; durationSeconds: number } | null>
    }>('tts:service')

    if (ttsService?.shouldAutoTTS(ctx.message.channelName, ctx.messageType)) {
      try {
        const ttsResult = await ttsService.synthesize(responseText)
        if (ttsResult) {
          audioBuffer = ttsResult.audioBuffer
          audioDurationSeconds = ttsResult.durationSeconds
          outputFormat = 'audio'
          logger.info({ traceId: ctx.traceId, durationSeconds: ttsResult.durationSeconds }, 'TTS synthesis complete')
        }
      } catch (err) {
        logger.warn({ err, traceId: ctx.traceId }, 'TTS synthesis failed, falling back to text')
      }
    }
  }

  const durationMs = Date.now() - startMs
  logger.info({
    traceId: ctx.traceId,
    durationMs,
    responseLength: responseText.length,
    parts: formattedParts.length,
    outputFormat,
  }, 'Phase 4 complete')

  return {
    responseText,
    formattedParts,
    audioBuffer,
    audioDurationSeconds,
    outputFormat,
    rawResponse,
  }
}

/**
 * Call LLM with retries (exponential backoff).
 * Returns response text or null if all attempts fail.
 */
async function callWithRetries(
  provider: string,
  model: string,
  system: string,
  userMessage: string,
  config: EngineConfig,
  traceId: string,
): Promise<string | null> {
  const maxRetries = config.composeRetriesPerProvider
  let lastError: unknown

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      if (attempt > 0) {
        const delayMs = 1000 * attempt  // 1s, 2s, 3s...
        logger.info({ traceId, provider, model, attempt, delayMs }, 'Retrying LLM call')
        await new Promise(resolve => setTimeout(resolve, delayMs))
      }

      const result = await callLLM({
        task: 'compose',
        provider: provider as import('../types.js').LLMProvider,
        model,
        system,
        messages: [{ role: 'user', content: userMessage }],
        maxTokens: config.maxOutputTokens,
        temperature: config.temperatureRespond,
      })

      logger.info({ traceId, provider: result.provider, model: result.model, attempt }, 'Phase 4 LLM succeeded')
      return result.text
    } catch (err) {
      lastError = err
      logger.warn({ traceId, provider, model, attempt, err: String(err) }, 'Phase 4 LLM attempt failed')
    }
  }

  logger.error({ traceId, provider, model, attempts: maxRetries + 1, lastError: String(lastError) }, 'Phase 4 — provider exhausted')
  return null
}
