// LUNA Engine — Agentic Prompt Builder
// Builds the system prompt + user message for the agentic loop (replaces Phases 2+3+4).
// Sections are clearly tagged with XML-style markers for LLM clarity.
//
// REUSE RULES (non-negotiable):
// - PromptsService via registry.getOptional('prompts:service')
// - loadSystemPrompt() from template-loader.ts
// - escapeForPrompt/escapeDataForPrompt/wrapUserContent from prompt-escape.ts
// - buildContextLayers() from context-builder.ts
// - loadSkillCatalog()/buildSkillCatalogSection() from skills.ts
// - getChannelLimit() imported from channel-format.ts (not duplicated)

import type { ContextBundle, ToolCatalogEntry, ProactiveTrigger } from '../types.js'
import type { Registry } from '../../kernel/registry.js'
import type { PromptsService } from '../../modules/prompts/types.js'
import type { SubagentCatalogEntry } from '../../modules/subagents/types.js'
import { loadSystemPrompt, renderTemplate } from '../../modules/prompts/template-loader.js'
import { getChannelLimit } from './channel-format.js'
import { buildContextLayers } from './context-builder.js'
import { loadSkillCatalog, buildSkillCatalogSection, filterSkillsByTools } from './skills.js'

interface TTSServiceLike {
  shouldAutoTTS(channel: string, inputType: string): boolean
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AgenticPromptOptions {
  isProactive?: boolean
  proactiveTrigger?: ProactiveTrigger
  subagentCatalog?: SubagentCatalogEntry[]
}

// ─── Main builder ─────────────────────────────────────────────────────────────

/**
 * Build the complete agentic prompt: system prompt (13 sections) + user message.
 *
 * System sections (in order):
 *  1. <security>          — non-overridable security rules
 *  2. <identity>          — agent persona with dynamic config fields
 *  3. <job>               — job instructions
 *  4. <guardrails>        — behavior rules
 *  5. <relationship>      — tone for this user type
 *  6. <accent>            — dynamic accent (optional)
 *  7. <agentic_instructions> — how to use tools in the loop
 *  8. <channel_format>    — channel-specific formatting rules
 *  9. <voice_instructions> — only when responseFormat === 'audio'
 * 10. <quality_checklist> — criticizer checklist
 * 11. <tools>             — tool catalog stubs (short descriptions)
 * 12. <skills>            — skill catalog stubs
 * 13. <knowledge_catalog> — available knowledge (only if no injection in user msg)
 * 14. <datetime>          — current date/time in agent's timezone
 *
 * User message: full context layers via buildContextLayers() +
 *               proactive trigger info (if isProactive)
 */
export async function buildAgenticPrompt(
  ctx: ContextBundle,
  toolCatalog: ToolCatalogEntry[],
  registry: Registry,
  options: AgenticPromptOptions = {},
): Promise<{ system: string; userMessage: string }> {
  const { isProactive = false, proactiveTrigger, subagentCatalog } = options

  const svc = registry.getOptional<PromptsService>('prompts:service')
  const systemParts: string[] = []

  // ── Section 1: <security> ─────────────────────────────────────────────────
  const securityPreamble = await loadSystemPrompt('security-preamble')
  if (securityPreamble) {
    systemParts.push(`<security>\n${securityPreamble}\n</security>`)
  }

  // ── Knowledge mandate (hardcoded — non-removable by admin) ────────────────
  const knowledgeMandate = await loadSystemPrompt('knowledge-mandate')
  if (knowledgeMandate) {
    systemParts.push(`<knowledge_mandate>\n${knowledgeMandate}\n</knowledge_mandate>`)
  }

  // ── Sections 2–5: identity, job, guardrails, relationship ─────────────────
  if (svc) {
    const prompts = await svc.getCompositorPrompts(ctx.userType)

    if (prompts.identity) {
      systemParts.push(`<identity>\n${prompts.identity}\n</identity>`)
    }
    if (prompts.job) {
      systemParts.push(`<job>\n${prompts.job}\n</job>`)
    }
    if (prompts.guardrails) {
      systemParts.push(`<guardrails>\n${prompts.guardrails}\n</guardrails>`)
    }
    if (prompts.relationship) {
      systemParts.push(`<relationship>\n${prompts.relationship}\n</relationship>`)
    }
  }

  // ── Section 7: <agentic_instructions> ────────────────────────────────────
  const agenticInstructionsTemplate = isProactive
    ? 'proactive-agentic-system'
    : 'agentic-system'
  const agenticInstructions = await loadSystemPrompt(agenticInstructionsTemplate)
  if (agenticInstructions) {
    const instructions = (isProactive && proactiveTrigger)
      ? renderTemplate(agenticInstructions, {
          triggerType: proactiveTrigger.type,
          reason: proactiveTrigger.reason,
        })
      : agenticInstructions
    systemParts.push(`<agentic_instructions>\n${instructions}\n</agentic_instructions>`)
  }

  // ── Section 8: <channel_format> ───────────────────────────────────────────
  const channelFormat = await getChannelLimit(ctx.message.channelName, registry)
  if (channelFormat) {
    systemParts.push(`<channel_format>\n${channelFormat}\n</channel_format>`)
  }

  // ── Section 9: <voice_instructions> (audio only) ──────────────────────────
  const ttsService = registry.getOptional<TTSServiceLike>('tts:service') ?? null
  const prepareForVoice = ctx.responseFormat === 'audio'
    || (ctx.responseFormat === 'auto' && !!ttsService?.shouldAutoTTS(ctx.message.channelName, ctx.messageType))

  if (prepareForVoice) {
    const voiceSection = svc ? await svc.getSystemPrompt('voice-tts-format') : ''
    const voiceTags = svc ? await svc.getSystemPrompt('tts-voice-tags') : ''
    let voiceContent = voiceSection
    if (voiceTags) voiceContent += `\n\n${voiceTags}`
    systemParts.push(`<voice_instructions>\n${voiceContent}\n</voice_instructions>`)
  }

  // ── Section 10: <quality_checklist> ──────────────────────────────────────
  if (svc) {
    const prompts = await svc.getCompositorPrompts(ctx.userType)
    const criticBase = await svc.getSystemPrompt('criticizer-base')
    const criticizer = [criticBase, prompts.criticizer].filter(Boolean).join('\n')
    if (criticizer) {
      systemParts.push(`<quality_checklist>\n${criticizer}\n</quality_checklist>`)
    }
  }

  // ── Section 11: <tools> ───────────────────────────────────────────────────
  const allowedTools = filterToolsByPermissions(toolCatalog, ctx)
  const toolsSection = buildToolsSection(allowedTools, subagentCatalog)
  if (toolsSection) {
    systemParts.push(`<tools>\n${toolsSection}\n</tools>`)
  }

  // ── Section 12: <skills> ──────────────────────────────────────────────────
  // Catalog only — full content is fetched on-demand by the agent via the skill_read tool.
  // Skills filtered by: userType (frontmatter) → requiredTools → userPermissions.skills
  const skills = await loadSkillCatalog(registry, ctx.userType)
  const activeToolNames = new Set(allowedTools.map((t: { name: string }) => t.name))
  const skillsByTools = filterSkillsByTools(skills, activeToolNames)
  const allowedSkills = ctx.userPermissions.skills
  const filteredSkills = (!allowedSkills || allowedSkills.length === 0 || allowedSkills.includes('*'))
    ? skillsByTools
    : skillsByTools.filter(s => allowedSkills.includes(s.name))
  const stubSection = buildSkillCatalogSection(filteredSkills)
  if (stubSection) {
    systemParts.push(stubSection)
  }

  // ── Section 13: <knowledge_catalog> ──────────────────────────────────────
  // Show categories/core-docs catalog in system prompt when knowledgeInjection exists.
  // The detailed matched items are injected in the user message via buildContextLayers().
  // This gives the LLM a high-level map of available knowledge before reading the specifics.
  if (ctx.knowledgeInjection) {
    const knowledgeMeta = buildKnowledgeCatalogSection(ctx)
    if (knowledgeMeta) {
      systemParts.push(`<knowledge_catalog>\n${knowledgeMeta}\n</knowledge_catalog>`)
    }
  }

  // ── Section 14: <datetime> ────────────────────────────────────────────────
  const datetimeSection = await buildDatetimeSection(registry)
  if (datetimeSection) {
    systemParts.push(`<datetime>\n${datetimeSection}\n</datetime>`)
  }

  // ── User message ──────────────────────────────────────────────────────────
  const userMessage = await buildUserMessage(ctx, registry, isProactive, proactiveTrigger)

  return {
    system: systemParts.join('\n\n'),
    userMessage,
  }
}

// ─── System section builders ──────────────────────────────────────────────────

/**
 * Build the tools section: catalog stubs + subagent catalog + routing hints.
 * The actual tool definitions (JSON schema) are passed separately to the LLM API.
 * This section gives the LLM semantic context for WHEN/HOW to use each tool.
 */
function buildToolsSection(
  tools: ToolCatalogEntry[],
  subagentCatalog: SubagentCatalogEntry[] | undefined,
): string {
  if (tools.length === 0 && (!subagentCatalog || subagentCatalog.length === 0)) return ''

  const lines: string[] = ['Herramientas disponibles (las definiciones JSON se incluyen automáticamente):']

  if (tools.length > 0) {
    for (const tool of tools) {
      lines.push(`- ${tool.name} [${tool.category}]: ${tool.description}`)
    }
  }

  if (subagentCatalog && subagentCatalog.length > 0) {
    lines.push('')
    lines.push('Subagentes disponibles — DELEGA a un subagente usando run_subagent(subagent_slug, task) cuando las instrucciones lo indiquen:')
    for (const sa of subagentCatalog) {
      lines.push(`- "${sa.slug}" (${sa.name}): ${sa.description}`)
    }
  }

  // Google Apps URL routing
  const toolNames = tools.map(t => t.name)
  const googleHints = buildGoogleUrlHints(toolNames)
  if (googleHints) {
    lines.push('')
    lines.push(googleHints)
  }

  return lines.join('\n')
}

function buildGoogleUrlHints(toolNames: string[]): string {
  const hints: string[] = []
  if (toolNames.includes('docs-read') || toolNames.includes('sheets-read') ||
      toolNames.includes('slides-read') || toolNames.includes('drive-get-file')) {
    hints.push('URLs de Google (usar tools de API nativa, NO web_explore):')
    if (toolNames.includes('docs-read')) hints.push('- docs.google.com/document/d/{ID}/... → docs-read con documentId="{ID}"')
    if (toolNames.includes('sheets-read')) hints.push('- docs.google.com/spreadsheets/d/{ID}/... → sheets-read con spreadsheetId="{ID}"')
    if (toolNames.includes('slides-read')) hints.push('- docs.google.com/presentation/d/{ID}/... → slides-read con presentationId="{ID}"')
    if (toolNames.includes('drive-get-file')) hints.push('- drive.google.com/file/d/{ID}/... → drive-get-file con fileId="{ID}"')
    hints.push('El ID es el string entre /d/ y el siguiente /')
  }
  return hints.join('\n')
}

function buildKnowledgeCatalogSection(ctx: ContextBundle): string {
  // Caller guarantees ctx.knowledgeInjection is present.
  if (!ctx.knowledgeInjection) return ''
  const inj = ctx.knowledgeInjection
  const lines: string[] = []

  if (inj.categories.length > 0) {
    lines.push('Categorías de conocimiento disponibles (buscar con search_knowledge):')
    for (const c of inj.categories) {
      lines.push(`- ${c.title}: ${c.description}`)
    }
  }
  if (inj.coreDocuments.length > 0) {
    lines.push('Documentos core (siempre disponibles):')
    for (const d of inj.coreDocuments) {
      lines.push(`- ${d.title}: ${d.description}`)
    }
  }

  return lines.join('\n')
}

export async function buildDatetimeSection(registry: Registry): Promise<string> {
  try {
    const configStore = await import('../../kernel/config-store.js')
    const db = registry.getDb()
    const tz = (await configStore.get(db, 'AGENT_TIMEZONE').catch(() => '')) || 'UTC'
    const now = new Date()
    const todayLocal = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(now)
    const dateStr = new Intl.DateTimeFormat('es', {
      timeZone: tz,
      weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(now).replace(',', '')
    return `Fecha y hora actual: ${dateStr} (${tz})\nHoy en ISO: ${todayLocal}`
  } catch {
    return ''
  }
}

// ─── User message builder ─────────────────────────────────────────────────────

async function buildUserMessage(
  ctx: ContextBundle,
  registry: Registry,
  isProactive: boolean,
  proactiveTrigger?: ProactiveTrigger,
): Promise<string> {
  // Build shared context layers (memory, knowledge, history, etc.)
  const contextLayers = await buildContextLayers(ctx, registry, {
    includeUserMessage: !isProactive,
    isProactive,
  })

  if (!isProactive) {
    return contextLayers
  }

  // Proactive mode: add trigger info + no user message (we're initiating)
  const parts: string[] = [contextLayers]

  if (proactiveTrigger) {
    parts.push(`\n[Trigger proactivo: ${proactiveTrigger.type}]`)
    parts.push(`[Razón: ${proactiveTrigger.reason}]`)
    if (proactiveTrigger.isOverdue) {
      parts.push(`[VENCIDO — este compromiso pasó su fecha límite]`)
    }
    if (proactiveTrigger.commitmentData) {
      const c = proactiveTrigger.commitmentData
      parts.push(`[Compromiso a cumplir:]`)
      parts.push(`- Tipo: ${c.commitmentType}`)
      parts.push(`- Descripción: ${c.description}`)
      parts.push(`- Prioridad: ${c.priority}`)
      if (c.dueAt) parts.push(`- Vence: ${c.dueAt.toISOString()}`)
      if (c.requiresTool) parts.push(`- Tool requerida: ${c.requiresTool}`)
      parts.push(`- Intentos previos: ${c.attemptCount}`)
    }
  }

  parts.push(`\n[Canal: ${ctx.message.channelName}]`)
  parts.push(`[Inicia el contacto. Si la situación no justifica el outreach, responde exactamente: [NO_ACTION]]`)

  return parts.join('\n')
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function filterToolsByPermissions(
  catalog: ToolCatalogEntry[],
  ctx: ContextBundle,
): ToolCatalogEntry[] {
  if (ctx.userPermissions.tools.includes('*')) return catalog
  return catalog.filter(t => ctx.userPermissions.tools.includes(t.name))
}

