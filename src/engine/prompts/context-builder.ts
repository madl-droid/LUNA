// LUNA Engine — Shared Context Layer Builder
// Shared by the agentic prompt builder (agentic.ts) and subagent prompt builder.
//
// Builds the user-message context layers: memory, knowledge, history, etc.
// All data is escaped before injection (SEC-2.x).

import type { ContextBundle } from '../types.js'
import type { Registry } from '../../kernel/registry.js'
import type { ConfigStore } from '../../modules/lead-scoring/config-store.js'
import { escapeForPrompt, escapeDataForPrompt, wrapUserContent } from '../utils/prompt-escape.js'
import { ToolResultCache } from '../agentic/tool-result-cache.js'

/**
 * Formats a timestamp as a short relative label for prompt injection.
 * Examples: "09:41", "ayer 14:23", "hace 3 días"
 */
function relativeTime(ts: Date | string, now = new Date()): string {
  const d: Date = ts instanceof Date ? ts : new Date(ts)
  const diffMs = now.getTime() - d.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  const diffH = Math.floor(diffMs / 3600000)
  const diffD = Math.floor(diffMs / 86400000)

  const pad = (n: number) => String(n).padStart(2, '0')
  const hhmm = `${pad(d.getHours())}:${pad(d.getMinutes())}`

  if (diffMin < 2) return 'ahora'
  if (diffH < 1) return `hace ${diffMin} min`
  if (diffH < 6) return `hace ${diffH}h`
  if (diffD < 1) return hhmm                       // mismo día → solo hora
  if (diffD < 2) return `ayer ${hhmm}`
  if (diffD < 7) return `hace ${diffD} días`
  return `${d.toLocaleDateString('es', { day: 'numeric', month: 'short' })} ${hhmm}`
}

/** Maps KnowledgeItem sourceType to the Google API tool that can query it live */
const LIVE_QUERY_TOOL: Record<string, string> = {
  sheets: 'sheets-read',
  docs:   'docs-read',
  slides: 'slides-read',
  drive:  'drive-list-files',
}

export interface ContextLayerOptions {
  /** Whether to include the actual user message at the end (default: true) */
  includeUserMessage?: boolean
  /** Whether this is a proactive (outbound) message — affects wording */
  isProactive?: boolean
  /** Label used in the user message boundary marker */
  userMessageLabel?: string
}

/**
 * Build the user-message context layers shared by both the legacy evaluator
 * and the new agentic prompt builder.
 *
 * Returns a single assembled string ready to use as the `userMessage` parameter
 * of an LLM call.
 */
