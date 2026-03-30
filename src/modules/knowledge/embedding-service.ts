// LUNA — Module: knowledge — Embedding Service
// Google gemini-embedding-exp-03-07 (1536 dims) with circuit breaker and rate limiting.
// Soporta texto, imágenes, video, código. Degrades gracefully: on failure → FTS-only.

import { GoogleGenerativeAI } from '@google/generative-ai'
import type pino from 'pino'

// Gemini Embedding 2 — natively multimodal (text, images, PDFs, video, audio)
// Using 1536 dims via Matryoshka for backward compatibility with existing vectors
const MODEL = 'gemini-embedding-2-preview-03-25'
const DIMENSIONS = 1536
const MAX_BATCH_SIZE = 100

// Circuit breaker: 3 failures in 5 min → open for 5 min
const CB_FAILURE_THRESHOLD = 3
const CB_WINDOW_MS = 5 * 60 * 1000
const CB_COOLDOWN_MS = 5 * 60 * 1000

// Rate limit: tier 2 = 5000 RPM
const RATE_LIMIT_RPM = 5000
const RATE_LIMIT_INTERVAL_MS = 60_000 / RATE_LIMIT_RPM  // ~12ms between requests

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

  /**
   * Generate embedding from raw file (PDF, image, etc.) using Gemini Embedding 2 multimodal.
   * Sends the file as inlineData — the model natively understands visual content.
   * Limits: PDF max ~6 pages, images max 6 per request.
   */
  async generateFileEmbedding(data: Buffer, mimeType: string): Promise<number[] | null> {
    if (!this.isAvailable()) return null
    if (data.length === 0) return null

    // Supported multimodal MIME types for embedding
    const SUPPORTED = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/gif']
    if (!SUPPORTED.includes(mimeType)) {
      this.log.debug({ mimeType }, '[EMBED] Unsupported MIME for multimodal embedding, skipping')
      return null
    }

    if (!this.consumeToken()) {
      this.log.warn('[EMBED] Rate limit reached, skipping file embedding')
      return null
    }

    try {
      const model = this.client!.getGenerativeModel({ model: MODEL })
      const base64 = data.toString('base64')
      this.log.info({ mimeType, sizeBytes: data.length, base64Length: base64.length }, '[EMBED] Sending file to multimodal embedding')

      const result = await model.embedContent({
        content: {
          role: 'user',
          parts: [{
            inlineData: { mimeType, data: base64 },
          }],
        },
      })

      const values = result.embedding.values
      this.log.info({ mimeType, dims: values.length }, '[EMBED] Multimodal file embedding generated')
      this.resetFailures()
      return values
    } catch (err) {
      this.recordFailure()
      this.log.error({ err, mimeType, sizeBytes: data.length }, '[EMBED] Multimodal file embedding failed')
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
