// LUNA — Kernel PostgreSQL pool

import { Pool, type QueryConfig, type QueryResult, type QueryResultRow } from 'pg'
import pino from 'pino'
import { kernelConfig } from './config.js'
import { runMigrations } from './migrator.js'
import { logSqlQuery } from './extreme-logger.js'

const logger = pino({ name: 'kernel:db' })


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

  logger.info('PostgreSQL connected')

  // Run domain migrations (contacts, sessions, kernel tables, etc.)
  await runMigrations(pool)

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
