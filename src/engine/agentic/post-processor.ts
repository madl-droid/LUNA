// LUNA Engine — Post Processor
// Convert AgenticResult into CompositorOutput.
// Steps: criticizer (smart mode) + tool call sanitizer + loop detection + channel formatting + TTS.

import { randomUUID } from 'node:crypto'
import pino from 'pino'
import type { Registry } from '../../kernel/registry.js'
import type { ContextBundle, CompositorOutput, EngineConfig } from '../types.js'
import type { AgenticResult } from './types.js'
import { callLLM } from '../utils/llm-client.js'
import { formatForChannel } from '../utils/message-formatter.js'
import { validateOutput } from '../output-sanitizer.js'

const logger = pino({ name: 'engine:post-processor' })

// FIX-03: raised from 3 → 6 (normal flows like knowledge+sheets+medilink = 5-6 tools easily)
const CRITICIZER_TOOL_THRESHOLD = 6

// FIX-04: loop detector constants
const REPEAT_SIMILARITY_THRESHOLD = 0.80
const REPEAT_COUNTER_TTL_S = 1800  // 30 min

// ── TTS service interface (only the methods we need) ──
interface TTSServiceLike {
  shouldAutoTTS(channel: string, inputType: string): boolean
  shouldAutoTTSWithMultiplier(channel: string, inputType: string, multiplier: number): boolean
  synthesize(text: string): Promise<{ audioBuffer: Buffer; durationSeconds: number } | null>
  synthesizeChunks(text: string): Promise<Array<{ audioBuffer: Buffer; durationSeconds: number }>>
  isEnabledForChannel(channel: string): boolean
}

// HITL manager minimal interface (to avoid direct module import)
interface HitlManagerLike {
  createTicket(input: {
    requesterContactId: string
    requesterChannel: string
    requesterSenderId: string
    sessionId?: string
    requestType: 'escalation'
    requestSummary: string
    requestContext?: Record<string, unknown>
    urgency?: 'high'
    targetRole: string
  }): Promise<{ id: string }>
}

// Memory manager minimal interface (to avoid direct module import)
interface MemoryManagerLike {
  saveMessage(m: {
    id: string
    sessionId: string
    channelName: string
    senderType: 'user' | 'agent'
    senderId: string
    content: { type: string; text?: string }
    role: 'user' | 'assistant' | 'system'
    contentText: string
    contentType: string
    createdAt: Date
  }): Promise<void>
}

/**
 * Jaccard similarity between two strings (word-level).
 * Returns 0.0–1.0. Used to detect bot response repetition.
 */
function jaccardSimilarity(a: string, b: string): number {
  const normalize = (s: string) =>
    s.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(Boolean)
  const setA = new Set(normalize(a))
  const setB = new Set(normalize(b))
  const intersection = new Set([...setA].filter(x => setB.has(x)))
  const union = new Set([...setA, ...setB])
  return union.size === 0 ? 0 : intersection.size / union.size
}

/**
 * FIX-01: Remove tool call markers that leaked into the response text.
 * Logs WARN when markers are found (indicates LLM is mixing formats).
 * Returns the sanitized text (may be empty if response was only markers).
 */
function sanitizeToolCallMarkers(text: string, traceId: string): string {
  // Use individual replaces to keep regex simple and avoid catastrophic backtracking
  let result = text
    .replace(/\[Tool call:[^\]]*\]/g, '')
    .replace(/\[tool_use:[^\]]*\]/g, '')
    .replace(/\[Calling tool:[^\]]*\]/g, '')

  // Multi-line tool_call code blocks (non-greedy)
  result = result.replace(/```tool_call[\s\S]*?```/g, '').trim()

  if (result !== text.trim()) {
    logger.warn({ traceId }, 'Tool call markers detected and cleaned from response — LLM mixing formats')
  }
  return result
}

/**
 * FIX-04: Loop detector — checks if the response is too similar to the last bot message.
 *
 * Counter behavior (Redis key: repeat:{contactId}, TTL 30min):
 * - count 1: pass through (first repeat may be legitimate)
 * - count 2: pass through + persist system note into session history for next turn
 * - count 3+: HARD STOP — send hardcoded message, create HITL ticket, reset counter
 */
