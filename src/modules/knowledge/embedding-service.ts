// LUNA — Module: knowledge — Embedding Service
// Google Gemini Embedding 2 (multimodal) via REST API with outputDimensionality.
// Degrades gracefully: on failure → FTS-only search.

import type pino from 'pino'

// Gemini Embedding 2 — natively multimodal (text, images, PDFs, video, audio)
// Uses outputDimensionality=1536 to get properly normalized 1536-dim vectors
// (model outputs 3072 by default, but pgvector index max is 2000 dims)
const MODEL = 'gemini-embedding-2-preview'
const DIMENSIONS = 1536
const MAX_BATCH_SIZE = 100
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

// Circuit breaker: 3 failures in 5 min → open for 5 min
const CB_FAILURE_THRESHOLD = 3
const CB_WINDOW_MS = 5 * 60 * 1000
const CB_COOLDOWN_MS = 5 * 60 * 1000

// Rate limit: tier 2 = 5000 RPM
const RATE_LIMIT_RPM = 5000

export class EmbeddingService {
  private static instanceCount = 0

  private readonly apiKey: string
  private readonly log: pino.Logger

  // Circuit breaker state
  private failures: number[] = []
  private cbOpenUntil = 0

  // Token bucket rate limiter
  private tokens: number = RATE_LIMIT_RPM
  private lastRefill: number = Date.now()

  constructor(apiKey: string, logger: pino.Logger) {
    EmbeddingService.instanceCount++
    this.apiKey = apiKey
    this.log = logger.child({ component: 'embedding-service' })

    if (EmbeddingService.instanceCount > 1) {
      this.log.warn('Multiple EmbeddingService instances detected — rate limiting may not work correctly')
    }

    if (!apiKey) {
      this.log.warn('No API key provided — embeddings disabled')
    }
  }

  // ───────────────────────────────────────────
  // Public API
  // ───────────────────────────────────────────

  isAvailable(): boolean {
    if (!this.apiKey) return false
    if (Date.now() < this.cbOpenUntil) return false
    return true
  }

  /**
   * Generate embedding for a text string.
   * Uses REST API with outputDimensionality=1536.
   */
  async generateEmbedding(text: string): Promise<number[] | null> {
    if (!this.isAvailable()) return null
    if (!text.trim()) return null
    if (!this.consumeToken()) {
      this.log.warn('Rate limit reached, skipping embedding')
      return null
    }

    try {
      const body = {
        model: `models/${MODEL}`,
        content: { parts: [{ text }] },
        outputDimensionality: DIMENSIONS,
      }

      const res = await fetch(`${API_BASE}/${MODEL}:embedContent?key=${this.apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(15000),
      })

      if (!res.ok) {
        const errText = await res.text().catch(() => '')
        throw new Error(`Embedding API ${res.status}: ${errText.substring(0, 200)}`)
      }

      const data = await res.json() as { embedding?: { values?: number[] } }
      const values = data.embedding?.values
      if (!values || values.length === 0) {
        this.log.warn('Embedding response missing values')
        return null
      }

      this.resetFailures()
      return values
    } catch (err) {
      this.recordFailure()
      this.log.error({ err }, 'Embedding generation failed')
      return null
    }
  }

  /**
   * Generate embedding from raw file (PDF, image) using multimodal inlineData.
   * REST API with outputDimensionality=1536.
   */
  async generateFileEmbedding(data: Buffer, mimeType: string): Promise<number[] | null> {
    if (!this.isAvailable()) return null
    if (data.length === 0) return null

    const SUPPORTED = [
      'application/pdf',
      'image/png', 'image/jpeg', 'image/webp', 'image/gif',
      'video/mp4', 'video/webm', 'video/mpeg',
      'audio/ogg', 'audio/mpeg', 'audio/mp4',
    ]
    if (!SUPPORTED.includes(mimeType)) {
      this.log.debug({ mimeType }, '[EMBED] Unsupported MIME for multimodal embedding')
      return null
    }

    if (!this.consumeToken()) {
      this.log.warn('[EMBED] Rate limit reached, skipping file embedding')
      return null
    }

    try {
      const base64 = data.toString('base64')
      this.log.info({ mimeType, sizeBytes: data.length }, '[EMBED] Sending file to multimodal embedding')

      const body = {
        model: `models/${MODEL}`,
        content: {
          parts: [{ inlineData: { mimeType, data: base64 } }],
        },
        outputDimensionality: DIMENSIONS,
      }

      const res = await fetch(`${API_BASE}/${MODEL}:embedContent?key=${this.apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30000),
      })

      if (!res.ok) {
        const errText = await res.text().catch(() => '')
        throw new Error(`File embedding API ${res.status}: ${errText.substring(0, 200)}`)
      }

      const result = await res.json() as { embedding?: { values?: number[] } }
      const values = result.embedding?.values
      if (!values) return null

      this.log.info({ mimeType, dims: values.length }, '[EMBED] Multimodal file embedding generated')
      this.resetFailures()
      return values
    } catch (err) {
      this.recordFailure()
      this.log.error({ err, mimeType, sizeBytes: data.length }, '[EMBED] Multimodal file embedding failed')
      return null
    }
  }

  /**
   * Batch embed multiple texts.
   * REST API batchEmbedContents with outputDimensionality=1536.
   */
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
      const body = {
        requests: capped.map(text => ({
          model: `models/${MODEL}`,
          content: { parts: [{ text }] },
          outputDimensionality: DIMENSIONS,
        })),
      }

      const res = await fetch(`${API_BASE}/${MODEL}:batchEmbedContents?key=${this.apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30000),
      })

      if (!res.ok) {
        const errText = await res.text().catch(() => '')
        throw new Error(`Batch embedding API ${res.status}: ${errText.substring(0, 200)}`)
      }

      const data = await res.json() as { embeddings?: Array<{ values?: number[] }> }
      this.resetFailures()

      return (data.embeddings ?? []).map((emb, i) => {
        if (!emb?.values) {
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
    if (elapsed <= 0) return
    const refill = Math.floor(elapsed / (60_000 / RATE_LIMIT_RPM))
    if (refill > 0) {
      this.tokens = Math.min(RATE_LIMIT_RPM, this.tokens + refill)
      this.lastRefill = now
    }
  }
}
