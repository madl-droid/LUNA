// LUNA Engine — Tool Loop Detector
// Detects and prevents infinite tool call loops within the agentic loop.
// Three detectors with graduated thresholds (inspired by OpenClaw patterns).

import pino from 'pino'
import type { LoopDetectorResult, LoopCallEntry } from './types.js'

const logger = pino({ name: 'engine:loop-detector' })

/**
 * Detects and prevents infinite tool call loops within the agentic loop.
 *
 * Three detectors:
 * 1. Generic Repeat: same tool + same input called N times
 * 2. No-Progress: same tool called with changing input but identical result hashes
 * 3. Ping-Pong: alternating between 2 tools repeatedly
 *
 * Graduated thresholds:
 * - warn (3): log warning, continue execution
 * - block (5): block that specific tool, inject error to LLM
 * - circuit_break (8): stop ALL tool calls, force text response
 */
export class ToolLoopDetector {
  private history: LoopCallEntry[] = []

  /** Names of tools that have been individually blocked. */
  private blockedTools = new Set<string>()

  /** Whether the circuit breaker has tripped (all tools blocked). */
  private circuitBroken = false

  // ── Thresholds ──
  private static readonly WARN_THRESHOLD = 3
  private static readonly BLOCK_THRESHOLD = 5
  private static readonly CIRCUIT_BREAK_THRESHOLD = 8

  /**
   * Record a tool call and check for loop patterns.
   *
   * @param toolName - Name of the tool being called
   * @param input - Input parameters (will be hashed for comparison)
   * @param resultData - Output data from the tool (will be hashed for no-progress detection)
   * @returns LoopDetectorResult with action and optional reason
   */
  check(toolName: string, input: Record<string, unknown>, resultData?: unknown): LoopDetectorResult {
    const inputHash = JSON.stringify(input).slice(0, 2000)
    const resultHash = resultData !== undefined ? JSON.stringify(resultData).slice(0, 2000) : 'void'

    this.history.push({ toolName, inputHash, resultHash, timestamp: Date.now() })

    // ── 1. Generic Repeat: same tool + same input ──
    const exactRepeatCount = this.history.filter(
      e => e.toolName === toolName && e.inputHash === inputHash,
    ).length

    if (exactRepeatCount >= ToolLoopDetector.CIRCUIT_BREAK_THRESHOLD) {
      this.circuitBroken = true
      const reason = `Circuit breaker tripped: tool "${toolName}" called ${exactRepeatCount} times with identical input`
      logger.error({ toolName, exactRepeatCount, reason }, 'Loop detector circuit break')
      return { action: 'circuit_break', reason }
    }

    if (exactRepeatCount >= ToolLoopDetector.BLOCK_THRESHOLD) {
      this.blockedTools.add(toolName)
      const reason = `Tool "${toolName}" blocked: called ${exactRepeatCount} times with identical input`
      logger.warn({ toolName, exactRepeatCount, reason }, 'Loop detector block')
      return { action: 'block', reason }
    }

    if (exactRepeatCount >= ToolLoopDetector.WARN_THRESHOLD) {
      const reason = `Tool "${toolName}" called ${exactRepeatCount} times with identical input`
      logger.warn({ toolName, exactRepeatCount, reason }, 'Loop detector warn')
      return { action: 'warn', reason }
    }

    // ── 2. No-Progress: same tool, different inputs, same result hash ──
    const toolHistory = this.history.filter(e => e.toolName === toolName)
    if (toolHistory.length >= 3) {
      const last5 = toolHistory.slice(-5)
      const allSameResult = last5.every(e => e.resultHash === resultHash && resultHash !== 'void')
      const allDifferentInput = last5.every(e => e.inputHash !== inputHash)

      if (allSameResult && allDifferentInput) {
        if (last5.length >= 5) {
          this.blockedTools.add(toolName)
          const reason = `Tool "${toolName}" blocked: no progress detected (5+ calls, same result, different inputs)`
          logger.warn({ toolName, count: last5.length, reason }, 'Loop detector no-progress block')
          return { action: 'block', reason }
        }
        const reason = `Tool "${toolName}" may be stuck: same result across ${last5.length} calls with different inputs`
        logger.warn({ toolName, count: last5.length, reason }, 'Loop detector no-progress warn')
        return { action: 'warn', reason }
      }
    }

    // ── 3. Ping-Pong: alternating between exactly 2 tools ──
    if (this.history.length >= 6) {
      const last6 = this.history.slice(-6)
      const toolsInLast6 = [...new Set(last6.map(e => e.toolName))]

      if (toolsInLast6.length === 2) {
        const [toolA, toolB] = toolsInLast6 as [string, string]
        const isPingPong = last6.every((e, i) =>
          (i % 2 === 0 && e.toolName === toolA) || (i % 2 === 1 && e.toolName === toolB),
        ) || last6.every((e, i) =>
          (i % 2 === 0 && e.toolName === toolB) || (i % 2 === 1 && e.toolName === toolA),
        )

        if (isPingPong) {
          // Check for 8+ alternating calls (circuit break territory)
          if (this.history.length >= 8) {
            const last8 = this.history.slice(-8)
            const toolsIn8 = [...new Set(last8.map(e => e.toolName))]
            if (toolsIn8.length === 2) {
              this.circuitBroken = true
              const reason = `Circuit breaker tripped: ping-pong loop detected between "${toolA}" and "${toolB}" (8+ alternating calls)`
              logger.error({ toolA, toolB, reason }, 'Loop detector ping-pong circuit break')
              return { action: 'circuit_break', reason }
            }
          }

          const reason = `Ping-pong pattern detected between "${toolA}" and "${toolB}"`
          logger.warn({ toolA, toolB, reason }, 'Loop detector ping-pong warn')
          return { action: 'warn', reason }
        }
      }
    }

    return { action: 'allow' }
  }

  /**
   * Pre-check before executing a tool. Returns 'block' if the tool is individually
   * blocked, or 'circuit_break' if all tools are blocked.
   * Does NOT record anything — call check() after execution.
   */
  preCheck(toolName: string): LoopDetectorResult {
    if (this.circuitBroken) {
      return { action: 'circuit_break', reason: 'Circuit breaker active — all tools blocked' }
    }
    if (this.blockedTools.has(toolName)) {
      return { action: 'block', reason: `Tool "${toolName}" blocked due to repeated calls` }
    }
    return { action: 'allow' }
  }

  /**
   * Returns true if the circuit breaker has tripped (all tools blocked).
   */
  get isCircuitBroken(): boolean {
    return this.circuitBroken
  }
}
