// LUNA Engine — Nightly Batch Job
// Procesos nocturnos: scoring de leads, compresión de memoria, reportes.
// Idempotente: usa fecha como flag. Config desde engine:nightly-config service.
// Usa taskPool para concurrencia configurable con retries + exponential backoff.

import { unlink } from 'node:fs/promises'
import pino from 'pino'
import type { ProactiveJobContext } from '../../types.js'
import type { PromptsService } from '../../../modules/prompts/types.js'
import type { MemoryManager } from '../../../modules/memory/memory-manager.js'
import { taskPool } from '../../utils/task-pool.js'

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
  concurrency: number
  maxRetries: number
}

interface EmbeddingService {
  generateBatchEmbeddings(texts: string[]): Promise<(number[] | null)[]>
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
  concurrency: 5,
  maxRetries: 2,
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

    // 2. Compress old sessions (+ inline embedding)
    await compressOldSessions(ctx)

    // 3. Generate daily report
    await generateDailyReport(ctx)

    // 4. Auto-embed knowledge items that are missing embeddings
    await scanAndEmbedKnowledgeItems(ctx)

    // 5. Embed summary chunks that are missing embeddings (safety net)
    await embedSummaryChunks(ctx)

    // 6. Purge old pipeline logs
    await purgeOldLogs(ctx)

    // 7. Purge old legal archives
    await purgeOldArchives(ctx)

    // 8. Purge expired attachments (DB records + media files on disk)
    await purgeExpiredAttachments(ctx)

    // 9. Merge unmerged session summaries into contact_memory (warm → cold)
    await mergeContactMemories(ctx)

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

  // Import scoring engine — zero LLM, code-only recalculation
  const { calculateScore } = await import('../../../modules/lead-scoring/scoring-engine.js')
  const configStore = ctx.registry.getOptional<{ getConfig(): import('../../../modules/lead-scoring/types.js').QualifyingConfig }>('lead-scoring:config')
  if (!configStore) {
    logger.debug({ traceId: ctx.traceId }, 'Lead-scoring module not active — skipping cold lead scoring')
    return
  }
  const qualConfig = configStore.getConfig()

  logger.info({ traceId: ctx.traceId, batchSize: config.scoringBatchSize }, 'Scoring cold leads (code-based, zero LLM)')

  try {
    // Cursor-based batch (max 1000 leads per run for safety)
    let lastContactId: string | null = null
    const batchSize = config.scoringBatchSize
    let reactivated = 0
    let total = 0

    while (true) {
      const params: unknown[] = [batchSize]
      let whereExtra = ''
      if (lastContactId) {
        whereExtra = ` AND ac.contact_id > $2`
        params.push(lastContactId)
      }

      const result = await ctx.db.query(
        `SELECT ac.contact_id,
                COALESCE(ac.qualification_data, '{}') AS qualification_data,
                ac.qualification_score
         FROM agent_contacts ac
         JOIN contacts c ON c.id = ac.contact_id
         WHERE c.contact_type = 'lead'
           AND ac.lead_status = 'cold'${whereExtra}
         ORDER BY ac.contact_id ASC
         LIMIT $1`,
        params,
      )

      if (result.rows.length === 0) break

      for (const row of result.rows) {
        const qualData = typeof row.qualification_data === 'string'
          ? JSON.parse(row.qualification_data) as Record<string, unknown>
          : (row.qualification_data as Record<string, unknown>) ?? {}

        const scoreResult = calculateScore(qualData, qualConfig)

        // Only write if score changed
        if (scoreResult.totalScore !== (row.qualification_score ?? 0)) {
          await ctx.db.query(
            `UPDATE agent_contacts SET qualification_score = $1, updated_at = NOW()
             WHERE contact_id = $2`,
            [scoreResult.totalScore, row.contact_id],
          )
        }

        // Reactivate if score above threshold and engine suggests qualifying
        if (scoreResult.totalScore >= config.scoringThreshold && scoreResult.suggestedStatus === 'qualifying') {
          await ctx.db.query(
            `UPDATE agent_contacts SET lead_status = 'qualifying', updated_at = NOW()
             WHERE contact_id = $1 AND lead_status = 'cold'`,
            [row.contact_id],
          )
          await ctx.registry.runHook('contact:status_changed', {
            contactId: row.contact_id,
            from: 'cold',
            to: 'qualifying',
          })
          reactivated++
        }
      }

      lastContactId = result.rows[result.rows.length - 1]!.contact_id as string
      total += result.rows.length

      if (total >= 1000) break
    }

    logger.info({ traceId: ctx.traceId, total, reactivated }, 'Cold lead scoring complete (code-based)')
  } catch (err) {
    logger.error({ err, traceId: ctx.traceId }, 'Cold lead scoring failed')
  }
}

