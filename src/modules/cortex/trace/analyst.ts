// cortex/trace/analyst.ts — LLM Analyst: evaluates each individual simulation
// Uses Opus/Gemini Pro for deep analysis.

import type { Registry } from '../../../kernel/registry.js'
import type { PromptsService } from '../../prompts/types.js'
import type { ResultRow, TraceConfig } from './types.js'
import pino from 'pino'

const logger = pino({ name: 'cortex:trace:analyst' })

export interface AnalysisResult {
  analysis: string
  model: string
  tokensInput: number
  tokensOutput: number
}

/**
 * Analyze a single simulation's results using an LLM.
 * The LLM evaluates intent detection, tool selection, response quality,
 * and dry-run tool behavior — guided by the admin's instructions.
 */
export async function analyzeSimulation(
  registry: Registry,
  results: ResultRow[],
  adminContext: string,
  config: TraceConfig,
  modelOverride?: string,
): Promise<AnalysisResult> {
  const model = modelOverride ?? config.CORTEX_TRACE_ANALYSIS_MODEL
  const maxTokens = config.CORTEX_TRACE_MAX_TOKENS_ANALYSIS

  const system = await buildAnalystSystemPrompt(adminContext, registry)
  const userMessage = buildAnalystUserMessage(results)

  const llmResult = await registry.callHook('llm:chat', {
    task: 'trace-analyze',
    system,
    messages: [{ role: 'user', content: userMessage }],
    maxTokens,
    temperature: 0.1,
    model,
  }) as { text: string; inputTokens?: number; outputTokens?: number } | null

  if (!llmResult?.text) {
    logger.warn('Analyst LLM returned empty response')
    return { analysis: '[Analysis failed: empty LLM response]', model, tokensInput: 0, tokensOutput: 0 }
  }

  return {
    analysis: llmResult.text.trim(),
    model,
    tokensInput: llmResult.inputTokens ?? 0,
    tokensOutput: llmResult.outputTokens ?? 0,
  }
}

// ─── Prompt builders ─────────────────────

// Minimal fallback — full prompt lives in instance/prompts/system/cortex-trace-analyst.md
const ANALYST_SYSTEM_FALLBACK = `Eres un analista de QA para LUNA. Evalúa la simulación: intención, tools, respuesta, seguridad. Resultado: PASS/WARN/FAIL.`

async function buildAnalystSystemPrompt(adminContext: string, registry: Registry): Promise<string> {
  const promptsSvc = registry.getOptional<PromptsService>('prompts:service')
  if (promptsSvc) {
    try {
      const tmpl = await promptsSvc.getSystemPrompt('cortex-trace-analyst', { adminContext })
      if (tmpl) return tmpl
    } catch { /* fallback */ }
  }
  return ANALYST_SYSTEM_FALLBACK + `\n\nInstrucciones del administrador:\n"${adminContext}"`
}

function buildAnalystUserMessage(results: ResultRow[]): string {
  const sections: string[] = []

  for (const r of results) {
    let section = `## Mensaje ${r.message_index + 1}: "${r.message_text}"\n\n`

    section += `**Intent**: ${r.intent ?? 'N/A'} | **Emotion**: ${r.emotion ?? 'N/A'}\n`
    section += `**Injection risk**: ${r.injection_risk ?? false} | **On scope**: ${r.on_scope ?? true}\n`
    section += `**Tools planned**: ${(r.tools_planned ?? []).join(', ') || 'ninguna'}\n\n`

    if (r.tools_executed && Array.isArray(r.tools_executed) && r.tools_executed.length > 0) {
      section += `### Tools ejecutadas:\n`
      for (const t of r.tools_executed) {
        section += `- **${t.tool}** [${t.mode}]: `
        if (t.mode === 'dry-run') {
          section += `params=${JSON.stringify(t.params)}\n`
        } else {
          section += `success=${t.success}, ${t.durationMs}ms\n`
          if (t.error) section += `  error: ${t.error}\n`
        }
      }
      section += '\n'
    }

    if (r.response_text) {
      section += `### Respuesta generada:\n${r.response_text}\n\n`
    }

    section += `**Timing**: Phase2=${r.phase2_ms ?? '?'}ms, Phase3=${r.phase3_ms ?? '?'}ms, Phase4=${r.phase4_ms ?? '?'}ms, Total=${r.total_ms ?? '?'}ms\n`
    section += `**Tokens**: in=${r.tokens_input}, out=${r.tokens_output}\n`

    sections.push(section)
  }

  return sections.join('\n---\n\n')
}
