// cortex/reflex/sensors.ts — Lightweight hook listeners that feed counters + ring buffer
// Sensors observe. They never block, never modify, never decide.

import { EventEmitter } from 'node:events'
import type { Registry } from '../../../kernel/registry.js'
import type { CounterSet } from '../types.js'
import { RingBuffer } from './ring-buffer.js'
import pino from 'pino'

const logger = pino({ name: 'cortex:sensors' })

/** Internal event bus for Reflex (sensor → evaluator communication) */
export const reflexBus = new EventEmitter()

// Track pipeline start timestamps to calculate duration
const pipelineStarts = new Map<string, number>()
const PIPELINE_START_TTL = 120_000 // 2 min max tracking

/**
 * Register all sensor hooks on the kernel registry.
 * Sensors run at priority 1 (before everything else) to capture events early.
 */
export function registerSensors(
  registry: Registry,
  counters: CounterSet,
  ringBuffer: RingBuffer,
): void {
  // ─── Pipeline sensors ───────────────────

  registry.addHook('cortex', 'message:incoming', async (payload) => {
    // Track start time for latency calculation
    const key = `${payload.channelName}:${payload.from}`
    pipelineStarts.set(key, Date.now())

    // Cleanup old entries to prevent memory leak
    if (pipelineStarts.size > 500) {
      const now = Date.now()
      for (const [k, ts] of pipelineStarts) {
        if (now - ts > PIPELINE_START_TTL) pipelineStarts.delete(k)
      }
    }

    counters.pipeline_count++
  }, 1) // priority 1 = runs first

  registry.addHook('cortex', 'message:sent', async (payload) => {
    const key = `${payload.channel}:${payload.to}`
    const startTs = pipelineStarts.get(key)

    if (startTs) {
      const durationMs = Date.now() - startTs
      counters.pipeline_latency_sum += durationMs
      if (durationMs > counters.pipeline_latency_max) {
        counters.pipeline_latency_max = durationMs
      }
      pipelineStarts.delete(key)
    }

    if (!payload.success) {
      counters.pipeline_errors++
      ringBuffer.push({
        timestamp: Date.now(),
        level: 'error',
        component: 'pipeline',
        message: `Message send failed: channel=${payload.channel} to=${payload.to}`,
      })
    }
  }, 1)

  // ─── LLM sensors ───────────────────────

  registry.addHook('cortex', 'llm:provider_down', async (payload) => {
    counters.llm_errors++
    ringBuffer.push({
      timestamp: Date.now(),
      level: 'error',
      component: 'llm',
      message: `Provider down: ${payload.provider} — ${payload.reason}`,
    })
    // Emit instant event for evaluator
    reflexBus.emit('provider:down', payload)
  }, 1)

  registry.addHook('cortex', 'llm:provider_up', async (payload) => {
    ringBuffer.push({
      timestamp: Date.now(),
      level: 'warn',
      component: 'llm',
      message: `Provider recovered: ${payload.provider}`,
    })
    reflexBus.emit('provider:up', payload)
  }, 1)

  // ─── Tool sensors ──────────────────────

  registry.addHook('cortex', 'tools:executed', async (payload) => {
    counters.tool_calls++
    if (!payload.success) {
      counters.tool_errors++
      ringBuffer.push({
        timestamp: Date.now(),
        level: 'error',
        component: 'tools',
        message: `Tool failed: ${payload.toolName} (${payload.durationMs}ms) — ${payload.error ?? 'unknown'}`,
      })
    }
  }, 1)

  // ─── Channel sensors (WhatsApp status changes) ───

  // WhatsApp adapter emits status via its own mechanism.
  // We poll it in the evaluator (direct check), but also listen for disconnect events.
  // The adapter fires connection.update internally — we detect it via getState() in evaluator.

  // ─── Module lifecycle ──────────────────

  registry.addHook('cortex', 'module:deactivated', async (payload) => {
    ringBuffer.push({
      timestamp: Date.now(),
      level: 'warn',
      component: 'kernel',
      message: `Module deactivated: ${payload.name}`,
    })
  }, 1)

  logger.info('Reflex sensors registered')
}

/**
 * Clear pipeline tracking state (for clean shutdown).
 */
export function clearSensors(): void {
  pipelineStarts.clear()
  reflexBus.removeAllListeners()
}
