// LUNA Engine — Agentic Loop (v2 Core)
// Replaces Phases 2+3+4 with a single LLM conversation that has native tool access.
// The LLM calls tools natively and composes the final response in the same conversation.

import pino from 'pino'
import type { Registry } from '../../kernel/registry.js'
import type {
  ContextBundle,
  EngineConfig,
  LLMToolDef,
} from '../types.js'
import type { AgenticConfig, AgenticResult, ToolCallLog } from './types.js'
import {
  executeRunSubagentTool,
  RUN_SUBAGENT_TOOL_NAME,
} from './subagent-delegation.js'
import { callLLMWithFallback } from '../utils/llm-client.js'
import { StepSemaphore } from '../concurrency/step-semaphore.js'
import { ToolDedupCache } from './tool-dedup-cache.js'
import { ToolLoopDetector } from './tool-loop-detector.js'

const logger = pino({ name: 'engine:agentic' })

// ── Tool executor interface (only the methods we need) ──
// Avoids importing the full ToolRegistry class from modules/.
interface ToolExecutor {
  executeTool(
    name: string,
    input: Record<string, unknown>,
    context: {
      contactId?: string | null
      agentId?: string
      traceId?: string
      messageId?: string
      contactType?: string | null
    },
  ): Promise<{ toolName: string; success: boolean; data?: unknown; error?: string; durationMs: number; retries: number }>
}

/**
 * Run the agentic loop: LLM + native tool calling until the model produces a final text response.
 *
 * @param ctx - ContextBundle from Phase 1 (unchanged)
 * @param systemPrompt - Fully assembled system prompt (built by Instance 2's prompt builder)
 * @param toolDefinitions - Native-format tool definitions for the LLM (from tool registry, already converted)
 * @param config - AgenticConfig with model, effort, limits
 * @param registry - Kernel registry for service access
 * @returns AgenticResult with responseText, tool call log, token usage
 */
export async function runAgenticLoop(
  ctx: ContextBundle,
  systemPrompt: string,
  toolDefinitions: LLMToolDef[],
  config: AgenticConfig,
  registry: Registry,
  engineConfig: EngineConfig,
): Promise<AgenticResult> {
  // ── 5.1 Initialize state ──
  const startMs = Date.now()
  const dedupCache = new ToolDedupCache()
  const loopDetector = new ToolLoopDetector()
  const toolCallsLog: ToolCallLog[] = []
  let totalTokens = 0
  let turns = 0
  let partialText = '' // accumulates any text the LLM produces alongside tool calls

  // ── 5.2 Get tool executor from registry ──
  const toolExecutor = registry.getOptional<ToolExecutor>('tools:registry')
  // If no tool executor, clear tool definitions — LLM will respond text-only
  const effectiveTools = toolDefinitions.filter(tool => toolExecutor || tool.name === RUN_SUBAGENT_TOOL_NAME)

  logger.info({
    traceId: ctx.traceId,
    effort: config.effort,
    model: config.model,
    provider: config.provider,
    maxToolTurns: config.maxToolTurns,
    toolCount: effectiveTools.length,
  }, 'Agentic loop starting')

  // ── 5.3 Build initial messages array ──
  // The user message is ctx.normalizedText.
  // Attachment context is already injected into history by Phase 1.
  // The system prompt (built by Instance 2) includes conversation history from ctx.history.
  // The agentic loop only needs the current message as the user turn.
  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
    { role: 'user', content: ctx.normalizedText },
  ]

  // ── 5.4 Main loop ──
  try {
    while (turns < config.maxToolTurns) {
      // Check circuit breaker before calling LLM
      if (loopDetector.isCircuitBroken) {
        logger.warn({ traceId: ctx.traceId, turns }, 'Circuit breaker active — forcing text response')
        break // fall through to final-text-only call below
      }

      turns++

      // Call LLM
      const llmResult = await callLLMWithFallback(
        {
          task: 'agentic',
          provider: config.provider,
          model: config.model,
          system: systemPrompt,
          messages,
          maxTokens: config.maxOutputTokens,
          temperature: config.temperature,
          tools: effectiveTools.length > 0 ? effectiveTools : undefined,
        },
        config.fallbackProvider,
        config.fallbackModel,
      )

      totalTokens += llmResult.inputTokens + llmResult.outputTokens

      // No tool calls: LLM is done. Return text.
      if (!llmResult.toolCalls || llmResult.toolCalls.length === 0) {
        const responseText = llmResult.text || partialText

        logger.info({
          traceId: ctx.traceId,
          turns,
          totalTokens,
          toolCallsCount: toolCallsLog.length,
          durationMs: Date.now() - startMs,
        }, 'Agentic loop completed — text response')

        return buildResult(responseText, toolCallsLog, turns, totalTokens, config.effort)
      }

      // Has tool calls: capture any text alongside calls (partial reasoning)
      if (llmResult.text) {
        partialText = llmResult.text
      }

      // Execute all tool calls from this turn.
      // Invariant: toolExecutor is non-null here because we only send tools to the LLM
      // when toolExecutor != null (effectiveTools is empty otherwise), so the LLM
      // can only produce tool_calls when we have an executor to handle them.
      if (!toolExecutor) {
        logger.warn({ traceId: ctx.traceId, turns }, 'LLM returned tool calls but no tool executor — treating as text response')
        break
      }
      const toolResults = await executeToolCalls(
        llmResult.toolCalls,
        ctx,
        toolExecutor,
        registry,
        dedupCache,
        loopDetector,
        toolCallsLog,
        config,
        engineConfig,
      )

      // Append assistant message (with tool calls) and user message (with results)
      messages.push({
        role: 'assistant',
        content: formatAssistantToolMessage(llmResult.text, llmResult.toolCalls),
      })
      messages.push({
        role: 'user',
        content: formatToolResultsMessage(toolResults),
      })
    }
  } catch (err) {
    logger.error({ traceId: ctx.traceId, turns, err }, 'Agentic loop unexpected error')
    // If we have partial text from a previous turn, return it
    if (partialText) {
      return buildResult(partialText, toolCallsLog, turns, totalTokens, config.effort, partialText)
    }
    throw err
  }

  // ── 5.5 Handle turn limit exceeded or circuit breaker ──
  // Force a text-only response
  const reason = loopDetector.isCircuitBroken ? 'circuit_break' : 'turn_limit'
  logger.info({ traceId: ctx.traceId, turns, reason }, 'Forcing text response')

  messages.push({
    role: 'user',
    content: 'You have reached the tool call limit. Please provide your final response now using the information you have gathered so far. Do not attempt any more tool calls.',
  })

  try {
    const finalResult = await callLLMWithFallback(
      {
        task: 'agentic',
        provider: config.provider,
        model: config.model,
        system: systemPrompt,
        messages,
        maxTokens: config.maxOutputTokens,
        temperature: config.temperature,
        // NO tools parameter — forces text-only response
      },
      config.fallbackProvider,
      config.fallbackModel,
    )

    totalTokens += finalResult.inputTokens + finalResult.outputTokens
    const responseText = finalResult.text || partialText

    logger.info({
      traceId: ctx.traceId,
      turns,
      reason,
      totalTokens,
      durationMs: Date.now() - startMs,
    }, 'Agentic loop completed — forced text response')

    return buildResult(responseText, toolCallsLog, turns, totalTokens, config.effort, partialText || undefined)
  } catch (err) {
    logger.error({ traceId: ctx.traceId, turns, reason, err }, 'Final forced text response failed')
    if (partialText) {
      return buildResult(partialText, toolCallsLog, turns, totalTokens, config.effort, partialText)
    }
    throw err
  }
}

