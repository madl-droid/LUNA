// LUNA Engine — Evaluator Prompt Builder
// Used by cortex/trace/simulator.ts for testing scenarios.
// Context layer building is delegated to context-builder.ts (shared with agentic.ts).

import type { ContextBundle, ToolCatalogEntry, ProactiveContextBundle } from '../types.js'
import type { Registry } from '../../kernel/registry.js'
import type { PromptsService } from '../../modules/prompts/types.js'
import type { SubagentCatalogEntry } from '../../modules/subagents/types.js'
import { escapeForPrompt, escapeDataForPrompt } from '../utils/prompt-escape.js'
import { buildContextLayers } from './context-builder.js'

// Minimal fallback — full prompt lives in instance/prompts/system/evaluator-system.md
const EVALUATOR_SYSTEM_FALLBACK = `Eres el evaluador de LUNA. Analiza el mensaje del contacto y genera un plan de ejecución.
RESPONDE EXCLUSIVAMENTE en JSON válido. Sin texto adicional.
{"intent":"string","sub_intent":"string|null","emotion":"string","injection_risk":false,"on_scope":true,"execution_plan":[{"type":"respond_only|api_call|subagent","tool":"","params":{},"description":""}],"tools_needed":[],"needs_acknowledgment":false,"objection_type":null,"objection_step":null}`

const TOOL_CATALOG_HEADER = `\nTools disponibles (solo usar las listadas):`
const TOOL_CATALOG_COMPACT_HEADER = `\nTools disponibles (catálogo resumido — pide definición completa si la necesitas):`

/**
 * Build the evaluator prompt for Phase 2.
 */
