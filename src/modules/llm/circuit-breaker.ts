// LUNA — LLM Circuit Breaker
// Patrón circuit breaker por provider. Protege contra cascadas de fallos.
// Estados: CLOSED (sano) → OPEN (down) → HALF-OPEN (probando) → CLOSED

import pino from 'pino'
import type {
  LLMProviderName,
  CircuitBreakerConfig,
  CircuitState,
  CircuitBreakerSnapshot,
  EscalatingCBConfig,
  EscalatingCBSnapshot,
} from './types.js'

const logger = pino({ name: 'llm:circuit-breaker' })

interface FailureRecord {
  timestamp: number
  error: string
}

export class CircuitBreaker {
  private state: CircuitState = 'closed'
  private failures: FailureRecord[] = []
  private openedAt: number | null = null
  private halfOpenRequests = 0
  private successesSinceHalfOpen = 0

  /** Called when breaker transitions to 'closed' (provider recovered). */
  onRecovery: ((provider: LLMProviderName) => void) | null = null

  constructor(
    private readonly provider: LLMProviderName,
    private readonly config: CircuitBreakerConfig,
  ) {}

  // ─── Public API ────────────────────────────

  /**
   * Check if the provider is available for requests.
   * In half-open state, allows limited requests to test recovery.
   */
  isAvailable(): boolean {
    this.pruneOldFailures()

    if (this.state === 'closed') return true

    if (this.state === 'open') {
      // Check if recovery period has elapsed → transition to half-open
      if (this.openedAt && Date.now() - this.openedAt >= this.config.recoveryMs) {
        this.transitionTo('half-open')
        return true
      }
      return false
    }

    // half-open: allow limited requests
    return this.halfOpenRequests < this.config.halfOpenMax
  }

  /**
   * Record a successful request. Resets breaker if in half-open.
   */
  recordSuccess(): void {
    if (this.state === 'half-open') {
      this.successesSinceHalfOpen++
      if (this.successesSinceHalfOpen >= this.config.halfOpenMax) {
        this.transitionTo('closed')
      }
    }
    // In closed state, successes don't change anything
  }

  /**
   * Record a failed request. May trip the breaker.
   * Returns true if this failure caused the circuit to open.
   */
  recordFailure(error: string): boolean {
    const now = Date.now()
    this.failures.push({ timestamp: now, error })

    if (this.state === 'half-open') {
      // Any failure in half-open → back to open
      this.transitionTo('open')
      return true
    }

    // In closed state, check if threshold is reached
    this.pruneOldFailures()
    if (this.failures.length >= this.config.failureThreshold) {
      this.transitionTo('open')
      return true
    }

    return false
  }

  /**
   * Force the circuit to a specific state (for manual intervention).
   */
  forceState(state: CircuitState): void {
    logger.warn({ provider: this.provider, from: this.state, to: state }, 'Circuit breaker state forced')
    this.transitionTo(state)
  }

  /**
   * Get a snapshot of the current state.
   */
  snapshot(): CircuitBreakerSnapshot {
    this.pruneOldFailures()
    return {
      provider: this.provider,
      state: this.state,
      failures: this.failures.length,
      lastFailureAt: this.failures.length > 0
        ? this.failures[this.failures.length - 1]!.timestamp
        : null,
      openedAt: this.openedAt,
      successesSinceHalfOpen: this.successesSinceHalfOpen,
    }
  }

  /**
   * Reset everything to healthy state.
   */
  reset(): void {
    this.state = 'closed'
    this.failures = []
    this.openedAt = null
    this.halfOpenRequests = 0
    this.successesSinceHalfOpen = 0
    logger.info({ provider: this.provider }, 'Circuit breaker reset')
  }

  // ─── Internal ──────────────────────────────

  private transitionTo(newState: CircuitState): void {
    const oldState = this.state
    this.state = newState

    switch (newState) {
      case 'open':
        this.openedAt = Date.now()
        this.halfOpenRequests = 0
        this.successesSinceHalfOpen = 0
        logger.error(
          { provider: this.provider, failures: this.failures.length, from: oldState },
          'Circuit breaker OPEN — provider marked as DOWN',
        )
        break

      case 'half-open':
        this.halfOpenRequests = 0
        this.successesSinceHalfOpen = 0
        logger.info(
          { provider: this.provider, recoveryMs: this.config.recoveryMs },
          'Circuit breaker HALF-OPEN — testing provider recovery',
        )
        break

      case 'closed':
        this.failures = []
        this.openedAt = null
        this.halfOpenRequests = 0
        this.successesSinceHalfOpen = 0
        logger.info({ provider: this.provider, from: oldState }, 'Circuit breaker CLOSED — provider healthy')
        if (oldState === 'half-open' && this.onRecovery) {
          this.onRecovery(this.provider)
        }
        break
    }
  }