async function checkRepeatLoop(
  responseText: string,
  ctx: ContextBundle,
  registry: Registry,
): Promise<{ hardStop: boolean; hardStopMessage?: string }> {
  if (!ctx.contactId) return { hardStop: false }

  // Get last assistant message from context history
  const lastBotMsg = [...ctx.history].reverse().find(m => m.role === 'assistant')
  if (!lastBotMsg) return { hardStop: false }

  const similarity = jaccardSimilarity(responseText, lastBotMsg.content)
  const redisKey = `repeat:${ctx.contactId}`
  const redis = registry.getRedis()

  if (similarity < REPEAT_SIMILARITY_THRESHOLD) {
    // Not a repeat — silently reset counter
    redis.del(redisKey).catch(() => {})
    return { hardStop: false }
  }

  // Repeat detected — increment counter
  const count = await redis.incr(redisKey)
  await redis.expire(redisKey, REPEAT_COUNTER_TTL_S)

  logger.warn({ traceId: ctx.traceId, contactId: ctx.contactId, similarity, repeatCount: count }, 'Repeat response detected')

  if (count === 2) {
    // 2nd repeat: pass through + inject system note into session history
    const note = '[SYSTEM: Repetición detectada. El agente ha dado la misma respuesta 2 veces. Debe cambiar de approach.]'
    const memManager = registry.getOptional<MemoryManagerLike>('memory:manager')
    if (memManager) {
      memManager.saveMessage({
        id: randomUUID(),
        sessionId: ctx.session.id,
        channelName: ctx.message.channelName,
        senderType: 'agent',
        senderId: 'system',
        content: { type: 'text', text: note },
        role: 'system',
        contentText: note,
        contentType: 'text',
        createdAt: new Date(),
      }).catch(err => logger.warn({ err, traceId: ctx.traceId }, 'Failed to save repeat detection system note'))
    }
    return { hardStop: false }
  }

  if (count >= 3) {
    // HARD STOP — reset counter, send hardcoded message, create HITL ticket
    logger.error({ traceId: ctx.traceId, contactId: ctx.contactId, count }, 'Repeat loop hard stop triggered')
    redis.del(redisKey).catch(() => {})

    const hitlManager = registry.getOptional<HitlManagerLike>('hitl:manager')
    if (hitlManager) {
      const lastUserMsg = [...ctx.history].reverse().find(m => m.role === 'user')
      hitlManager.createTicket({
        requesterContactId: ctx.contactId,
        requesterChannel: ctx.message.channelName,
        requesterSenderId: ctx.message.from,
        sessionId: ctx.session.id,
        requestType: 'escalation',
        requestSummary: `Loop de repetición detectado (${count} repeticiones consecutivas). Contexto del usuario: ${lastUserMsg?.content?.slice(0, 200) ?? 'desconocido'}`,
        requestContext: { repeatCount: count, similarity, traceId: ctx.traceId },
        urgency: 'high',
        targetRole: 'admin',
      }).catch(err => logger.warn({ err, traceId: ctx.traceId }, 'Failed to create HITL ticket for repeat loop'))
    }

    return {
      hardStop: true,
      hardStopMessage: 'Dame un momento, déjame revisar bien tu caso para ayudarte mejor.',
    }
  }

  // count === 1: first repeat, pass through silently
  return { hardStop: false }
}