// ── Internal helpers ──

/**
 * Execute a batch of tool calls from a single LLM turn.
 * Uses StepSemaphore for parallelism, dedup cache, and loop detection.
 */
async function executeToolCalls(
  toolCalls: Array<{ name: string; input: Record<string, unknown> }>,
  ctx: ContextBundle,
  toolExecutor: ToolExecutor,
  registry: Registry,
  dedupCache: ToolDedupCache,
  loopDetector: ToolLoopDetector,
  toolCallsLog: ToolCallLog[],
  config: AgenticConfig,
  engineConfig: EngineConfig,
): Promise<Array<{ name: string; success: boolean; data: unknown; error?: string }>> {
  const semaphore = new StepSemaphore(config.maxConcurrentTools)

  const results = await Promise.allSettled(
    toolCalls.map(toolCall =>
      semaphore.run(async () => {
        // 1. Pre-check with loop detector
        const preCheck = loopDetector.preCheck(toolCall.name)
        if (preCheck.action === 'block' || preCheck.action === 'circuit_break') {
          const log: ToolCallLog = {
            name: toolCall.name,
            input: toolCall.input,
            output: null,
            success: false,
            error: preCheck.reason,
            durationMs: 0,
            fromCache: false,
            blocked: true,
            blockReason: preCheck.reason,
          }
          toolCallsLog.push(log)
          logger.warn({
            toolName: toolCall.name,
            action: preCheck.action,
            reason: preCheck.reason,
            traceId: ctx.traceId,
          }, 'Tool call pre-blocked by loop detector')
          return { name: toolCall.name, success: false, data: null, error: preCheck.reason }
        }

        // 2. Check dedup cache
        const cached = dedupCache.get(toolCall.name, toolCall.input)
        if (cached) {
          const log: ToolCallLog = {
            name: toolCall.name,
            input: toolCall.input,
            output: cached.data,
            success: cached.success,
            error: cached.error,
            durationMs: cached.durationMs,
            fromCache: true,
          }
          toolCallsLog.push(log)
          logger.debug({ toolName: toolCall.name, traceId: ctx.traceId }, 'Tool call served from dedup cache')
          return { name: toolCall.name, success: cached.success, data: cached.data, error: cached.error }
        }

        // 3. Execute via tool registry or internal meta-tool
        let result: { toolName: string; success: boolean; data?: unknown; error?: string; durationMs: number; retries: number }
        try {
          if (toolCall.name === RUN_SUBAGENT_TOOL_NAME) {
            const subagentResult = await executeRunSubagentTool(ctx, toolCall.input, engineConfig, registry)
            result = {
              toolName: toolCall.name,
              success: subagentResult.success,
              data: subagentResult.data,
              error: subagentResult.error,
              durationMs: subagentResult.durationMs,
              retries: 0,
            }
          } else {
            result = await toolExecutor.executeTool(toolCall.name, toolCall.input, {
              contactId: ctx.contactId,
              agentId: ctx.agentId,
              traceId: ctx.traceId,
              messageId: ctx.message.id,
              contactType: ctx.contact?.contactType ?? null,
            })
          }
        } catch (err) {
          // Tool execution threw — treat as error result, don't crash the loop
          const errorMsg = String(err)
          logger.error({ toolName: toolCall.name, traceId: ctx.traceId, err }, 'Tool execution threw unexpectedly')
          const log: ToolCallLog = {
            name: toolCall.name,
            input: toolCall.input,
            output: null,
            success: false,
            error: errorMsg,
            durationMs: 0,
            fromCache: false,
          }
          toolCallsLog.push(log)
          return { name: toolCall.name, success: false, data: null, error: errorMsg }
        }

        // 4. Store in dedup cache
        dedupCache.set(toolCall.name, toolCall.input, {
          data: result.data,
          success: result.success,
          error: result.error,
          durationMs: result.durationMs,
        })

        // 5. Post-check with loop detector (record call, detect patterns)
        const postCheck = loopDetector.check(toolCall.name, toolCall.input, result.data)
        if (postCheck.action === 'warn') {
          logger.warn({ toolName: toolCall.name, reason: postCheck.reason, traceId: ctx.traceId }, 'Loop detector warn')
        }

        // 6. Log to toolCallsLog
        const log: ToolCallLog = {
          name: toolCall.name,
          input: toolCall.input,
          output: result.data,
          success: result.success,
          error: result.error,
          durationMs: result.durationMs,
          fromCache: false,
        }
        toolCallsLog.push(log)

        logger.debug({
          toolName: toolCall.name,
          success: result.success,
          durationMs: result.durationMs,
          traceId: ctx.traceId,
        }, 'Tool executed')

        // 7. Return result
        return { name: toolCall.name, success: result.success, data: result.data ?? null, error: result.error }
      }),
    ),
  )

  // Collect results, converting rejections to error results
  return results.map((settled, i) => {
    const toolCall = toolCalls[i]!
    if (settled.status === 'fulfilled') {
      return settled.value
    }
    // Promise rejected (shouldn't happen since we catch inside, but guard anyway)
    const errorMsg = String(settled.reason)
    logger.error({ toolName: toolCall.name, error: errorMsg, traceId: ctx.traceId }, 'Tool call promise rejected')
    return { name: toolCall.name, success: false, data: null, error: errorMsg }
  })
}

