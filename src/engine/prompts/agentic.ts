// LUNA Engine — Agentic Prompt Builder
// Builds the system prompt + user message for the agentic loop (replaces Phases 2+3+4).
// Sections are clearly tagged with XML-style markers for LLM clarity.
//
// REUSE RULES (non-negotiable):
// - PromptsService via registry.getOptional('prompts:service')
// - loadSystemPrompt() from template-loader.ts
// - escapeForPrompt/escapeDataForPrompt/wrapUserContent from prompt-escape.ts
// - buildContextLayers() from context-builder.ts
// - buildAccentSection() from accent.ts
// - loadSkillCatalog()/buildSkillCatalogSection() from skills.ts
// - getChannelLimit() logic reused from compositor.ts (inline via helper)

import type { ContextBundle, ToolCatalogEntry, ProactiveTrigger } from '../types.js'
import type { Registry } from '../../kernel/registry.js'
import type { PromptsService } from '../../modules/prompts/types.js'
import type { SubagentCatalogEntry } from '../../modules/subagents/types.js'
import { loadSystemPrompt } from '../../modules/prompts/template-loader.js'
import { buildContextLayers } from './context-builder.js'
import { buildAccentSection } from './accent.js'
import { loadSkillCatalog, buildSkillCatalogSection } from './skills.js'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AgenticPromptOptions {
  isProactive?: boolean
  proactiveTrigger?: ProactiveTrigger
  subagentCatalog?: SubagentCatalogEntry[]
}

// ─── Maps ─────────────────────────────────────────────────────────────────────

/** Map channel names to their communication category */
const CHANNEL_CATEGORIES: Record<string, string> = {
  whatsapp: 'mensajería instantánea',
  'google-chat': 'mensajería instantánea',
  instagram: 'mensajería instantánea',
  messenger: 'mensajería instantánea',
  email: 'comunicación asíncrona',
  voice: 'voz en tiempo real',
}

// ─── Main builder ─────────────────────────────────────────────────────────────

/**
 * Build the complete agentic prompt: system prompt (14 sections) + user message.
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

  // ── Section 6: <accent> ───────────────────────────────────────────────────
  const accentSection = await buildAccentSection(registry)
  if (accentSection) {
    systemParts.push(accentSection)
  }

  // ── Section 7: <agentic_instructions> ────────────────────────────────────
  const agenticInstructionsTemplate = isProactive
    ? 'proactive-agentic-system'
    : 'agentic-system'
  const agenticInstructions = await loadSystemPrompt(agenticInstructionsTemplate)
  if (agenticInstructions) {
    let instructions = agenticInstructions
    if (isProactive && proactiveTrigger) {
      instructions = instructions
        .replace(/\{triggerType\}/g, proactiveTrigger.type)
        .replace(/\{reason\}/g, proactiveTrigger.reason)
    }
    systemParts.push(`<agentic_instructions>\n${instructions}\n</agentic_instructions>`)
  }

  // ── Section 8: <channel_format> ───────────────────────────────────────────
  const channelFormat = await getChannelFormat(ctx.message.channelName, registry)
  if (channelFormat) {
    systemParts.push(`<channel_format>\n${channelFormat}\n</channel_format>`)
  }

  // ── Section 9: <voice_instructions> (audio only) ──────────────────────────
  if (ctx.responseFormat === 'audio') {
    const voiceSection = buildVoiceSection()
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
  const toolsSection = buildToolsSection(allowedTools, subagentCatalog, registry)
  if (toolsSection) {
    systemParts.push(`<tools>\n${toolsSection}\n</tools>`)
  }

  // ── Section 12: <skills> ──────────────────────────────────────────────────
  const skills = await loadSkillCatalog(registry, ctx.userType)
  const skillsSection = buildSkillCatalogSection(skills)
  if (skillsSection) {
    systemParts.push(skillsSection)
  }

  // ── Section 13: <knowledge_catalog> ──────────────────────────────────────
  // Only include here if knowledgeInjection is absent (it will be in the user message otherwise)
  if (!ctx.knowledgeInjection && ctx.knowledgeMatches.length === 0) {
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
 * Get channel format instructions.
 * Priority: 1) config_store form fields, 2) system template, 3) minimal hardcoded default.
 * Reuses the same logic as compositor.ts's getChannelLimit + buildFormatFromForm.
 */
