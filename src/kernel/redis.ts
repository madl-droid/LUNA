// LUNA — Kernel Redis connection

import { Redis } from 'ioredis'
import pino from 'pino'
import { kernelConfig } from './config.js'

const logger = pino({ name: 'kernel:redis' })

export async function createRedis(): Promise<Redis> {
  const redis = new Redis({
    host: kernelConfig.redis.host,
    port: kernelConfig.redis.port,
    password: kernelConfig.redis.password || undefined,
    db: kernelConfig.redis.db,
    maxRetriesPerRequest: kernelConfig.redis.maxRetries,
    lazyConnect: true,
  })

  await redis.connect()
  logger.info('Redis connected')
  return redis
}
