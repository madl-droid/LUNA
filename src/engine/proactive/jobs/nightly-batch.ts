// LUNA Engine — Nightly Batch Job
// Procesos nocturnos: scoring de leads, compresión de memoria, reportes.
// Idempotente: usa fecha como flag.

import pino from 'pino'
import type { ProactiveJobContext } from '../../types.js'

const logger = pino({ name: 'engine:job:nightly-batch' })

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

    // Mark as completed
    await ctx.redis.set(redisKey, '1', 'EX', 86400)

    logger.info({ traceId: ctx.traceId, date: today }, 'Nightly batch complete')
  } catch (err) {
    logger.error({ traceId: ctx.traceId, err }, 'Nightly batch failed')
  }
}

async function scoreColdLeads(ctx: ProactiveJobContext): Promise<void> {
  // TODO: use batch LLM to score leads that went cold
  // Query contacts with qualification_status = 'cold'
  // Run Haiku batch for scoring
  logger.debug({ traceId: ctx.traceId }, 'Score cold leads (noop)')
}

async function compressOldSessions(ctx: ProactiveJobContext): Promise<void> {
  // TODO: compress sessions with >30 messages
  // Use Gemini Flash batch for compression
  // Store compressed_summary in sessions table
  logger.debug({ traceId: ctx.traceId }, 'Compress old sessions (noop)')
}

async function generateDailyReport(ctx: ProactiveJobContext): Promise<void> {
  // TODO: generate report and sync to Google Sheet
  // Use Gemini Flash batch
  logger.debug({ traceId: ctx.traceId }, 'Generate daily report (noop)')
}