// ─── 2. Compress Old Sessions (v2 — queue-based) ─────────────────

interface CompressionWorkerService {
  enqueue(data: { sessionId: string; contactId: string; channel: string; triggerType: 'reopen_expired' | 'nightly_batch' }): Promise<void>
}

async function compressOldSessions(ctx: ProactiveJobContext): Promise<void> {
  const config = getNightlyConfig(ctx)
  if (!config.compressionEnabled) {
    logger.debug({ traceId: ctx.traceId }, 'Session compression disabled')
    return
  }

  logger.info({ traceId: ctx.traceId, batchSize: config.compressionBatchSize }, 'Compressing old sessions (v2 queue)')

  try {
    // Find sessions with no compression_status that closed >24h ago (safety net)
    const result = await ctx.db.query<{
      id: string; contact_id: string; channel_name: string;
    }>(
      `SELECT id, contact_id, channel_name
       FROM sessions
       WHERE compression_status IS NULL
         AND status = 'closed'
         AND contact_id IS NOT NULL
         AND last_activity_at < NOW() - INTERVAL '24 hours'
       ORDER BY last_activity_at ASC
       LIMIT $1`,
      [config.compressionBatchSize],
    )

    if (result.rows.length === 0) {
      logger.info({ traceId: ctx.traceId }, 'No sessions need compression')
      return
    }

    // Try to use compression worker queue
    const compressionWorker = ctx.registry.getOptional<CompressionWorkerService>('memory:compression-worker')

    if (compressionWorker) {
      let enqueued = 0
      for (const row of result.rows) {
        try {
          await compressionWorker.enqueue({
            sessionId: row.id,
            contactId: row.contact_id,
            channel: row.channel_name ?? 'unknown',
            triggerType: 'nightly_batch',
          })
          enqueued++
        } catch (err) {
          logger.warn({ err, sessionId: row.id, traceId: ctx.traceId }, 'Failed to enqueue compression job')
        }
      }

      logger.info({
        traceId: ctx.traceId,
        eligible: result.rows.length,
        enqueued,
      }, 'Session compression jobs enqueued (v2)')
    } else {
      // Fallback: use legacy compressSession if compression worker not available
      const memoryManager = ctx.registry.getOptional<MemoryManager>('memory:manager')
      if (!memoryManager) {
        logger.debug({ traceId: ctx.traceId }, 'Neither compression worker nor memory:manager available')
        return
      }

      const embeddingService = ctx.registry.getOptional<EmbeddingService>('knowledge:embedding-service')
      let compressed = 0

      interface LegacySessionRow { id: string; contact_id: string; channel_name: string | null }

      const poolResult = await taskPool({
        items: result.rows as LegacySessionRow[],
        concurrency: config.concurrency,
        maxRetries: config.maxRetries,
        label: 'nightly-compression-legacy',
        worker: async (row) => {
          const messages = await memoryManager.getSessionMessages(row.id)
          if (messages.length < config.compressionMinMessages) return

          const conversationText = messages
            .map(m => `[${m.role === 'assistant' ? 'Agente' : 'Usuario'}]: ${m.contentText || m.content?.text || ''}`)
            .join('\n')

          const llmResult = await ctx.registry.callHook('llm:chat', {
            task: 'nightly-compress',
            system: 'Eres un asistente que resume conversaciones de ventas/atención al cliente.',
            messages: [{ role: 'user' as const, content: `Resume esta conversación:\n${conversationText.slice(0, 15000)}\n\nResponde SOLO con JSON: { "summary": "...", "keyFacts": [{"fact": "...", "confidence": 0.9}], "structuredData": {} }` }],
            maxTokens: 1500,
            temperature: 0.3,
          })

          if (!llmResult?.text) return
          const parsed = parseJSON(llmResult.text)
          if (!parsed?.summary) return

          const summaryId = await memoryManager.compressSession(
            row.id, row.contact_id, row.channel_name ?? null,
            {
              summary: parsed.summary as string,
              keyFacts: Array.isArray(parsed.keyFacts) ? (parsed.keyFacts as Array<Record<string, unknown>>).map(kf => ({ fact: String(kf.fact ?? ''), source: 'nightly-compression', confidence: typeof kf.confidence === 'number' ? kf.confidence : 0.8 })) : [],
              structuredData: (parsed.structuredData ?? {}) as Record<string, unknown>,
              originalCount: messages.length, keptRecentCount: 0,
              modelUsed: llmResult.model ?? 'batch',
              tokensUsed: (llmResult.inputTokens ?? 0) + (llmResult.outputTokens ?? 0),
            },
            new Date(), new Date(),
          )

          // Inline embedding
          if (embeddingService) {
            const chunks = await memoryManager.getChunksBySummary(summaryId)
            if (chunks.length > 0) {
              const texts = chunks.map(c => c.chunkText)
              const embeddings = await embeddingService.generateBatchEmbeddings(texts)
              for (let j = 0; j < chunks.length; j++) {
                const emb = embeddings[j]
                if (emb) await memoryManager.updateChunkEmbedding(chunks[j]!.id, emb)
              }
            }
          }
          compressed++
        },
      })

      logger.info({ traceId: ctx.traceId, eligible: result.rows.length, compressed, failed: poolResult.failed }, 'Legacy compression complete')
    }
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
        task: 'batch',
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

async function scanAndEmbedKnowledgeItems(ctx: ProactiveJobContext): Promise<void> {
  const config = getNightlyConfig(ctx)
  const pgStore = ctx.registry.getOptional<KnowledgePgStore>('knowledge:pg-store')
  const itemManager = ctx.registry.getOptional<KnowledgeItemManager>('knowledge:item-manager')

  if (!pgStore || !itemManager) {
    logger.debug({ traceId: ctx.traceId }, 'knowledge services not available, skipping knowledge scan')
    return
  }

  const drive = ctx.registry.getOptional<DriveService>('google:drive')

  logger.info({ traceId: ctx.traceId }, 'Starting knowledge items sync scan')

  try {
    // Step A: items that have never been loaded or embedding failed
    const unloaded = await pgStore.listItemsNeedingEmbedding()

    const poolA = await taskPool({
      items: unloaded,
      concurrency: config.concurrency,
      maxRetries: config.maxRetries,
      label: 'nightly-knowledge-unloaded',
      worker: async (item) => {
        const result = await itemManager.loadContent(item.id)
        logger.info({ traceId: ctx.traceId, itemId: item.id, title: item.title, chunks: result.chunks }, 'Unloaded item embedded')
      },
    })

    // Step B: items due for sync check → compare Drive modifiedTime
    const dueItems = await pgStore.listItemsDueForSync()
    let noChange = 0

    const poolB = await taskPool({
      items: dueItems,
      concurrency: config.concurrency,
      maxRetries: config.maxRetries,
      label: 'nightly-knowledge-sync',
      worker: async (item) => {
        const now = new Date()
        let changed = false
        let latestModifiedTime: string | null = item.lastModifiedTime

        if (drive && item.sourceType !== 'drive') {
          try {
            const meta = await drive.getFile(item.sourceId)
            if (meta.modifiedTime) {
              latestModifiedTime = meta.modifiedTime
              changed = !item.lastModifiedTime || meta.modifiedTime !== item.lastModifiedTime
            } else {
              changed = true
            }
          } catch (err) {
            logger.warn({ traceId: ctx.traceId, err, itemId: item.id }, 'Drive metadata check failed, treating as changed')
            changed = true
          }
        } else {
          changed = true
        }

        await pgStore.updateItemSyncStatus(item.id, now, latestModifiedTime)

        if (changed) {
          await itemManager.loadContent(item.id)
          logger.info({ traceId: ctx.traceId, itemId: item.id, title: item.title }, 'Item changed — re-embedded')
        } else {
          noChange++
          logger.debug({ traceId: ctx.traceId, itemId: item.id, title: item.title }, 'Item unchanged — skipped')
        }
      },
    })

    logger.info({
      traceId: ctx.traceId,
      unloaded: poolA.succeeded,
      checked: dueItems.length,
      reembedded: poolB.succeeded - noChange,
      noChange,
      failed: poolA.failed + poolB.failed,
    }, 'Knowledge sync scan complete')
  } catch (err) {
    logger.error({ err, traceId: ctx.traceId }, 'Knowledge sync scan failed')
  }
}

// ─── 5. Embed Summary Chunks (safety net for stragglers) ──────

async function embedSummaryChunks(ctx: ProactiveJobContext): Promise<void> {
  const config = getNightlyConfig(ctx)
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

    logger.info({ traceId: ctx.traceId, count: chunks.length }, 'Embedding straggler summary chunks')

    // Split into batches of 50 (embedding API limit)
    const BATCH_SIZE = 50
    const batches: Array<Array<{ id: string; chunkText: string }>> = []
    for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
      batches.push(chunks.slice(i, i + BATCH_SIZE))
    }

    let embedded = 0

    const poolResult = await taskPool({
      items: batches,
      concurrency: config.concurrency,
      maxRetries: config.maxRetries,
      label: 'nightly-embed-stragglers',
      worker: async (batch) => {
        const texts = batch.map(c => c.chunkText)
        const embeddings = await embeddingService.generateBatchEmbeddings(texts)
        for (let j = 0; j < batch.length; j++) {
          const emb = embeddings[j]
          if (emb) {
            await memoryManager.updateChunkEmbedding(batch[j]!.id, emb)
            embedded++
          }
        }
      },
    })

    logger.info({
      traceId: ctx.traceId,
      total: chunks.length,
      embedded,
      batches: poolResult.succeeded,
      failed: poolResult.failed,
    }, 'Straggler chunk embedding complete')
  } catch (err) {
    logger.error({ err, traceId: ctx.traceId }, 'Chunk embedding failed')
  }
}