async function getChannelFormat(channel: string, registry: Registry): Promise<string> {
  try {
    const db = registry.getDb()
    const built = await buildFormatFromForm(channel, db)
    if (built) return built
  } catch { /* fallback */ }

  const svc = registry.getOptional<PromptsService>('prompts:service')
  if (svc) {
    const tmpl = await svc.getSystemPrompt(`channel-format-${channel}`)
    if (tmpl) return tmpl
  }

  return `CANAL: ${channel.toUpperCase()} — ${CHANNEL_CATEGORIES[channel] ?? 'mensajería instantánea'}`
}

/** Build format prompt from config_store form fields (reused from compositor.ts) */
async function buildFormatFromForm(channel: string, db: import('pg').Pool): Promise<string | null> {
  const configStore = await import('../../kernel/config-store.js')
  const prefix = channel.toUpperCase()
  const all = await configStore.getAll(db)

  const tone = all[`${prefix}_FORMAT_TONE`] || 'directo'
  const maxSentences = all[`${prefix}_FORMAT_MAX_SENTENCES`] || '2'
  const maxParagraphs = all[`${prefix}_FORMAT_MAX_PARAGRAPHS`] || '2'
  const emojiLevel = all[`${prefix}_FORMAT_EMOJI_LEVEL`] || 'bajo'
  const openingSigns = all[`${prefix}_FORMAT_OPENING_SIGNS`] || 'nunca'
  const typosEnabled = all[`${prefix}_FORMAT_TYPOS_ENABLED`] === 'true'
  const typosIntensity = all[`${prefix}_FORMAT_TYPOS_INTENSITY`] || '0.3'
  const typosTypes = all[`${prefix}_FORMAT_TYPOS_TYPES`] || ''
  const audioEnabled = all[`${prefix}_FORMAT_AUDIO_ENABLED`] === 'true'
  const additionalInstructions = all[`FORMAT_INSTRUCTIONS_${prefix}`] || ''

  const category = CHANNEL_CATEGORIES[channel] ?? 'mensajería instantánea'
  const lines: string[] = []

  lines.push(`FORMATO DE RESPUESTA — ${category.toUpperCase()}`)
  lines.push(`- REGLA CLAVE: Se breve y ${tone}. Es un canal de mensajería, no es email — los mensajes largos no se leen.`)
  lines.push(`- Escribe tu respuesta con saltos de párrafo naturales (doble enter entre ideas). Cada párrafo se enviará como un mensaje separado. Usa entre 1 y ${maxParagraphs} párrafos según la situación:`)
  lines.push(`  - Saludos o respuestas cortas: un solo mensaje`)
  lines.push(`  - Respuestas con mucha información: ${maxParagraphs} (máximo absoluto)`)
  lines.push(`- MÁXIMO 1-${maxSentences} oraciones por párrafo.`)
  lines.push(`- Un párrafo = UNA idea. Si cambias de tema, nuevo párrafo.`)
  lines.push(`- PROHIBIDO: párrafos largos. Si se ve largo, está largo.`)
  lines.push(`- NO uses markdown ni formato especial, solo texto plano (es WhatsApp)`)
  lines.push(`- NUNCA uses asteriscos (*) en tus mensajes.`)
  lines.push(`- Emojis: ${emojiLevel}`)

  if (openingSigns === 'nunca') {
    lines.push(`- REGLA CRÍTICA de puntuación: los signos de exclamación e interrogación se usan SOLO al final, NUNCA al inicio.`)
    lines.push(`  Correcto: "Que bueno" "Como estas" "Perfecto, te mando la info"`)
  } else if (openingSigns === 'final') {
    lines.push(`- REGLA CRÍTICA de puntuación: usa signos de exclamación e interrogación SOLO al final.`)
    lines.push(`  Correcto: "Que bueno!" "Como estas?" "Perfecto, te mando la info!"`)
  } else if (openingSigns === 'ambos') {
    lines.push(`- REGLA CRÍTICA de puntuación: usa signos de apertura Y cierre.`)
    lines.push(`  Correcto: "¡Que bueno!" "¿Como estas?" "¡Perfecto!"`)
  }

  lines.push('')
  lines.push('Arquitectura de mensajes de venta:')
  lines.push('- Respuesta directa y corta a lo que preguntó')
  lines.push('- Link, video o recurso relevante (si aplica)')
  lines.push('- UNA pregunta que avance la conversación')

  if (typosEnabled) {
    lines.push('')
    lines.push('Naturalidad y errores (canal casual):')
    lines.push(`- Temperatura de typos: ${typosIntensity}`)
    const types = typosTypes.split(',').map(t => t.trim().toLowerCase())
    if (types.includes('tildes')) lines.push(`  - Tildes omitidas ocasionalmente`)
    if (types.includes('invertidas')) lines.push(`  - Letras invertidas ocasionales`)
    if (types.includes('doble_letra')) lines.push(`  - Doble letra accidental`)
  }

  if (audioEnabled) {
    lines.push('')
    lines.push('Notas de voz: cuando veas [RESPONDER CON AUDIO], escribe como si hablaras.')
    lines.push('- Usa frases cortas y naturales.')
    lines.push('- Evita listas, números de teléfono, URLs (no se entienden en audio).')
  }

  if (additionalInstructions.trim()) {
    lines.push('')
    lines.push(additionalInstructions.trim())
  }

  return lines.join('\n')
}

