// LUNA Engine — Cache Refresh Job
// Refresca caches de Google Sheets y datos operativos.
// Idempotente: sobrescribe cache existente.

import pino from 'pino'
import type { ProactiveJobContext } from '../../types.js'

const logger = pino({ name: 'engine:job:cache-refresh' })

const CACHE_KEY = 'sheets:cache'
const CACHE_TTL_SECONDS = 3600 // 1h — job runs more frequently so data stays fresh

/**
 * Refresh Redis caches for sheets data and operational data.
 * Reads from Google Sheets (via google:sheets service) and stores in Redis.
 */
export async function runCacheRefresh(ctx: ProactiveJobContext): Promise<void> {
  logger.info({ traceId: ctx.traceId }, 'Cache refresh job starting')

  // Read nightly config for Sheet ID
  const nightlyCfgSvc = ctx.registry.getOptional<{ get(): { reportSheetId: string; reportSheetName: string } }>('engine:nightly-config')
  const sheetId = nightlyCfgSvc?.get().reportSheetId ?? ''

  if (!sheetId) {
    logger.debug({ traceId: ctx.traceId }, 'No NIGHTLY_REPORT_SHEET_ID configured — skipping sheets cache refresh')
    return
  }

  // Get Google Sheets service
  const sheets = ctx.registry.getOptional<{
    readRange(spreadsheetId: string, range: string): Promise<{ values: string[][] }>
  }>('google:sheets')

  if (!sheets) {
    logger.debug({ traceId: ctx.traceId }, 'Google Sheets service not available — skipping cache refresh')
    return
  }

  try {
    // Read first sheet (entire data range)
    const sheetName = nightlyCfgSvc?.get().reportSheetName || 'Sheet1'
    const data = await sheets.readRange(sheetId, `${sheetName}!A1:Z1000`)

    if (!data.values || data.values.length === 0) {
      logger.info({ traceId: ctx.traceId, sheetId }, 'Sheets data is empty — clearing cache')
      await ctx.redis.del(CACHE_KEY)
      return
    }

    // Convert rows to keyed object: first row is headers, rest is data
    const headers = data.values[0]!
    const rows = data.values.slice(1).map(row => {
      const obj: Record<string, string> = {}
      for (let i = 0; i < headers.length; i++) {
        const key = headers[i]
        if (key) obj[key] = row[i] ?? ''
      }
      return obj
    })

    const cachePayload = JSON.stringify({ headers, rows, refreshedAt: new Date().toISOString() })
    await ctx.redis.set(CACHE_KEY, cachePayload, 'EX', CACHE_TTL_SECONDS)

    logger.info({ traceId: ctx.traceId, sheetId, rows: rows.length, headers: headers.length }, 'Sheets cache refreshed')
  } catch (err) {
    logger.error({ err, traceId: ctx.traceId, sheetId }, 'Failed to refresh sheets cache')
  }
}
