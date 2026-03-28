// cortex/reflex/health.ts — Enhanced health check logic
// Active verification with 2s timeout per component. No cache.

import type { Pool } from 'pg'
import type { Redis } from 'ioredis'
import type { Registry } from '../../../kernel/registry.js'
import type { HealthStatus, ComponentStatus, EmailStatus } from '../types.js'
import { readMetric } from './counters.js'

const startTime = Date.now()

/** Race a promise against a timeout. Returns null on timeout. */
async function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([
    promise,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), ms)),
  ])
}

export async function checkHealth(
  db: Pool,
  redis: Redis,
  registry: Registry,
): Promise<HealthStatus> {
  // ─── Component checks (parallel, 2s timeout each) ───

  const [pgStatus, redisStatus, waStatus, emailStatus, bullmqStatus, cbStatus] = await Promise.all([
    checkPostgres(db),
    checkRedis(redis),
    checkWhatsApp(registry),
    checkEmail(registry),
    checkBullMQ(redis),
    checkCircuitBreakers(registry),
  ])

  // ─── Pipeline metrics from Redis ───
  let messagesLastHour = 0
  let avgLatency = 0
  try {
    messagesLastHour = await readMetric(redis, 'pipeline:count')
    avgLatency = await readMetric(redis, 'pipeline:latency_avg')
  } catch { /* Redis may be down */ }

  // ─── Overall status ───
  const pgDown = pgStatus === 'disconnected'
  const redisDown = redisStatus === 'disconnected'
  const anyDegraded = waStatus === 'disconnected' || emailStatus === 'expired'

  let status: HealthStatus['status'] = 'healthy'
  if (pgDown || redisDown) status = 'down'
  else if (anyDegraded) status = 'degraded'

  return {
    status,
    uptime_seconds: Math.floor((Date.now() - startTime) / 1000),
    components: {
      postgresql: pgStatus,
      redis: redisStatus,
      whatsapp: waStatus,
      email: emailStatus,
    },
    bullmq: bullmqStatus,
    pipeline: {
      messages_last_hour: messagesLastHour,
      avg_latency_ms: avgLatency,
    },
    circuit_breakers: cbStatus,
  }
}

async function checkPostgres(db: Pool): Promise<ComponentStatus> {
  const result = await withTimeout(
    db.query('SELECT 1').then(() => true).catch(() => false),
    2000,
  )
  return result ? 'connected' : 'disconnected'
}

async function checkRedis(redis: Redis): Promise<ComponentStatus> {
  const result = await withTimeout(
    redis.ping().then((r: string) => r === 'PONG').catch(() => false),
    2000,
  )
  return result ? 'connected' : 'disconnected'
}

async function checkWhatsApp(registry: Registry): Promise<ComponentStatus> {
  const adapter = registry.getOptional<{
    getState(): { status: string }
  }>('whatsapp:adapter')
  if (!adapter) return 'not_configured'
  const state = adapter.getState()
  return state.status === 'connected' ? 'connected' : 'disconnected'
}

async function checkEmail(registry: Registry): Promise<EmailStatus> {
  // Gmail module exposes oauth status if available
  const gmail = registry.getOptional<{
    isAuthenticated?: () => boolean
  }>('gmail:api')
  if (!gmail) return 'not_configured'
  if (gmail.isAuthenticated && !gmail.isAuthenticated()) return 'expired'
  return 'authenticated'
}

async function checkBullMQ(redis: Redis): Promise<{ waiting: number; active: number; failed: number }> {
  try {
    // Read BullMQ job counts directly from Redis keys
    const [waiting, active, failed] = await Promise.all([
      redis.llen('bull:luna-scheduled-tasks:wait').catch(() => 0),
      redis.llen('bull:luna-scheduled-tasks:active').catch(() => 0),
      redis.zcard('bull:luna-scheduled-tasks:failed').catch(() => 0),
    ])
    return { waiting, active, failed }
  } catch {
    return { waiting: 0, active: 0, failed: 0 }
  }
}

async function checkCircuitBreakers(
  registry: Registry,
): Promise<Record<string, 'open' | 'closed' | 'half-open'>> {
  const result: Record<string, 'open' | 'closed' | 'half-open'> = {}
  const gateway = registry.getOptional<{
    getBreakerSnapshots?: () => Array<{ provider: string; state: string }>
  }>('llm:gateway')
  if (gateway?.getBreakerSnapshots) {
    for (const snap of gateway.getBreakerSnapshots()) {
      result[snap.provider] = snap.state as 'open' | 'closed' | 'half-open'
    }
  }
  return result
}
