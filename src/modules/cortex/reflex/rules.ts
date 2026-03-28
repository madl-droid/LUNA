// cortex/reflex/rules.ts — Rule definitions for Reflex evaluator
// Each rule: check returns true when something is WRONG.
// 100% code. Zero LLM.

import * as os from 'node:os'
import type { Rule } from '../types.js'

// ═══════════════════════════════════════════
// Ola 1: Critical rules (direct checks)
// ═══════════════════════════════════════════

const pgDown: Rule = {
  id: 'pg-down',
  name: 'PostgreSQL caído',
  severity: 'critical',
  component: 'db',
  async check(ctx) {
    try {
      const result = await Promise.race([
        ctx.db.query('SELECT 1'),
        new Promise<null>((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000)),
      ])
      return result === null
    } catch {
      return true
    }
  },
  async getMessage() {
    return '⛔ CRÍTICO — PostgreSQL desconectado\npool.query timeout o error de conexión'
  },
}

const redisDown: Rule = {
  id: 'redis-down',
  name: 'Redis caído',
  severity: 'critical',
  component: 'redis',
  async check(ctx) {
    try {
      const result = await Promise.race([
        ctx.redis.ping(),
        new Promise<null>((_, reject) => setTimeout(() => reject(new Error('timeout')), 2000)),
      ])
      return result !== 'PONG'
    } catch {
      return true
    }
  },
  async getMessage() {
    return '⛔ CRÍTICO — Redis desconectado\nredis.ping() timeout o error de conexión'
  },
}

const whatsappDown: Rule = {
  id: 'wa-down',
  name: 'WhatsApp desconectado',
  severity: 'critical',
  component: 'whatsapp',
  async check(ctx) {
    const adapter = ctx.registry.getOptional<{ getState(): { status: string } }>('whatsapp:adapter')
    if (!adapter) return false // not configured, not an error
    const state = adapter.getState()
    return state.status === 'disconnected'
  },
  async getMessage(ctx) {
    const adapter = ctx.registry.getOptional<{
      getState(): { status: string; lastDisconnectReason: string | null }
    }>('whatsapp:adapter')
    const reason = adapter?.getState().lastDisconnectReason ?? 'unknown'
    return `⛔ CRÍTICO — WhatsApp desconectado\nRazón: ${reason}`
  },
}

const memoryHigh: Rule = {
  id: 'mem-high',
  name: 'Memoria alta',
  severity: 'critical',
  component: 'system',
  async check(ctx) {
    const total = os.totalmem()
    const used = total - os.freemem()
    const percent = (used / total) * 100
    return percent > ctx.config.CORTEX_REFLEX_MEM_THRESHOLD
  },
  async getMessage(ctx) {
    const total = os.totalmem()
    const used = total - os.freemem()
    const percent = Math.round((used / total) * 100)
    return `⛔ CRÍTICO — Memoria al ${percent}% (umbral: ${ctx.config.CORTEX_REFLEX_MEM_THRESHOLD}%)\nUsado: ${Math.round(used / 1024 / 1024)}MB / ${Math.round(total / 1024 / 1024)}MB`
  },
}

const diskHigh: Rule = {
  id: 'disk-high',
  name: 'Disco lleno',
  severity: 'critical',
  component: 'system',
  async check(ctx) {
    try {
      const { statfsSync } = await import('node:fs')
      const stats = statfsSync('/')
      const total = stats.blocks * stats.bsize
      const free = stats.bfree * stats.bsize
      const usedPercent = ((total - free) / total) * 100
      return usedPercent > ctx.config.CORTEX_REFLEX_DISK_THRESHOLD
    } catch {
      return false // can't check, don't alert
    }
  },
  async getMessage(ctx) {
    try {
      const { statfsSync } = await import('node:fs')
      const stats = statfsSync('/')
      const total = stats.blocks * stats.bsize
      const free = stats.bfree * stats.bsize
      const usedPercent = Math.round(((total - free) / total) * 100)
      return `⛔ CRÍTICO — Disco al ${usedPercent}% (umbral: ${ctx.config.CORTEX_REFLEX_DISK_THRESHOLD}%)\nLibre: ${Math.round(free / 1024 / 1024)}MB`
    } catch {
      return '⛔ CRÍTICO — Disco lleno (no se pudo leer stats)'
    }
  },
}

