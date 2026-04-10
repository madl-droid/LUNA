// LUNA — Centralized cache flag
// When DEBUG_CACHE_ENABLED=false in config_store, all module caches bypass reads/writes.
// Modules import isCacheEnabled() from here instead of implementing their own check.

import type { Pool } from 'pg'

let _db: Pool | null = null
let _cachedEnabled: boolean | null = null
let _cacheTs = 0
const CACHE_TTL_MS = 10_000

/** Initialize cache flag with database pool reference */
export function initCacheFlag(db: Pool): void {
  _db = db
}

/** Check if caching is globally enabled (cached 10s, default: true) */
export async function isCacheEnabled(): Promise<boolean> {
  const now = Date.now()
  if (_cachedEnabled !== null && (now - _cacheTs) < CACHE_TTL_MS) return _cachedEnabled
  if (!_db) return true
  try {
    const result = await _db.query(`SELECT value FROM config_store WHERE key = 'DEBUG_CACHE_ENABLED'`)
    _cachedEnabled = result.rows[0]?.value !== 'false'
    _cacheTs = now
    return _cachedEnabled
  } catch {
    return _cachedEnabled ?? true
  }
}
