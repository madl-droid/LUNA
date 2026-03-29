// LUNA Engine — Subagent Verifier
// Verifica la calidad del resultado del subagent.
// Usa el mismo modelo de Phase 2 (classifyModel).
// Veredicto: accept / retry (con feedback) / fail.

import pino from 'pino'
import type { VerificationResult } from './types.js'
import type { EngineConfig } from '../types.js'
import { callLLM } from '../utils/llm-client.js'

const logger = pino({ name: 'engine:verifier' })

const VERIFIER_SYSTEM = `Eres un verificador de calidad. Tu trabajo es evaluar si un subagente completó correctamente su tarea.

Evalúa:
1. ¿La tarea se completó según la descripción?
2. ¿Los datos retornados son coherentes y completos?
3. ¿Hay errores obvios o datos faltantes?

Responde SIEMPRE en JSON con este formato exacto:
{
  "verdict": "accept" | "retry" | "fail",
  "confidence": 0.0 a 1.0,
  "feedback": "explicación breve de por qué retry o fail (omitir si accept)",
  "issues": ["issue 1", "issue 2"] (omitir si accept)
}

Reglas:
- "accept": la tarea se completó bien, datos correctos
- "retry": la tarea se completó parcialmente o tiene errores corregibles. Incluye feedback específico para que el subagente corrija
- "fail": la tarea es imposible o los datos son irrecuperables
- Sé pragmático: si los datos son "suficientemente buenos", usa accept
- NO uses retry si el problema es que la herramienta no existe o no hay datos disponibles (eso es fail)`

/**
 * Verify the result of a subagent execution.
 * Uses the classify model (Phase 2) for consistency.
 */
export async function verifySubagentResult(
  taskDescription: string,
  result: unknown,
  success: boolean,
  config: EngineConfig,
): Promise<VerificationResult & { tokensUsed: number }> {
  try {
    const userMessage = [
      `Tarea asignada al subagente: ${taskDescription}`,
      ``,
      `Estado de ejecución: ${success ? 'completada' : 'fallida'}`,
      ``,
      `Resultado obtenido:`,
      JSON.stringify(result, null, 2)?.slice(0, 4000) ?? '(sin datos)',
    ].join('\n')

    const llmResult = await callLLM({
      task: 'subagent-verify',
      provider: config.classifyProvider,
      model: config.classifyModel,
      system: VERIFIER_SYSTEM,
      messages: [{ role: 'user', content: userMessage }],
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