const eventLoopLag: Rule = {
  id: 'eventloop-lag',
  name: 'Event loop congelado',
  severity: 'critical',
  component: 'system',
  async check() {
    return new Promise<boolean>((resolve) => {
      const start = performance.now()
      setImmediate(() => {
        const lag = performance.now() - start
        resolve(lag > 500) // >500ms lag = frozen
      })
    })
  },
  async getMessage() {
    return '⛔ CRÍTICO — Event loop lag >500ms\nEl proceso Node.js está bloqueado'
  },
}

// ═══════════════════════════════════════════
// Ola 2: Degradation rules (metrics from Redis)
// ═══════════════════════════════════════════

const llmCircuitOpen: Rule = {
  id: 'llm-circuit-open',
  name: 'LLM circuit breaker abierto',
  severity: 'degraded',
  component: 'llm',
  async check(ctx) {
    const gateway = ctx.registry.getOptional<{
      getBreakerSnapshots?: () => Array<{ provider: string; state: string }>
    }>('llm:gateway')
    if (!gateway?.getBreakerSnapshots) return false
    return gateway.getBreakerSnapshots().some(s => s.state === 'open')
  },
  async getMessage(ctx) {
    const gateway = ctx.registry.getOptional<{
      getBreakerSnapshots?: () => Array<{ provider: string; state: string }>
    }>('llm:gateway')
    const open = gateway?.getBreakerSnapshots?.().filter(s => s.state === 'open') ?? []
    const providers = open.map(s => s.provider).join(', ')
    return `⚠ DEGRADADO — Circuit breaker abierto: ${providers}`
  },
}

const bullmqQueueGrowing: Rule = {
  id: 'bullmq-queue',
  name: 'Cola BullMQ creciendo',
  severity: 'degraded',
  component: 'bullmq',
  async check(ctx) {
    try {
      const waiting = await ctx.redis.llen('bull:luna-scheduled-tasks:wait')
      return waiting > 50
    } catch {
      return false
    }
  },
  async getMessage(ctx) {
    try {
      const waiting = await ctx.redis.llen('bull:luna-scheduled-tasks:wait')
      return `⚠ DEGRADADO — Cola BullMQ: ${waiting} jobs esperando (umbral: 50)`
    } catch {
      return '⚠ DEGRADADO — Cola BullMQ creciendo'
    }
  },
}

const latencyHigh: Rule = {
  id: 'latency-high',
  name: 'Latencia pipeline alta',
  severity: 'degraded',
  component: 'pipeline',
  async check(ctx) {
    try {
      const val = await ctx.redis.get('reflex:metrics:pipeline:latency_avg')
      if (!val) return false
      return parseInt(val, 10) > ctx.config.CORTEX_REFLEX_LATENCY_THRESHOLD_MS
    } catch {
      return false
    }
  },
  async getMessage(ctx) {
    try {
      const val = await ctx.redis.get('reflex:metrics:pipeline:latency_avg')
      const avg = val ? parseInt(val, 10) : 0
      return `⚠ DEGRADADO — Latencia pipeline: ${avg}ms (umbral: ${ctx.config.CORTEX_REFLEX_LATENCY_THRESHOLD_MS}ms)`
    } catch {
      return '⚠ DEGRADADO — Latencia pipeline alta'
    }
  },
}

const toolFailing: Rule = {
  id: 'tool-failing',
  name: 'Tool fallando repetidamente',
  severity: 'degraded',
  component: 'tools',
  async check(ctx) {
    // Check if tool errors exceed 5 in the current flush window
    return ctx.counters.tool_errors > 5
  },
  async getMessage(ctx) {
    return `⚠ DEGRADADO — ${ctx.counters.tool_errors} errores de tools en el último ciclo`
  },
}

const emailOAuthExpired: Rule = {
  id: 'email-oauth-expired',
  name: 'Email OAuth expirado',
  severity: 'degraded',
  component: 'gmail',
  async check(ctx) {
    const gmail = ctx.registry.getOptional<{
      isAuthenticated?: () => boolean
    }>('gmail:api')
    if (!gmail) return false
    if (!gmail.isAuthenticated) return false
    return !gmail.isAuthenticated()
  },
  async getMessage() {
    return '⚠ DEGRADADO — Gmail OAuth token expirado\nNo se pueden enviar/recibir emails'
  },
}