export async function buildEvaluatorPrompt(ctx: ContextBundle, toolCatalog: ToolCatalogEntry[], registry?: Registry, subagentCatalog?: SubagentCatalogEntry[]): Promise<{
  system: string
  userMessage: string
}> {
  // Filter catalog by user permissions
  const allowedTools = filterToolsByPermissions(toolCatalog, ctx)

  // Build system with tool catalog — try template, fallback to hardcoded
  const svc = registry?.getOptional<PromptsService>('prompts:service') ?? null
  let system = svc ? await svc.getSystemPrompt('evaluator-system') : ''
  if (!system) system = EVALUATOR_SYSTEM_FALLBACK

  // Inject current date/time using agent timezone (same source as compositor)
  // so the evaluator can resolve relative dates ("next tuesday") to ISO dates correctly
  {
    try {
      const configStore = await import('../../kernel/config-store.js')
      const db = registry?.getDb()
      const tz = db ? ((await configStore.get(db, 'AGENT_TIMEZONE').catch(() => '')) || 'UTC') : 'UTC'
      const now = new Date()
      // YYYY-MM-DD in agent's local timezone
      const todayLocal = new Intl.DateTimeFormat('en-CA', {
        timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
      }).format(now) // en-CA gives YYYY-MM-DD
      // Full readable datetime for context
      const dateStr = new Intl.DateTimeFormat('es', {
        timeZone: tz,
        weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: false,
      }).format(now).replace(',', '')
      system = system.replace(/\{TODAY\}/g, todayLocal ?? '')
      system += `\n\n--- CONTEXTO TEMPORAL ---\nFecha y hora actual: ${dateStr} (${tz})\nHoy en ISO: ${todayLocal}`
    } catch { /* best-effort — leave {TODAY} unreplaced if fails */ }
  }

  // Inject job + guardrails so the evaluator knows the agent's mission and rules
  if (svc) {
    const prompts = await svc.getCompositorPrompts(ctx.userType)
    if (prompts.job) system += `\n\n--- TRABAJO ---\n${prompts.job}`
    if (prompts.guardrails) system += `\n\n--- REGLAS ---\n${prompts.guardrails}`
  }

  if (allowedTools.length > 15) {
    // Compact catalog: name + 1-line description only
    system += TOOL_CATALOG_COMPACT_HEADER
    for (const tool of allowedTools) {
      system += `\n- ${tool.name}: ${tool.description}`
    }
  } else if (allowedTools.length > 0) {
    system += TOOL_CATALOG_HEADER
    for (const tool of allowedTools) {
      system += `\n- ${tool.name} [${tool.category}]: ${tool.description}`
    }
  }

  // Inject enabled subagent types (only if any exist)
  if (subagentCatalog && subagentCatalog.length > 0) {
    system += `\n\nSubagentes disponibles (para tareas complejas que requieren múltiples tools o razonamiento autónomo):`
    system += `\nPara usar un subagente: { "type": "subagent", "subagent_slug": "slug", "description": "tarea a realizar", "params": { "tools": ["tool1", "tool2"] } }`
    for (const sa of subagentCatalog) {
      const tools = sa.allowedTools.length > 0 ? ` [tools: ${sa.allowedTools.join(', ')}]` : ''
      system += `\n- "${sa.slug}" (${sa.name}): ${sa.description}${tools}`
    }

    // Guide evaluator to use web-researcher for web tasks
    const hasWebResearcher = subagentCatalog.some(sa => sa.slug === 'web-researcher')
    if (hasWebResearcher) {
      system += `\n\nPara búsquedas web, lectura de URLs externas, comparaciones con productos/servicios externos, o verificación de información online: usa type=subagent con subagent_slug="web-researcher".`
      system += `\nNO uses type=web_search directamente — el sistema lo redirigirá automáticamente al web-researcher.`
    }
  }

  // Inject company websites (bypass web-researcher — use web_explore directly)
  const companyWebsites = getCompanyWebsites(registry)
  if (companyWebsites.length > 0) {
    system += `\n\nSitios web de la empresa (leer con web_explore directo, NO usar web-researcher):`
    for (const url of companyWebsites) {
      system += `\n- ${url}`
    }
    system += `\nPara leer estos sitios: { "type": "api_call", "tool": "web_explore", "params": { "url": "..." } }`
  }

  // Google Apps domain routing — use native API tools instead of web scraping
  const googleToolNames = allowedTools.map(t => t.name)
  const hasDocsRead = googleToolNames.includes('docs-read')
  const hasSheetsRead = googleToolNames.includes('sheets-read')
  const hasSlidesRead = googleToolNames.includes('slides-read')
  const hasDriveGet = googleToolNames.includes('drive-get-file')
  if (hasDocsRead || hasSheetsRead || hasSlidesRead || hasDriveGet) {
    system += `\n\nURLs de Google (usar tools de API nativa, NO web_explore ni web-researcher):`
    system += `\nCuando el usuario envíe un link de Google Drive/Docs/Sheets/Slides, extrae el ID del recurso de la URL y usa la tool correspondiente:`
    if (hasDocsRead) system += `\n- docs.google.com/document/d/{ID}/... → { "type": "api_call", "tool": "docs-read", "params": { "documentId": "{ID}" } }`
    if (hasSheetsRead) system += `\n- docs.google.com/spreadsheets/d/{ID}/... → { "type": "api_call", "tool": "sheets-read", "params": { "spreadsheetId": "{ID}" } }`
    if (hasSlidesRead) system += `\n- docs.google.com/presentation/d/{ID}/... → { "type": "api_call", "tool": "slides-read", "params": { "presentationId": "{ID}" } }`
    if (hasDriveGet) system += `\n- drive.google.com/file/d/{ID}/... → { "type": "api_call", "tool": "drive-get-file", "params": { "fileId": "{ID}" } }`
    system += `\nEl ID es el string largo entre /d/ y el siguiente /. Ejemplo: https://docs.google.com/document/d/1aBcDeFgHiJk/edit → ID = "1aBcDeFgHiJk"`
  }

  // YouTube URLs — use web_explore directly, no need for web-researcher
  const hasWebExplore = googleToolNames.includes('web_explore')
  if (hasWebExplore) {
    system += `\n\nURLs de YouTube (youtube.com, youtu.be): leer con web_explore directo, NO usar web-researcher.`
    system += `\n{ "type": "api_call", "tool": "web_explore", "params": { "url": "https://youtube.com/..." } }`
  }

  // Inject HITL rules (if hitl module is active and has enabled rules)
  if (registry) {
    try {
      const hitlRules = registry.getOptional<{ getRulesForEvaluator(): Promise<string> }>('hitl:rules')
      if (hitlRules) {
        const rulesText = await hitlRules.getRulesForEvaluator()
        if (rulesText) system += `\n\n${rulesText}`
      }
    } catch { /* hitl module not active */ }
  }

  // Build user message with shared context-builder (also used by agentic.ts)
  const userMessage = await buildContextLayers(ctx, registry)

  return {
    system,
    userMessage,
  }
}

/**
 * Filter tool catalog by user permissions.
 */
function filterToolsByPermissions(
  catalog: ToolCatalogEntry[],
  ctx: ContextBundle,
): ToolCatalogEntry[] {
  // Admin gets everything
  if (ctx.userPermissions.tools.includes('*')) return catalog

  // Filter by allowed tool names
  return catalog.filter(t => ctx.userPermissions.tools.includes(t.name))
}

// ═══════════════════════════════════════════
// Proactive evaluator prompt
// ═══════════════════════════════════════════

// Minimal fallback — full prompt lives in instance/prompts/system/proactive-evaluator-system.md
const PROACTIVE_EVALUATOR_SYSTEM_FALLBACK = `You are the proactive evaluator of LUNA. Decide whether to reach out to a contact.
RESPOND EXCLUSIVELY in valid JSON. No additional text.
{"intent":"follow_up|reminder|fulfill_commitment|cancel_commitment|reactivate|escalate|no_action","emotion":"warm|professional|urgent|casual|empathetic","injection_risk":false,"on_scope":true,"execution_plan":[{"type":"respond_only|api_call","tool":"","params":{},"description":""}],"tools_needed":[],"needs_acknowledgment":false}
CRITICAL: Return intent="no_action" when in doubt.`