// ─── 6. Purge Old Pipeline Logs ──────────────

async function purgeOldLogs(ctx: ProactiveJobContext): Promise<void> {
  const memoryManager = ctx.registry.getOptional<MemoryManager>('memory:manager')
  if (!memoryManager) return

  try {
    const purged = await memoryManager.purgeOldPipelineLogs()
    if (purged > 0) {
      logger.info({ traceId: ctx.traceId, purged }, 'Purged old pipeline logs')
    }
  } catch (err) {
    logger.error({ err, traceId: ctx.traceId }, 'Pipeline logs purge failed')
  }
}

// ─── 7. Purge Old Legal Archives ─────────────

async function purgeOldArchives(ctx: ProactiveJobContext): Promise<void> {
  const memoryManager = ctx.registry.getOptional<MemoryManager>('memory:manager')
  if (!memoryManager) return

  try {
    const purged = await memoryManager.purgeOldArchives()
    if (purged > 0) {
      logger.info({ traceId: ctx.traceId, purged }, 'Purged old conversation archives')
    }

    // Also purge session_archives (v2) using the same retention
    const config = ctx.registry.getConfig<{ MEMORY_ARCHIVE_RETENTION_YEARS: number }>('memory')
    const years = config.MEMORY_ARCHIVE_RETENTION_YEARS
    if (years > 0 && years < 999) {
      const result = await ctx.db.query(
        `DELETE FROM session_archives WHERE created_at < now() - interval '1 year' * $1`,
        [years],
      )
      const v2Purged = result.rowCount ?? 0
      if (v2Purged > 0) {
        logger.info({ traceId: ctx.traceId, purged: v2Purged }, 'Purged old session archives (v2)')
      }
    }
  } catch (err) {
    logger.error({ err, traceId: ctx.traceId }, 'Archive purge failed')
  }
}