// ═══════════════════════════════════════════
// Ola 2: Informational rules
// ═══════════════════════════════════════════

const leadsWaiting: Rule = {
  id: 'leads-waiting',
  name: 'Leads sin respuesta',
  severity: 'info',
  component: 'pipeline',
  async check(ctx) {
    try {
      // Count contacts with pending messages older than 5 minutes
      const result = await ctx.db.query(
        `SELECT COUNT(*) as cnt FROM messages
         WHERE direction = 'incoming'
         AND created_at > NOW() - INTERVAL '1 hour'
         AND created_at < NOW() - INTERVAL '5 minutes'
         AND NOT EXISTS (
           SELECT 1 FROM messages m2
           WHERE m2.contact_id = messages.contact_id
           AND m2.direction = 'outgoing'
           AND m2.created_at > messages.created_at
         )`,
      )
      const count = parseInt(result.rows[0]?.cnt ?? '0', 10)
      return count > 3
    } catch {
      return false
    }
  },
  async getMessage(ctx) {
    try {
      const result = await ctx.db.query(
        `SELECT COUNT(*) as cnt FROM messages
         WHERE direction = 'incoming'
         AND created_at > NOW() - INTERVAL '1 hour'
         AND created_at < NOW() - INTERVAL '5 minutes'
         AND NOT EXISTS (
           SELECT 1 FROM messages m2
           WHERE m2.contact_id = messages.contact_id
           AND m2.direction = 'outgoing'
           AND m2.created_at > messages.created_at
         )`,
      )
      const count = parseInt(result.rows[0]?.cnt ?? '0', 10)
      return `ℹ INFO — ${count} leads esperando respuesta >5 min`
    } catch {
      return 'ℹ INFO — Leads sin respuesta detectados'
    }
  },
}

const fallbackRateHigh: Rule = {
  id: 'fallback-rate-high',
  name: 'Tasa de fallback alta',
  severity: 'info',
  component: 'llm',
  async check(ctx) {
    try {
      const hourKey = new Date().toISOString().slice(0, 13)
      const [pipelineStr, fallbackStr] = await Promise.all([
        ctx.redis.get(`reflex:metrics:hourly:${hourKey}:pipeline`),
        ctx.redis.get(`reflex:metrics:hourly:${hourKey}:llm_fallbacks`),
      ])
      const pipeline = parseInt(pipelineStr ?? '0', 10)
      const fallbacks = parseInt(fallbackStr ?? '0', 10)
      if (pipeline < 10) return false // not enough data
      return (fallbacks / pipeline) > 0.2
    } catch {
      return false
    }
  },
  async getMessage(ctx) {
    try {
      const hourKey = new Date().toISOString().slice(0, 13)
      const [pipelineStr, fallbackStr] = await Promise.all([
        ctx.redis.get(`reflex:metrics:hourly:${hourKey}:pipeline`),
        ctx.redis.get(`reflex:metrics:hourly:${hourKey}:llm_fallbacks`),
      ])
      const pipeline = parseInt(pipelineStr ?? '0', 10)
      const fallbacks = parseInt(fallbackStr ?? '0', 10)
      const rate = pipeline > 0 ? Math.round((fallbacks / pipeline) * 100) : 0
      return `ℹ INFO — Tasa de fallback: ${rate}% (${fallbacks}/${pipeline} mensajes esta hora)`
    } catch {
      return 'ℹ INFO — Tasa de fallback alta'
    }
  },
}

// ═══════════════════════════════════════════
// Exports
// ═══════════════════════════════════════════

/** Critical rules (direct checks, no Redis dependency) */
export const CRITICAL_RULES: Rule[] = [
  pgDown,
  redisDown,
  whatsappDown,
  memoryHigh,
  diskHigh,
  eventLoopLag,
]

/** Degraded rules (depend on Redis metrics) */
export const DEGRADED_RULES: Rule[] = [
  llmCircuitOpen,
  bullmqQueueGrowing,
  latencyHigh,
  toolFailing,
  emailOAuthExpired,
]

/** Info rules (accumulated, not real-time alerts) */
export const INFO_RULES: Rule[] = [
  leadsWaiting,
  fallbackRateHigh,
]

/** All 13 rules */
export const ALL_RULES: Rule[] = [...CRITICAL_RULES, ...DEGRADED_RULES, ...INFO_RULES]
