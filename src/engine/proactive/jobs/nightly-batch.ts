// LUNA Engine — Nightly Batch Job
// Procesos nocturnos: scoring de leads, compresión de memoria, reportes.
// Idempotente: usa fecha como flag. Config desde engine:nightly-config service.

import pino from 'pino'
import type { ProactiveJobContext } from '../../types.js'
import type { PromptsService } from '../../../modules/prompts/types.js'
import type { MemoryManager } from '../../../modules/memory/memory-manager.js'

const logger = pino({ name: 'engine:job:nightly-batch' })

interface NightlyConfig {
  scoringEnabled: boolean
  scoringThreshold: number
  scoringBatchSize: number
  compressionEnabled: boolean
  compressionMinMessages: number
  compressionBatchSize: number
  reportEnabled: boolean
  reportSheetId: string
  reportSheetName: string
}

const DEFAULTS: NightlyConfig = {
  scoringEnabled: true,
  scoringThreshold: 40,
  scoringBatchSize: 100,
  compressionEnabled: true,
  compressionMinMessages: 30,
  compressionBatchSize: 20,
  reportEnabled: true,
  reportSheetId: '',
  reportSheetName: 'Daily Report',
}

// FIX: E-30 — Use agent slug from config instead of hardcoded 'luna'
function getAgentId(ctx: ProactiveJobContext): string {
  return ctx.engineConfig.agentSlug
}

/** Get batch LLM model/provider from engine config (proactive task routing) */
function getBatchModel(ctx: ProactiveJobContext): { provider?: string; model?: string } {
  return { provider: ctx.engineConfig.proactiveProvider, model: ctx.engineConfig.proactiveModel }
}

function getNightlyConfig(ctx: ProactiveJobContext): NightlyConfig {
  const svc = ctx.registry.getOptional<{ get(): NightlyConfig }>('engine:nightly-config')
  return svc ? svc.get() : DEFAULTS
}

/**
 * Run nightly batch processes.
 */
export async function runNightlyBatch(ctx: ProactiveJobContext): Promise<void> {
  const today = new Date().toISOString().split('T')[0]
  const redisKey = `batch:completed:${today}`

  logger.info({ traceId: ctx.traceId, date: today }, 'Nightly batch starting')

  // Idempotency check
  const alreadyRan = await ctx.redis.get(redisKey)
  if (alreadyRan) {
    logger.info({ traceId: ctx.traceId }, 'Nightly batch already completed today')
    return
  }

  try {
    // 1. Score cold leads
    await scoreColdLeads(ctx)

    // 2. Compress old sessions
    await compressOldSessions(ctx)

    // 3. Generate daily report
    await generateDailyReport(ctx)

    // 4. Auto-embed knowledge items that are missing embeddings
    await scanAndEmbedKnowledgeItems(ctx)

    // 5. Embed summary chunks that are missing embeddings
    await embedSummaryChunks(ctx)

    // Mark as completed
    await ctx.redis.set(redisKey, '1', 'EX', 86400)

    logger.info({ traceId: ctx.traceId, date: today }, 'Nightly batch complete')
  } catch (err) {
    logger.error({ traceId: ctx.traceId, err }, 'Nightly batch failed')
  }
}

// ─── 1. Score Cold Leads ──────────────────────

