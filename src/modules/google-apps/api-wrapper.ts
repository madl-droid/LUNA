// LUNA — Module: google-apps — API Call Wrapper
// FIX: GA-3 — Timeout and retry with exponential backoff for Google API calls.
// Retries on 429 (rate limit) and 5xx (server error).

import pino from 'pino'

const logger = pino({ name: 'google-apps:api' })

export interface GoogleApiCallConfig {
  timeoutMs: number
  maxRetries: number
}

/**
 * Execute a Google API call with timeout and retry (exponential backoff).
 * Retries on HTTP 429 and 5xx errors only.
 */
export async function googleApiCall<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  config: GoogleApiCallConfig,
  label = 'google-api',
): Promise<T> {
  let lastError: Error | undefined

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs)

    try {
      const result = await fn(controller.signal)
      return result
    } catch (err: unknown) {
      lastError = err instanceof Error ? err : new Error(String(err))
      const code = (err as { code?: number })?.code
        ?? (err as { status?: number })?.status
        ?? (err as { response?: { status?: number } })?.response?.status

      // Only retry on 429 (rate limit) and 5xx (server error)
      if (code === 429 || (typeof code === 'number' && code >= 500 && code < 600)) {
        if (attempt < config.maxRetries) {
          const retryAfter = (err as { response?: { headers?: Record<string, string> } })
            ?.response?.headers?.['retry-after']
          const delay = retryAfter ? parseInt(retryAfter, 10) * 1000 : Math.pow(2, attempt) * 1000
          logger.warn({ label, attempt, delay, code }, 'Google API retrying...')
          await new Promise(r => setTimeout(r, delay))
          continue
        }
      }

      // Abort errors (timeout)
      if (controller.signal.aborted) {
        throw new Error(`${label} timed out after ${config.timeoutMs}ms`)
      }

      // Non-retryable error
      throw err
    } finally {
      clearTimeout(timeout)
    }
  }

  throw lastError
}
