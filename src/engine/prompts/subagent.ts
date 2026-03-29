// LUNA Engine — Subagent Prompt Builder v2
// Prompt type-aware: usa system prompt del catálogo si existe.
// NO incluye identity.md ni guardrails.md (esos van en fase 4).

import type { ContextBundle, ExecutionStep, ToolDefinition } from '../types.js'
import type { Registry } from '../../kernel/registry.js'
import type { PromptsService } from '../../modules/prompts/types.js'
import type { SubagentCatalogEntry } from '../../modules/subagents/types.js'
import { escapeDataForPrompt, wrapUserContent } from '../utils/prompt-escape.js'

// Fallback used when no custom prompt and prompts:service not available
const SUBAGENT_SYSTEM_FALLBACK = `Eres un agente de ejecución. Tu trabajo es completar una tarea específica usando las herramientas disponibles.

Reglas:
- Ejecuta SOLO la tarea indicada, nada más
- Usa las herramientas disponibles para resolver la tarea
- Si no puedes completar la tarea, responde con un resumen de lo que lograste
- Sé eficiente: usa el mínimo de pasos necesarios
- NO generes respuestas conversacionales, solo ejecuta y reporta resultados
- Responde en JSON cuando no uses tools: {"status": "done|partial|failed", "result": {...}, "summary": "..."}`

// Spawn instructions appended when subagent can create children
const SPAWN_INSTRUCTIONS = `

IMPORTANTE sobre spawn_subagent:
- SOLO usa spawn_subagent si la tarea es DEMASIADO COMPLEJA o LARGA para completarla tú mismo
- Para tareas simples o de pocos pasos, resuélvelas directamente con tus tools
- El sub-subagente NO puede crear más hijos, así que asegúrate de darle una tarea que pueda resolver solo
- Divide el trabajo solo cuando genuinamente necesites paralelizar o separar responsabilidades`

/**
 * Build the subagent prompt for a specific execution step.
 * Uses catalog entry's system prompt if available, falls back to prompts module, then hardcoded.
 */
export async function buildSubagentPrompt(
  ctx: ContextBundle,
  step: ExecutionStep,
  toolDefs: ToolDefinition[],
  registry?: Registry,
  catalogEntry?: SubagentCatalogEntry,
): Promise<{
  system: string
  userMessage: string
  tools: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>
}> {
  // ── System prompt resolution ──
  // Priority: catalog entry custom prompt > prompts module template > fallback
  let system = ''

  if (catalogEntry?.systemPrompt) {
    system = catalogEntry.systemPrompt
  }

  if (!system) {
    const svc = registry?.getOptional<PromptsService>('prompts:service') ?? null
    system = svc ? await svc.getSystemPrompt('subagent-system') : ''
  }

  if (!system) {
    system = SUBAGENT_SYSTEM_FALLBACK
  }

  // Append spawn instructions if this subagent can spawn children
  if (catalogEntry?.canSpawnChildren) {
    system += SPAWN_INSTRUCTIONS
  }

  // ── User message ──
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

  // Subagent type info (helps the LLM understand its role)
  if (catalogEntry) {
    parts.push(`\nSubagente: ${catalogEntry.name}`)
    if (catalogEntry.description) {
      parts.push(`Rol: ${catalogEntry.description}`)
    }
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
