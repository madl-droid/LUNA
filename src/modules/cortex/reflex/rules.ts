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
// Exports
// ═══════════════════════════════════════════

/** Ola 1 rules: 6 critical direct checks */
export const CRITICAL_RULES: Rule[] = [
  pgDown,
  redisDown,
  whatsappDown,
  memoryHigh,
  diskHigh,
  eventLoopLag,
]

/** All rules (Ola 1) */
export const ALL_RULES: Rule[] = [...CRITICAL_RULES]
