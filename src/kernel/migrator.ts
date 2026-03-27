// LUNA — Auto-migration system
// Runs numbered SQL migrations from src/migrations/ on boot.
// Tracks applied migrations in schema_migrations table.

import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type { Pool } from 'pg'
import pino from 'pino'

const logger = pino({ name: 'kernel:migrator' })

const ENSURE_TRACKING_TABLE = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  name        TEXT PRIMARY KEY,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
`

/**
 * Run all pending SQL migrations in order.
 * Each migration runs inside a transaction; on failure the migration is rolled back
 * and the process aborts (subsequent migrations are skipped).
 */
export async function runMigrations(pool: Pool): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query(ENSURE_TRACKING_TABLE)

    // Resolve migrations directory (works for both src/ dev and dist/ prod)
    const migrationsDir = path.resolve(import.meta.dirname, '..', 'migrations')

    let files: string[]
    try {
      files = await fs.readdir(migrationsDir)
    } catch {
      logger.warn({ dir: migrationsDir }, 'Migrations directory not found, skipping')
      return
    }

    // Only .sql files, sorted by name (numeric prefix ensures order)
    const sqlFiles = files
      .filter(f => f.endsWith('.sql'))
      .sort()

    if (sqlFiles.length === 0) {
      logger.info('No migration files found')
      return
    }

    // Get already-applied migrations
    const { rows: applied } = await client.query<{ name: string }>(
      `SELECT name FROM schema_migrations`,
    )
    const appliedSet = new Set(applied.map(r => r.name))

    const pending = sqlFiles.filter(f => !appliedSet.has(f))

    if (pending.length === 0) {
      logger.info({ total: sqlFiles.length }, 'All migrations already applied')
      return
    }

    logger.info({ pending: pending.length, total: sqlFiles.length }, 'Running pending migrations...')

    for (const file of pending) {
      const filePath = path.join(migrationsDir, file)
      const sql = await fs.readFile(filePath, 'utf-8')

      try {
        await client.query('BEGIN')
        await client.query(sql)
        await client.query(
          `INSERT INTO schema_migrations (name) VALUES ($1) ON CONFLICT (name) DO NOTHING`,
          [file],
        )
        await client.query('COMMIT')
        logger.info({ migration: file }, 'Migration applied')
      } catch (err) {
        await client.query('ROLLBACK')
        logger.error({ err, migration: file }, 'Migration failed, aborting')
        throw err
      }
    }

    logger.info({ applied: pending.length }, 'All pending migrations applied successfully')
  } finally {
    client.release()
  }
}
