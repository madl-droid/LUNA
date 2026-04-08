// LUNA — Kernel Redis connection

import { Redis } from 'ioredis'
import pino from 'pino'
import { kernelConfig } from './config.js'

const logger = pino({ name: 'kernel:redis' })

// Exponential backoff delays for reconnect (ms): 100, 500, 1000, 2000, 5000
const RETRY_DELAYS = [100, 500, 1000, 2000, 5000]
const MAX_RETRIES = 10

export async function createRedis(): Promise<Redis> {
  const redis = new Redis({
    host: kernelConfig.redis.host,
    port: kernelConfig.redis.port,
    password: kernelConfig.redis.password || undefined,
    db: kernelConfig.redis.db,
    // null = commands wait for reconnect instead of failing immediately
    maxRetriesPerRequest: null,
    lazyConnect: true,
    // FIX-04: Exponential backoff reconnect strategy (100ms→500ms→1s→2s→5s)
    retryStrategy: (times: number) => {
      if (times > MAX_RETRIES) {
        logger.error({ times }, 'Redis connection failed after max retries — giving up')
        return null  // Stop retrying; app health check will detect this
      }
      const delay = RETRY_DELAYS[Math.min(times - 1, RETRY_DELAYS.length - 1)] ?? 5000
      logger.warn({ times, delayMs: delay }, 'Redis reconnecting with backoff')
      return delay
    },
    // Reconnect on READONLY (Redis failover/replica promotion) and LOADING
    reconnectOnError: (err: Error) => {
      return err.message.includes('READONLY') || err.message.includes('LOADING')
    },
  })

  redis.on('error', (err: Error) => {
    logger.error({ err }, 'Redis connection error')
  })
  redis.on('close', () => {
    logger.warn('Redis connection closed')
  })
  redis.on('reconnecting', () => {
    logger.info('Redis reconnecting...')
  })
  redis.on('ready', () => {
    logger.info('Redis connection ready')
  })

  await redis.connect()
  logger.info('Redis connected')
  return redis
}
