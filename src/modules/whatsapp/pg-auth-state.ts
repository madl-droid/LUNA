// LUNA — PostgreSQL-backed auth state for Baileys
// Replaces useMultiFileAuthState so credentials live in the DB,
// not on the filesystem. Each container gets its own instance_id.

import type { Pool } from 'pg'
import { proto } from '@whiskeysockets/baileys'
import { initAuthCreds, BufferJSON } from '@whiskeysockets/baileys'
import type { AuthenticationState, SignalDataTypeMap } from '@whiskeysockets/baileys'
import pino from 'pino'

const logger = pino({ name: 'whatsapp:pg-auth' })

// ─── Tables ──────────────────────────────────────

const ENSURE_TABLES_SQL = `
CREATE TABLE IF NOT EXISTS wa_auth_creds (
  instance_id  TEXT PRIMARY KEY,
  creds        JSONB NOT NULL,
  updated_at   TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wa_auth_keys (
  instance_id  TEXT NOT NULL,
  category     TEXT NOT NULL,
  key_id       TEXT NOT NULL,
  value        JSONB,
  updated_at   TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (instance_id, category, key_id)
);
`

let tablesEnsured = false

async function ensureTables(pool: Pool): Promise<void> {
  if (tablesEnsured) return
  await pool.query(ENSURE_TABLES_SQL)
  tablesEnsured = true
  logger.debug('wa_auth tables ensured')
}

// ─── Serialization helpers ───────────────────────

/** Serialize a value so it's safe for JSONB (handles Buffer/Uint8Array) */
function toJsonb(obj: unknown): unknown {
  return JSON.parse(JSON.stringify(obj, BufferJSON.replacer))
}

/** Deserialize a JSONB value back, reconstructing Buffer/Uint8Array */
function fromJsonb(obj: unknown): unknown {
  return JSON.parse(JSON.stringify(obj), BufferJSON.reviver)
}

// ─── Public API ──────────────────────────────────

export async function usePostgresAuthState(
  pool: Pool,
  instanceId: string,
): Promise<{ state: AuthenticationState; saveCreds: () => Promise<void> }> {
  await ensureTables(pool)

  // Load or init creds
  const { rows: credRows } = await pool.query<{ creds: unknown }>(
    'SELECT creds FROM wa_auth_creds WHERE instance_id = $1',
    [instanceId],
  )

  const creds = credRows[0]
    ? fromJsonb(credRows[0].creds) as ReturnType<typeof initAuthCreds>
    : initAuthCreds()

  const saveCreds = async () => {
    await pool.query(
      `INSERT INTO wa_auth_creds (instance_id, creds, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (instance_id) DO UPDATE SET creds = $2, updated_at = now()`,
      [instanceId, toJsonb(creds)],
    )
  }

  const keys: AuthenticationState['keys'] = {
    get: async <T extends keyof SignalDataTypeMap>(type: T, ids: string[]) => {
      const data: { [id: string]: SignalDataTypeMap[T] } = {}

      if (ids.length === 0) return data

      const { rows } = await pool.query<{ key_id: string; value: unknown }>(
        `SELECT key_id, value FROM wa_auth_keys
         WHERE instance_id = $1 AND category = $2 AND key_id = ANY($3)`,
        [instanceId, type, ids],
      )

      for (const row of rows) {
        let value = fromJsonb(row.value)
        if (type === 'app-state-sync-key' && value) {
          value = proto.Message.AppStateSyncKeyData.fromObject(value as Record<string, unknown>)
        }
        data[row.key_id] = value as SignalDataTypeMap[T]
      }

      return data
    },

    set: async (data) => {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        for (const category in data) {
          const entries = data[category as keyof typeof data]
          if (!entries) continue
          for (const id in entries) {
            const value = entries[id]
            if (value) {
              await client.query(
                `INSERT INTO wa_auth_keys (instance_id, category, key_id, value, updated_at)
                 VALUES ($1, $2, $3, $4, now())
                 ON CONFLICT (instance_id, category, key_id)
                 DO UPDATE SET value = $4, updated_at = now()`,
                [instanceId, category, id, toJsonb(value)],
              )
            } else {
              await client.query(
                `DELETE FROM wa_auth_keys
                 WHERE instance_id = $1 AND category = $2 AND key_id = $3`,
                [instanceId, category, id],
              )
            }
          }
        }
        await client.query('COMMIT')
      } catch (err) {
        await client.query('ROLLBACK')
        throw err
      } finally {
        client.release()
      }
    },
  }

  return { state: { creds, keys }, saveCreds }
}

/** Delete all auth data for an instance (used on explicit disconnect/logout) */
export async function clearAuthState(pool: Pool, instanceId: string): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('DELETE FROM wa_auth_creds WHERE instance_id = $1', [instanceId])
    await client.query('DELETE FROM wa_auth_keys WHERE instance_id = $1', [instanceId])
    await client.query('COMMIT')
    logger.info({ instanceId }, 'Auth state cleared from DB')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}
