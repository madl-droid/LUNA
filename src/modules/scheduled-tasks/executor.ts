// scheduled-tasks/executor.ts — Executes a scheduled task via the LLM

import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import pino from 'pino'
import type { Registry } from '../../kernel/registry.js'
import type { LLMChatPayload } from '../../kernel/types.js'
import type { ScheduledTask, ScheduledTasksConfig, TaskAction } from './types.js'
import * as store from './store.js'

const logger = pino({ name: 'scheduled-tasks:executor' })

/**
 * Execute a scheduled task: call the LLM with the task prompt,
 * then run any configured actions (tools, messages, hooks).
 * Returns the combined result text.
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
    // Resolve recipient context for the system prompt
    const recipientInfo = await resolveRecipientInfo(registry, task)

    const payload: LLMChatPayload = {
      task: 'scheduled-task',
      system: buildSystemPrompt(task, recipientInfo),
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

    // Handle LLM tool calls if any
    const llmToolResults: string[] = []
    if (result?.toolCalls?.length) {
      for (const tc of result.toolCalls) {
        try {
          await registry.runHook('tools:before_execute', {
            toolName: tc.name,
            input: tc.input,
          }, traceId)

          const toolExecutor = registry.getOptional<{
            execute(name: string, input: Record<string, unknown>, context: { contactId: string; channel: string; traceId: string }): Promise<unknown>
          }>('tools:executor')

          if (toolExecutor) {
            const toolResult = await toolExecutor.execute(tc.name, tc.input, {
              contactId: `task:${task.id}`,
              channel: 'scheduled-task',
              traceId,
            })
            llmToolResults.push(`[${tc.name}]: ${JSON.stringify(toolResult)}`)
          }
        } catch (err) {
          logger.warn({ tool: tc.name, err }, 'Tool execution failed in scheduled task')
          llmToolResults.push(`[${tc.name}]: ERROR — ${String(err)}`)
        }
      }
    }

    // Execute configured actions (post-LLM)
    const actionResults = await executeActions(registry, task, responseText, traceId)

    // Build full result
    const parts = [responseText]
    if (llmToolResults.length > 0) {
      parts.push(`\n--- LLM Tool Results ---\n${llmToolResults.join('\n')}`)
    }
    if (actionResults.length > 0) {
      parts.push(`\n--- Actions ---\n${actionResults.join('\n')}`)
    }
    const fullResult = parts.join('')

    await store.finishExecution(db, execId, 'success', fullResult, null)
    await store.updateLastRun(db, task.id, 'success', fullResult)

    logger.info({ taskId: task.id, traceId, actions: task.actions.length }, 'Task executed successfully')
    return fullResult
  } catch (err) {
    const errorMsg = String(err)
    await store.finishExecution(db, execId, 'error', null, errorMsg)
    await store.updateLastRun(db, task.id, 'error', errorMsg)
    logger.error({ taskId: task.id, traceId, err }, 'Task execution failed')
    throw err
  }
}

/** Execute the task's configured actions after LLM response */
async function executeActions(
  registry: Registry,
  task: ScheduledTask,
  llmResult: string,
  traceId: string,
): Promise<string[]> {
  const results: string[] = []

  for (const action of task.actions) {
    try {
      const actionResult = await executeAction(registry, task, action, llmResult, traceId)
      results.push(actionResult)
    } catch (err) {
      results.push(`[${action.type}] ERROR: ${String(err)}`)
      logger.warn({ action: action.type, err }, 'Action execution failed')
    }
  }

  return results
}