/**
 * Format the assistant's response that contains tool calls for the conversation history.
 * Represents tool calls as structured text so the LLM can track what it did.
 */
function formatAssistantToolMessage(
  text: string | undefined,
  toolCalls: Array<{ name: string; input: Record<string, unknown> }>,
): string {
  const parts: string[] = []
  if (text) parts.push(text)
  for (const tc of toolCalls) {
    parts.push(`[Tool call: ${tc.name}(${JSON.stringify(tc.input).slice(0, 500)})]`)
  }
  return parts.join('\n')
}

/**
 * Format tool results as a user message for the conversation.
 */
function formatToolResultsMessage(
  results: Array<{ name: string; success: boolean; data: unknown; error?: string }>,
): string {
  const parts: string[] = ['Tool results:']
  for (const r of results) {
    if (r.success) {
      const dataStr = typeof r.data === 'string' ? r.data : JSON.stringify(r.data)
      parts.push(`[${r.name}]: ${(dataStr ?? '(no data)').slice(0, 3000)}`)
    } else {
      parts.push(`[${r.name}]: ERROR — ${r.error ?? 'Unknown error'}`)
    }
  }
  return parts.join('\n\n')
}

/**
 * Build the final AgenticResult from loop state.
 */
function buildResult(
  responseText: string,
  toolCallsLog: ToolCallLog[],
  turns: number,
  tokensUsed: number,
  effortUsed: import('./types.js').EffortLevel,
  partialText?: string,
): AgenticResult {
  const toolsUsed = [...new Set(toolCallsLog.filter(t => !t.blocked).map(t => t.name))]
  return {
    responseText,
    toolCallsLog,
    turns,
    tokensUsed,
    effortUsed,
    partialText,
    toolsUsed,
  }
}
