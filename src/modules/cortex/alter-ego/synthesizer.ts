// cortex/alter-ego/synthesizer.ts — Aggregated analysis of N simulations
// Only runs when sim_count > 1. Uses extended thinking for strategic insights.

import type { Registry } from '../../../kernel/registry.js'
import type { AlterEgoConfig, RunSummary } from './types.js'
import pino from 'pino'

const logger = pino({ name: 'cortex:alter-ego:synthesizer' })

export interface SynthesisResult {
  synthesis: string
  model: string
  tokensInput: number
  tokensOutput: number
}

/**
 * Synthesize all individual analyses into a single executive report.
 * Identifies patterns, consistency, recurring issues, and recommendations.
 */
export async function synthesizeResults(
  registry: Registry,
  analyses: string[],
  adminContext: string,
  summary: RunSummary,
  config: AlterEgoConfig,
  modelOverride?: string,
): Promise<SynthesisResult> {
  const model = modelOverride ?? config.CORTEX_ALTER_EGO_ANALYSIS_MODEL
  const maxTokens = config.CORTEX_ALTER_EGO_MAX_TOKENS_ANALYSIS

  const system = buildSynthesizerPrompt(adminContext, summary)
  const userMessage = buildSynthesizerUserMessage(analyses, summary)

  const llmResult = await registry.callHook('llm:chat', {
    task: 'alter-ego-synthesize',
    system,
    messages: [{ role: 'user', content: userMessage }],
    maxTokens,
    temperature: 0.1,
    model,
  }) as { text: string; inputTokens?: number; outputTokens?: number } | null

  if (!llmResult?.text) {
    logger.warn('Synthesizer LLM returned empty response')
    return {
      synthesis: '[Synthesis failed: empty LLM response]',
      model,
      tokensInput: 0,
      tokensOutput: 0,
    }
  }

  return {
    synthesis: llmResult.text.trim(),
    model,
    tokensInput: llmResult.inputTokens ?? 0,
    tokensOutput: llmResult.outputTokens ?? 0,
  }
}

// ─── Prompt builders ─────────────────────

function buildSynthesizerPrompt(adminContext: string, summary: RunSummary): string {
  return `Eres un analista senior de QA para un agente de IA conversacional.
El administrador ejecutó ${summary.total_simulations} simulaciones del pipeline con estas instrucciones:

"${adminContext}"

Cada simulación fue analizada individualmente. Tu trabajo es revisar TODOS los análisis
y producir un informe ejecutivo que identifique patrones y dé recomendaciones accionables.

Tu informe debe incluir:

1. **Resumen general**: ¿El agente se comporta consistentemente? ¿Pasa o falla?
2. **Patrones detectados**: ¿Hay intenciones que falla repetidamente? ¿Tools mal seleccionadas?
3. **Variabilidad**: ¿Las respuestas son consistentes o hay mucha dispersión entre simulaciones?
4. **Tools de escritura**: ¿La selección y params de tools write es consistente y correcta?
5. **Problemas recurrentes**: Lista si hay, con frecuencia (N de ${summary.total_simulations}).
6. **Recomendaciones**: Qué cambiar en prompts, tools, o configuración. Sé específico.
7. **Score general**: 0-10 con justificación.

Sé directo. El admin necesita decisiones, no prosa.`
}

function buildSynthesizerUserMessage(analyses: string[], summary: RunSummary): string {
  let msg = `## Métricas agregadas\n\n`
  msg += `- **Simulaciones**: ${summary.total_simulations}\n`
  msg += `- **Mensajes totales**: ${summary.total_messages}\n`
  msg += `- **Intents detectados**: ${Object.entries(summary.intents).map(([k, v]) => `${k}(${v})`).join(', ')}\n`
  msg += `- **Avg Phase 2**: ${summary.avg_phase2_ms}ms\n`
  msg += `- **Avg Phase 4**: ${summary.avg_phase4_ms}ms\n`
  msg += `- **Tools planificadas**: ${summary.tools_planned.join(', ') || 'ninguna'}\n`
  msg += `- **Tools dry-run**: ${summary.tools_dry_run.join(', ') || 'ninguna'}\n`
  msg += `- **Tokens**: in=${summary.total_tokens_input}, out=${summary.total_tokens_output}\n\n`

  msg += `---\n\n## Análisis individuales\n\n`
  for (let i = 0; i < analyses.length; i++) {
    msg += `### Simulación ${i + 1}\n\n${analyses[i]}\n\n---\n\n`
  }

  return msg
}
