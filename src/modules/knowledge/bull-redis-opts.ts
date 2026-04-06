// LUNA — Knowledge — BullMQ Redis connection options helper
// Single source of truth for BullMQ Redis opts. Used by embedding-queue and vectorize-worker.

import type { Redis } from 'ioredis'

export function getBullRedisOpts(redis: Redis): {
  host: string
  port: number
  password: string | undefined
  db: number
  maxRetriesPerRequest: null
} {
  return {
    host: redis.options.host ?? 'localhost',
    port: redis.options.port ?? 6379,
    password: redis.options.password,
    db: redis.options.db ?? 0,
    maxRetriesPerRequest: null,
  }
}
