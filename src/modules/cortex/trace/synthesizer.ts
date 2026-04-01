// cortex/trace/synthesizer.ts — Aggregated analysis of N simulations
// Only runs when sim_count > 1. Uses extended thinking for strategic insights.

import type { Registry } from '../../../kernel/registry.js'
import type { PromptsService } from '../../prompts/types.js'
import type { TraceConfig, RunSummary } from './types.js'
import pino from 'pino'

const logger = pino({ name: 'cortex:trace:synthesizer' })

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
  config: TraceConfig,
  modelOverride?: string,
): Promise<SynthesisResult> {
  const model = modelOverride ?? config.CORTEX_TRACE_ANALYSIS_MODEL
  const maxTokens = config.CORTEX_TRACE_MAX_TOKENS_ANALYSIS

  const system = await buildSynthesizerSystemPrompt(adminContext, summary, registry)
  const userMessage = buildSynthesizerUserMessage(analyses, summary)

  const llmResult = await registry.callHook('llm:chat', {
    task: 'trace-synthesize',
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

// Minimal fallback — full prompt lives in instance/prompts/system/cortex-trace-synthesizer.md
const SYNTHESIZER_SYSTEM_FALLBACK = `Eres un analista senior de QA. Revisa los análisis y produce un informe ejecutivo con patrones, problemas y recomendaciones. Score 0-10.`

async function buildSynthesizerSystemPrompt(adminContext: string, summary: RunSummary, registry: Registry): Promise<string> {
  const promptsSvc = registry.getOptional<PromptsService>('prompts:service')
  if (promptsSvc) {
    try {
      const tmpl = await promptsSvc.getSystemPrompt('cortex-trace-synthesizer', {
        adminContext,
        totalSimulations: String(summary.total_simulations),
      })
      if (tmpl) return tmpl
    } catch { /* fallback */ }
  }
  return SYNTHESIZER_SYSTEM_FALLBACK + `\n\n${summary.total_simulations} simulaciones. Instrucciones: "${adminContext}"`
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
    msg += `### Simulación ${i + 1}\n\n${analyses[i]!}\n\n---\n\n`
  }

  return msg
}
