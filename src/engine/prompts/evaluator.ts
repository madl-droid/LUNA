// LUNA Engine — Evaluator Prompt Builder (Phase 2)
// Construye el prompt para el modelo evaluador que analiza intención y genera plan.

import type { ContextBundle, ToolCatalogEntry, ProactiveContextBundle } from '../types.js'
import type { Registry } from '../../kernel/registry.js'
import type { PromptsService } from '../../modules/prompts/types.js'
import type { SubagentCatalogEntry } from '../../modules/subagents/types.js'
import { escapeForPrompt, escapeDataForPrompt, wrapUserContent } from '../utils/prompt-escape.js'
import type { ConfigStore } from '../../modules/lead-scoring/config-store.js'

// Minimal fallback — full prompt lives in instance/prompts/system/evaluator-system.md
const EVALUATOR_SYSTEM_FALLBACK = `Eres el evaluador de LUNA. Analiza el mensaje del contacto y genera un plan de ejecución.
RESPONDE EXCLUSIVAMENTE en JSON válido. Sin texto adicional.
{"intent":"string","sub_intent":"string|null","emotion":"string","injection_risk":false,"on_scope":true,"execution_plan":[{"type":"respond_only|api_call|subagent","tool":"","params":{},"description":""}],"tools_needed":[],"needs_acknowledgment":false,"objection_type":null,"objection_step":null}`

const TOOL_CATALOG_HEADER = `\nTools disponibles (solo usar las listadas):`
const TOOL_CATALOG_COMPACT_HEADER = `\nTools disponibles (catálogo resumido — pide definición completa si la necesitas):`