// ─── 8. Purge Expired Attachments (DB + disk) ────────────
// Uses MEMORY_SUMMARY_RETENTION_DAYS — attachments live as long as their session summaries.

async function purgeExpiredAttachments(ctx: ProactiveJobContext): Promise<void> {
  let retentionDays: number
  try {
    const config = ctx.registry.getConfig<{ MEMORY_SUMMARY_RETENTION_DAYS: number }>('memory')
    retentionDays = config.MEMORY_SUMMARY_RETENTION_DAYS
  } catch {
    retentionDays = 120
  }

  try {
    // 1. Get file_paths of expired attachment_extractions before deleting
    const expiredFiles = await ctx.db.query<{ file_path: string }>(
      `SELECT DISTINCT file_path FROM attachment_extractions
       WHERE file_path IS NOT NULL
         AND created_at < NOW() - INTERVAL '1 day' * $1`,
      [retentionDays],
    )

    // 2. Delete expired attachment_extractions from DB
    const deleteResult = await ctx.db.query(
      `DELETE FROM attachment_extractions
       WHERE created_at < NOW() - INTERVAL '1 day' * $1`,
      [retentionDays],
    )
    const dbDeleted = deleteResult.rowCount ?? 0

    // 3. Delete corresponding media files from disk + nullify media_ref in chunks
    let filesDeleted = 0
    const filePaths = expiredFiles.rows.map((r: { file_path: string }) => r.file_path)

    for (const filePath of filePaths) {
      try {
        await unlink(filePath)
        filesDeleted++
      } catch {
        // File may already be gone or path invalid — skip
      }
    }

    // 4. Clear dead media_ref pointers in session_memory_chunks
    if (filePaths.length > 0) {
      await ctx.db.query(
        `UPDATE session_memory_chunks SET media_ref = NULL
         WHERE media_ref = ANY($1)`,
        [filePaths],
      )
    }

    if (dbDeleted > 0 || filesDeleted > 0) {
      logger.info({ traceId: ctx.traceId, dbDeleted, filesDeleted, mediaRefsCleared: filePaths.length, retentionDays }, 'Purged expired attachments (DB + disk + media_ref)')
    }
  } catch (err) {
    logger.error({ err, traceId: ctx.traceId }, 'Attachment purge failed')
  }
}

