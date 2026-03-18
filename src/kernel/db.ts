// LUNA — Kernel PostgreSQL pool

import { Pool } from 'pg'
import pino from 'pino'
import { kernelConfig } from './config.js'

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
`

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

  // Run kernel migrations
  const client = await pool.connect()
  try {
    await client.query(KERNEL_MIGRATIONS)
    logger.info('PostgreSQL connected, kernel tables ensured')
  } finally {
    client.release()
  }

  return pool
}