  /**
   * Remove failures older than the rolling window.
   */
  private pruneOldFailures(): void {
    const cutoff = Date.now() - this.config.windowMs
    this.failures = this.failures.filter(f => f.timestamp > cutoff)
  }
}

// ═══════════════════════════════════════════
// Escalating Circuit Breaker — per model-target
// Key: "provider:model" (e.g. "anthropic:claude-sonnet-4-6")
// Trigger: failureThreshold failures in windowMs
// Recovery: escalates through recoverySteps (default: 1h → 3h → 6h → loop 6h)
// ═══════════════════════════════════════════

const DEFAULT_ESCALATING_CONFIG: EscalatingCBConfig = {
  failureThreshold: 2,
  windowMs: 30 * 60 * 1000,  // 30 min
  halfOpenMax: 1,
  recoverySteps: [
    1 * 60 * 60 * 1000,   // 1 hour
    3 * 60 * 60 * 1000,   // 3 hours
    6 * 60 * 60 * 1000,   // 6 hours (loops here)
  ],
}

export class EscalatingCircuitBreaker {
  private state: CircuitState = 'closed'
  private failures: Array<{ timestamp: number; error: string }> = []
  private openedAt: number | null = null
  private halfOpenRequests = 0
  private successesSinceHalfOpen = 0
  /** Current escalation level (0-indexed into recoverySteps) */
  private escalationLevel = 0

  onRecovery: ((targetKey: string) => void) | null = null
  onOpen: ((targetKey: string, escalationLevel: number) => void) | null = null

  constructor(
    readonly targetKey: string,
    private readonly config: EscalatingCBConfig = DEFAULT_ESCALATING_CONFIG,
  ) {}

  isAvailable(): boolean {
    this.pruneOldFailures()

    if (this.state === 'closed') return true

    if (this.state === 'open') {
      const recoveryMs = this.getCurrentRecoveryMs()
      if (this.openedAt && Date.now() - this.openedAt >= recoveryMs) {
        this.transitionTo('half-open')
        return true
      }
      return false
    }

    // half-open
    return this.halfOpenRequests < this.config.halfOpenMax
  }

  recordSuccess(): void {
    if (this.state === 'half-open') {
      this.successesSinceHalfOpen++
      if (this.successesSinceHalfOpen >= this.config.halfOpenMax) {
        // Recovery! Reset escalation level
        this.escalationLevel = 0
        this.transitionTo('closed')
      }
    }
  }

  recordFailure(error: string): boolean {
    const now = Date.now()
    this.failures.push({ timestamp: now, error })

    if (this.state === 'half-open') {
      // Failed during recovery test → escalate
      this.escalate()
      this.transitionTo('open')
      return true
    }

    this.pruneOldFailures()
    if (this.failures.length >= this.config.failureThreshold) {
      this.transitionTo('open')
      return true
    }

    return false
  }

  snapshot(): EscalatingCBSnapshot {
    this.pruneOldFailures()
    return {
      targetKey: this.targetKey,
      state: this.state,
      failures: this.failures.length,
      lastFailureAt: this.failures.length > 0
        ? this.failures[this.failures.length - 1]!.timestamp
        : null,
      openedAt: this.openedAt,
      escalationLevel: this.escalationLevel,
      currentRecoveryMs: this.getCurrentRecoveryMs(),
    }
  }

  reset(): void {
    this.state = 'closed'
    this.failures = []
    this.openedAt = null
    this.halfOpenRequests = 0
    this.successesSinceHalfOpen = 0
    this.escalationLevel = 0
    logger.info({ target: this.targetKey }, 'Escalating CB reset')
  }

  // ─── Internal ──────────────────────────────

  private getCurrentRecoveryMs(): number {
    const steps = this.config.recoverySteps
    if (steps.length === 0) return 60 * 60 * 1000 // fallback: 1h
    const idx = Math.min(this.escalationLevel, steps.length - 1)
    return steps[idx]!
  }

