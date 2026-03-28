// cortex/reflex/counters.ts — In-memory counters with periodic Redis flush
// Accumulates metrics synchronously (zero overhead per event).
// Flushes totals to Redis in a single pipeline call (1 round-trip).

import type { Redis } from 'ioredis'
import type { CounterSet } from '../types.js'
import pino from 'pino'

const logger = pino({ name: 'cortex:counters' })

const REDIS_PREFIX = 'reflex:metrics'
const REDIS_TTL = 86400 // 24 hours

/** Create a fresh zero counter set */
export function createCounters(): CounterSet {
  return {
    pipeline_count: 0,
    pipeline_errors: 0,
    pipeline_latency_sum: 0,
    pipeline_latency_max: 0,
    llm_calls: 0,
    llm_errors: 0,
    llm_tokens_in: 0,
    llm_tokens_out: 0,
    llm_fallbacks: 0,
    tool_calls: 0,
    tool_errors: 0,
  }
}

/** Flush counters to Redis in a single pipeline, then reset */
export async function flushToRedis(counters: CounterSet, redis: Redis): Promise<void> {
  try {
    const pipelineCount = counters.pipeline_count
    const avgLatency = pipelineCount > 0
      ? Math.round(counters.pipeline_latency_sum / pipelineCount)
      : 0

    const pipe = redis.pipeline()
    pipe.set(`${REDIS_PREFIX}:pipeline:count`, String(pipelineCount), 'EX', REDIS_TTL)
    pipe.set(`${REDIS_PREFIX}:pipeline:errors`, String(counters.pipeline_errors), 'EX', REDIS_TTL)
    pipe.set(`${REDIS_PREFIX}:pipeline:latency_avg`, String(avgLatency), 'EX', REDIS_TTL)
    pipe.set(`${REDIS_PREFIX}:pipeline:latency_max`, String(counters.pipeline_latency_max), 'EX', REDIS_TTL)
    pipe.set(`${REDIS_PREFIX}:llm:calls`, String(counters.llm_calls), 'EX', REDIS_TTL)
    pipe.set(`${REDIS_PREFIX}:llm:errors`, String(counters.llm_errors), 'EX', REDIS_TTL)
    pipe.set(`${REDIS_PREFIX}:llm:tokens_in`, String(counters.llm_tokens_in), 'EX', REDIS_TTL)
    pipe.set(`${REDIS_PREFIX}:llm:tokens_out`, String(counters.llm_tokens_out), 'EX', REDIS_TTL)
    pipe.set(`${REDIS_PREFIX}:llm:fallbacks`, String(counters.llm_fallbacks), 'EX', REDIS_TTL)
    pipe.set(`${REDIS_PREFIX}:tool:calls`, String(counters.tool_calls), 'EX', REDIS_TTL)
    pipe.set(`${REDIS_PREFIX}:tool:errors`, String(counters.tool_errors), 'EX', REDIS_TTL)
    await pipe.exec()

    // Accumulate hourly counters (INCRBY so multiple flush cycles aggregate)
    const hourKey = new Date().toISOString().slice(0, 13) // YYYY-MM-DDTHH
    const hourPipe = redis.pipeline()
    hourPipe.incrby(`${REDIS_PREFIX}:hourly:${hourKey}:pipeline`, pipelineCount)
    hourPipe.expire(`${REDIS_PREFIX}:hourly:${hourKey}:pipeline`, REDIS_TTL)
    hourPipe.incrby(`${REDIS_PREFIX}:hourly:${hourKey}:llm_errors`, counters.llm_errors)
    hourPipe.expire(`${REDIS_PREFIX}:hourly:${hourKey}:llm_errors`, REDIS_TTL)
    hourPipe.incrby(`${REDIS_PREFIX}:hourly:${hourKey}:llm_fallbacks`, counters.llm_fallbacks)
    hourPipe.expire(`${REDIS_PREFIX}:hourly:${hourKey}:llm_fallbacks`, REDIS_TTL)
    await hourPipe.exec()

    logger.debug({ pipelineCount, avgLatency }, 'Counters flushed to Redis')
  } catch (err) {
    logger.warn({ err }, 'Failed to flush counters to Redis')
  }

  // Reset all counters
  counters.pipeline_count = 0
  counters.pipeline_errors = 0
  counters.pipeline_latency_sum = 0
  counters.pipeline_latency_max = 0
  counters.llm_calls = 0
  counters.llm_errors = 0
  counters.llm_tokens_in = 0
  counters.llm_tokens_out = 0
  counters.llm_fallbacks = 0
  counters.tool_calls = 0
  counters.tool_errors = 0
}

/** Read a metric from Redis (for evaluator trend checks) */
export async function readMetric(redis: Redis, key: string): Promise<number> {
  try {
    const val = await redis.get(`${REDIS_PREFIX}:${key}`)
    return val ? parseInt(val, 10) : 0
  } catch {
    return 0
  }
}

/** Read hourly counter */
export async function readHourlyMetric(redis: Redis, key: string): Promise<number> {
  try {
    const hourKey = new Date().toISOString().slice(0, 13)
    const val = await redis.get(`${REDIS_PREFIX}:hourly:${hourKey}:${key}`)
    return val ? parseInt(val, 10) : 0
  } catch {
    return 0
  }
}
