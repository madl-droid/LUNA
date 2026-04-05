// LUNA Engine — Subagent Verifier
// Verifica la calidad del resultado del subagent.
// Usa el mismo modelo de Phase 2 (classifyModel).
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

// Minimal fallback — full prompt lives in instance/prompts/system/subagent-verifier.md
const VERIFIER_SYSTEM_FALLBACK = `Eres un verificador de calidad. Evalúa si la tarea se completó correctamente.
Responde en JSON: {"verdict":"accept|retry|fail","confidence":0.0-1.0,"feedback":"...","issues":[]}`

/**
 * Verify the result of a subagent execution.
 * Uses the classify model (Phase 2) for consistency.
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
    // Load system prompt from .md template, fallback to minimal constant
    let systemPrompt = VERIFIER_SYSTEM_FALLBACK
    if (registry) {
      const promptsSvc = registry.getOptional<PromptsService>('prompts:service')
      if (promptsSvc) {
        const tmpl = await promptsSvc.getSystemPrompt('subagent-verifier')
        if (tmpl) systemPrompt = tmpl
      }
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
    const parsed = JSON.parse(llmResult.text)

    const verdict = ['accept', 'retry', 'fail'].includes(parsed.verdict)
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