async function scoreColdLeads(ctx: ProactiveJobContext): Promise<void> {
  const config = getNightlyConfig(ctx)
  if (!config.scoringEnabled) {
    logger.debug({ traceId: ctx.traceId }, 'Cold lead scoring disabled')
    return
  }

  logger.info({ traceId: ctx.traceId, batchSize: config.scoringBatchSize }, 'Scoring cold leads')

  try {
    const agentSlug = getAgentId(ctx)
    const result = await ctx.db.query(
      `SELECT c.id, c.display_name, ac.qualification_data, ac.qualification_score
       FROM contacts c
       JOIN agent_contacts ac ON ac.contact_id = c.id
         AND ac.agent_id = (SELECT id FROM agents WHERE slug = $2 LIMIT 1)
       WHERE c.contact_type = 'lead'
         AND ac.lead_status = 'cold'
       ORDER BY ac.updated_at DESC
       LIMIT $1`,
      [config.scoringBatchSize, agentSlug],
    )

    if (result.rows.length === 0) {
      logger.info({ traceId: ctx.traceId }, 'No cold leads to score')
      return
    }

    let reactivated = 0
    let scored = 0

    for (const row of result.rows) {
      try {
        const qualData = row.qualification_data ?? {}
        const dataStr = Object.entries(qualData)
          .map(([k, v]) => `- ${k}: ${v}`)
          .join('\n') || '(sin datos)'

        // Load session summaries for this contact
        const summaries = await ctx.db.query(
          `SELECT summary_text FROM session_summaries
           WHERE contact_id = $1 ORDER BY created_at DESC LIMIT 3`,
          [row.id],
        ).catch(() => ({ rows: [] }))

        const historyStr = summaries.rows.length > 0
          ? summaries.rows.map((s: Record<string, string>) => s.summary_text).join('\n---\n')
          : '(sin historial)'

        const displayName = row.display_name ?? 'Sin nombre'
        const promptsSvc = ctx.registry.getOptional<PromptsService>('prompts:service')
        let coldLeadUserContent = ''
        if (promptsSvc) {
          coldLeadUserContent = await promptsSvc.getSystemPrompt('cold-lead-scoring', {
            displayName,
            qualificationData: dataStr,
            historyStr,
          })
        }
        if (!coldLeadUserContent) {
          coldLeadUserContent = `Lead: ${displayName}
Datos de calificación:
${dataStr}

Historial de conversaciones:
${historyStr}

Evalúa este lead frío. Responde SOLO con JSON:
{ "score": 0-100, "reason": "breve explicación", "recommend_reactivation": true/false }`
        }

        const llmResult = await ctx.registry.callHook('llm:chat', {
          task: 'nightly-scoring',
          system: 'Eres un analista de leads. Evalúa si un lead frío vale la pena reactivar.',
          messages: [{
            role: 'user' as const,
            content: coldLeadUserContent,
          }],
          maxTokens: 200,
          temperature: 0.2,
        })

        if (!llmResult?.text) continue

        const parsed = parseJSON(llmResult.text)
        if (!parsed || typeof parsed.score !== 'number') continue

        const newScore = Math.max(0, Math.min(100, Math.round(parsed.score)))
        scored++

        await ctx.db.query(
          `UPDATE agent_contacts SET qualification_score = $1, updated_at = NOW()
           WHERE contact_id = $2 AND agent_id = (SELECT id FROM agents WHERE slug = $3 LIMIT 1)`,
          [newScore, row.id, agentSlug],
        )

        if (newScore >= config.scoringThreshold && parsed.recommend_reactivation) {
          await ctx.db.query(
            `UPDATE agent_contacts SET lead_status = 'qualifying', updated_at = NOW()
             WHERE contact_id = $1 AND lead_status = 'cold'
               AND agent_id = (SELECT id FROM agents WHERE slug = $2 LIMIT 1)`,
            [row.id, agentSlug],
          )
          await ctx.registry.runHook('contact:status_changed', {
            contactId: row.id,
            agentId: getAgentId(ctx),
            from: 'cold',
            to: 'qualifying',
          })
          reactivated++
          logger.info({ contactId: row.id, score: newScore, reason: parsed.reason }, 'Cold lead reactivated')
        }
      } catch (err) {
        logger.warn({ err, contactId: row.id, traceId: ctx.traceId }, 'Failed to score cold lead')
      }
    }

    logger.info({ traceId: ctx.traceId, total: result.rows.length, scored, reactivated }, 'Cold lead scoring complete')
  } catch (err) {
    logger.error({ err, traceId: ctx.traceId }, 'Cold lead scoring failed')
  }
}

// ─── 2. Compress Old Sessions ─────────────────