// ─── 9. Merge Contact Memories (warm → cold) ──────────────────────────────

/**
 * For contacts with unmerged session summaries, extract key_facts and preferences
 * via LLM and merge them into the contact's cold-tier contact_memory.
 * Uses mergeToContactMemory() which already exists in memory-manager but was never called.
 */
async function mergeContactMemories(ctx: ProactiveJobContext): Promise<void> {
  const config = getNightlyConfig(ctx)
  const memoryManager = ctx.registry.getOptional<MemoryManager>('memory:manager')
  if (!memoryManager) {
    logger.debug({ traceId: ctx.traceId }, 'memory:manager not available, skipping contact memory merge')
    return
  }

  try {
    // Find contacts with unmerged summaries from both v1 and v2 tables
    const result = await ctx.db.query<{ contact_id: string }>(
      `SELECT DISTINCT contact_id FROM (
         SELECT contact_id FROM session_summaries
         WHERE merged_to_memory_at IS NULL AND created_at < NOW() - INTERVAL '1 hour'
         UNION
         SELECT contact_id FROM session_summaries_v2
         WHERE merged_to_memory_at IS NULL AND created_at < NOW() - INTERVAL '1 hour'
       ) combined
       LIMIT $1`,
      [config.compressionBatchSize],
    )

    if (result.rows.length === 0) {
      logger.debug({ traceId: ctx.traceId }, 'No contacts need contact_memory merge')
      return
    }

    logger.info({ traceId: ctx.traceId, count: result.rows.length }, 'Starting contact_memory merge')

    interface ContactIdRow { contact_id: string }

    const poolResult = await taskPool({
      items: result.rows as ContactIdRow[],
      concurrency: config.concurrency,
      maxRetries: config.maxRetries,
      label: 'nightly-contact-memory-merge',
      worker: async (row: ContactIdRow) => {
        const contactId = row.contact_id

        // Load unmerged summaries for this contact
        const summaries = await memoryManager.getUnmergedSummaries(contactId)
        if (summaries.length === 0) return

        const summaryIds = summaries.map(s => s.id)
        const summaryText = summaries.map(s => s.summaryText).join('\n\n---\n\n').slice(0, 12000)

        // Get existing contact memory
        const ac = await memoryManager.getAgentContact(contactId)
        const existingMemory = ac?.contactMemory ?? {
          summary: '',
          key_facts: [],
          preferences: {},
          important_dates: [],
          relationship_notes: '',
        }

        // LLM: extract facts, preferences, dates from summaries
        const llmResult = await ctx.registry.callHook('llm:chat', {
          task: 'batch',
          system: 'Eres un asistente que extrae información estructurada de conversaciones de ventas/atención al cliente.',
          messages: [{
            role: 'user' as const,
            content: `Analiza estos resúmenes de conversación y extrae:
1. Datos clave del contacto (hechos relevantes, cargo, empresa, situación)
2. Preferencias detectadas (canal, horario, idioma, etc.)
3. Fechas importantes mencionadas

Resúmenes:
${summaryText}

Responde SOLO con JSON válido:
{
  "key_facts": [{"fact": "...", "confidence": 0.9}],
  "preferences": {"clave": "valor"},
  "important_dates": [{"date": "YYYY-MM-DD", "what": "descripción"}],
  "summary_addition": "Nueva info relevante en 1-2 líneas (o null si no hay nada nuevo)"
}`,
          }],
          maxTokens: 800,
          temperature: 0.2,
        })

        if (!llmResult?.text) return
        const extracted = parseJSON(llmResult.text)
        if (!extracted) return

        // Merge extracted data into existing memory
        const mergedMemory = { ...existingMemory }

        // Merge key_facts (dedup by fact text)
        const existingFacts = new Set(mergedMemory.key_facts.map((f: { fact: string }) => f.fact.toLowerCase()))
        for (const kf of (extracted.key_facts as Array<{ fact: string; confidence: number }> ?? [])) {
          if (kf.fact && !existingFacts.has(kf.fact.toLowerCase())) {
            mergedMemory.key_facts.push({
              fact: kf.fact,
              source: 'nightly:session_merge',
              confidence: kf.confidence ?? 0.8,
            })
            existingFacts.add(kf.fact.toLowerCase())
          }
        }

        // Merge preferences (existing wins)
        for (const [key, value] of Object.entries((extracted.preferences as Record<string, string>) ?? {})) {
          if (!(key in mergedMemory.preferences)) {
            mergedMemory.preferences[key] = value
          }
        }

        // Merge important_dates (dedup by date+what)
        const existingDates = new Set(
          mergedMemory.important_dates.map((d: { date: string; what: string }) => `${d.date}::${d.what}`)
        )
        for (const d of (extracted.important_dates as Array<{ date: string; what: string }> ?? [])) {
          if (d.date && d.what && !existingDates.has(`${d.date}::${d.what}`)) {
            mergedMemory.important_dates.push({ date: d.date, what: d.what })
            existingDates.add(`${d.date}::${d.what}`)
          }
        }

        // Append summary addition if provided
        if (typeof extracted.summary_addition === 'string' && extracted.summary_addition.trim()) {
          mergedMemory.summary = mergedMemory.summary
            ? `${mergedMemory.summary}\n${extracted.summary_addition}`
            : extracted.summary_addition
        }

        // Save merged memory and mark summaries as merged
        await memoryManager.mergeToContactMemory(contactId, mergedMemory, summaryIds)

        logger.info({
          traceId: ctx.traceId,
          contactId,
          summariesMerged: summaryIds.length,
          newFacts: mergedMemory.key_facts.length - existingMemory.key_facts.length,
        }, 'Contact memory merged from session summaries')
      },
    })

    logger.info({
      traceId: ctx.traceId,
      total: result.rows.length,
      succeeded: poolResult.succeeded,
      failed: poolResult.failed,
    }, 'Contact memory merge complete')
  } catch (err) {
    logger.error({ err, traceId: ctx.traceId }, 'Contact memory merge failed')
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
