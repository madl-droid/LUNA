// LUNA Engine — Post Processor
// Convert AgenticResult into CompositorOutput.
// Steps: criticizer (smart mode) + channel formatting + TTS.

import pino from 'pino'
import type { Registry } from '../../kernel/registry.js'
import type { ContextBundle, CompositorOutput, EngineConfig } from '../types.js'
import type { AgenticConfig, AgenticResult } from './types.js'
import type { LLMToolDef } from '../types.js'
import { callLLM } from '../utils/llm-client.js'
import { runAgenticLoop } from './agentic-loop.js'
import { formatForChannel } from '../utils/message-formatter.js'
import { validateOutput } from '../output-sanitizer.js'

const logger = pino({ name: 'engine:post-processor' })

// ── TTS service interface (only the methods we need) ──
interface TTSServiceLike {
  shouldAutoTTS(channel: string, inputType: string): boolean
  shouldAutoTTSWithMultiplier(channel: string, inputType: string, multiplier: number): boolean
  synthesize(text: string): Promise<{ audioBuffer: Buffer; durationSeconds: number } | null>
  synthesizeChunks(text: string): Promise<Array<{ audioBuffer: Buffer; durationSeconds: number }>>
  isEnabledForChannel(channel: string): boolean
}

/**
 * Convert AgenticResult into CompositorOutput.
 *
 * Steps:
 * 1. Criticizer (optional, only for complex messages)
 * 2. Channel formatting
 * 3. TTS (if audio response)
 *
 * @param agenticResult - Output from runAgenticLoop
 * @param ctx - ContextBundle from Phase 1
 * @param config - EngineConfig (for criticizer mode, model selection)
 * @param registry - Kernel registry
 * @returns CompositorOutput (reused type from engine/types.ts)
 */
export async function postProcess(
  agenticResult: AgenticResult,
  ctx: ContextBundle,
  config: EngineConfig,
  registry: Registry,
  loopContext?: {
    systemPrompt: string
    toolDefinitions: LLMToolDef[]
    agenticConfig: AgenticConfig
  },
): Promise<CompositorOutput> {
  // ── 6.1 Criticizer (smart mode) ──
  let responseText = agenticResult.responseText

  const shouldCriticize =
    config.criticizerMode === 'always' ||
    (config.criticizerMode === 'complex_only' && (
      agenticResult.effortUsed === 'complex' ||
      agenticResult.toolCallsLog.filter(t => !t.blocked && !t.fromCache).length >= 3
    ))

  if (shouldCriticize && responseText.length > 50) {
    try {
      const criticized = await runCriticizer(responseText, ctx, config, registry, loopContext)
      if (criticized) {
        responseText = criticized
        logger.debug({ traceId: ctx.traceId }, 'Criticizer improved response')
      }
    } catch (err) {
      logger.warn({ err, traceId: ctx.traceId }, 'Criticizer failed — using original response')
    }
  }

  // ── 6.3 Channel formatting ──
  const preValidation = validateOutput(responseText)
  if (!preValidation.passed) {
    responseText = preValidation.sanitizedText
  }
  const formattedParts = formatForChannel(responseText, ctx.message.channelName, registry)

  // ── 6.4 TTS ──
  let audioBuffer: Buffer | undefined
  let audioDurationSeconds: number | undefined
  let audioChunks: Array<{ audioBuffer: Buffer; durationSeconds: number }> | undefined
  let outputFormat: 'text' | 'audio' = 'text'
  let ttsFailed = false

  const ttsService = registry.getOptional<TTSServiceLike>('tts:service') ?? null

  let shouldTTS = false
  if (ctx.responseFormat === 'audio') {
    shouldTTS = ttsService?.isEnabledForChannel(ctx.message.channelName) ?? false
  } else if (ctx.responseFormat === 'auto' && ttsService) {
    shouldTTS = ttsService.shouldAutoTTS(ctx.message.channelName, ctx.messageType)
  }

  if (shouldTTS && ttsService) {
    try {
      // For long responses, use chunked synthesis (multiple voice notes)
      if (responseText.length > 900) {
        const chunks = await ttsService.synthesizeChunks(responseText)
        if (chunks.length > 0) {
          audioChunks = chunks
          audioBuffer = chunks[0]!.audioBuffer
          audioDurationSeconds = chunks[0]!.durationSeconds
          outputFormat = 'audio'
        }
      } else {
        const result = await ttsService.synthesize(responseText)
        if (result) {
          audioBuffer = result.audioBuffer
          audioDurationSeconds = result.durationSeconds
          outputFormat = 'audio'
        }
      }
    } catch (err) {
      logger.warn({ err, traceId: ctx.traceId }, 'TTS synthesis failed')
      ttsFailed = true
    }
  }

  logger.info({
    traceId: ctx.traceId,
    criticizerRan: shouldCriticize,
    formattedParts: formattedParts.length,
    outputFormat,
    ttsFailed: ttsFailed || undefined,
  }, 'Post-processor completed')

  // ── 6.5 Build and return CompositorOutput ──
  return {
    responseText,
    formattedParts,
    audioBuffer,
    audioDurationSeconds,
    audioChunks,
    outputFormat,
    ttsFailed: ttsFailed || undefined,
  }
}