async function executeAction(
  registry: Registry,
  task: ScheduledTask,
  action: TaskAction,
  llmResult: string,
  traceId: string,
): Promise<string> {
  switch (action.type) {
    case 'tool': {
      if (!action.toolName) return '[tool] No tool name specified'
      const toolExecutor = registry.getOptional<{
        execute(name: string, input: Record<string, unknown>, context: { contactId: string; channel: string; traceId: string }): Promise<unknown>
      }>('tools:executor')
      if (!toolExecutor) return '[tool] Tool executor not available'

      const input = action.toolInput ?? {}
      // Replace {{result}} placeholder in string values
      const resolvedInput = resolveInputPlaceholders(input, llmResult)

      const result = await toolExecutor.execute(action.toolName, resolvedInput, {
        contactId: `task:${task.id}`,
        channel: 'scheduled-task',
        traceId,
      })
      return `[tool:${action.toolName}] ${JSON.stringify(result)}`
    }

    case 'message': {
      if (!action.messageText) return '[message] No message text'
      const text = action.messageText.replace(/\{\{result\}\}/g, llmResult)
      const channel = action.messageChannel ?? 'whatsapp'

      // Resolve recipients and send
      const recipients = await resolveRecipients(registry, task)
      if (recipients.length === 0) return '[message] No recipients resolved'

      const sentResults: string[] = []
      for (const r of recipients) {
        try {
          await registry.runHook('message:send', {
            channel,
            to: r.senderId,
            content: { type: 'text', text },
            correlationId: traceId,
          }, traceId)
          sentResults.push(`sent to ${r.senderId}`)
        } catch (err) {
          sentResults.push(`failed ${r.senderId}: ${String(err)}`)
        }
      }
      return `[message:${channel}] ${sentResults.join(', ')}`
    }

    case 'hook': {
      if (!action.hookName) return '[hook] No hook name'
      await registry.runHook(action.hookName as keyof import('../../kernel/types.js').HookMap, action.hookPayload as never, traceId)
      return `[hook:${action.hookName}] fired`
    }

    case 'llm':
    default:
      return '[llm] Already executed as main prompt'
  }
}

/** Resolve {{result}} placeholders in tool input values */
function resolveInputPlaceholders(input: Record<string, unknown>, llmResult: string): Record<string, unknown> {
  const resolved: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(input)) {
    if (typeof v === 'string') {
      resolved[k] = v.replace(/\{\{result\}\}/g, llmResult)
    } else {
      resolved[k] = v
    }
  }
  return resolved
}

/** Resolve the recipients of a task based on its recipient config */
async function resolveRecipients(
  registry: Registry,
  task: ScheduledTask,
): Promise<Array<{ senderId: string; channel: string }>> {
  const recipient = task.recipient
  if (!recipient || recipient.type === 'none') return []

  const usersDb = registry.getOptional<{
    listUsers(listType: string, activeOnly?: boolean): Promise<Array<{ senderId: string; channel: string; id: string }>>
  }>('users:db')

  if (!usersDb) return []

  if (recipient.type === 'user' && recipient.userId) {
    const users = await usersDb.listUsers(recipient.group ?? 'admin')
    const user = users.find(u => u.id === recipient.userId)
    return user ? [{ senderId: user.senderId, channel: user.channel }] : []
  }

  if (recipient.type === 'group' && recipient.group) {
    const users = await usersDb.listUsers(recipient.group)
    return users.map(u => ({ senderId: u.senderId, channel: u.channel }))
  }

  return []
}

/** Build context info about recipients for the system prompt */
async function resolveRecipientInfo(registry: Registry, task: ScheduledTask): Promise<string> {
  const r = task.recipient
  if (!r || r.type === 'none') return ''

  if (r.type === 'group') {
    return `\nDestinatario: todos los usuarios del grupo "${r.group}".`
  }

  if (r.type === 'user' && r.userId) {
    const usersDb = registry.getOptional<{
      findUserById(id: string): Promise<{ displayName: string | null; senderId: string } | null>
    }>('users:db')
    if (usersDb) {
      const user = await usersDb.findUserById(r.userId)
      if (user) {
        return `\nDestinatario: ${user.displayName ?? user.senderId} (grupo "${r.group}").`
      }
    }
    return `\nDestinatario: usuario ${r.userId} del grupo "${r.group}".`
  }

  return ''
}

function buildSystemPrompt(task: ScheduledTask, recipientInfo: string): string {
  return `Eres LUNA, un agente de IA. Estas ejecutando una tarea programada.

Nombre de la tarea: ${task.name}
Tipo de activacion: ${task.trigger_type}${task.trigger_type === 'cron' ? ` (${task.cron})` : ''}${task.trigger_event ? `\nEvento: ${task.trigger_event}` : ''}${recipientInfo}

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