  private escalate(): void {
    const maxLevel = this.config.recoverySteps.length - 1
    if (this.escalationLevel < maxLevel) {
      this.escalationLevel++
    }
    // At max level, stays there (loops at last step)
    logger.warn({
      target: this.targetKey,
      level: this.escalationLevel,
      nextRecoveryMs: this.getCurrentRecoveryMs(),
    }, 'CB escalation level increased')
  }

  private transitionTo(newState: CircuitState): void {
    const oldState = this.state
    this.state = newState

    switch (newState) {
      case 'open':
        this.openedAt = Date.now()
        this.halfOpenRequests = 0
        this.successesSinceHalfOpen = 0
        logger.error({
          target: this.targetKey,
          failures: this.failures.length,
          escalation: this.escalationLevel,
          recoveryMs: this.getCurrentRecoveryMs(),
          from: oldState,
        }, 'Escalating CB OPEN — target marked DOWN')
        this.onOpen?.(this.targetKey, this.escalationLevel)
        break

      case 'half-open':
        this.halfOpenRequests = 0
        this.successesSinceHalfOpen = 0
        logger.info({
          target: this.targetKey,
          escalation: this.escalationLevel,
        }, 'Escalating CB HALF-OPEN — testing recovery')
        break

      case 'closed':
        this.failures = []
        this.openedAt = null
        this.halfOpenRequests = 0
        this.successesSinceHalfOpen = 0
        logger.info({ target: this.targetKey, from: oldState }, 'Escalating CB CLOSED — target healthy')
        if (oldState === 'half-open') {
          this.onRecovery?.(this.targetKey)
        }
        break
    }
  }

  private pruneOldFailures(): void {
    const cutoff = Date.now() - this.config.windowMs
    this.failures = this.failures.filter(f => f.timestamp > cutoff)
  }
}

// ═══════════════════════════════════════════
// Escalating CB Manager — one breaker per provider:model target
// ═══════════════════════════════════════════

export class EscalatingCBManager {
  private breakers = new Map<string, EscalatingCircuitBreaker>()

  onRecovery: ((targetKey: string) => void) | null = null
  onOpen: ((targetKey: string, level: number) => void) | null = null

  constructor(private readonly config: EscalatingCBConfig = DEFAULT_ESCALATING_CONFIG) {}

  /** Get or create a breaker for a provider:model target */
  get(provider: LLMProviderName, model: string): EscalatingCircuitBreaker {
    const key = `${provider}:${model}`
    let breaker = this.breakers.get(key)
    if (!breaker) {
      breaker = new EscalatingCircuitBreaker(key, this.config)
      breaker.onRecovery = this.onRecovery
      breaker.onOpen = this.onOpen
      this.breakers.set(key, breaker)
    }
    return breaker
  }

  allSnapshots(): EscalatingCBSnapshot[] {
    return [...this.breakers.values()].map(b => b.snapshot())
  }

  resetAll(): void {
    for (const breaker of this.breakers.values()) {
      breaker.reset()
    }
  }

  resetTarget(provider: LLMProviderName, model: string): void {
    const key = `${provider}:${model}`
    this.breakers.get(key)?.reset()
  }
}

// ═══════════════════════════════════════════
// Legacy Manager — one breaker per provider (kept for backward compat)
// ═══════════════════════════════════════════

export class CircuitBreakerManager {
  private breakers = new Map<LLMProviderName, CircuitBreaker>()

  /** Callback fired when any breaker recovers (half-open → closed). */
  onRecovery: ((provider: LLMProviderName) => void) | null = null

  constructor(private readonly defaultConfig: CircuitBreakerConfig) {}

  get(provider: LLMProviderName): CircuitBreaker {
    let breaker = this.breakers.get(provider)
    if (!breaker) {
      breaker = new CircuitBreaker(provider, this.defaultConfig)
      breaker.onRecovery = this.onRecovery
      this.breakers.set(provider, breaker)
    }
    return breaker
  }

  allSnapshots(): CircuitBreakerSnapshot[] {
    return [...this.breakers.values()].map(b => b.snapshot())
  }

  resetAll(): void {
    for (const breaker of this.breakers.values()) {
      breaker.reset()
    }
  }
}
