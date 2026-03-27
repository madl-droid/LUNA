// LUNA — Module: tools — Tool Executor
// Ejecución con retry configurable por tool, timeout global, paralelismo con Promise.allSettled.

import pino from 'pino'
import type {
  ToolHandler,
  ToolExecutionContext,
  ToolSettings,
  ToolResult,
  ToolsConfig,
} from './types.js'

const logger = pino({ name: 'tools:executor' })

export class ToolExecutor {
  private readonly backoffMs: number
  private readonly globalTimeout: number
  private readonly maxCallsPerTurn: number

  constructor(config: ToolsConfig) {
    this.backoffMs = config.TOOLS_RETRY_BACKOFF_MS
    this.globalTimeout = config.TOOLS_EXECUTION_TIMEOUT_MS
    this.maxCallsPerTurn = config.PIPELINE_MAX_TOOL_CALLS_PER_TURN
  }

  async execute(
    toolName: string,
    handler: ToolHandler,
    input: Record<string, unknown>,
    context: ToolExecutionContext,
    settings: ToolSettings,
  ): Promise<ToolResult> {
    const maxRetries = settings.maxRetries
    let lastError: string | undefined
    let retries = 0
    const start = Date.now()

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const result = await this.executeWithTimeout(handler, input, context)
        const durationMs = Date.now() - start

        logger.info({ toolName, durationMs, retries, attempt }, 'Tool executed successfully')

        return {
          toolName,
          success: result.success,
          data: result.data,
          error: result.error,
          durationMs,
          retries,
        }
      } catch (err) {
        retries = attempt
        lastError = err instanceof Error ? err.message : String(err)

        logger.warn({ toolName, attempt, maxRetries, error: lastError }, 'Tool execution failed')

        if (!this.isRetryable(err) || attempt >= maxRetries) {
          break
        }

        // Exponential backoff
        const delay = this.backoffMs * Math.pow(2, attempt)
        await this.sleep(delay)
      }
    }

    const durationMs = Date.now() - start

    logger.error({ toolName, durationMs, retries, error: lastError }, 'Tool execution exhausted retries')

    return {
      toolName,
      success: false,
      error: lastError ?? 'Unknown error',
      durationMs,
      retries,
    }
  }

  async executeParallel(
    calls: Array<{ toolName: string; handler: ToolHandler; input: Record<string, unknown>; settings: ToolSettings }>,
    context: ToolExecutionContext,
  ): Promise<ToolResult[]> {
    // Respetar límite global
    const limited = calls.slice(0, this.maxCallsPerTurn)

    if (limited.length < calls.length) {
      logger.warn(
        { requested: calls.length, limit: this.maxCallsPerTurn },
        'Tool calls truncated to max per turn',
      )
    }

    const results = await Promise.allSettled(
      limited.map((call) =>
        this.execute(call.toolName, call.handler, call.input, context, call.settings),
      ),
    )

    return results.map((result, idx) => {
      if (result.status === 'fulfilled') {
        return result.value
      }
      return {
        toolName: limited[idx]!.toolName,
        success: false,
        error: result.reason instanceof Error ? result.reason.message : String(result.reason),
        durationMs: 0,
        retries: 0,
      }
    })
  }

  private executeWithTimeout(
    handler: ToolHandler,
    input: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<{ success: boolean; data?: unknown; error?: string }> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('Tool execution timed out'))
      }, this.globalTimeout)

      handler(input, context)
        .then((result) => {
          clearTimeout(timer)
          resolve(result)
        })
        .catch((err) => {
          clearTimeout(timer)
          reject(err)
        })
    })
  }

  private isRetryable(err: unknown): boolean {
    if (!(err instanceof Error)) return false
    const msg = err.message.toLowerCase()
    // Retry on: timeouts, network errors, 5xx
    if (msg.includes('timed out')) return true
    if (msg.includes('econnrefused')) return true
    if (msg.includes('econnreset')) return true
    if (msg.includes('enotfound')) return true
    if (msg.includes('socket hang up')) return true
    if (msg.includes('5') && msg.includes('status')) return true
    // No retry on: validation, 4xx, logic errors
    return false
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}
