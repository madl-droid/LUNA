// LUNA — Centralized cache flag
// When DEBUG_CACHE_ENABLED=false in config_store, all module caches bypass reads/writes.
// Modules import isCacheEnabled() from here instead of implementing their own check.

import type { Pool } from 'pg'

let _db: Pool | null = null

/** Initialize cache flag with database pool reference */
export function initCacheFlag(db: Pool): void {
  _db = db
}

/** Check if caching is globally enabled (default: true) */
export async function isCacheEnabled(): Promise<boolean> {
  if (!_db) return true
  try {
    const result = await _db.query(`SELECT value FROM config_store WHERE key = 'DEBUG_CACHE_ENABLED'`)
    return result.rows[0]?.value !== 'false'
  } catch {
    return true
  }
}
