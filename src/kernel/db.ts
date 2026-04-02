// LUNA — Kernel PostgreSQL pool

import { Pool, type QueryConfig, type QueryResult, type QueryResultRow } from 'pg'
import pino from 'pino'
import { kernelConfig } from './config.js'
import { runMigrations } from './migrator.js'
import { logSqlQuery } from './extreme-logger.js'

const logger = pino({ name: 'kernel:db' })

const KERNEL_MIGRATIONS = `
CREATE TABLE IF NOT EXISTS kernel_modules (
  name          TEXT PRIMARY KEY,
  active        BOOLEAN NOT NULL DEFAULT false,
  installed_at  TIMESTAMPTZ DEFAULT now(),
  activated_at  TIMESTAMPTZ,
  config_overrides JSONB DEFAULT '{}',
  meta          JSONB DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS config_store (
  key         TEXT PRIMARY KEY,
  value       TEXT NOT NULL,
  is_secret   BOOLEAN DEFAULT false,
  updated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_credentials (
  user_id       VARCHAR(20) PRIMARY KEY,
  password_hash TEXT NOT NULL,
  last_login    TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);
`

async function seedDefaultAgent(pool: Pool): Promise<void> {
  try {
    const result = await pool.query<{ id: string }>(
      `INSERT INTO agents (slug, name, description, config_path)
       VALUES ('luna', 'LUNA', 'Agente principal', 'instance/config.json')
       ON CONFLICT (slug) DO NOTHING
       RETURNING id`,
    )
    if (result.rowCount && result.rowCount > 0) {
      logger.info({ agentId: result.rows[0]?.id }, 'Default agent seeded')
    }
  } catch {
    // agents table may not exist yet in very early migrations — safe to skip
  }
}

export async function createPool(): Promise<Pool> {
  const pool = new Pool({
    host: kernelConfig.db.host,
    port: kernelConfig.db.port,
    database: kernelConfig.db.name,
    user: kernelConfig.db.user,
    password: kernelConfig.db.password,
    max: kernelConfig.db.maxConnections,
    idleTimeoutMillis: kernelConfig.db.idleTimeoutMs,
    connectionTimeoutMillis: kernelConfig.db.connectionTimeoutMs,
  })

  // FIX: K-1 — Error handler para conexiones idle del pool
  pool.on('error', (err) => {
    logger.error({ err }, 'Unexpected PostgreSQL pool error')
  })

  // Run kernel migrations
  const client = await pool.connect()
  try {
    await client.query(KERNEL_MIGRATIONS)
    logger.info('PostgreSQL connected, kernel tables ensured')
  } finally {
    client.release()
  }

  // Run domain migrations (contacts, sessions, agents, etc.)
  await runMigrations(pool)

  // Seed default agent if missing — survives factory resets
  await seedDefaultAgent(pool)

  // Wrap pool.query to instrument SQL logging
  const originalQuery = pool.query.bind(pool)
  pool.query = (async (...args: unknown[]): Promise<QueryResult<QueryResultRow>> => {
    const start = Date.now()
    try {
      const result = await (originalQuery as Function)(...args) as QueryResult<QueryResultRow>
      const queryText = typeof args[0] === 'string' ? args[0] : (args[0] as QueryConfig)?.text ?? '?'
      const params = typeof args[0] === 'string' ? args[1] as unknown[] : (args[0] as QueryConfig)?.values as unknown[]
      logSqlQuery({ query: queryText, params, durationMs: Date.now() - start, rowCount: result.rowCount ?? 0 }).catch(() => {})
      return result
    } catch (err) {
      const queryText = typeof args[0] === 'string' ? args[0] : (args[0] as QueryConfig)?.text ?? '?'
      logSqlQuery({ query: queryText, durationMs: Date.now() - start, error: String(err) }).catch(() => {})
      throw err
    }
  }) as typeof pool.query

  return pool
}
