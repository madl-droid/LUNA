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
import { callLLM, callLLMWithFallback } from '../utils/llm-client.js'
import { loadFallback } from '../fallbacks/fallback-loader.js'
import { formatForChannel } from '../utils/message-formatter.js'
import { isComplexPlan } from './phase3-execute.js'

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
  // Mode: 'disabled' = skip, 'complex_only' = 3+ LLM steps, 'always' = every response
  if (config.criticizerMode !== 'disabled' && responseText && !rawResponse?.startsWith('FALLBACK')) {
    const shouldCriticize = config.criticizerMode === 'always' || isComplexPlan(evaluation)
    if (shouldCriticize) {
      responseText = await runCriticizer(responseText, system, userMessage, ctx, evaluation, config, registry)
    }
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

// isComplexPlan imported from phase3-execute.ts (single source of truth)

/**
 * Run the criticizer quality gate (2-step flow):
 *
 * 1. **Pro reviews**: Gemini Pro (task 'criticize') evaluates the response
 *    and returns structured JSON refinements.
 *    Prompt loaded from prompts module (criticizer-base + custom checklist).
 *
 * 2. **Flash regenerates**: The compositor model (Flash) gets a second pass
 *    with the refinement instructions injected naturally into its system prompt.
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
  registry?: Registry,
): Promise<string> {
  // ── Load criticizer prompt from prompts service ──
  const criticizerPrompt = await loadCriticizerPrompt(registry)

  // ── Step 1: Pro reviews → structured JSON refinements ──
  let refinements: CriticRefinements
  try {
    const result = await callLLMWithFallback({
      task: 'criticize',
      system: `${criticizerPrompt}\n\n${await loadCriticizerReviewSchema(registry)}`,
      messages: [{
        role: 'user',
        content: `Intención del usuario: ${evaluation.intent}
Canal: ${ctx.message.channelName}

Respuesta del agente a revisar:
---
${responseText}
---

¿Es aceptable o necesita corrección? Responde con JSON.`,
      }],
      maxTokens: 1024,
      temperature: 0.2,
    }, config.fallbackRespondProvider, config.fallbackRespondModel)

    if (!result.text || result.text.trim() === '') {
      return responseText
    }

    const parsed = parseCriticResponse(result.text)
    if (!parsed) {
      logger.warn({ traceId: ctx.traceId, text: result.text.slice(0, 200) }, 'Criticizer returned unparseable response')
      return responseText
    }

    if (parsed.approved) {
      logger.debug({ traceId: ctx.traceId }, 'Criticizer approved response')
      return responseText
    }

    refinements = parsed
    logger.info({ traceId: ctx.traceId, provider: result.provider }, 'Criticizer found issues — requesting regeneration')
  } catch (err) {
    logger.warn({ err, traceId: ctx.traceId }, 'Criticizer failed — using original response')
    return responseText
  }

  // ── Step 2: Flash regenerates with structured refinements ──
  try {
    const refinementInstructions = buildRefinementInstructions(refinements)
    const enrichedSystem = `${compositorSystem}\n\n--- INSTRUCCIONES ADICIONALES ---\n${refinementInstructions}`

    const regenerated = await callWithRetries(
      config.respondProvider, config.respondModel,
      enrichedSystem, compositorUserMessage,
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

// ─── Criticizer helpers ─────────────────────────

interface CriticRefinements {
  approved: boolean
  tone?: string
  length?: string | null
  remove?: string[]
  add?: string[]
  rephrase?: string[]
}

function parseCriticResponse(text: string): CriticRefinements | null {
  try {
    const parsed = JSON.parse(text.trim()) as Record<string, unknown>
    if (typeof parsed['approved'] !== 'boolean') return null
    return parsed as unknown as CriticRefinements
  } catch {
    // Try extracting JSON from response if wrapped in extra text
    const match = text.match(/\{[\s\S]*\}/)
    if (match) {
      try {
        const parsed = JSON.parse(match[0]) as Record<string, unknown>
        if (typeof parsed['approved'] !== 'boolean') return null
        return parsed as unknown as CriticRefinements
      } catch { /* fall through */ }
    }
    return null
  }
}

function buildRefinementInstructions(r: CriticRefinements): string {
  const parts: string[] = []
  if (r.tone) parts.push(`Ajusta el tono: ${r.tone}`)
  if (r.length === 'más corta') parts.push('Haz la respuesta más concisa.')
  if (r.length === 'más larga') parts.push('Expande la respuesta con más detalle.')
  if (r.remove && r.remove.length > 0) {
    parts.push(`No incluyas: ${r.remove.join('; ')}`)
  }
  if (r.add && r.add.length > 0) {
    parts.push(`Asegúrate de incluir: ${r.add.join('; ')}`)
  }
  if (r.rephrase && r.rephrase.length > 0) {
    for (const instruction of r.rephrase) {
      parts.push(instruction)
    }
  }
  return parts.join('\n')
}

/** Default criticizer prompt when prompts service is not available */
const DEFAULT_CRITICIZER_PROMPT = `Eres un revisor de calidad de respuestas de un agente de atención al cliente.
Evalúa la respuesta del agente y decide si es aceptable o necesita corrección.

Reglas de evaluación:
1. ¿Responde lo que el usuario preguntó? No se va por la tangente.
2. ¿Es apropiado para el canal? Longitud y formato correctos.
3. ¿Respeta guardrails? No inventa información, no promete de más.
4. ¿Los resultados de tools están integrados naturalmente? No dice "según la herramienta...".
5. ¿NO revela datos internos del sistema? (API keys, nombres de modelos, IDs internos)
6. ¿El tono es profesional y cálido?
7. ¿Termina con pregunta o CTA claro?`

// Minimal fallback for criticizer review JSON schema
const CRITICIZER_REVIEW_FALLBACK = `Responde SOLO con JSON válido. Si aceptable: {"approved":true}. Si necesita corrección: {"approved":false,"tone":"...","remove":["..."],"add":["..."],"rephrase":["..."]}`

/** Load the criticizer review JSON schema from .md template. */
async function loadCriticizerReviewSchema(registry?: Registry): Promise<string> {
  if (!registry) return CRITICIZER_REVIEW_FALLBACK
  const promptsSvc = registry.getOptional<{ getSystemPrompt(name: string): Promise<string> }>('prompts:service')
  if (!promptsSvc) return CRITICIZER_REVIEW_FALLBACK
  try {
    const tmpl = await promptsSvc.getSystemPrompt('criticizer-review')
    return tmpl || CRITICIZER_REVIEW_FALLBACK
  } catch {
    return CRITICIZER_REVIEW_FALLBACK
  }
}

/**
 * Load criticizer prompt from prompts service (criticizer-base + custom checklist).
 * Falls back to hardcoded default if prompts service is not available.
 */
async function loadCriticizerPrompt(registry?: Registry): Promise<string> {
  if (!registry) return DEFAULT_CRITICIZER_PROMPT

  const promptsService = registry.getOptional<{
    getSystemPrompt(name: string): Promise<string>
    getCompositorPrompts(userType: string): Promise<{ criticizer: string }>
  }>('prompts:service')

  if (!promptsService) return DEFAULT_CRITICIZER_PROMPT

  try {
    const [criticBase, compositorPrompts] = await Promise.all([
      promptsService.getSystemPrompt('criticizer-base'),
      promptsService.getCompositorPrompts('default'),
    ])
    const combined = [criticBase, compositorPrompts.criticizer].filter(Boolean).join('\n')
    return combined || DEFAULT_CRITICIZER_PROMPT
  } catch {
    return DEFAULT_CRITICIZER_PROMPT
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
