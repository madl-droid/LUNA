// LUNA — Setup wizard: fresh install detection
// Checks config_store for SETUP_COMPLETED flag.

import type { Pool } from 'pg'

/**
 * Returns true if the installation wizard has been completed.
 * Queries config_store (created by kernel migrations in db.ts).
 */
export async function isSetupCompleted(pool: Pool): Promise<boolean> {
  const { rows } = await pool.query<{ value: string }>(
    `SELECT value FROM config_store WHERE key = 'SETUP_COMPLETED'`,
  )
  return rows[0]?.value === 'true'
}
