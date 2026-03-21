// scheduled-tasks/executor.ts — Executes a scheduled task via the LLM

import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import pino from 'pino'
import type { Registry } from '../../kernel/registry.js'
import type { LLMChatPayload } from '../../kernel/types.js'
import type { ScheduledTask, ScheduledTasksConfig } from './types.js'
import * as store from './store.js'

const logger = pino({ name: 'scheduled-tasks:executor' })

/**
 * Execute a scheduled task: call the LLM with the task prompt.
 * Returns the LLM response text.
 */
export async function executeTask(
  db: Pool,
  registry: Registry,
  task: ScheduledTask,
  config: ScheduledTasksConfig,
): Promise<string> {
  const traceId = randomUUID()
  const execId = await store.createExecution(db, task.id)

  try {
    const payload: LLMChatPayload = {
      task: 'scheduled-task',
      system: buildSystemPrompt(task),
      messages: [{ role: 'user', content: task.prompt }],
      temperature: 0.3,
      traceId,
    }

    // Gather available tools from the tools registry if available
    const toolsRegistry = registry.getOptional<{
      listTools(): Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>
    }>('tools:registry')

    if (toolsRegistry) {
      payload.tools = toolsRegistry.listTools()
    }

    const result = await withTimeout(
      registry.callHook('llm:chat', payload, traceId),
      config.SCHEDULED_TASKS_EXECUTION_TIMEOUT_MS,
    )

    const responseText = result?.text ?? '(sin respuesta)'

    // Handle tool calls if any
    if (result?.toolCalls?.length) {
      const toolResults: string[] = []
      for (const tc of result.toolCalls) {
        try {
          await registry.runHook('tools:before_execute', {
            toolName: tc.name,
            input: tc.input,
          }, traceId)

          // Execute the tool
          const toolExecutor = registry.getOptional<{
            execute(name: string, input: Record<string, unknown>, context: { contactId: string; channel: string; traceId: string }): Promise<unknown>
          }>('tools:executor')

          if (toolExecutor) {
            const toolResult = await toolExecutor.execute(tc.name, tc.input, {
              contactId: `task:${task.id}`,
              channel: 'scheduled-task',
              traceId,
            })
            toolResults.push(`[${tc.name}]: ${JSON.stringify(toolResult)}`)
          }
        } catch (err) {
          logger.warn({ tool: tc.name, err }, 'Tool execution failed in scheduled task')
          toolResults.push(`[${tc.name}]: ERROR — ${String(err)}`)
        }
      }

      const fullResult = toolResults.length > 0
        ? `${responseText}\n\n--- Tool Results ---\n${toolResults.join('\n')}`
        : responseText

      await store.finishExecution(db, execId, 'success', fullResult, null)
      await store.updateLastRun(db, task.id, 'success', fullResult)

      logger.info({ taskId: task.id, traceId, tools: result.toolCalls.length }, 'Task executed with tools')
      return fullResult
    }

    await store.finishExecution(db, execId, 'success', responseText, null)
    await store.updateLastRun(db, task.id, 'success', responseText)

    logger.info({ taskId: task.id, traceId }, 'Task executed successfully')
    return responseText
  } catch (err) {
    const errorMsg = String(err)
    await store.finishExecution(db, execId, 'error', null, errorMsg)
    await store.updateLastRun(db, task.id, 'error', errorMsg)
    logger.error({ taskId: task.id, traceId, err }, 'Task execution failed')
    throw err
  }
}

function buildSystemPrompt(task: ScheduledTask): string {
  return `Eres LUNA, un agente de IA. Estas ejecutando una tarea programada.

Nombre de la tarea: ${task.name}
Horario (cron): ${task.cron}

Ejecuta la instruccion del usuario. Si necesitas herramientas, usalas. Responde de forma concisa con el resultado.`
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Task execution timed out after ${ms}ms`)), ms)
    promise.then(
      (val) => { clearTimeout(timer); resolve(val) },
      (err) => { clearTimeout(timer); reject(err) },
    )
  })
}
