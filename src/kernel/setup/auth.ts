// LUNA — Setup wizard: password hashing & session management
// Uses node:crypto scrypt (same approach as config-store.ts).
// Sessions stored in Redis with 30-day TTL.

import * as crypto from 'node:crypto'
import type { Redis } from 'ioredis'
import type { Pool } from 'pg'
import pino from 'pino'

const logger = pino({ name: 'kernel:auth' })

const SCRYPT_KEY_LENGTH = 64
const SALT_LENGTH = 16
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60 // 30 days
const SESSION_PREFIX = 'session:'

export const SESSION_COOKIE_NAME = 'luna_session'

// ═══════════════════════════════════════════
// Password hashing
// ═══════════════════════════════════════════

/** Hash a password with a random salt. Returns "salt_hex:hash_hex". */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(SALT_LENGTH)
  const hash = await new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(password, salt, SCRYPT_KEY_LENGTH, (err: Error | null, key: Buffer) => {
      if (err) reject(err)
      else resolve(key)
    })
  })
  return `${salt.toString('hex')}:${hash.toString('hex')}`
}

/** Verify a password against a stored "salt_hex:hash_hex" string. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split(':')
  if (parts.length !== 2) return false
  const salt = Buffer.from(parts[0]!, 'hex')
  const storedHash = Buffer.from(parts[1]!, 'hex')
  const hash = await new Promise<Buffer>((resolve, reject) => {
    crypto.scrypt(password, salt, SCRYPT_KEY_LENGTH, (err: Error | null, key: Buffer) => {
      if (err) reject(err)
      else resolve(key)
    })
  })
  return crypto.timingSafeEqual(hash, storedHash)
}

// ═══════════════════════════════════════════
// Session management (Redis-backed)
// ═══════════════════════════════════════════

/** Create a new session for a user. Returns the session token. */
export async function createSession(redis: Redis, userId: string): Promise<string> {
  const token = crypto.randomBytes(32).toString('hex')
  await redis.set(`${SESSION_PREFIX}${token}`, userId, 'EX', SESSION_TTL_SECONDS)
  logger.debug({ userId }, 'Session created')
  return token
}

/** Validate a session token. Returns userId or null. */
export async function validateSession(redis: Redis, token: string): Promise<string | null> {
  if (!token) return null
  const userId = await redis.get(`${SESSION_PREFIX}${token}`)
  return userId
}

/** Destroy a session. */
export async function destroySession(redis: Redis, token: string): Promise<void> {
  if (!token) return
  await redis.del(`${SESSION_PREFIX}${token}`)
}

/** Extract session token from cookie header. */
export function getSessionToken(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null
  const match = cookieHeader.match(new RegExp(`${SESSION_COOKIE_NAME}=([^;]+)`))
  return match?.[1] ?? null
}

/** Build Set-Cookie header value for a session token. */
export function sessionCookie(token: string, maxAge = SESSION_TTL_SECONDS, secure = false): string {
  return `${SESSION_COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`
}

/** Build Set-Cookie header to clear the session. */
export function clearSessionCookie(secure = false): string {
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`
}

// ═══════════════════════════════════════════
// Credential storage (user_credentials table)
// ═══════════════════════════════════════════

/** Store a password hash for a user. */
export async function storeCredentials(pool: Pool, userId: string, passwordHash: string): Promise<void> {
  await pool.query(
    `INSERT INTO user_credentials (user_id, password_hash)
     VALUES ($1, $2)
     ON CONFLICT (user_id) DO UPDATE SET password_hash = $2, updated_at = now()`,
    [userId, passwordHash],
  )
}

/** Retrieve password hash for a user. */
export async function getCredentials(pool: Pool, userId: string): Promise<string | null> {
  const { rows } = await pool.query<{ password_hash: string }>(
    `SELECT password_hash FROM user_credentials WHERE user_id = $1`,
    [userId],
  )
  return rows[0]?.password_hash ?? null
}

/** Update last_login timestamp. */
export async function updateLastLogin(pool: Pool, userId: string): Promise<void> {
  await pool.query(
    `UPDATE user_credentials SET last_login = now() WHERE user_id = $1`,
    [userId],
  )
}

/** Find a user by email (looks up user_contacts with channel='email'). */
export async function findUserByEmail(pool: Pool, email: string): Promise<{ userId: string; displayName: string | null; listType: string } | null> {
  const { rows } = await pool.query<{ user_id: string; display_name: string | null; list_type: string }>(
    `SELECT u.id AS user_id, u.display_name, u.list_type
     FROM user_contacts uc
     JOIN users u ON u.id = uc.user_id
     WHERE uc.channel = 'email' AND LOWER(uc.sender_id) = LOWER($1) AND u.is_active = true
     LIMIT 1`,
    [email],
  )
  return rows[0] ? { userId: rows[0].user_id, displayName: rows[0].display_name, listType: rows[0].list_type } : null
}