// ── Internal helpers ──

/** Structured feedback from the JSON-based reviewer (criticizer-review.md format) */
interface ReviewerFeedback {
  approved: boolean
  tone?: string
  length?: string | null
  remove?: string[]
  add?: string[]
  rephrase?: string[]
}

/** Attempt to parse JSON reviewer feedback. Returns null if parsing fails. */
function parseReviewerJSON(text: string): ReviewerFeedback | null {
  try {
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
    const parsed = JSON.parse(cleaned) as Record<string, unknown>
    if (typeof parsed === 'object' && parsed !== null && typeof parsed.approved === 'boolean') {
      return parsed as unknown as ReviewerFeedback
    }
    return null
  } catch {
    return null
  }
}

/** Convert structured JSON feedback into prose instructions for the rewriter. */
function feedbackToProse(fb: ReviewerFeedback): string {
  const parts: string[] = []
  if (fb.tone) parts.push(`Ajuste de tono: ${fb.tone}`)
  if (fb.length) parts.push(`Longitud: hacerla ${fb.length}`)
  if (fb.remove?.length) parts.push(`Eliminar: ${fb.remove.join('; ')}`)
  if (fb.add?.length) parts.push(`Agregar: ${fb.add.join('; ')}`)
  if (fb.rephrase?.length) parts.push(`Reformular: ${fb.rephrase.join('; ')}`)
  return parts.join('\n')
}

/**
 * Run the criticizer: two-step process.
 * Step 1 — Reviewer LLM: evaluates the response and returns detailed feedback or "APPROVED".
 * Step 2 — Rewriter LLM (only if feedback): takes original response + feedback and produces a clean improved response.
 * Returns improved text, or null if the original is fine.
 */
async function runCriticizer(
  responseText: string,
  ctx: ContextBundle,
  config: EngineConfig,
  registry: Registry,
  loopContext?: {
    systemPrompt: string
    toolDefinitions: LLMToolDef[]
    agenticConfig: AgenticConfig
  },
): Promise<string | null> {
  // Step 1: Get feedback from reviewer
  const feedback = await getReviewFeedback(responseText, ctx, config, registry)
  if (!feedback) return null // APPROVED — original is fine

  logger.debug({ traceId: ctx.traceId, feedbackLength: feedback.length }, 'Criticizer has feedback — rewriting')

  // Step 2: Re-enter agentic loop with feedback (if loop context available) or fallback to simple rewrite
  const improved = loopContext
    ? await rewriteViaLoop(responseText, feedback, ctx, config, registry, loopContext)
    : await rewriteWithFeedback(responseText, feedback, ctx, config)

  // Step 3: Re-evaluate — reviewer decides if the retry is better than the original
  const retryFeedback = await getReviewFeedback(improved, ctx, config, registry)
  if (!retryFeedback) {
    // Retry approved — use the improved version
    logger.debug({ traceId: ctx.traceId }, 'Criticizer retry approved')
    return improved
  }

  // Retry still has issues — keep original (conservative: don't make it worse)
  logger.info({ traceId: ctx.traceId }, 'Criticizer retry not approved — keeping original response')
  return null
}

