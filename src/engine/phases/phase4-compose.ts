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

  // ═══ Criticizer step — quality gate via Gemini Pro ═══
  // Pro reviews → if issues found, Flash regenerates with Pro's feedback
  if (responseText && !rawResponse?.startsWith('FALLBACK')) {
    responseText = await runCriticizer(responseText, system, userMessage, ctx, evaluation, config)
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
 * Run the criticizer quality gate (2-step flow):
 *
 * 1. **Pro reviews**: Gemini Pro (task 'criticize') evaluates the response.
 *    - If APPROVED → return original response unchanged.
 *    - If issues found → returns a list of specific problems/instructions.
 *
 * 2. **Flash regenerates**: The original compositor model (Flash) gets a second
 *    chance with Pro's feedback injected as additional instructions. Flash has
 *    the full context (identity, guardrails, conversation history), so it
 *    produces a better correction than Pro could without that context.
 *
 * Fail-open: if criticizer or regeneration fails, original response is returned.
 */
async function runCriticizer(
  responseText: string,
  compositorSystem: string,
  compositorUserMessage: string,
  ctx: ContextBundle,
  evaluation: EvaluatorOutput,
  config: EngineConfig,
): Promise<string> {
  // ── Step 1: Pro reviews ──
  let feedback: string
  try {
    const result = await callLLM({
      task: 'criticize',
      system: `Eres un revisor de calidad de respuestas de un agente de atención al cliente.
Evalúa la respuesta del agente y decide si es aceptable o necesita corrección.

Reglas de evaluación:
1. ¿Responde lo que el usuario preguntó? No se va por la tangente.
2. ¿Es apropiado para el canal? Longitud y formato correctos.
3. ¿Respeta guardrails? No inventa información, no promete de más.
4. ¿Los resultados de tools están integrados naturalmente? No dice "según la herramienta...".
5. ¿NO revela datos internos del sistema? (API keys, nombres de modelos, IDs internos)
6. ¿El tono es profesional y cálido?
7. ¿Termina con pregunta o CTA claro?

Si la respuesta es aceptable, responde EXACTAMENTE: APPROVED
Si necesita corrección, lista los problemas específicos y cómo corregirlos. NO reescribas la respuesta, solo da instrucciones claras de qué cambiar.`,
      messages: [{
        role: 'user',
        content: `Intención del usuario: ${evaluation.intent}
Canal: ${ctx.message.channelName}

Respuesta del agente a revisar:
---
${responseText}
---

¿Es aceptable o necesita corrección?`,
      }],
      maxTokens: 2048,
      temperature: 0.3,
    })

    if (!result.text || result.text.trim() === '') {
      return responseText
    }

    const trimmed = result.text.trim()
    if (trimmed === 'APPROVED') {
      logger.debug({ traceId: ctx.traceId }, 'Criticizer approved response')
      return responseText
    }

    feedback = trimmed
    logger.info({ traceId: ctx.traceId, provider: result.provider }, 'Criticizer found issues — requesting regeneration')
  } catch (err) {
    logger.warn({ err, traceId: ctx.traceId }, 'Criticizer failed — using original response')
    return responseText
  }

  // ── Step 2: Flash regenerates with feedback ──
  try {
    const feedbackPrompt = `${compositorUserMessage}

--- CORRECCIONES DEL REVISOR ---
Tu respuesta anterior fue revisada y se encontraron estos problemas:
${feedback}

Genera una nueva respuesta corrigiendo estos problemas. Responde SOLO con la respuesta corregida, sin explicaciones ni prefijos.`

    const regenerated = await callWithRetries(
      config.respondProvider, config.respondModel,
      compositorSystem, feedbackPrompt,
      config, ctx.traceId,
    )

    if (regenerated) {
      logger.info({ traceId: ctx.traceId }, 'Criticizer regeneration succeeded')
      return regenerated
    }

    logger.warn({ traceId: ctx.traceId }, 'Criticizer regeneration failed — using original response')
    return responseText
  } catch (err) {
    logger.warn({ err, traceId: ctx.traceId }, 'Criticizer regeneration error — using original response')
    return responseText
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

      // FIX: E-14 — Reject empty LLM responses so retry/fallback takes over
      if (!result.text || result.text.trim() === '') {
        logger.warn({ traceId, provider, model, attempt }, 'LLM returned empty response — treating as failure')
        lastError = new Error('Empty LLM response')
        continue
      }
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