/**
 * Convert AgenticResult into CompositorOutput.
 *
 * Steps:
 * 1. Criticizer (optional, smart mode — only for complex messages)
 * 2. Tool call marker sanitizer (FIX-01)
 * 3. Loop detector (FIX-04)
 * 4. Channel formatting
 * 5. TTS (if audio response)
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
): Promise<CompositorOutput> {
  // ── 6.1 Criticizer (smart mode) ──
  let responseText = agenticResult.responseText

  // FIX-03: threshold raised from 3 to 6
  const shouldCriticize =
    config.criticizerMode === 'always' ||
    (config.criticizerMode === 'complex_only' && (
      agenticResult.effortUsed === 'complex' ||
      agenticResult.toolCallsLog.filter(t => !t.blocked && !t.fromCache).length >= CRITICIZER_TOOL_THRESHOLD
    ))

  if (shouldCriticize && responseText.length > 50) {
    try {
      const criticized = await runCriticizer(responseText, ctx, config, registry)
      if (criticized) {
        responseText = criticized
        logger.debug({ traceId: ctx.traceId }, 'Criticizer improved response')
      }
    } catch (err) {
      logger.warn({ err, traceId: ctx.traceId }, 'Criticizer failed — using original response')
    }
  }

  // ── 6.2 Tool call marker sanitizer (FIX-01) ──
  // Must run AFTER criticizer so we also clean rewriter output.
  // Must run BEFORE delivery so markers never reach the user.
  const sanitized = sanitizeToolCallMarkers(responseText, ctx.traceId)
  if (!sanitized) {
    // Sanitization consumed everything — restore original to avoid empty message
    logger.warn({ traceId: ctx.traceId }, 'Response empty after sanitization — restoring original')
  } else {
    responseText = sanitized
  }

  // ── 6.3 Loop detector (FIX-04) ──
  const loopResult = await checkRepeatLoop(responseText, ctx, registry)
  if (loopResult.hardStop) {
    responseText = loopResult.hardStopMessage!
  }

  // ── 6.4 Channel formatting ──
  const preValidation = validateOutput(responseText)
  if (!preValidation.passed) {
    responseText = preValidation.sanitizedText
  }
  const formattedParts = formatForChannel(responseText, ctx.message.channelName, registry)

  // ── 6.5 TTS ──
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
    loopHardStop: loopResult.hardStop || undefined,
  }, 'Post-processor completed')

  // ── 6.6 Build and return CompositorOutput ──
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
): Promise<string | null> {
  // Step 1: Get feedback from reviewer
  const feedback = await getReviewFeedback(responseText, ctx, registry)
  if (!feedback) return null // APPROVED — original is fine

  logger.debug({ traceId: ctx.traceId, feedbackLength: feedback.length }, 'Criticizer has feedback — rewriting')

  // Step 2: Rewrite using feedback
  const improved = await rewriteWithFeedback(responseText, feedback, ctx, config, registry)
  return improved
}

/**
 * Step 1: Ask the reviewer LLM to evaluate the response.
 * Returns feedback text if improvements are needed, or null if APPROVED.
 *
 * FIX-02: supports both plain text ("APPROVED") and JSON ({"approved": true}) responses
 * so Gemini's JSON output is handled correctly alongside Claude's text output.
 */
async function getReviewFeedback(
  responseText: string,
  ctx: ContextBundle,
  registry: Registry,
): Promise<string | null> {
  const promptsService = registry.getOptional<{
    getPrompt(slot: string, variant?: string): Promise<string>
  }>('prompts:service')

  const system = promptsService
    ? await promptsService.getPrompt('criticizer').catch(() => '')
    : ''

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

  const feedback = result.text.trim()

  // Check plain text APPROVED format
  if (feedback.toUpperCase().startsWith('APPROVED') || feedback.length < 10) {
    return null
  }

  // FIX-02: also handle JSON format (e.g. Gemini responds with {"approved": true})
  try {
    const parsed = JSON.parse(feedback) as Record<string, unknown>
    if (parsed.approved === true) return null
    // approved === false: extract structured feedback for the rewriter
    const parts: string[] = []
    if (parsed.tone) parts.push(`Tono: ${String(parsed.tone)}`)
    if (parsed.length) parts.push(`Longitud: ${String(parsed.length)}`)
    if (Array.isArray(parsed.remove) && parsed.remove.length > 0) {
      parts.push(`Eliminar: ${(parsed.remove as unknown[]).map(String).join(', ')}`)
    }
    if (Array.isArray(parsed.add) && parsed.add.length > 0) {
      parts.push(`Agregar: ${(parsed.add as unknown[]).map(String).join(', ')}`)
    }
    if (Array.isArray(parsed.rephrase) && parsed.rephrase.length > 0) {
      parts.push(`Reformular: ${(parsed.rephrase as unknown[]).map(String).join(', ')}`)
    }
    if (parts.length > 0) return parts.join('\n')
  } catch { /* not JSON — fall through to return raw feedback */ }

  return feedback
}

/**
 * Step 2: Rewrite the original response incorporating the reviewer's feedback.
 * Returns a clean improved response — no analysis, no preamble.
 */
async function rewriteWithFeedback(
  originalResponse: string,
  feedback: string,
  ctx: ContextBundle,
  config: EngineConfig,
  registry: Registry,
): Promise<string> {
  const svc = registry.getOptional<{ getSystemPrompt(name: string): Promise<string> }>('prompts:service')
  const system = svc ? await svc.getSystemPrompt('criticizer-rewrite') : ''

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