/**
 * Step 1: Ask the reviewer LLM to evaluate the response.
 * Returns feedback text if improvements are needed, or null if APPROVED.
 */
async function getReviewFeedback(
  responseText: string,
  ctx: ContextBundle,
  _config: EngineConfig,
  registry: Registry,
): Promise<string | null> {
  const promptsService = registry.getOptional<{
    getPrompt(slot: string, variant?: string): Promise<string>
    getSystemPrompt(name: string, variables?: Record<string, string>): Promise<string>
  }>('prompts:service')

  // Load quality criteria (DB slot, points 6-10) + JSON format instructions (criticizer-review.md)
  const [qualityCriteria, jsonFormatInstruction] = promptsService
    ? await Promise.all([
        promptsService.getPrompt('criticizer').catch(() => null),
        promptsService.getSystemPrompt('criticizer-review').catch(() => null),
      ])
    : [null, null]

  let system: string
  if (qualityCriteria && jsonFormatInstruction) {
    // Ideal path: quality criteria from DB + JSON format from criticizer-review.md
    system = `You are a quality reviewer for a sales agent's response. Evaluate it against these criteria:\n\n${qualityCriteria}\n\n${jsonFormatInstruction}`
  } else if (qualityCriteria) {
    // criticizer-review.md missing/empty but DB criteria available — use criteria with prose format
    system = `You are a quality reviewer for a sales agent's response. Evaluate it against these criteria:\n\n${qualityCriteria}\n\nIf the response is good as-is, reply with exactly: APPROVED\n\nIf improvements are needed, explain clearly what should be changed and why.\nDo NOT rewrite the response — only provide your feedback.`
  } else {
    // Fallback: hardcoded English prose-based review (original behavior)
    system = `You are a quality reviewer for a sales agent's response. Evaluate it for:
1. Accuracy — does it correctly answer the question?
2. Tone — is it professional and warm?
3. Completeness — is anything missing?
4. Brevity — is it unnecessarily long?

If the response is good as-is, reply with exactly: APPROVED

If improvements are needed, explain clearly what should be changed and why.
Do NOT rewrite the response — only provide your feedback.`
  }

  const result = await callLLM({
    task: 'criticizer-review',
    system,
    messages: [
      {
        role: 'user',
        content: `User message: ${ctx.normalizedText.slice(0, 500)}\n\nAgent response to review:\n${responseText}`,
      },
    ],
    maxTokens: 1024,
  })

  const raw = result.text.trim()

  // Try JSON parse first (when criticizer-review.md format was used)
  const structured = parseReviewerJSON(raw)
  if (structured) {
    if (structured.approved) return null
    const prose = feedbackToProse(structured)
    return prose || null // null if all optional fields were omitted
  }

  // Fallback: prose-based detection (when hardcoded English fallback was used)
  if (raw.toUpperCase().startsWith('APPROVED') || raw.length < 10) {
    return null
  }
  return raw
}

/** Max tool-calling turns for criticizer re-entry (1 turn = 1 LLM call that can produce tool_calls) */
const CRITICIZER_MAX_TOOL_TURNS = 2
/** Max individual tool calls allowed during criticizer re-entry */
const CRITICIZER_MAX_TOOL_CALLS = 2
/** Tool name for subagent delegation */
const RUN_SUBAGENT_TOOL_NAME = 'run_subagent'

