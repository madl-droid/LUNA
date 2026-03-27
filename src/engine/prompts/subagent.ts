// LUNA Engine — Subagent Prompt Builder
// Prompt para el mini-loop con tools como function calling nativo.
// NO incluye identity.md ni guardrails.md (esos van en fase 4).

import type { ContextBundle, ExecutionStep, ToolDefinition } from '../types.js'
import { escapeDataForPrompt, wrapUserContent } from '../utils/prompt-escape.js'

const SUBAGENT_SYSTEM = `Eres un agente de ejecución. Tu trabajo es completar una tarea específica usando las herramientas disponibles.

Reglas:
- Ejecuta SOLO la tarea indicada, nada más
- Usa las herramientas disponibles para resolver la tarea
- Si no puedes completar la tarea, responde con un resumen de lo que lograste
- Sé eficiente: usa el mínimo de pasos necesarios
- NO generes respuestas conversacionales, solo ejecuta y reporta resultados
- Responde en JSON cuando no uses tools: {"status": "done|partial|failed", "result": {...}, "summary": "..."}`

/**
 * Build the subagent prompt for a specific execution step.
 */
export function buildSubagentPrompt(
  ctx: ContextBundle,
  step: ExecutionStep,
  toolDefs: ToolDefinition[],
): {
  system: string
  userMessage: string
  tools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>
} {
  const system = SUBAGENT_SYSTEM

  // Build user message with task context
  const parts: string[] = []

  // FIX: SEC-2.3 — escape LLM-generated step descriptions (second-order injection)
  parts.push(`Tarea: ${escapeDataForPrompt(step.description ?? 'Ejecutar paso del plan', 500)}`)

  if (step.params && Object.keys(step.params).length > 0) {
    parts.push(`Parámetros: ${escapeDataForPrompt(JSON.stringify(step.params), 1000)}`)
  }

  // Minimal context (no identity/guardrails)
  parts.push(`\nContexto:`)
  parts.push(`- Canal: ${ctx.message.channelName}`)
  parts.push(`- Tipo de usuario: ${ctx.userType}`)
  if (ctx.contact) {
    parts.push(`- Contacto: ${ctx.contact.displayName ?? ctx.contact.channelContactId}`)
  }

  // FIX: SEC-2.3 — escape user message
  parts.push(`\nMensaje original del contacto:\n${wrapUserContent(ctx.normalizedText)}`)

  // Convert tool definitions to LLM format
  const tools = toolDefs.map(t => ({
    name: t.name,
    description: t.description,
    inputSchema: t.parameters,
  }))

  return {
    system,
    userMessage: parts.join('\n'),
    tools,
  }
}