async function compressOldSessions(ctx: ProactiveJobContext): Promise<void> {
  const config = getNightlyConfig(ctx)
  if (!config.compressionEnabled) {
    logger.debug({ traceId: ctx.traceId }, 'Session compression disabled')
    return
  }

  const memoryManager = ctx.registry.getOptional<MemoryManager>('memory:manager')
  if (!memoryManager) {
    logger.debug({ traceId: ctx.traceId }, 'memory:manager not available, skipping compression')
    return
  }

  logger.info({ traceId: ctx.traceId, batchSize: config.compressionBatchSize }, 'Compressing old sessions')

  try {
    const sessions = await memoryManager.getSessionsForCompression(getAgentId(ctx))
    const batch = sessions.slice(0, config.compressionBatchSize)

    if (batch.length === 0) {
      logger.info({ traceId: ctx.traceId }, 'No sessions need compression')
      return
    }

    let compressed = 0

    for (const session of batch) {
      try {
        const messages = await memoryManager.getSessionMessages(session.sessionId)
        if (messages.length < config.compressionMinMessages) continue

        // Build conversation text for LLM
        const conversationText = messages
          .map(m => `[${m.role === 'assistant' ? 'Agente' : 'Usuario'}]: ${m.contentText || m.content?.text || ''}`)
          .join('\n')

        const batchLlm = getBatchModel(ctx)
        const compressPromptsSvc = ctx.registry.getOptional<PromptsService>('prompts:service')
        let compressUserContent = ''
        if (compressPromptsSvc) {
          compressUserContent = await compressPromptsSvc.getSystemPrompt('session-compression', {
            conversationText: conversationText.slice(0, 15000),
          })
        }
        if (!compressUserContent) {
          compressUserContent = `Resume esta conversación en menos de 500 palabras. Mantén:
- Datos BANT extraídos (presupuesto, autoridad, necesidad, timing)
- Compromisos hechos por el agente
- Preferencias del contacto
- Objeciones o dudas planteadas
- Resultado de la conversación

Responde SOLO con JSON:
{ "summary": "resumen de la conversación", "keyFacts": [{"fact": "dato clave", "confidence": 0.9}], "structuredData": {} }

Conversación:
${conversationText.slice(0, 15000)}`
        }

        const llmResult = await ctx.registry.callHook('llm:chat', {
          task: 'nightly-compress',
          provider: batchLlm.provider,
          model: batchLlm.model,
          system: 'Eres un asistente que resume conversaciones de ventas/atención al cliente. Extrae la información clave.',
          messages: [{
            role: 'user' as const,
            content: compressUserContent,
          }],
          maxTokens: 1500,
          temperature: 0.3,
        })

        if (!llmResult?.text) continue

        const parsed = parseJSON(llmResult.text)
        if (!parsed?.summary) continue

        await memoryManager.compressSession(
          session.sessionId,
          getAgentId(ctx),
          session.contactId,
          session.channelIdentifier ?? null,
          {
            summary: parsed.summary as string,
            keyFacts: Array.isArray(parsed.keyFacts)
              ? (parsed.keyFacts as Array<Record<string, unknown>>).map(kf => ({
                  fact: String(kf.fact ?? ''),
                  source: 'nightly-compression',
                  confidence: typeof kf.confidence === 'number' ? kf.confidence : 0.8,
                }))
              : [],
            structuredData: (parsed.structuredData ?? {}) as Record<string, unknown>,
            originalCount: messages.length,
            keptRecentCount: 0,
            modelUsed: llmResult.model ?? batchLlm.model ?? 'unknown',
            tokensUsed: (llmResult.inputTokens ?? 0) + (llmResult.outputTokens ?? 0),
          },
          session.startedAt,
          session.lastMessageAt,
        )

        compressed++
        logger.debug({ sessionId: session.sessionId, messages: messages.length }, 'Session compressed')
      } catch (err) {
        logger.warn({ err, sessionId: session.sessionId, traceId: ctx.traceId }, 'Failed to compress session')
      }
    }

    logger.info({ traceId: ctx.traceId, eligible: batch.length, compressed }, 'Session compression complete')
  } catch (err) {
    logger.error({ err, traceId: ctx.traceId }, 'Session compression failed')
  }
}

// ─── 3. Generate Daily Report ─────────────────

