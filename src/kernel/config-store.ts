// LUNA — Encrypted config store
// CRUD for config_store table with AES-256-GCM encryption for secret values.

import * as crypto from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { Pool } from 'pg'
import pino from 'pino'

const logger = pino({ name: 'config-store' })

const ALGORITHM = 'aes-256-gcm'
const KEY_LENGTH = 32
const IV_LENGTH = 12
const AUTH_TAG_LENGTH = 16

// Secret field keys — these get encrypted in the DB
const SECRET_KEYS = new Set([
  'ANTHROPIC_API_KEY', 'GOOGLE_AI_API_KEY',
  'DB_PASSWORD', 'REDIS_PASSWORD',
  'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN',
  'GMAIL_CLIENT_SECRET', 'GMAIL_REFRESH_TOKEN',
])

let _encryptionKey: Buffer | null = null

function getEncryptionKey(): Buffer {
  if (_encryptionKey) return _encryptionKey

  // 1. Try env var
  const envKey = process.env['CONFIG_ENCRYPTION_KEY']
  if (envKey) {
    _encryptionKey = crypto.scryptSync(envKey, 'luna-config-salt', KEY_LENGTH)
    return _encryptionKey
  }

  // 2. Try file at instance/config.key
  const keyPath = path.resolve('instance', 'config.key')
  if (fs.existsSync(keyPath)) {
    const keyHex = fs.readFileSync(keyPath, 'utf-8').trim()
    _encryptionKey = Buffer.from(keyHex, 'hex')
    return _encryptionKey
  }

  // 3. Generate and save
  fs.mkdirSync(path.dirname(keyPath), { recursive: true })
  _encryptionKey = crypto.randomBytes(KEY_LENGTH)
  fs.writeFileSync(keyPath, _encryptionKey.toString('hex'), { mode: 0o600 })
  logger.info('Generated new config encryption key at instance/config.key')
  return _encryptionKey
}

function encrypt(plaintext: string): string {
  const key = getEncryptionKey()
  const iv = crypto.randomBytes(IV_LENGTH)
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()])
  const authTag = cipher.getAuthTag()
  // Format: iv:authTag:ciphertext (all hex)
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`
}

function decrypt(ciphertext: string): string {
  const key = getEncryptionKey()
  const parts = ciphertext.split(':')
  if (parts.length !== 3) throw new Error('Invalid encrypted value format')
  const iv = Buffer.from(parts[0]!, 'hex')
  const authTag = Buffer.from(parts[1]!, 'hex')
  const encrypted = Buffer.from(parts[2]!, 'hex')
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)
  return decipher.update(encrypted) + decipher.final('utf-8')
}

function isSecretKey(key: string): boolean {
  return SECRET_KEYS.has(key) || key.includes('PASSWORD') || key.includes('SECRET') || key.includes('API_KEY')
}

export async function getAll(pool: Pool): Promise<Record<string, string>> {
  const { rows } = await pool.query<{ key: string; value: string; is_secret: boolean }>(
    'SELECT key, value, is_secret FROM config_store'
  )
  const result: Record<string, string> = {}
  for (const row of rows) {
    try {
      result[row.key] = row.is_secret ? decrypt(row.value) : row.value
    } catch (err) {
      logger.warn({ key: row.key, err }, 'Failed to decrypt config value, skipping')
    }
  }
  return result
}

export async function get(pool: Pool, key: string): Promise<string | null> {
  const { rows } = await pool.query<{ value: string; is_secret: boolean }>(
    'SELECT value, is_secret FROM config_store WHERE key = $1',
    [key]
  )
  if (rows.length === 0) return null
  const row = rows[0]!
  return row.is_secret ? decrypt(row.value) : row.value
}

export async function set(pool: Pool, key: string, value: string, isSecret?: boolean): Promise<void> {
  const secret = isSecret ?? isSecretKey(key)
  const storedValue = secret ? encrypt(value) : value
  await pool.query(
    `INSERT INTO config_store (key, value, is_secret, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (key) DO UPDATE SET value = $2, is_secret = $3, updated_at = now()`,
    [key, storedValue, secret]
  )
}

export async function setMultiple(pool: Pool, entries: Record<string, string>): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    for (const [key, value] of Object.entries(entries)) {
      const secret = isSecretKey(key)
      const storedValue = secret ? encrypt(value) : value
      await client.query(
        `INSERT INTO config_store (key, value, is_secret, updated_at)
         VALUES ($1, $2, $3, now())
         ON CONFLICT (key) DO UPDATE SET value = $2, is_secret = $3, updated_at = now()`,
        [key, storedValue, secret]
      )
    }
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}