function buildVoiceSection(): string {
  return `Tu respuesta será convertida a nota de voz (audio). Escribe como si hablaras en voz alta:
- NO uses listas, viñetas, markdown ni formato visual — el contacto no las verá
- Usa frases cortas y naturales. Habla como en una conversación telefónica
- Evita compartir URLs, emails o datos que se vean mejor por escrito`
}

/**
 * Build the tools section: catalog stubs + subagent catalog + routing hints.
 * The actual tool definitions (JSON schema) are passed separately to the LLM API.
 * This section gives the LLM semantic context for WHEN/HOW to use each tool.
 */
function buildToolsSection(
  tools: ToolCatalogEntry[],
  subagentCatalog: SubagentCatalogEntry[] | undefined,
  registry: Registry,
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
    lines.push('Subagentes disponibles (para tareas complejas, autónomas o multi-herramienta):')
    for (const sa of subagentCatalog) {
      const toolList = sa.allowedTools.length > 0 ? ` [tools: ${sa.allowedTools.join(', ')}]` : ''
      lines.push(`- "${sa.slug}" (${sa.name}): ${sa.description}${toolList}`)
    }

    const hasWebResearcher = subagentCatalog.some(sa => sa.slug === 'web-researcher')
    if (hasWebResearcher) {
      lines.push('')
      lines.push('Para búsquedas web, lectura de URLs externas o verificación de información online: usa el subagente web-researcher.')
    }
  }

  // Google Apps URL routing
  const toolNames = tools.map(t => t.name)
  const googleHints = buildGoogleUrlHints(toolNames)
  if (googleHints) {
    lines.push('')
    lines.push(googleHints)
  }

  // Company websites (bypass web-researcher)
  const companyWebsites = getCompanyWebsites(registry)
  if (companyWebsites.length > 0) {
    lines.push('')
    lines.push('Sitios web de la empresa (usar web_explore directo, NO web-researcher):')
    for (const url of companyWebsites) {
      lines.push(`- ${url}`)
    }
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
  if (toolNames.includes('web_explore')) {
    hints.push('URLs de YouTube (youtube.com, youtu.be): usar web_explore directo.')
  }
  return hints.join('\n')
}

function buildKnowledgeCatalogSection(ctx: ContextBundle): string {
  // This is shown when knowledge wasn't injected via knowledgeInjection
  // (it may still be in knowledgeMatches legacy fallback handled in user message)
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

async function buildDatetimeSection(registry: Registry): Promise<string> {
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

function getCompanyWebsites(registry: Registry): string[] {
  try {
    const cfg = registry.getConfig<{ COMPANY_WEBSITES?: string }>('prompts')
    const raw = cfg?.COMPANY_WEBSITES ?? ''
    return raw.split(',').map(u => u.trim()).filter(Boolean)
  } catch {
    return []
  }
}
