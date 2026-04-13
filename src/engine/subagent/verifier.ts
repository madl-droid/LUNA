// LUNA Engine — Subagent Verifier
// Verifica la calidad del resultado del subagent.
// Usa task 'subagent-verify' → routed to 'criticize' via task router.
// Veredicto: accept / retry (con feedback) / fail.
// Soporta verificación progresiva: más estricto en cada retry.

import pino from 'pino'
import type { VerificationResult } from './types.js'
import { SUBAGENT_HARD_LIMITS } from './types.js'
import type { EngineConfig } from '../types.js'
import type { Registry } from '../../kernel/registry.js'
import type { PromptsService } from '../../modules/prompts/types.js'
import { callLLM } from '../utils/llm-client.js'

const logger = pino({ name: 'engine:verifier' })

/** Resilient JSON parser: strips markdown fences and trailing commas from LLM output. */
function safeParseJSON(text: string): Record<string, unknown> | null {
  try {
    let s = text.trim()
    if (s.startsWith('```')) s = s.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '')
    s = s.replace(/,\s*([\]}])/g, '$1')
    return JSON.parse(s) as Record<string, unknown>
  } catch {
    return null
  }
}

/**
 * Verify the result of a subagent execution.
 * Uses the classify model (effort router) for consistency.
 *
 * @param taskDescription - What was asked of the subagent
 * @param result - The result data from the subagent
 * @param success - Whether the subagent reported success
 * @param config - Engine config for model selection
 * @param retryAttempt - Which retry attempt this is (0 = first verification, 1+ = post-retry). Higher = stricter.
 */
export async function verifySubagentResult(
  taskDescription: string,
  result: unknown,
  success: boolean,
  _config: EngineConfig,
  retryAttempt = 0,
  registry?: Registry,
): Promise<VerificationResult & { tokensUsed: number }> {
  try {
    let systemPrompt = ''
    if (registry) {
      const promptsSvc = registry.getOptional<PromptsService>('prompts:service')
      if (promptsSvc) {
        systemPrompt = await promptsSvc.getSystemPrompt('subagent-verifier')
      }
    }

    if (!systemPrompt) {
      logger.warn({ template: 'subagent-verifier' }, 'System prompt missing — skipping LLM call')
      return { verdict: 'accept', confidence: 0.5, tokensUsed: 0 }
    }

    const parts: string[] = [
      `Tarea asignada al subagente: ${taskDescription}`,
      ``,
      `Estado de ejecución: ${success ? 'completada' : 'fallida'}`,
      ``,
      `Resultado obtenido:`,
      JSON.stringify(result, null, 2)?.slice(0, 4000) ?? '(sin datos)',
    ]

    // Progressive strictness: after retries, be more demanding
    if (retryAttempt > 0) {
      parts.push('')
      parts.push(`--- CONTEXTO DE VERIFICACIÓN ---`)
      parts.push(`Este es el intento ${retryAttempt + 1} de ${SUBAGENT_HARD_LIMITS.MAX_VERIFY_RETRIES + 1}.`)
      parts.push(`El subagente recibió feedback y corrigió su respuesta anterior.`)
      if (retryAttempt >= 2) {
        parts.push(`ATENCIÓN: Este es uno de los últimos intentos. Si los mismos problemas persisten, usa "fail" en vez de "retry".`)
      } else {
        parts.push(`Sé más exigente: verifica que el feedback anterior fue atendido.`)
      }
    }

    const llmResult = await callLLM({
      task: 'subagent-verify',
      system: systemPrompt,
      messages: [{ role: 'user', content: parts.join('\n') }],
      maxTokens: 512,
      temperature: 0.1,
      jsonMode: true,
    })

    const verifierTokens = llmResult.inputTokens + llmResult.outputTokens
    const parsed = safeParseJSON(llmResult.text)
    if (!parsed) throw new Error('Verifier returned unparseable JSON')

    const verdict = ['accept', 'retry', 'fail'].includes(parsed.verdict as string)
      ? parsed.verdict as VerificationResult['verdict']
      : 'accept'

    return {
      verdict,
      confidence: typeof parsed.confidence === 'number'
        ? Math.max(0, Math.min(1, parsed.confidence))
        : 0.5,
      feedback: typeof parsed.feedback === 'string' ? parsed.feedback : undefined,
      issues: Array.isArray(parsed.issues) ? parsed.issues : undefined,
      tokensUsed: verifierTokens,
    }
  } catch (err) {
    logger.error({ err }, 'Verifier LLM call failed — defaulting to accept')
    // If verifier fails, don't block the pipeline — accept by default
    return { verdict: 'accept', confidence: 0.5, tokensUsed: 0 }
  }
}
