// LUNA — Module: knowledge — Embedding Service
// Google text-embedding-004 (768 dims) with circuit breaker and rate limiting.
// Degrades gracefully: on failure returns null, search falls back to FTS-only.

import { GoogleGenerativeAI } from '@google/generative-ai'
import type pino from 'pino'

const MODEL = 'text-embedding-004'
const DIMENSIONS = 768
const MAX_BATCH_SIZE = 100

// Circuit breaker: 3 failures in 5 min → open for 5 min
const CB_FAILURE_THRESHOLD = 3
const CB_WINDOW_MS = 5 * 60 * 1000
const CB_COOLDOWN_MS = 5 * 60 * 1000

// Rate limit: 1500 RPM free tier → token bucket
const RATE_LIMIT_RPM = 1500
const RATE_LIMIT_INTERVAL_MS = 60_000 / RATE_LIMIT_RPM  // ~40ms between requests

export class EmbeddingService {
  private readonly apiKey: string
  private readonly log: pino.Logger
  private readonly client: GoogleGenerativeAI | null

  // Circuit breaker state
  private failures: number[] = []
  private cbOpenUntil = 0

  // Token bucket rate limiter
  private tokens: number = RATE_LIMIT_RPM
  private lastRefill: number = Date.now()

  constructor(apiKey: string, logger: pino.Logger) {
    this.apiKey = apiKey
    this.log = logger.child({ component: 'embedding-service' })

    if (apiKey) {
      this.client = new GoogleGenerativeAI(apiKey)
    } else {
      this.client = null
      this.log.warn('No API key provided — embeddings disabled')
    }
  }

  // ───────────────────────────────────────────
  // Public API
  // ───────────────────────────────────────────

  isAvailable(): boolean {
    if (!this.client || !this.apiKey) return false
    if (Date.now() < this.cbOpenUntil) return false
    return true
  }

  async generateEmbedding(text: string): Promise<number[] | null> {
    if (!this.isAvailable()) return null
    if (!text.trim()) return null

    if (!this.consumeToken()) {
      this.log.warn('Rate limit reached, skipping embedding')
      return null
    }

    try {
      const model = this.client!.getGenerativeModel({ model: MODEL })
      const result = await model.embedContent(text)
      const values = result.embedding.values

      if (values.length !== DIMENSIONS) {
        this.log.warn({ got: values.length, expected: DIMENSIONS }, 'Unexpected embedding dimensions')
      }

      this.resetFailures()
      return values
    } catch (err) {
      this.recordFailure()
      this.log.error({ err }, 'Embedding generation failed')
      return null
    }
  }

  async generateBatchEmbeddings(texts: string[]): Promise<(number[] | null)[]> {
    if (!this.isAvailable()) return texts.map(() => null)
    if (texts.length === 0) return []

    const capped = texts.slice(0, MAX_BATCH_SIZE)
    if (texts.length > MAX_BATCH_SIZE) {
      this.log.warn({ requested: texts.length, max: MAX_BATCH_SIZE }, 'Batch truncated to max size')
    }

    if (!this.consumeToken()) {
      this.log.warn('Rate limit reached, skipping batch embeddings')
      return capped.map(() => null)
    }

    try {
      const model = this.client!.getGenerativeModel({ model: MODEL })
      const result = await model.batchEmbedContents({
        requests: capped.map(text => ({
          content: { role: 'user', parts: [{ text }] },
        })),
      })

      this.resetFailures()

      return result.embeddings.map((emb, i) => {
        if (!emb || !emb.values) {
          this.log.warn({ index: i }, 'Missing embedding in batch result')
          return null
        }
        return emb.values
      })
    } catch (err) {
      this.recordFailure()
      this.log.error({ err }, 'Batch embedding generation failed')
      return capped.map(() => null)
    }
  }

  // ───────────────────────────────────────────
  // Circuit breaker
  // ───────────────────────────────────────────

  private recordFailure(): void {
    const now = Date.now()
    this.failures.push(now)
    // Keep only failures within the window
    this.failures = this.failures.filter(t => now - t < CB_WINDOW_MS)

    if (this.failures.length >= CB_FAILURE_THRESHOLD) {
      this.cbOpenUntil = now + CB_COOLDOWN_MS
      this.failures = []
      this.log.warn(
        { cooldownMs: CB_COOLDOWN_MS },
        'Circuit breaker OPEN — embeddings unavailable',
      )
    }
  }

  private resetFailures(): void {
    if (this.failures.length > 0) {
      this.failures = []
    }
  }

  // ───────────────────────────────────────────
  // Token bucket rate limiter
  // ───────────────────────────────────────────

  private consumeToken(): boolean {
    this.refillTokens()
    if (this.tokens < 1) return false
    this.tokens -= 1
    return true
  }

  private refillTokens(): void {
    const now = Date.now()
    const elapsed = now - this.lastRefill
    const refill = (elapsed / RATE_LIMIT_INTERVAL_MS)
    this.tokens = Math.min(RATE_LIMIT_RPM, this.tokens + refill)
    this.lastRefill = now
  }
}
