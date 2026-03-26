// LUNA — Freshdesk API Client
// HTTP client for Freshdesk Solutions (Knowledge Base) API.
// Auth: API key as Basic Auth (key:X). Rate limit aware via X-Ratelimit headers.

import pino from 'pino'
import type {
  FreshdeskCategory,
  FreshdeskFolder,
  FreshdeskArticle,
  FreshdeskSearchResult,
} from './types.js'

const logger = pino({ name: 'freshdesk:client' })

const MAX_CALLS_PER_MINUTE = 100
const WINDOW_MS = 60_000

export class FreshdeskClient {
  private readonly baseUrl: string
  private readonly authHeader: string

  // Simple sliding window rate limiter
  private callTimestamps: number[] = []

  constructor(domain: string, apiKey: string) {
    this.baseUrl = `https://${domain}/api/v2`
    this.authHeader = 'Basic ' + Buffer.from(`${apiKey}:X`).toString('base64')
  }

  // ─── Public API ────────────────────────────

  async getCategories(): Promise<FreshdeskCategory[]> {
    return this.get<FreshdeskCategory[]>('/solutions/categories')
  }

  async getFolders(categoryId: number): Promise<FreshdeskFolder[]> {
    return this.get<FreshdeskFolder[]>(`/solutions/categories/${categoryId}/folders`)
  }

  async getArticles(folderId: number, page = 1): Promise<FreshdeskArticle[]> {
    return this.get<FreshdeskArticle[]>(`/solutions/folders/${folderId}/articles?page=${page}`)
  }

  async getArticle(articleId: number): Promise<FreshdeskArticle> {
    return this.get<FreshdeskArticle>(`/solutions/articles/${articleId}`)
  }

  async searchArticles(term: string): Promise<FreshdeskSearchResult[]> {
    const encoded = encodeURIComponent(term)
    return this.get<FreshdeskSearchResult[]>(`/search/solutions?term=${encoded}`)
  }

  // ─── HTTP layer ────────────────────────────

  private async get<T>(path: string): Promise<T> {
    await this.waitForRateLimit()

    const url = `${this.baseUrl}${path}`
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 15_000)

    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': this.authHeader,
          'Content-Type': 'application/json',
        },
        signal: controller.signal,
      })

      // Track rate limit headers
      const remaining = res.headers.get('x-ratelimit-remaining')
      if (remaining) {
        const left = parseInt(remaining, 10)
        if (left < 20) {
          logger.warn({ remaining: left, path }, 'Freshdesk rate limit running low')
        }
      }

      if (!res.ok) {
        const body = await res.text().catch(() => '')
        throw new Error(`Freshdesk API ${res.status}: ${body.substring(0, 200)}`)
      }

      return (await res.json()) as T
    } finally {
      clearTimeout(timeout)
    }
  }

  private async waitForRateLimit(): Promise<void> {
    const now = Date.now()
    // Purge old timestamps
    this.callTimestamps = this.callTimestamps.filter(t => now - t < WINDOW_MS)

    if (this.callTimestamps.length >= MAX_CALLS_PER_MINUTE) {
      const oldest = this.callTimestamps[0]!
      const waitMs = WINDOW_MS - (now - oldest) + 50
      logger.info({ waitMs }, 'Rate limit reached, waiting')
      await new Promise(resolve => setTimeout(resolve, waitMs))
    }

    this.callTimestamps.push(Date.now())
  }
}
