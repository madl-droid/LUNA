// LUNA Engine — Post Processor
// Convert AgenticResult into CompositorOutput.
// Steps: criticizer (smart mode) + channel formatting + TTS.

import pino from 'pino'
import type { Registry } from '../../kernel/registry.js'
import type { ContextBundle, CompositorOutput, EngineConfig } from '../types.js'
import type { AgenticResult } from './types.js'
import { callLLM } from '../utils/llm-client.js'
import { formatForChannel } from '../utils/message-formatter.js'

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
): Promise<CompositorOutput> {
  // ── 6.1 Criticizer (smart mode) ──
  let responseText = agenticResult.responseText

  const shouldCriticize =
    config.criticizerMode === 'always' ||
    (config.criticizerMode === 'complex_only' && (
      agenticResult.effortUsed === 'high' ||
      agenticResult.toolCallsLog.filter(t => !t.blocked && !t.fromCache).length >= 3
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

  // ── 6.3 Channel formatting ──
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

/**
 * Run the criticizer: ask a fast model to review and optionally improve the response.
 * Reuses the pattern from phase4-compose.ts but as a focused function.
 * Returns improved text, or null if the original is fine.
 */
async function runCriticizer(
  responseText: string,
  ctx: ContextBundle,
  config: EngineConfig,
  registry: Registry,
): Promise<string | null> {
  // Load criticizer prompt from prompts:service if available
  const promptsService = registry.getOptional<{
    getPrompt(slot: string, variant?: string): Promise<string>
  }>('prompts:service')

  const criticizerPrompt = promptsService
    ? await promptsService.getPrompt('criticizer').catch(() => null)
    : null

  const system = criticizerPrompt || `You are a quality reviewer for a sales agent's response. Review the response for:
1. Accuracy — does it answer the question?
2. Tone — is it professional and warm?
3. Completeness — is anything missing?
4. Brevity — is it unnecessarily long?

If the response is good, reply with exactly: APPROVED
If it needs changes, reply with the improved response directly (no explanation, no preamble).`

  const result = await callLLM({
    task: 'criticizer',
    provider: config.classifyProvider,
    model: config.classifyModel,
    system,
    messages: [
      {
        role: 'user',
        content: `User message: ${ctx.normalizedText.slice(0, 500)}\n\nAgent response to review:\n${responseText}`,
      },
    ],
    maxTokens: config.maxOutputTokens,
    temperature: 0.2,
  })

  const critText = result.text.trim()
  if (critText === 'APPROVED' || critText.length < 10) {
    return null // Original is fine
  }
  return critText
}