/**
 * Build proactive evaluator prompt for Phase 2 in proactive mode.
 */
export async function buildProactiveEvaluatorPrompt(
  ctx: ProactiveContextBundle,
  toolCatalog: ToolCatalogEntry[],
  registry?: Registry,
): Promise<{ system: string; userMessage: string }> {
  // Try template, fallback to hardcoded
  const svc = registry?.getOptional<PromptsService>('prompts:service') ?? null
  let system = svc ? await svc.getSystemPrompt('proactive-evaluator-system') : ''
  if (!system) system = PROACTIVE_EVALUATOR_SYSTEM_FALLBACK

  // Inject job + guardrails so the proactive evaluator knows the agent's mission and rules
  if (svc) {
    const prompts = await svc.getCompositorPrompts(ctx.userType ?? 'lead')
    if (prompts.job) system += `\n\n--- TRABAJO ---\n${prompts.job}`
    if (prompts.guardrails) system += `\n\n--- REGLAS ---\n${prompts.guardrails}`
  }

  // Add available tools
  if (toolCatalog.length > 0) {
    system += '\n\nAvailable tools:'
    for (const tool of toolCatalog) {
      system += `\n- ${tool.name} [${tool.category}]: ${tool.description}`
    }
  }

  const parts: string[] = []
  const trigger = ctx.proactiveTrigger

  // Trigger context
  parts.push(`[Proactive trigger: ${trigger.type}]`)
  parts.push(`[Reason: ${trigger.reason}]`)

  if (trigger.isOverdue) {
    parts.push(`[OVERDUE — this commitment is past its deadline]`)
  }

  // Contact context
  if (ctx.contact) {
    parts.push(`[Contact: ${ctx.contact.displayName ?? 'Unknown'}, status: ${ctx.contact.qualificationStatus ?? 'unknown'}]`)
  }

  // Lead status
  if (ctx.leadStatus) {
    parts.push(`[Lead status: ${ctx.leadStatus}]`)
  }

  // Contact memory — FIX: SEC-2.2 — escape DB data in proactive evaluator
  if (ctx.contactMemory) {
    if (ctx.contactMemory.summary) {
      parts.push(`[Contact memory: ${escapeDataForPrompt(ctx.contactMemory.summary)}]`)
    }
    if (ctx.contactMemory.key_facts.length > 0) {
      parts.push(`[Key facts:]`)
      for (const f of ctx.contactMemory.key_facts.slice(0, 8)) {
        parts.push(`- ${escapeDataForPrompt(f.fact, 500)}`)
      }
    }
  }

  // Commitment data (for commitment triggers)
  if (trigger.commitmentData) {
    const c = trigger.commitmentData
    parts.push(`[Commitment to fulfill:]`)
    parts.push(`- Type: ${c.commitmentType}`)
    parts.push(`- Description: ${escapeDataForPrompt(c.description, 500)}`)
    parts.push(`- Priority: ${c.priority}`)
    if (c.dueAt) parts.push(`- Due: ${c.dueAt.toISOString()}`)
    if (c.requiresTool) parts.push(`- Required tool: ${c.requiresTool}`)
    parts.push(`- Attempts so far: ${c.attemptCount}`)
  }

  // Other pending commitments
  if (ctx.pendingCommitments.length > 0) {
    parts.push(`[Other pending commitments:]`)
    for (const c of ctx.pendingCommitments.slice(0, 3)) {
      const due = c.dueAt ? ` (due: ${c.dueAt.toISOString().split('T')[0]})` : ''
      parts.push(`- [${c.commitmentType}] ${escapeDataForPrompt(c.description, 500)}${due}`)
    }
  }

  // Buffer summary — compressed older turns from this session (Phase 3 inline compression)
  if (ctx.bufferSummary) {
    parts.push(`[Prior session context (compressed):]`)
    parts.push(escapeForPrompt(ctx.bufferSummary, 600))
  }

  // Recent history — FIX: SEC-2.2 — escape history
  if (ctx.history.length > 0) {
    parts.push(`[Recent conversation:]`)
    for (const msg of ctx.history.slice(-5)) {
      parts.push(`${msg.role === 'user' ? 'Contact' : 'Agent'}: ${escapeForPrompt(msg.content.substring(0, 200), 250)}`)
    }
  }

  // Channel
  parts.push(`[Channel: ${ctx.message.channelName}]`)

  return { system, userMessage: parts.join('\n') }
}

/**
 * Get company website URLs from prompts config.
 * Used to bypass the web-researcher subagent for owned domains.
 */
function getCompanyWebsites(registry?: Registry): string[] {
  if (!registry) return []
  try {
    const promptsConfig = registry.getConfig<{ COMPANY_WEBSITES?: string }>('prompts')
    const raw = promptsConfig?.COMPANY_WEBSITES ?? ''
    return raw.split(',').map(u => u.trim()).filter(Boolean)
  } catch {
    return []
  }
}
