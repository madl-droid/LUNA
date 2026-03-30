// LUNA — Module: knowledge — Web Source Manager
// Manages cached web sources (max 3). Fetches, extracts, chunks, and caches web content.

import { createHash } from 'node:crypto'
import type { Redis } from 'ioredis'
import pino from 'pino'
import type { Registry } from '../../kernel/registry.js'
import type { KnowledgePgStore } from './pg-store.js'
import type { KnowledgeWebSource, SyncFrequency } from './types.js'
import { SYNC_FREQUENCY_MS } from './types.js'
import { extractContent, resolveMimeType } from './extractors/index.js'
import { chunkDocs, linkChunks } from './extractors/smart-chunker.js'

const logger = pino({ name: 'knowledge:web-sources' })

const MAX_WEB_SOURCES = 3
const FETCH_TIMEOUT_MS = 30_000
const USER_AGENT = 'LUNA-Agent/1.0'
const SKIP_CHANGE_THRESHOLD = 0.05  // 5%
const SKIP_RECENCY_MS = 7 * 24 * 60 * 60 * 1000  // 1 week

export class WebSourceManager {
  constructor(
    private pgStore: KnowledgePgStore,
    _redis: Redis,
    private registry: Registry,
  ) {}

  // ─── CRUD ──────────────────────────────────

  async create(data: {
    url: string
    title: string
    description?: string
    categoryId?: string | null
    refreshFrequency?: SyncFrequency
  }): Promise<string> {
    const count = await this.pgStore.countWebSources()
    if (count >= MAX_WEB_SOURCES) {
      throw new Error(`Maximum of ${MAX_WEB_SOURCES} web sources allowed`)
    }

    const id = await this.pgStore.insertWebSource({
      url: data.url,
      title: data.title,
      description: data.description ?? '',
      categoryId: data.categoryId ?? null,
      refreshFrequency: data.refreshFrequency ?? '24h',
    })

    logger.info({ id, url: data.url, title: data.title }, 'Web source created')
    return id
  }

  async update(id: string, updates: Partial<{
    url: string
    title: string
    description: string
    categoryId: string | null
    refreshFrequency: SyncFrequency
  }>): Promise<void> {
    await this.pgStore.updateWebSource(id, updates)
    logger.info({ id, updates: Object.keys(updates) }, 'Web source updated')
  }

  async remove(id: string): Promise<void> {
    // Remove associated pseudo-document first
    const sourceRef = `web:${id}`
    const existingDoc = await this.pgStore.getDocumentBySourceRef(sourceRef)
    if (existingDoc) {
      await this.pgStore.deleteDocument(existingDoc.id)
      logger.info({ documentId: existingDoc.id }, 'Removed associated pseudo-document')
    }

    await this.pgStore.deleteWebSource(id)
    logger.info({ id }, 'Web source removed')
  }

  async list(): Promise<KnowledgeWebSource[]> {
    return this.pgStore.listWebSources()
  }

  // ─── Caching ───────────────────────────────

  async cacheWebSource(id: string): Promise<void> {
    const webSource = await this.pgStore.getWebSource(id)
    if (!webSource) {
      logger.warn({ id }, 'Web source not found, skipping cache')
      return
    }

    logger.info({ id, url: webSource.url }, 'Caching web source')

    // FIX: K-SSRF2 — Validar URL antes de fetch para prevenir SSRF
    const { assertNotPrivateUrl } = await import('../../kernel/ssrf-guard.js')
    try {
      assertNotPrivateUrl(webSource.url)
    } catch (err) {
      logger.error({ id, url: webSource.url, err }, 'SSRF blocked: web source URL targets private address')
      return
    }

    // Fetch content with timeout
    let response: Response
    try {
      response = await fetch(webSource.url, {
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: { 'User-Agent': USER_AGENT },
      })
    } catch (err) {
      logger.error({ id, url: webSource.url, err }, 'Failed to fetch web source')
      return
    }

    if (!response.ok) {
      logger.error({ id, url: webSource.url, status: response.status }, 'HTTP error fetching web source')
      return
    }

    const buffer = Buffer.from(await response.arrayBuffer())
    const contentType = response.headers.get('content-type') ?? ''
    const newHash = createHash('sha256').update(buffer).digest('hex')

    // Smart refresh: skip if <5% change AND cached less than 1 week ago
    if (webSource.cacheHash && webSource.cachedAt) {
      const timeSinceCache = Date.now() - webSource.cachedAt.getTime()
      if (timeSinceCache < SKIP_RECENCY_MS) {
        const changeRatio = computeChangeRatio(webSource.cacheHash, newHash)
        if (changeRatio < SKIP_CHANGE_THRESHOLD) {
          logger.info({ id, changeRatio, timeSinceCache }, 'Content unchanged, skipping re-cache')
          return
        }
      }
    }

    // Extract content
    const mimeType = resolveMimeType(webSource.url, contentType.split(';')[0]?.trim())
    const extracted = await extractContent(buffer, webSource.url, mimeType, this.registry)

    // Smart chunk content
    const fullText = extracted.sections.map(s => (s.title ? `## ${s.title}\n` : '') + s.content).join('\n\n')
    const smartChunks = chunkDocs(fullText)
    if (smartChunks.length === 0) {
      logger.warn({ id, url: webSource.url }, 'No chunks extracted from web source')
      return
    }

    // Upsert pseudo-document
    const sourceRef = `web:${id}`
    const existingDoc = await this.pgStore.getDocumentBySourceRef(sourceRef)

    let documentId: string
    if (existingDoc) {
      documentId = existingDoc.id
      await this.pgStore.updateDocumentHash(documentId, newHash, smartChunks.length)
    } else {
      documentId = await this.pgStore.insertDocument({
        title: webSource.title,
        category: 'consultable' as unknown as import('./types.js').KnowledgeCategory,
        sourceType: 'web',
        sourceRef,
        contentHash: newHash,
        filePath: null,
        mimeType,
        metadata: {
          originalName: webSource.url,
          sizeBytes: buffer.length,
          extractorUsed: 'web-fetch',
        },
      })
    }

    // Insert linked smart chunks
    const linked = linkChunks(sourceRef, smartChunks)
    await this.pgStore.insertLinkedChunks(documentId, linked)

    // Update web source record with cache metadata
    await this.pgStore.updateWebSource(id, {
      cacheHash: newHash,
      cachedAt: new Date(),
      chunkCount: linked.length,
    })

    logger.info({ id, documentId, chunkCount: linked.length }, 'Web source cached successfully')
  }

  async refreshAll(): Promise<void> {
    const sources = await this.pgStore.listWebSources()
    const now = Date.now()

    for (const source of sources) {
      const frequencyMs = SYNC_FREQUENCY_MS[source.refreshFrequency]
      const lastCached = source.cachedAt?.getTime() ?? 0
      const isDue = (now - lastCached) >= frequencyMs

      if (!isDue) {
        logger.debug({ id: source.id, url: source.url }, 'Web source not due for refresh')
        continue
      }

      try {
        await this.cacheWebSource(source.id)
      } catch (err) {
        logger.error({ id: source.id, url: source.url, err }, 'Failed to refresh web source')
      }
    }
  }
}

// ─── Helpers ───────────────────────────────────

/**
 * Compare two SHA-256 hashes. If they are identical, change ratio is 0.
 * If different, we treat it as 100% change since we can't compute partial diff from hashes.
 * For true partial comparison, we'd need the original content — but hash comparison
 * is the specified approach: same hash = 0% change, different hash = 100% change.
 */
function computeChangeRatio(oldHash: string, newHash: string): number {
  return oldHash === newHash ? 0 : 1
}
