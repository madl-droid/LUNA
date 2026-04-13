// LUNA — Module: knowledge — Embedding Service
// Google Gemini Embedding 2 (multimodal) via @google/genai SDK with outputDimensionality.
// Degrades gracefully: on failure → FTS-only search.

import type pino from 'pino'
import { GoogleGenAI } from '@google/genai'

const DEFAULT_MODEL = 'gemini-embedding-2-preview'
const DEFAULT_DIMENSIONS = 1536
const MAX_BATCH_SIZE = 100
const BATCH_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models'

// Circuit breaker: 3 failures in 5 min → open for 5 min
const CB_FAILURE_THRESHOLD = 3
const CB_WINDOW_MS = 5 * 60 * 1000
const CB_COOLDOWN_MS = 5 * 60 * 1000

// Rate limit: tier 2 = 5000 RPM
const RATE_LIMIT_RPM = 5000

export class EmbeddingService {
  private static instanceCount = 0

  private readonly apiKey: string
  private readonly model: string
  private readonly dimensions: number
  private readonly log: pino.Logger
  private readonly client: GoogleGenAI | null

  // Circuit breaker state
  private failures: number[] = []
  private cbOpenUntil = 0

  // Token bucket rate limiter
  private tokens: number = RATE_LIMIT_RPM
  private lastRefill: number = Date.now()

  constructor(apiKey: string, logger: pino.Logger, model?: string, dimensions?: number) {
    EmbeddingService.instanceCount++
    this.apiKey = apiKey
    this.model = model || DEFAULT_MODEL
    this.dimensions = dimensions || DEFAULT_DIMENSIONS
    this.log = logger.child({ component: 'embedding-service' })
    this.client = apiKey ? new GoogleGenAI({ apiKey }) : null

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
   * Uses @google/genai SDK with outputDimensionality=1536.
   */
  async generateEmbedding(text: string): Promise<number[] | null> {
    if (!this.isAvailable() || !this.client) return null
    if (!text.trim()) return null
    if (!this.consumeToken()) {
      this.log.warn('Rate limit reached, skipping embedding')
      return null
    }

    try {
      const result = await this.client.models.embedContent({
        model: this.model,
        contents: { parts: [{ text }] },
        config: { outputDimensionality: this.dimensions },
      })

      // SDK v1 returns embeddings array; fallback to singular embedding field
      const values = result.embeddings?.[0]?.values ?? (result as unknown as { embedding?: { values?: number[] } }).embedding?.values
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
   * Uses @google/genai SDK with outputDimensionality=1536.
   */
  async generateFileEmbedding(data: Buffer, mimeType: string): Promise<number[] | null> {
    if (!this.isAvailable() || !this.client) return null
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

      const result = await this.client.models.embedContent({
        model: this.model,
        contents: {
          parts: [{ inlineData: { mimeType, data: base64 } }],
        },
        config: { outputDimensionality: this.dimensions },
      })

      // SDK v1 returns embeddings array; fallback to singular embedding field
      const values = result.embeddings?.[0]?.values ?? (result as unknown as { embedding?: { values?: number[] } }).embedding?.values
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
          model: `models/${this.model}`,
          content: { parts: [{ text }] },
          outputDimensionality: this.dimensions,
        })),
      }

      const res = await fetch(`${BATCH_API_BASE}/${this.model}:batchEmbedContents`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': this.apiKey,
        },
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