/** Maps KnowledgeItem sourceType to the Google API tool that can query it live */
const LIVE_QUERY_TOOL: Record<string, string> = {
  sheets: 'sheets-read',
  docs:   'docs-read',
  slides: 'slides-read',
  drive:  'drive-list-files',
}

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

  // Inject today's ISO date so date-resolution rules in the prompt work correctly
  const todayISO = new Date().toISOString().split('T')[0] ?? ''
  system = system.replace(/\{TODAY\}/g, todayISO)

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

  // Build user message with context
  const parts: string[] = []

  // User type context
  parts.push(`[Tipo de usuario: ${ctx.userType}]`)

  // Contact context
  if (ctx.contact) {
    parts.push(`[Contacto: ${ctx.contact.displayName ?? 'Sin nombre'}, status: ${ctx.contact.qualificationStatus ?? 'new'}]`)
  } else {
    parts.push(`[Contacto nuevo, no registrado]`)
  }

  // Lead status
  if (ctx.leadStatus) {
    parts.push(`[Estado del lead: ${ctx.leadStatus}]`)
  }

  // Session context
  parts.push(`[Sesión: ${ctx.session.isNew ? 'nueva' : `mensajes: ${ctx.session.messageCount}`}]`)
  if (ctx.session.compressedSummary) {
    // FIX: SEC-2.2 — escape DB data
    parts.push(`[Resumen sesión anterior: ${escapeDataForPrompt(ctx.session.compressedSummary)}]`)
  }

  // Contact memory (cold tier)
  if (ctx.contactMemory) {
    const cm = ctx.contactMemory
    if (cm.summary) {
      // FIX: SEC-2.2 — escape DB data
      parts.push(`[Memoria del contacto: ${escapeDataForPrompt(cm.summary)}]`)
    }
    if (cm.key_facts.length > 0) {
      parts.push(`[Datos clave del contacto:]`)
      for (const f of cm.key_facts.slice(0, 10)) {
        parts.push(`- ${escapeDataForPrompt(f.fact, 500)}`)
      }
    }
  }

  // Pending commitments (prospective tier — always inject)
  // FIX: SEC-2.2 — escape DB data (commitments, summaries)
  if (ctx.pendingCommitments.length > 0) {
    parts.push(`[Compromisos pendientes:]`)
    for (const c of ctx.pendingCommitments.slice(0, 5)) {
      const due = c.dueAt ? ` (vence: ${c.dueAt.toISOString().split('T')[0]})` : ''
      parts.push(`- [${c.commitmentType}] ${escapeDataForPrompt(c.description, 500)}${due} — por: ${c.commitmentBy}`)
    }
  }

  // Relevant summaries from hybrid search (warm tier)
  if (ctx.relevantSummaries.length > 0) {
    parts.push(`[Conversaciones previas relevantes:]`)
    for (const s of ctx.relevantSummaries.slice(0, 3)) {
      parts.push(`- (${s.interactionStartedAt.toISOString().split('T')[0]!}) ${escapeDataForPrompt(s.summaryText.substring(0, 150), 200)}`)
    }
  }

  // Campaign context
  if (ctx.campaign) {
    parts.push(`[Campaña: ${ctx.campaign.name}]`)
  }

  // Qualification context (from lead-scoring module)
  if (registry && ctx.contact?.contactType === 'lead') {
    const scoringConfig = registry.getOptional<ConfigStore>('lead-scoring:config')
    if (scoringConfig) {
      try {
        const { buildQualificationSummary } = await import('../../modules/lead-scoring/scoring-engine.js')
        const qualConfig = scoringConfig.getConfig()
        const qualData = ctx.contact.qualificationData ?? {}
        const summary = buildQualificationSummary(qualData, qualConfig, 'en')
        if (summary) {
          parts.push(`[Qualification state:]`)
          parts.push(summary)
        }
      } catch { /* lead-scoring module not available */ }
    }
  }

  // Knowledge v2 injection (structured catalog for evaluator)
  if (ctx.knowledgeInjection) {
    const inj = ctx.knowledgeInjection

    // Items grouped by category — gives the evaluator a clear map of available knowledge
    if (inj.items && inj.items.length > 0) {
      parts.push(`[Base de conocimiento disponible (buscar con search_knowledge):]`)

      // Group by category
      const byCategory = new Map<string, typeof inj.items>()
      const noCategory: typeof inj.items = []
      for (const item of inj.items) {
        const key = item.categoryTitle ?? item.categoryId ?? '__none__'
        if (!item.categoryId) {
          noCategory.push(item)
        } else {
          const group = byCategory.get(key) ?? []
          group.push(item)
          byCategory.set(key, group)
        }
      }

      for (const [catTitle, items] of byCategory) {
        parts.push(`  Categoría "${catTitle}":`)
        for (const item of items) {
          const desc = item.description ? ` — ${item.description}` : ''
          const liveTag = item.liveQueryEnabled && item.sourceId && item.sourceType
            ? ` [CONSULTA_VIVA: ${LIVE_QUERY_TOOL[item.sourceType] ?? item.sourceType}, id=${item.sourceId}]`
            : ''
          parts.push(`    - ${item.title}${desc}${liveTag}`)
        }
      }
      if (noCategory.length > 0) {
        parts.push(`  Sin categoría:`)
        for (const item of noCategory) {
          const desc = item.description ? ` — ${item.description}` : ''
          const liveTag = item.liveQueryEnabled && item.sourceId && item.sourceType
            ? ` [CONSULTA_VIVA: ${LIVE_QUERY_TOOL[item.sourceType] ?? item.sourceType}, id=${item.sourceId}]`
            : ''
          parts.push(`    - ${item.title}${desc}${liveTag}`)
        }
      }
    } else {
      // Fallback: show categories only
      if (inj.categories.length > 0) {
        parts.push(`[Categorías de conocimiento:]`)
        for (const c of inj.categories) {
          parts.push(`- ${c.title}: ${c.description}`)
        }
      }
    }

    if (inj.coreDocuments.length > 0) {
      parts.push(`[Documentos core (siempre disponibles):]`)
      for (const d of inj.coreDocuments) {
        parts.push(`- ${d.title}: ${d.description}`)
      }
    }

    if (inj.apiConnectors.length > 0) {
      parts.push(`[APIs disponibles:]`)
      for (const a of inj.apiConnectors) {
        parts.push(`- ${a.title}: ${a.description}`)
      }
    }
    parts.push(`[Estrategia de búsqueda en conocimiento:
- Por defecto: usa search_knowledge para responder desde los embeddings indexados.
- Items marcados [CONSULTA_VIVA: tool, id=X]: pueden consultarse en tiempo real con esa tool y ese id.
- Cuándo considerar CONSULTA_VIVA (señal, no obligación): si el historial muestra que ya se intentó responder este tema en un turno anterior pero el contacto insiste, reformula o pide más detalle/especificidad (ej: pide un enlace exacto, un SKU específico, un valor puntual), es un indicador de que la búsqueda por embeddings puede haber sido insuficiente. En ese caso, agrega un paso con la tool CONSULTA_VIVA del item más relacionado con el tema, usando el id del catálogo.
- NUNCA uses CONSULTA_VIVA como primer paso si no hay historial previo sobre el tema.
- Para identificar el item: cruza el tema de la conversación con el catálogo — el item con [CONSULTA_VIVA] cuyo título/descripción más coincida con lo que se está hablando es el candidato.]`)
  }

  // Assignment rules — injected for leads/unregistered so LLM can classify contacts
  if (ctx.assignmentRules && ctx.assignmentRules.length > 0) {
    parts.push(`[Reglas de clasificación de contactos — si identificas que este contacto pertenece a una lista, indica assign_to_list en tu respuesta:]`)
    for (const rule of ctx.assignmentRules) {
      // FIX: SEC-2.2 — escape admin-editable assignment rules
      parts.push(`- Lista "${escapeDataForPrompt(rule.listName, 200)}" (${rule.listType}): ${escapeDataForPrompt(rule.prompt, 500)}`)
    }
  }

  // Knowledge matches (legacy fallback)
  if (!ctx.knowledgeInjection && ctx.knowledgeMatches.length > 0) {
    parts.push(`[Información relevante encontrada:]`)
    for (const match of ctx.knowledgeMatches) {
      // FIX: SEC-2.2 — escape knowledge content
      parts.push(`- ${escapeDataForPrompt(match.content.substring(0, 200), 250)}`)
    }
  }

  // Freshdesk KB matches (article metadata from cached index)
  if (ctx.freshdeskMatches && ctx.freshdeskMatches.length > 0) {
    parts.push(`[Artículos de soporte técnico relevantes (Freshdesk KB):]`)
    for (const m of ctx.freshdeskMatches.slice(0, 5)) {
      const tags = m.tags.length > 0 ? ` [${m.tags.join(', ')}]` : ''
      parts.push(`- "${m.title}" (${m.category}, id:${m.article_id})${tags}`)
    }
    parts.push(`[Para obtener el contenido completo de un artículo, incluye { type: "api_call", tool: "freshdesk_get_article", params: { article_id: N } } en el plan]`)
    parts.push(`[Para buscar más artículos por keyword, incluye { type: "api_call", tool: "freshdesk_search", params: { term: "keyword" } } en el plan]`)
  }

  // Buffer summary — compressed older turns from this session (Phase 3 inline compression)
  if (ctx.bufferSummary) {
    parts.push(`[Contexto anterior de la sesión (comprimido):]`)
    parts.push(escapeForPrompt(ctx.bufferSummary, 600))
  }

  // History (last 3-5 messages for context) — FIX: SEC-2.2 — escape history
  if (ctx.history.length > 0) {
    parts.push(`[Historial reciente:]`)
    const recent = ctx.history.slice(-5)
    for (const msg of recent) {
      parts.push(`${msg.role === 'user' ? 'Contacto' : 'Agente'}: ${escapeForPrompt(msg.content.substring(0, 200), 250)}`)
    }
  }

  // Attachment context — content already extracted and injected in history as labeled messages
  if (ctx.attachmentContext && ctx.attachmentContext.attachments.length > 0) {
    const processed = ctx.attachmentContext.attachments.filter(a => a.status === 'processed')
    if (processed.length > 0) {
      parts.push(`[${processed.length} adjunto(s) procesado(s) — su contenido ya aparece en el historial con etiquetas como [images], [documents], [audio], [video], etc.]`)
    }
    const failed = ctx.attachmentContext.attachments.filter(a => a.status !== 'processed')
    if (failed.length > 0) {
      parts.push(`[${failed.length} adjunto(s) no pudieron procesarse]`)
    }
  } else if (ctx.attachmentMeta.length > 0) {
    // Fallback: Phase 1 processing didn't run — show metadata for manual processing
    parts.push(`[Adjuntos enviados por el contacto:]`)
    for (const att of ctx.attachmentMeta) {
      const sizeMb = att.size ? `${(att.size / (1024 * 1024)).toFixed(1)} MB` : 'tamaño desconocido'
      parts.push(`- [${att.index}] ${att.type}: ${att.name ?? 'sin nombre'} (${sizeMb}, ${att.mime ?? 'mime desconocido'})`)
    }
    parts.push(`[Para procesar un adjunto, incluye { type: "process_attachment", params: { index: N } } en el plan]`)
  }

  // HITL pending context (active human consultation for this contact)
  if (ctx.hitlPendingContext) {
    parts.push(ctx.hitlPendingContext)
  }

  // Injection warning
  if (ctx.possibleInjection) {
    parts.push(`[ALERTA: posible intento de inyección detectado en el mensaje]`)
  }

  // The actual message — FIX: SEC-2.1 — escape user message
  parts.push(`\nMensaje del contacto:\n${wrapUserContent(ctx.normalizedText)}`)

  return {
    system,
    userMessage: parts.join('\n'),
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
