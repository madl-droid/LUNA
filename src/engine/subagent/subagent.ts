// LUNA Engine — Subagent
// Mini-loop con barandas. Recibe ContextBundle + tools como function calling nativo.
// NO recibe identity.md ni guardrails.md (esos van en fase 4).

import pino from 'pino'
import type { Registry } from '../../kernel/registry.js'
import type {
  ContextBundle,
  ExecutionStep,
  SubagentResult,
  EngineConfig,
  ToolDefinition,
} from '../types.js'
import { buildSubagentPrompt } from '../prompts/subagent.js'
import { callLLM } from '../utils/llm-client.js'
import { loadGuardrails, checkGuardrails } from './guardrails.js'

// Interface for executing tools via tools:registry service
interface ToolExecutor {
  executeTool(name: string, input: Record<string, unknown>, ctx: unknown): Promise<{ success: boolean; data?: unknown; error?: string }>
}

const logger = pino({ name: 'engine:subagent' })

/**
 * Run the subagent mini-loop for complex tasks.
 * Uses function calling nativo with guardrails.
 */
export async function runSubagent(
  ctx: ContextBundle,
  step: ExecutionStep,
  toolDefs: ToolDefinition[],
  config: EngineConfig,
  registry?: Registry,
  llmTask = 'subagent',
): Promise<SubagentResult> {
  const startMs = Date.now()

  // Load guardrails (from instance/config.json or defaults)
  const guardrails = await loadGuardrails({
    maxIterations: config.subagentMaxIterations,
    timeoutMs: config.subagentTimeoutMs,
    maxTokenBudget: config.subagentMaxTokenBudget,
    allowedTools: ctx.userPermissions.tools,
  })

  logger.info({
    traceId: ctx.traceId,
    maxIterations: guardrails.maxIterations,
    timeoutMs: guardrails.timeoutMs,
    tools: toolDefs.map(t => t.name),
  }, 'Subagent starting')

  // Build initial prompt
  const { system, userMessage, tools } = await buildSubagentPrompt(ctx, step, toolDefs, registry)

  let iterations = 0
  let tokensUsed = 0
  let lastData: unknown = null

  // Conversation turns for the subagent loop
  const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
    { role: 'user', content: userMessage },
  ]

  while (true) {
    // Check guardrails before each iteration
    const guardrailCheck = checkGuardrails(guardrails, iterations, tokensUsed, startMs)
    if (guardrailCheck.hit) {
      logger.warn({
        traceId: ctx.traceId,
        reason: guardrailCheck.reason,
        iterations,
        tokensUsed,
      }, 'Subagent guardrail hit')

      return {
        success: iterations > 0,
        data: lastData,
        iterations,
        tokensUsed,
        timedOut: guardrailCheck.reason?.includes('Timeout') ?? false,
        hitTokenLimit: guardrailCheck.reason?.includes('Token') ?? false,
        error: guardrailCheck.reason,
      }
    }

    iterations++

    try {
      // Call LLM with tools (+ optional thinking/coding from Phase 2 hints)
      const result = await callLLM({
        task: llmTask,
        provider: config.toolsProvider,
        model: config.toolsModel,
        system,
        messages,
        maxTokens: 1024,
        temperature: 0.1,
        tools: tools.length > 0 ? tools.map(t => ({
          name: t.name,
          description: t.description,
          inputSchema: t.inputSchema,
        })) : undefined,
        thinking: step.useThinking ? { type: 'adaptive', budgetTokens: 4096 } : undefined,
        codeExecution: step.useCoding ?? false,
      })

      tokensUsed += result.inputTokens + result.outputTokens

      // Check if LLM wants to use tools
      if (result.toolCalls && result.toolCalls.length > 0) {
        // Execute each tool call
        const toolResults: string[] = []

        for (const toolCall of result.toolCalls) {
          // Check if tool is allowed
          if (!guardrails.allowedTools.includes('*') && !guardrails.allowedTools.includes(toolCall.name)) {
            toolResults.push(JSON.stringify({
              tool: toolCall.name,
              error: 'Tool not allowed by guardrails',
            }))
            continue
          }

          const toolsRegistry = registry?.getOptional<ToolExecutor>('tools:registry')
          if (!toolsRegistry) {
            toolResults.push(JSON.stringify({
              tool: toolCall.name,
              error: 'Tools module not active — cannot execute tool',
            }))
            continue
          }
          const toolResult = await toolsRegistry.executeTool(toolCall.name, toolCall.input, {
            contactId: ctx.contactId,
            agentId: ctx.agentId,
            traceId: ctx.traceId,
          })
          lastData = toolResult.data
          toolResults.push(JSON.stringify({
            tool: toolCall.name,
            result: toolResult,
          }))
        }

        // Add assistant response and tool results to conversation
        messages.push({ role: 'assistant', content: result.text || `[Tool calls: ${result.toolCalls.map(t => t.name).join(', ')}]` })
        messages.push({ role: 'user', content: `Resultados de tools:\n${toolResults.join('\n')}` })

        continue  // Loop again for next iteration
      }

      // No tool calls — LLM is done
      // Try to parse the response as JSON status
      let finalData = lastData
      try {
        const parsed = JSON.parse(result.text)
        finalData = parsed.result ?? parsed
      } catch {
        finalData = result.text || lastData
      }

      logger.info({
        traceId: ctx.traceId,
        iterations,
        tokensUsed,
        durationMs: Date.now() - startMs,
      }, 'Subagent completed')

      return {
        success: true,
        data: finalData,
        iterations,
        tokensUsed,
        timedOut: false,
        hitTokenLimit: false,
      }
    } catch (err) {
      logger.error({ traceId: ctx.traceId, iteration: iterations, err }, 'Subagent LLM call failed')

      return {
        success: false,
        data: lastData,
        iterations,
        tokensUsed,
        timedOut: false,
        hitTokenLimit: false,
        error: String(err),
      }
    }
  }
}
