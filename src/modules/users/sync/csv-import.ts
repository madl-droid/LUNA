// LUNA — Users module: CSV import
// Parsea CSV simple y crea usuarios en una lista.

import pino from 'pino'
import type { UsersDb } from '../db.js'
import type { UserCache } from '../cache.js'
import type { BulkImportResult } from '../types.js'

const logger = pino({ name: 'users:csv-import' })

/**
 * Parse a CSV string into an array of objects.
 * Handles quoted fields with commas and newlines.
 * First row must be headers.
 */
export function parseCsv(raw: string): Record<string, string>[] {
  const lines = splitCsvLines(raw.trim())
  if (lines.length < 2) return []

  const headerLine = lines[0]
  if (!headerLine) return []
  const headers = parseCsvLine(headerLine).map(h => h.trim().toLowerCase())
  const rows: Record<string, string>[] = []

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]
    if (!line) continue
    const values = parseCsvLine(line)
    const obj: Record<string, string> = {}
    for (let j = 0; j < headers.length; j++) {
      const key = headers[j]
      if (key) obj[key] = values[j]?.trim() ?? ''
    }
    rows.push(obj)
  }

  return rows
}

/** Split CSV text into logical lines (handling quoted newlines). */
function splitCsvLines(text: string): string[] {
  const lines: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]

    if (ch === '"') {
      inQuotes = !inQuotes
      current += ch
    } else if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && text[i + 1] === '\n') i++ // skip \r\n
      if (current.trim()) lines.push(current)
      current = ''
    } else {
      current += ch
    }
  }

  if (current.trim()) lines.push(current)
  return lines
}

/** Parse a single CSV line into fields. */
function parseCsvLine(line: string): string[] {
  const fields: string[] = []
  let current = ''
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]

    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"'
        i++ // skip escaped quote
      } else {
        inQuotes = !inQuotes
      }
    } else if (ch === ',' && !inQuotes) {
      fields.push(current)
      current = ''
    } else {
      current += ch
    }
  }

  fields.push(current)
  return fields
}

/**
 * Import users from a CSV string into a list.
 * Required columns: sender_id, channel
 * Optional: display_name, [extra columns → metadata]
 */
export async function importCsv(
  db: UsersDb,
  cache: UserCache,
  listType: string,
  csvContent: string,
): Promise<BulkImportResult> {
  const rows = parseCsv(csvContent)

  if (rows.length === 0) {
    return { total: 0, created: 0, updated: 0, errors: [] }
  }

  // Validate required columns
  const firstRow = rows[0]!
  if (!('sender_id' in firstRow) || !('channel' in firstRow)) {
    throw new Error('CSV must have "sender_id" and "channel" columns')
  }

  const result: BulkImportResult = { total: rows.length, created: 0, updated: 0, errors: [] }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!
    const senderId = row['sender_id']
    const channel = row['channel']

    if (!senderId || !channel) {
      result.errors.push({ row: i + 2, error: 'Missing sender_id or channel' })
      continue
    }

    // Build metadata from extra columns
    const metadata: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(row)) {
      if (key === 'sender_id' || key === 'channel' || key === 'display_name') continue
      if (value) metadata[key] = value
    }

    try {
      await db.createUser({
        senderId,
        channel,
        listType,
        displayName: row['display_name'] || undefined,
        metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
        source: 'csv_import',
      })
      result.created++
      await cache.invalidate(senderId)
    } catch (err) {
      result.errors.push({ row: i + 2, error: (err as Error).message })
    }
  }

  logger.info({ listType, total: result.total, created: result.created, errors: result.errors.length }, 'CSV import completed')
  return result
}

/**
 * Import users from a JSON array (used by bulk API endpoint).
 */
export async function importArray(
  db: UsersDb,
  cache: UserCache,
  listType: string,
  users: Array<{ senderId: string; channel: string; displayName?: string; metadata?: Record<string, unknown> }>,
): Promise<BulkImportResult> {
  const result: BulkImportResult = { total: users.length, created: 0, updated: 0, errors: [] }

  for (let i = 0; i < users.length; i++) {
    const user = users[i]!
    if (!user.senderId || !user.channel) {
      result.errors.push({ row: i + 1, error: 'Missing senderId or channel' })
      continue
    }

    try {
      await db.createUser({
        senderId: user.senderId,
        channel: user.channel,
        listType,
        displayName: user.displayName,
        metadata: user.metadata,
        source: 'api',
      })
      result.created++
      await cache.invalidate(user.senderId)
    } catch (err) {
      result.errors.push({ row: i + 1, error: (err as Error).message })
    }
  }

  logger.info({ listType, total: result.total, created: result.created, errors: result.errors.length }, 'Array import completed')
  return result
}
