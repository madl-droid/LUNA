// LUNA — Users module: Google Sheets sync (skeleton)
// Se activa solo cuando hay un módulo de Google OAuth conectado.
// Sincroniza contactos desde una Google Sheet configurada por lista.

import pino from 'pino'
import type { Registry } from '../../../kernel/registry.js'
import type { UsersDb } from '../db.js'
import type { UserCache } from '../cache.js'
import type { SyncConfig, BulkImportResult } from '../types.js'

const logger = pino({ name: 'users:sheet-sync' })

/** Expected columns in the Google Sheet: sender_id, channel, display_name, [metadata...] */
interface SheetRow {
  senderId: string
  channel: string
  displayName?: string
  metadata?: Record<string, unknown>
}

let _syncInterval: ReturnType<typeof setInterval> | null = null

/**
 * Check if Google OAuth module is available and connected.
 * Returns the OAuth client if available, null otherwise.
 */
function getGoogleAuth(registry: Registry): unknown | null {
  // The Google OAuth module (when implemented) will register a service like:
  // registry.provide('google:oauth-client', client)
  return registry.getOptional<unknown>('google:oauth-client')
}

/**
 * Start periodic sync for all lists that have sheet sync configured.
 */
export function startSheetSync(
  registry: Registry,
  db: UsersDb,
  cache: UserCache,
  defaultIntervalMs: number,
): void {
  // Check if Google OAuth is available
  const auth = getGoogleAuth(registry)
  if (!auth) {
    logger.info('Google OAuth not available — sheet sync disabled')
    return
  }

  _syncInterval = setInterval(async () => {
    try {
      await syncAllLists(registry, db, cache)
    } catch (err) {
      logger.error({ err }, 'Periodic sheet sync failed')
    }
  }, defaultIntervalMs)

  logger.info({ intervalMs: defaultIntervalMs }, 'Sheet sync started')
}

export function stopSheetSync(): void {
  if (_syncInterval) {
    clearInterval(_syncInterval)
    _syncInterval = null
    logger.info('Sheet sync stopped')
  }
}

/**
 * Sync all lists that have a sheetUrl in their syncConfig.
 */
async function syncAllLists(registry: Registry, db: UsersDb, cache: UserCache): Promise<void> {
  const configs = await db.getAllListConfigs()

  for (const config of configs) {
    if (!config.syncConfig.sheetUrl) continue
    if (config.listType === 'admin') continue // admin never synced from sheet
    if (config.listType === 'lead') continue  // leads are not in lists

    try {
      await syncListFromSheet(registry, db, cache, config.listType, config.syncConfig)
    } catch (err) {
      logger.error({ listType: config.listType, err }, 'Sheet sync failed for list')
    }
  }
}

/**
 * Sync a single list from its configured Google Sheet.
 * Strategy: deactivate existing sheet_sync entries, re-import, cache invalidate.
 */
export async function syncListFromSheet(
  registry: Registry,
  db: UsersDb,
  cache: UserCache,
  listType: string,
  syncConfig: SyncConfig,
): Promise<BulkImportResult> {
  const auth = getGoogleAuth(registry)
  if (!auth) {
    throw new Error('Google OAuth not available — cannot sync from sheet')
  }

  if (!syncConfig.sheetUrl) {
    throw new Error(`No sheet URL configured for list "${listType}"`)
  }

  logger.info({ listType, sheetUrl: syncConfig.sheetUrl }, 'Starting sheet sync')

  // TODO: When Google OAuth module is implemented, use googleapis to read the sheet
  // const sheets = google.sheets({ version: 'v4', auth })
  // const response = await sheets.spreadsheets.values.get({
  //   spreadsheetId: extractSheetId(syncConfig.sheetUrl),
  //   range: syncConfig.sheetTab ?? 'Sheet1',
  // })
  // const rows = parseSheetRows(response.data.values)

  // For now, return empty result since Google OAuth is not yet available
  // When implemented: const rows = _parseSheetRows(response.data.values)
  const rows: SheetRow[] = []

  // Deactivate existing sheet_sync entries for this list
  await db.deactivateBySource(listType, 'sheet_sync')

  // Import rows
  const result: BulkImportResult = { total: rows.length, created: 0, updated: 0, errors: [] }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!
    try {
      await db.createUser({
        senderId: row.senderId,
        channel: row.channel,
        listType,
        displayName: row.displayName,
        metadata: row.metadata,
        source: 'sheet_sync',
      })
      result.created++
      await cache.invalidate(row.senderId)
    } catch (err) {
      result.errors.push({ row: i + 1, error: (err as Error).message })
    }
  }

  logger.info({ listType, ...result }, 'Sheet sync completed')
  return result
}

/**
 * Parse raw sheet values into typed rows.
 * Expected header: sender_id, channel, display_name, [extra columns as metadata]
 */
function _parseSheetRows(values: string[][]): SheetRow[] {
  if (!values || values.length < 2) return []

  const headerRow = values[0]!
  const headers = headerRow.map(h => h.trim().toLowerCase())
  const senderIdx = headers.indexOf('sender_id')
  const channelIdx = headers.indexOf('channel')
  const nameIdx = headers.indexOf('display_name')

  if (senderIdx === -1 || channelIdx === -1) {
    throw new Error('Sheet must have "sender_id" and "channel" columns')
  }

  const rows: SheetRow[] = []

  for (let i = 1; i < values.length; i++) {
    const row = values[i]!
    const senderId = row[senderIdx]?.trim()
    const channel = row[channelIdx]?.trim()

    if (!senderId || !channel) continue

    // Extra columns become metadata
    const metadata: Record<string, unknown> = {}
    for (let j = 0; j < headers.length; j++) {
      if (j === senderIdx || j === channelIdx || j === nameIdx) continue
      if (row[j]?.trim()) {
        metadata[headers[j]!] = row[j]!.trim()
      }
    }

    rows.push({
      senderId,
      channel,
      displayName: nameIdx >= 0 ? row[nameIdx]?.trim() : undefined,
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    })
  }

  return rows
}