async function generateDailyReport(ctx: ProactiveJobContext): Promise<void> {
  const config = getNightlyConfig(ctx)
  if (!config.reportEnabled) {
    logger.debug({ traceId: ctx.traceId }, 'Daily report disabled')
    return
  }

  logger.info({ traceId: ctx.traceId }, 'Generating daily report')

  try {
    const yesterday = new Date()
    yesterday.setDate(yesterday.getDate() - 1)
    const dateStr = yesterday.toISOString().split('T')[0]!

    // Check idempotency
    const existing = await ctx.db.query(
      `SELECT id FROM daily_reports WHERE report_date = $1`, [dateStr],
    ).catch(() => ({ rows: [] }))
    if (existing.rows.length > 0) {
      logger.info({ traceId: ctx.traceId, date: dateStr }, 'Daily report already exists')
      return
    }

    // Query metrics for yesterday
    const [msgResult, leadsResult, sessionsResult, pipelineResult] = await Promise.all([
      ctx.db.query(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE sender_type = 'user')::int AS incoming,
                COUNT(*) FILTER (WHERE sender_type = 'agent')::int AS outgoing
         FROM messages WHERE created_at::date = $1::date`, [dateStr],
      ).catch(() => ({ rows: [{ total: 0, incoming: 0, outgoing: 0 }] })),
      ctx.db.query(
        `SELECT COUNT(*) FILTER (WHERE c.created_at::date = $1::date)::int AS new_leads,
                COUNT(*) FILTER (WHERE ac.lead_status = 'qualified' AND ac.updated_at::date = $1::date)::int AS qualified
         FROM contacts c
         LEFT JOIN agent_contacts ac ON ac.contact_id = c.id
         WHERE c.contact_type = 'lead'`, [dateStr],
      ).catch(() => ({ rows: [{ new_leads: 0, qualified: 0 }] })),
      ctx.db.query(
        `SELECT COUNT(*) FILTER (WHERE started_at::date = $1::date)::int AS opened,
                COUNT(*) FILTER (WHERE last_activity_at::date = $1::date AND started_at::date < $1::date)::int AS active
         FROM sessions`, [dateStr],
      ).catch(() => ({ rows: [{ opened: 0, active: 0 }] })),
      ctx.db.query(
        `SELECT AVG(total_ms)::int AS avg_pipeline_ms, COUNT(*)::int AS total_pipelines
         FROM pipeline_logs WHERE created_at::date = $1::date`, [dateStr],
      ).catch(() => ({ rows: [{ avg_pipeline_ms: 0, total_pipelines: 0 }] })),
    ])

    const metrics = {
      date: dateStr,
      messages: msgResult.rows[0] ?? { total: 0, incoming: 0, outgoing: 0 },
      leads: leadsResult.rows[0] ?? { new_leads: 0, qualified: 0 },
      sessions: sessionsResult.rows[0] ?? { opened: 0, active: 0 },
      pipeline: pipelineResult.rows[0] ?? { avg_pipeline_ms: 0, total_pipelines: 0 },
    }

    // Generate narrative summary via LLM
    let narrative: string | null = null
    try {
      const reportLlm = getBatchModel(ctx)
      const reportPromptsSvc = ctx.registry.getOptional<PromptsService>('prompts:service')
      let reportUserContent = ''
      if (reportPromptsSvc) {
        reportUserContent = await reportPromptsSvc.getSystemPrompt('daily-report', {
          dateStr,
          messagesTotal: String(metrics.messages.total),
          messagesIncoming: String(metrics.messages.incoming),
          messagesOutgoing: String(metrics.messages.outgoing),
          newLeads: String(metrics.leads.new_leads),
          qualifiedLeads: String(metrics.leads.qualified),
          sessionsOpened: String(metrics.sessions.opened),
          sessionsActive: String(metrics.sessions.active),
          totalPipelines: String(metrics.pipeline.total_pipelines),
          avgPipelineMs: String(metrics.pipeline.avg_pipeline_ms),
        })
      }
      if (!reportUserContent) {
        reportUserContent = `Genera un resumen narrativo breve (3-5 líneas) de estas métricas del día ${dateStr}:
- Mensajes: ${metrics.messages.total} total (${metrics.messages.incoming} entrantes, ${metrics.messages.outgoing} salientes)
- Leads nuevos: ${metrics.leads.new_leads}, Calificados: ${metrics.leads.qualified}
- Sesiones abiertas: ${metrics.sessions.opened}, Activas: ${metrics.sessions.active}
- Pipeline: ${metrics.pipeline.total_pipelines} ejecuciones, ${metrics.pipeline.avg_pipeline_ms}ms promedio

Escribe el resumen en español, enfocándote en tendencias y datos relevantes.`
      }

      const llmResult = await ctx.registry.callHook('llm:chat', {
        task: 'custom',
        provider: reportLlm.provider,
        model: reportLlm.model,
        system: 'Genera reportes diarios concisos de operación de un agente de atención al cliente.',
        messages: [{
          role: 'user' as const,
          content: reportUserContent,
        }],
        maxTokens: 300,
        temperature: 0.5,
      })

      narrative = llmResult?.text?.trim() ?? null
    } catch (err) {
      logger.warn({ err, traceId: ctx.traceId }, 'Failed to generate report narrative')
    }

    // Persist report
    await ctx.db.query(
      `INSERT INTO daily_reports (report_date, metrics, narrative, synced_to_sheets)
       VALUES ($1, $2, $3, false)
       ON CONFLICT (report_date) DO NOTHING`,
      [dateStr, JSON.stringify(metrics), narrative],
    )

    // Sync to Google Sheets if configured
    let synced = false
    if (config.reportSheetId) {
      const sheetsSvc = ctx.registry.getOptional<{
        appendRows(spreadsheetId: string, sheetName: string, values: unknown[][]): Promise<void>
      }>('google:sheets')

      if (sheetsSvc) {
        try {
          await sheetsSvc.appendRows(config.reportSheetId, config.reportSheetName, [[
            dateStr,
            metrics.messages.total,
            metrics.messages.incoming,
            metrics.messages.outgoing,
            metrics.leads.new_leads,
            metrics.leads.qualified,
            metrics.sessions.opened,
            metrics.sessions.active,
            metrics.pipeline.total_pipelines,
            metrics.pipeline.avg_pipeline_ms,
            narrative ?? '',
          ]])
          synced = true
          await ctx.db.query(
            `UPDATE daily_reports SET synced_to_sheets = true WHERE report_date = $1`, [dateStr],
          )
        } catch (err) {
          logger.warn({ err, traceId: ctx.traceId }, 'Failed to sync report to Google Sheets')
        }
      }
    }

    logger.info({ traceId: ctx.traceId, date: dateStr, synced, hasNarrative: !!narrative }, 'Daily report generated')
  } catch (err) {
    logger.error({ err, traceId: ctx.traceId }, 'Daily report generation failed')
  }
}

// ─── 4. Scan & Embed Knowledge Items ─────────

const MAX_EMBED_RETRIES = 3
const EMBED_RETRY_DELAY_MS = 2000

interface KnowledgePgStore {
  listItemsNeedingEmbedding(): Promise<Array<{ id: string; title: string; contentLoaded: boolean; embeddingStatus: string }>>
  listItemsDueForSync(): Promise<Array<{ id: string; title: string; sourceId: string; sourceType: string; lastModifiedTime: string | null }>>
  updateItemSyncStatus(id: string, checkedAt: Date, modifiedTime: string | null): Promise<void>
}

interface KnowledgeItemManager {
  loadContent(id: string): Promise<{ chunks: number }>
}

interface DriveService {
  getFile(fileId: string): Promise<{ modifiedTime?: string }>
}

async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts: number,
  delayMs: number,
  label: string,
): Promise<T> {
  let lastErr: unknown
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      if (attempt < maxAttempts) {
        logger.warn({ err, attempt, maxAttempts, label }, 'Retrying after error')
        await new Promise(r => setTimeout(r, delayMs * attempt))
      }
    }
  }
  throw lastErr
}

async function scanAndEmbedKnowledgeItems(ctx: ProactiveJobContext): Promise<void> {
  const pgStore = ctx.registry.getOptional<KnowledgePgStore>('knowledge:pg-store')
  const itemManager = ctx.registry.getOptional<KnowledgeItemManager>('knowledge:item-manager')

  if (!pgStore || !itemManager) {
    logger.debug({ traceId: ctx.traceId }, 'knowledge services not available, skipping knowledge scan')
    return
  }

  const drive = ctx.registry.getOptional<DriveService>('google:drive')

  logger.info({ traceId: ctx.traceId }, 'Starting knowledge items sync scan')

  let checked = 0
  let reembedded = 0
  let noChange = 0
  let failed = 0

  try {
    // Step A: items that have never been loaded or embedding failed → load unconditionally
    const unloaded = await pgStore.listItemsNeedingEmbedding()
    for (const item of unloaded) {
      try {
        const result = await withRetry(
          () => itemManager.loadContent(item.id),
          MAX_EMBED_RETRIES,
          EMBED_RETRY_DELAY_MS,
          `loadContent:${item.id}`,
        )
        reembedded++
        logger.info({ traceId: ctx.traceId, itemId: item.id, title: item.title, chunks: result.chunks }, 'Unloaded item embedded')
      } catch (err) {
        failed++
        logger.warn({ traceId: ctx.traceId, err, itemId: item.id, title: item.title }, 'Failed to embed unloaded item')
      }
    }

    // Step B: items due for sync check → compare Drive modifiedTime
    const dueItems = await pgStore.listItemsDueForSync()
    for (const item of dueItems) {
      checked++
      const now = new Date()
      try {
        let changed = false
        let latestModifiedTime: string | null = item.lastModifiedTime

        // Check Drive modifiedTime if service available (skip Drive folders — use item-level check)
        if (drive && item.sourceType !== 'drive') {
          try {
            const meta = await withRetry(
              () => drive.getFile(item.sourceId),
              2,
              1000,
              `getFile:${item.sourceId}`,
            )
            if (meta.modifiedTime) {
              latestModifiedTime = meta.modifiedTime
              changed = !item.lastModifiedTime || meta.modifiedTime !== item.lastModifiedTime
            } else {
              // Cannot determine — treat as changed to be safe
              changed = true
            }
          } catch (err) {
            logger.warn({ traceId: ctx.traceId, err, itemId: item.id }, 'Drive metadata check failed, treating as changed')
            changed = true
          }
        } else {
          // No Drive service or drive-type item — always re-embed on schedule
          changed = true
        }

        // Update sync timestamp regardless of whether we re-embed
        await pgStore.updateItemSyncStatus(item.id, now, latestModifiedTime)

        if (changed) {
          await withRetry(
            () => itemManager.loadContent(item.id),
            MAX_EMBED_RETRIES,
            EMBED_RETRY_DELAY_MS,
            `loadContent:${item.id}`,
          )
          reembedded++
          logger.info({ traceId: ctx.traceId, itemId: item.id, title: item.title }, 'Item changed — re-embedded')
        } else {
          noChange++
          logger.debug({ traceId: ctx.traceId, itemId: item.id, title: item.title }, 'Item unchanged — skipped')
        }
      } catch (err) {
        failed++
        logger.warn({ traceId: ctx.traceId, err, itemId: item.id, title: item.title }, 'Knowledge item sync failed')
      }
    }

    logger.info({ traceId: ctx.traceId, checked, reembedded, noChange, failed }, 'Knowledge sync scan complete')
  } catch (err) {
    logger.error({ err, traceId: ctx.traceId }, 'Knowledge sync scan failed')
  }
}

// ─── 5. Embed Summary Chunks ────────────────────

interface EmbeddingService {
  generateBatchEmbeddings(texts: string[]): Promise<(number[] | null)[]>
}

async function embedSummaryChunks(ctx: ProactiveJobContext): Promise<void> {
  const memoryManager = ctx.registry.getOptional<MemoryManager>('memory:manager')
  const embeddingService = ctx.registry.getOptional<EmbeddingService>('knowledge:embedding-service')

  if (!memoryManager || !embeddingService) {
    logger.debug({ traceId: ctx.traceId }, 'memory/embedding not available, skipping chunk embedding')
    return
  }

  try {
    const chunks = await memoryManager.getChunksWithoutEmbeddings(100)
    if (chunks.length === 0) {
      logger.debug({ traceId: ctx.traceId }, 'No chunks need embedding')
      return
    }

    logger.info({ traceId: ctx.traceId, count: chunks.length }, 'Embedding summary chunks')

    // Process in batches of 50 (API batch limit)
    const BATCH_SIZE = 50
    let embedded = 0

    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      const batch = chunks.slice(i, i + BATCH_SIZE)
      const texts = batch.map(c => c.chunkText)
      const embeddings = await embeddingService.generateBatchEmbeddings(texts)

      for (let j = 0; j < batch.length; j++) {
        const emb = embeddings[j]
        if (emb) {
          await memoryManager.updateChunkEmbedding(batch[j]!.id, emb)
          embedded++
        }
      }
    }

    logger.info({ traceId: ctx.traceId, total: chunks.length, embedded }, 'Chunk embedding complete')
  } catch (err) {
    logger.error({ err, traceId: ctx.traceId }, 'Chunk embedding failed')
  }
}

// ─── Helpers ──────────────────────────────────

function parseJSON(text: string): Record<string, unknown> | null {
  try {
    let jsonStr = text.trim()
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '')
    }
    return JSON.parse(jsonStr)
  } catch {
    return null
  }
}