/**
 * Step 2 (enhanced): Re-enter the agentic loop with full context + tools.
 * The model sees its original response + feedback and can use tools to fix content gaps.
 * Guards: criticizerMode=disabled (no recursion), maxToolTurns=2, max 2 tool calls + 1 subagent.
 */
async function rewriteViaLoop(
  originalResponse: string,
  feedback: string,
  ctx: ContextBundle,
  config: EngineConfig,
  registry: Registry,
  loopContext: {
    systemPrompt: string
    toolDefinitions: LLMToolDef[]
    agenticConfig: AgenticConfig
  },
): Promise<string> {
  // Filter tools: keep up to CRITICIZER_MAX_TOOL_CALLS regular tools + 1 subagent
  const subagentTool = loopContext.toolDefinitions.find(t => t.name === RUN_SUBAGENT_TOOL_NAME)
  const regularTools = loopContext.toolDefinitions
    .filter(t => t.name !== RUN_SUBAGENT_TOOL_NAME)
    .slice(0, CRITICIZER_MAX_TOOL_CALLS)
  const limitedTools = subagentTool ? [...regularTools, subagentTool] : regularTools

  const retryConfig: AgenticConfig = {
    ...loopContext.agenticConfig,
    maxToolTurns: CRITICIZER_MAX_TOOL_TURNS,
    criticizerMode: 'disabled', // ← loop guard: never re-criticize a retry
  }

  // User message: original response as assistant context + feedback as correction instruction
  const userMessage = `Tu respuesta anterior fue:\n\n${originalResponse}\n\n---\nEl revisor de calidad encontró estos problemas:\n${feedback}\n\n---\nCorrige tu respuesta incorporando el feedback. Si necesitas consultar información usa tus herramientas. Responde SOLO con la respuesta corregida, sin explicaciones ni preámbulos.`

  const result = await runAgenticLoop(
    ctx,
    loopContext.systemPrompt,
    limitedTools,
    retryConfig,
    registry,
    config,
    userMessage,
  )

  const rewritten = result.responseText.trim()
  if (rewritten.length < 10) {
    logger.warn({ traceId: ctx.traceId }, 'Criticizer loop retry returned empty/short text — keeping original')
    return originalResponse
  }

  logger.info({
    traceId: ctx.traceId,
    retryTurns: result.turns,
    retryToolsUsed: result.toolsUsed,
    retryTokens: result.tokensUsed,
  }, 'Criticizer loop retry completed')

  return rewritten
}

/**
 * Step 2 (fallback): Simple rewrite without tools or context.
 * Used when loopContext is not available (e.g., called outside the agentic delivery pipeline).
 */
async function rewriteWithFeedback(
  originalResponse: string,
  feedback: string,
  ctx: ContextBundle,
  config: EngineConfig,
): Promise<string> {
  const system = `You are a response editor for a sales agent. You receive the agent's original response and feedback from a quality reviewer. Your job is to rewrite the response incorporating the feedback.

Rules:
- Return ONLY the improved response text
- No explanation, no preamble, no labels, no headers
- Keep the same language as the original response
- Preserve the original intent and information — only improve what the feedback indicates`

  const result = await callLLM({
    task: 'criticizer-rewrite',
    system,
    messages: [
      {
        role: 'user',
        content: `Original response:\n${originalResponse}\n\nReviewer feedback:\n${feedback}\n\nRewrite the response incorporating this feedback. Return ONLY the improved response.`,
      },
    ],
    maxTokens: config.maxOutputTokens,
  })

  const rewritten = result.text.trim()
  // Safety fallback: if rewriter returns something suspiciously short or empty, keep original
  if (rewritten.length < 10) {
    logger.warn({ traceId: ctx.traceId }, 'Criticizer rewriter returned empty/short text — keeping original')
    return originalResponse
  }
  return rewritten
}
