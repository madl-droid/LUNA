// LUNA Engine — Subagent Prompt Builder v2
// Prompt type-aware: usa system prompt del catálogo si existe.
// NO incluye identity.md ni guardrails.md (esos van en fase 4).

import type { ContextBundle, ExecutionStep, ToolDefinition } from '../types.js'
import type { Registry } from '../../kernel/registry.js'
import type { PromptsService } from '../../modules/prompts/types.js'
import type { SubagentCatalogEntry } from '../../modules/subagents/types.js'
import type { KnowledgeManager } from '../../modules/knowledge/knowledge-manager.js'
import { escapeDataForPrompt, wrapUserContent } from '../utils/prompt-escape.js'
import { SKILL_READ_TOOL_NAME } from '../agentic/skill-delegation.js'
import { loadSkillCatalog } from './skills.js'
import { buildDatetimeSection } from './agentic.js'

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

  // Append spawn instructions if this subagent can spawn children
  if (catalogEntry?.canSpawnChildren) {
    const svcForSpawn = registry?.getOptional<PromptsService>('prompts:service') ?? null
    const spawnInstr = svcForSpawn ? await svcForSpawn.getSystemPrompt('spawn-instructions') : ''
    system += spawnInstr
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

  // ── Datetime context (subagents need temporal awareness for scheduling) ──
  if (registry) {
    const datetimeSection = await buildDatetimeSection(registry)
    if (datetimeSection) {
      parts.push(`\n<datetime>\n${datetimeSection}\n</datetime>`)
    }
  }

  // ── Skills catalog (when skill_read is in allowed tools) ──
  const hasSkillRead = toolDefs.some(t => t.name === SKILL_READ_TOOL_NAME) ||
    (catalogEntry?.allowedTools.includes(SKILL_READ_TOOL_NAME) ?? false)
  if (hasSkillRead && registry) {
    try {
      const skills = await loadSkillCatalog(registry, ctx.userType)
      if (skills.length > 0) {
        parts.push(`\n<skills>`)
        parts.push(`Habilidades disponibles (usa skill_read para obtener instrucciones completas):`)
        for (const skill of skills) {
          parts.push(`- ${skill.name}: ${skill.description}`)
        }
        parts.push(`</skills>`)
      }
    } catch {
      // Non-fatal — subagent works without skill catalog
    }
  }

  // ── Filtered knowledge catalog (only when categories assigned + search_knowledge available) ──
  const hasSearchTool = toolDefs.some(t => t.name === 'search_knowledge')
  const filteredCats = catalogEntry?.allowedKnowledgeCategories ?? []
  if (hasSearchTool && filteredCats.length > 0) {
    try {
      const km = registry?.getOptional<KnowledgeManager>('knowledge:manager')
      if (km) {
        const injection = await km.getInjection()
        // Filter categories to only those allowed
        const allowedSet = new Set(filteredCats)
        const relevantCats = injection.categories.filter(c => allowedSet.has(c.id))
        const relevantItems = (injection.items ?? []).filter(item => item.categoryId && allowedSet.has(item.categoryId))

        if (relevantCats.length > 0 || relevantItems.length > 0) {
          parts.push(`\nCatálogo de conocimiento disponible (usa search_knowledge para consultar):`)
          for (const cat of relevantCats) {
            const catItems = relevantItems.filter(i => i.categoryId === cat.id)
            const desc = cat.description ? ` — ${cat.description}` : ''
            parts.push(`  Categoría '${cat.title}'${desc}:`)
            for (const item of catItems) {
              const itemDesc = item.description ? ` — ${item.description}` : ''
              parts.push(`    - '${item.title}'${itemDesc}`)
            }
            if (catItems.length === 0) {
              parts.push(`    (sin items)`)
            }
          }
        }
      }
    } catch {
      // Non-fatal — subagent works without knowledge catalog
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
