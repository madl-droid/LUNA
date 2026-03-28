// cortex/reflex/metrics-store.ts — Structured Redis metrics for dashboard and Pulse
// Reads metrics written by counters.ts flush + evaluator checks.

import type { Redis } from 'ioredis'
import pino from 'pino'

const logger = pino({ name: 'cortex:metrics' })

const PREFIX = 'reflex:metrics'
const STATUS_KEY = 'reflex:status'
const STATUS_TTL = 300 // 5 minutes

export interface MetricsSummary {
  pipeline: {
    count: number
    errors: number
    latency_avg: number
    latency_max: number
  }
  llm: {
    calls: number
    errors: number
    tokens_in: number
    tokens_out: number
    fallbacks: number
  }
  tools: {
    calls: number
    errors: number
  }
  hourly: {
    pipeline: number
    llm_errors: number
    llm_fallbacks: number
  }
}

/**
 * Read all current metrics from Redis into a structured summary.
 */
export async function getMetricsSummary(redis: Redis): Promise<MetricsSummary> {
  try {
    const hourKey = new Date().toISOString().slice(0, 13)

    const keys = [
      `${PREFIX}:pipeline:count`,
      `${PREFIX}:pipeline:errors`,
      `${PREFIX}:pipeline:latency_avg`,
      `${PREFIX}:pipeline:latency_max`,
      `${PREFIX}:llm:calls`,
      `${PREFIX}:llm:errors`,
      `${PREFIX}:llm:tokens_in`,
      `${PREFIX}:llm:tokens_out`,
      `${PREFIX}:llm:fallbacks`,
      `${PREFIX}:tool:calls`,
      `${PREFIX}:tool:errors`,
      `${PREFIX}:hourly:${hourKey}:pipeline`,
      `${PREFIX}:hourly:${hourKey}:llm_errors`,
      `${PREFIX}:hourly:${hourKey}:llm_fallbacks`,
    ]

    const values = await redis.mget(...keys)
    const nums = values.map((v: string | null) => (v ? parseInt(v, 10) : 0))

    return {
      pipeline: {
        count: nums[0]!,
        errors: nums[1]!,
        latency_avg: nums[2]!,
        latency_max: nums[3]!,
      },
      llm: {
        calls: nums[4]!,
        errors: nums[5]!,
        tokens_in: nums[6]!,
        tokens_out: nums[7]!,
        fallbacks: nums[8]!,
      },
      tools: {
        calls: nums[9]!,
        errors: nums[10]!,
      },
      hourly: {
        pipeline: nums[11]!,
        llm_errors: nums[12]!,
        llm_fallbacks: nums[13]!,
      },
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to read metrics from Redis')
    return {
      pipeline: { count: 0, errors: 0, latency_avg: 0, latency_max: 0 },
      llm: { calls: 0, errors: 0, tokens_in: 0, tokens_out: 0, fallbacks: 0 },
      tools: { calls: 0, errors: 0 },
      hourly: { pipeline: 0, llm_errors: 0, llm_fallbacks: 0 },
    }
  }
}

/**
 * Write a full health status snapshot to Redis (consumed by dashboard/Pulse).
 */
export async function writeHealthSnapshot(redis: Redis, snapshot: Record<string, unknown>): Promise<void> {
  try {
    await redis.set(STATUS_KEY, JSON.stringify(snapshot), 'EX', STATUS_TTL)
  } catch (err) {
    logger.warn({ err }, 'Failed to write health snapshot')
  }
}

/**
 * Read the last health snapshot.
 */
export async function readHealthSnapshot(redis: Redis): Promise<Record<string, unknown> | null> {
  try {
    const raw = await redis.get(STATUS_KEY)
    return raw ? JSON.parse(raw) as Record<string, unknown> : null
  } catch {
    return null
  }
}
