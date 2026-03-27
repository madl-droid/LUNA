// LUNA — Kernel atomic Redis rate limiter
// FIX: SEC-8.1/SEC-8.2/SEC-8.3 — Lua scripts atómicos para evitar TOCTOU en rate limits.
// Usado por: gmail rate-limiter, engine phase5, medilink rate-limiter.

import type { Redis } from 'ioredis'

// Single key: INCR + check + EXPIRE atomically
// Returns 1 if allowed, 0 if exceeded
const SINGLE_LUA = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[2])
end
if current > tonumber(ARGV[1]) then
  return 0
end
return 1`

// Dual key: both must pass, or neither increments
// Returns 1 if both allowed, 0 if either exceeded
const DUAL_LUA = `
local c1 = redis.call('INCR', KEYS[1])
if c1 == 1 then redis.call('EXPIRE', KEYS[1], ARGV[3]) end
local c2 = redis.call('INCR', KEYS[2])
if c2 == 1 then redis.call('EXPIRE', KEYS[2], ARGV[4]) end
if c1 > tonumber(ARGV[1]) or c2 > tonumber(ARGV[2]) then
  redis.call('DECR', KEYS[1])
  redis.call('DECR', KEYS[2])
  return 0
end
return 1`

/** Atomic single-key rate limit: INCR + check in one Redis roundtrip. limit=0 means unlimited. */
export async function atomicRateCheck(
  redis: Redis, key: string, limit: number, ttlSeconds: number,
): Promise<boolean> {
  if (limit <= 0) return true
  const result = await redis.eval(SINGLE_LUA, 1, key, String(limit), String(ttlSeconds))
  return result === 1
}

/** Atomic dual-key rate limit: both keys must be within limits, or neither increments. limit=0 means unlimited. */
export async function atomicDualRateCheck(
  redis: Redis,
  key1: string, limit1: number, ttl1: number,
  key2: string, limit2: number, ttl2: number,
): Promise<boolean> {
  if (limit1 <= 0 && limit2 <= 0) return true
  if (limit1 <= 0) return atomicRateCheck(redis, key2, limit2, ttl2)
  if (limit2 <= 0) return atomicRateCheck(redis, key1, limit1, ttl1)
  const result = await redis.eval(DUAL_LUA, 2, key1, key2, String(limit1), String(limit2), String(ttl1), String(ttl2))
  return result === 1
}
