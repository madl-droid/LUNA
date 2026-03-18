// LUNA — LLM Circuit Breaker
// Patrón circuit breaker por provider. Protege contra cascadas de fallos.
// Estados: CLOSED (sano) → OPEN (down) → HALF-OPEN (probando) → CLOSED

import pino from 'pino'
import type {
  LLMProviderName,
  CircuitBreakerConfig,
  CircuitState,
  CircuitBreakerSnapshot,
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
// Manager — one breaker per provider
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