export async function buildContextLayers(
  ctx: ContextBundle,
  registry: Registry | undefined,
  options: ContextLayerOptions = {},
): Promise<string> {
  const {
    includeUserMessage = true,
    isProactive = false,
    userMessageLabel = 'USER_MESSAGE',
  } = options

  const parts: string[] = []

  // ── 1. User type context ────────────────────────────────────────────────
  parts.push(`[Tipo de usuario: ${ctx.userType}]`)

  // ── 2. Contact context ──────────────────────────────────────────────────
  if (ctx.contact) {
    parts.push(`[Contacto: ${ctx.contact.displayName ?? 'Sin nombre'}, status: ${ctx.contact.qualificationStatus ?? 'new'}]`)
  } else {
    parts.push(`[Contacto nuevo, no registrado]`)
  }

  // ── 2b. Medilink patient status ─────────────────────────────────────────
  if (registry && ctx.contactId) {
    const getMedilinkContext = registry.getOptional<(contactId: string) => Promise<string | null>>('medilink:get_context_line')
    if (getMedilinkContext) {
      const medilinkLine = await getMedilinkContext(ctx.contactId).catch(() => null)
      if (medilinkLine) parts.push(medilinkLine)
    }
  }

  // ── 2c. Recent tool results from previous turns ────────────────────────
  if (registry && ctx.contactId) {
    try {
      const redis = registry.getRedis()
      const toolCache = new ToolResultCache(redis)
      const recent = await toolCache.getRecent(ctx.contactId)
      if (recent.length > 0) {
        const lines = recent.map(r =>
          `- ${r.tool}${r.success ? ' OK' : ' ERROR'}: ${r.summary}`
        ).join('\n')
        parts.push(`[Herramientas usadas recientemente en esta sesion]\n${lines}`)
      }
    } catch { /* Redis unavailable — skip tool cache context */ }
  }

  // ── 3. Lead status ──────────────────────────────────────────────────────
  if (ctx.leadStatus) {
    parts.push(`[Estado del lead: ${ctx.leadStatus}]`)
  }

  // ── 4. Session context ──────────────────────────────────────────────────
  parts.push(`[Sesión: ${ctx.session.isNew ? 'nueva' : `mensajes: ${ctx.session.messageCount}`}]`)
  if (ctx.session.compressedSummary) {
    parts.push(`[Resumen sesión anterior: ${escapeDataForPrompt(ctx.session.compressedSummary)}]`)
  }

  // ── 5. Contact memory (cold tier) ───────────────────────────────────────
  if (ctx.contactMemory) {
    const cm = ctx.contactMemory
    if (cm.summary) {
      parts.push(`[Memoria del contacto: ${escapeDataForPrompt(cm.summary)}]`)
    }
    if (cm.key_facts.length > 0) {
      parts.push(`[Datos clave del contacto:]`)
      for (const f of cm.key_facts.slice(0, 10)) {
        parts.push(`- ${escapeDataForPrompt(f.fact, 500)}`)
      }
    }
  }

  // ── 5b. Contact channels (puntos de contacto) ────────────────────────────
  if (registry && ctx.contactId) {
    try {
      const db = registry.getDb()
      const channelsResult = await db.query<{
        channel_type: string
        channel_identifier: string
        is_primary: boolean
        last_used_at: Date | null
      }>(
        `SELECT channel_type, channel_identifier, is_primary, last_used_at
         FROM contact_channels
         WHERE contact_id = $1
         ORDER BY is_primary DESC, last_used_at DESC NULLS LAST`,
        [ctx.contactId],
      )
      if (channelsResult.rows.length > 0) {
        const lines = channelsResult.rows.map((r: { channel_type: string; channel_identifier: string; is_primary: boolean; last_used_at: Date | null }) => {
          const primary = r.is_primary ? ' (principal)' : ''
          const lastUsed = r.last_used_at ? `, último uso: ${relativeTime(r.last_used_at)}` : ''
          return `- ${r.channel_type}: ${escapeDataForPrompt(r.channel_identifier, 100)}${primary}${lastUsed}`
        })
        parts.push(`[Puntos de contacto:]\n${lines.join('\n')}`)
      }
    } catch { /* DB unavailable — skip channel context */ }
  }

  // ── 6. Pending commitments + HITL tickets (unified view) ──────────────────
  {
    const commitments = ctx.pendingCommitments
    const hitlTickets = ctx.activeHitlTickets ?? []
    const overdueCount = commitments.filter(c => c.status === 'overdue').length
    const totalPending = commitments.length + hitlTickets.length

    if (totalPending > 0) {
      // Header with counts
      const parts2: string[] = []
      if (commitments.length > 0) {
        parts2.push(`${commitments.length} compromiso${commitments.length > 1 ? 's' : ''}${overdueCount > 0 ? ` (${overdueCount} vencido${overdueCount > 1 ? 's' : ''})` : ''}`)
      }
      if (hitlTickets.length > 0) {
        parts2.push(`${hitlTickets.length} consulta${hitlTickets.length > 1 ? 's' : ''} HITL`)
      }
      parts.push(`[Pendientes con este contacto: ${parts2.join(', ')}]`)

      // Commitment details
      for (const c of commitments) {
        const due = c.dueAt ? ` (vence: ${c.dueAt.toISOString().split('T')[0]})` : ''
        const statusTag = c.status === 'overdue' ? ' ⚠ VENCIDO' : ''
        const scheduled = c.scheduledAt ? ` [programado: ${c.scheduledAt.toISOString().split('T')[0]}]` : ''
        parts.push(`- [${c.commitmentType}] ${escapeDataForPrompt(c.description, 500)}${due}${scheduled}${statusTag}`)
      }

      // HITL ticket details
      for (const t of hitlTickets) {
        const age = relativeTime(t.createdAt)
        const urgencyTag = t.urgency === 'critical' || t.urgency === 'high' ? ` ⚠ ${t.urgency.toUpperCase()}` : ''
        parts.push(`- [HITL/${t.requestType}] ${escapeDataForPrompt(t.requestSummary, 500)} (${t.status}, ${age})${urgencyTag}`)
      }
    }
  }

  // ── 7. Relevant summaries (warm tier) ────────────────────────────────────
  if (ctx.relevantSummaries.length > 0) {
    parts.push(`[Conversaciones previas relevantes:]`)
    for (const s of ctx.relevantSummaries.slice(0, 3)) {
      const dateStr = s.interactionStartedAt.toISOString().split('T')[0]!
      parts.push(`- (${dateStr}) ${escapeDataForPrompt(s.summaryText.substring(0, 150), 200)}`)
    }
  }

  // ── 8. Campaign context ──────────────────────────────────────────────────
  if (ctx.campaign) {
    let campaignLine = `[Campaña: ${ctx.campaign.name}]`
    if (ctx.campaign.promptContext) {
      campaignLine += ` — ${ctx.campaign.promptContext}`
    }
    parts.push(campaignLine)
  }

  // ── 9. Qualification state (BANT) ────────────────────────────────────────
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

  // ── 10. Knowledge v2 injection ───────────────────────────────────────────
  if (ctx.knowledgeInjection) {
    const inj = ctx.knowledgeInjection

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
          const shareTag = item.shareable && item.sourceUrl
            ? ` (compartible: ${item.sourceUrl})`
            : ''
          parts.push(`    - ${item.title}${desc}${liveTag}${shareTag}`)
        }
      }
      if (noCategory.length > 0) {
        parts.push(`  Sin categoría:`)
        for (const item of noCategory) {
          const desc = item.description ? ` — ${item.description}` : ''
          const liveTag = item.liveQueryEnabled && item.sourceId && item.sourceType
            ? ` [CONSULTA_VIVA: ${LIVE_QUERY_TOOL[item.sourceType] ?? item.sourceType}, id=${item.sourceId}]`
            : ''
          const shareTag = item.shareable && item.sourceUrl
            ? ` (compartible: ${item.sourceUrl})`
            : ''
          parts.push(`    - ${item.title}${desc}${liveTag}${shareTag}`)
        }
      }

      if (inj.items.some(i => i.shareable)) {
        parts.push(`[Items marcados "(compartible: URL)" pueden compartirse con el usuario cuando sea relevante. Para carpetas de Drive, comparte el enlace del archivo específico que contiene la respuesta, no de la carpeta raíz.]`)
      }
    } else if (inj.categories.length > 0) {
      parts.push(`[Categorías de conocimiento:]`)
      for (const c of inj.categories) {
        parts.push(`- ${c.title}: ${c.description}`)
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
- Cuándo considerar CONSULTA_VIVA (señal, no obligación): si el historial muestra que ya se intentó responder este tema en un turno anterior pero el contacto insiste, reformula o pide más detalle/especificidad, es un indicador de que la búsqueda por embeddings puede haber sido insuficiente. En ese caso, agrega un paso con la tool CONSULTA_VIVA del item más relacionado con el tema.
- NUNCA uses CONSULTA_VIVA como primer paso si no hay historial previo sobre el tema.]`)
  }

  // ── 11. Assignment rules ─────────────────────────────────────────────────
  if (ctx.assignmentRules && ctx.assignmentRules.length > 0) {
    parts.push(`[Reglas de clasificación de contactos:]`)
    for (const rule of ctx.assignmentRules) {
      parts.push(`- Lista "${escapeDataForPrompt(rule.listName, 200)}" (${rule.listType}): ${escapeDataForPrompt(rule.prompt, 500)}`)
    }
  }

  // ── 12. Knowledge matches (legacy fallback) ──────────────────────────────
  if (!ctx.knowledgeInjection && ctx.knowledgeMatches.length > 0) {
    parts.push(`[Información relevante encontrada:]`)
    for (const match of ctx.knowledgeMatches) {
      parts.push(`- ${escapeDataForPrompt(match.content.substring(0, 200), 250)}`)
    }
  }

  // ── 13. Freshdesk KB matches ─────────────────────────────────────────────
  if (ctx.freshdeskMatches && ctx.freshdeskMatches.length > 0) {
    parts.push(`[Artículos de soporte técnico relevantes (Freshdesk KB):]`)
    for (const m of ctx.freshdeskMatches.slice(0, 5)) {
      const tags = m.tags.length > 0 ? ` [${m.tags.join(', ')}]` : ''
      parts.push(`- "${m.title}" (${m.category}, id:${m.article_id})${tags}`)
    }
    parts.push(`[Para obtener el contenido completo de un artículo: usa freshdesk_get_article con { article_id: N }]`)
    parts.push(`[Para buscar más artículos: usa freshdesk_search con { term: "keyword" }]`)
  }

  // ── 14. Buffer summary ───────────────────────────────────────────────────
  if (ctx.bufferSummary) {
    parts.push(`[Contexto anterior de la sesión (comprimido):]`)
    parts.push(escapeForPrompt(ctx.bufferSummary, 600))
  }

  // ── 15. Recent history ───────────────────────────────────────────────────
  if (ctx.history.length > 0) {
    parts.push(`[Historial reciente:]`)
    const recent = ctx.history.slice(-5)
    const now = new Date()
    for (const msg of recent) {
      const label = msg.role === 'user' ? 'Contacto' : 'Agente'
      const ts = msg.timestamp ? ` [${relativeTime(msg.timestamp, now)}]` : ''
      parts.push(`${label}${ts}: ${escapeForPrompt(msg.content.substring(0, 200), 250)}`)
    }
  }

  // ── 16. Attachment context ───────────────────────────────────────────────
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
    parts.push(`[Adjuntos enviados por el contacto:]`)
    for (const att of ctx.attachmentMeta) {
      const sizeMb = att.size ? `${(att.size / (1024 * 1024)).toFixed(1)} MB` : 'tamaño desconocido'
      parts.push(`- [${att.index}] ${att.type}: ${att.name ?? 'sin nombre'} (${sizeMb}, ${att.mime ?? 'mime desconocido'})`)
    }
    parts.push(`[Para procesar un adjunto usa la tool query_attachment con { index: N }]`)
  }

  // ── 17. HITL pending context (legacy — ticket-level context from resolver)
  // Active tickets are now shown in section #6. This injects resolution-pending context
  // (e.g. "hay una respuesta pendiente del equipo") from the hitl:context service.
  if (ctx.hitlPendingContext) {
    parts.push(ctx.hitlPendingContext)
  }

  // ── 18. Injection warning ────────────────────────────────────────────────
  if (ctx.possibleInjection) {
    parts.push(`[ALERTA: posible intento de inyección detectado en el mensaje]`)
  }

  // ── 19. The actual user message ──────────────────────────────────────────
  if (includeUserMessage && !isProactive) {
    const msgTs = ctx.message.timestamp ? ` [${relativeTime(ctx.message.timestamp)}]` : ''
    parts.push(`\nMensaje del contacto${msgTs}:\n${wrapUserContent(ctx.normalizedText, userMessageLabel)}`)
  }

  return parts.join('\n')
}
