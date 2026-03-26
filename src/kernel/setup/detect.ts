// LUNA — Setup wizard: fresh install detection
// Checks config_store for SETUP_COMPLETED flag AND that a super admin with credentials exists.

import type { Pool } from 'pg'

/**
 * Returns true if the installation wizard has been completed AND
 * at least one admin user with stored credentials exists.
 * If the flag is set but no admin has credentials, clears the flag
 * so the wizard re-runs (handles interrupted setups or manual DB edits).
 */
export async function isSetupCompleted(pool: Pool): Promise<boolean> {
  const { rows: flagRows } = await pool.query<{ value: string }>(
    `SELECT value FROM config_store WHERE key = 'SETUP_COMPLETED'`,
  )
  if (flagRows[0]?.value !== 'true') return false

  // Verify there's at least one admin with credentials
  const { rows: credRows } = await pool.query<{ cnt: string }>(
    `SELECT COUNT(*)::text AS cnt
     FROM users u
     JOIN user_credentials uc ON uc.user_id = u.id
     WHERE u.list_type = 'admin' AND u.is_active = true
       AND uc.password_hash IS NOT NULL`,
  )
  const hasAdminWithCreds = parseInt(credRows[0]?.cnt ?? '0', 10) > 0

  if (!hasAdminWithCreds) {
    // Clear the flag so wizard re-runs
    await pool.query(`DELETE FROM config_store WHERE key = 'SETUP_COMPLETED'`)
    return false
  }

  return true
}
