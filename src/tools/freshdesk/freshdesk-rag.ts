// LUNA — Freshdesk RAG (Phase 1)
// Fuse.js fuzzy search over cached Freshdesk article metadata from Redis.
// Returns top matches for inclusion in ContextBundle.

import type { Redis } from 'ioredis'
import Fuse from 'fuse.js'
import pino from 'pino'
import { loadFreshdeskIndex } from './freshdesk-sync.js'
import type { FreshdeskArticleMeta, FreshdeskMatch } from './types.js'

const logger = pino({ name: 'freshdesk:rag' })

// In-memory fuse index, rebuilt when Redis data changes
let fuseIndex: Fuse<FreshdeskArticleMeta> | null = null
let lastIndexHash = ''
let lastLoadTime = 0
const RELOAD_INTERVAL_MS = 5 * 60_000 // check every 5 minutes

/**
 * Search Freshdesk article metadata using fuse.js.
 * Returns top matches with article_ids for the evaluator.
 */
export async function searchFreshdeskIndex(
  redis: Redis,
  query: string,
  maxResults = 5,
): Promise<FreshdeskMatch[]> {
  if (!query.trim()) return []

  const now = Date.now()

  // Reload index if stale
  if (!fuseIndex || now - lastLoadTime > RELOAD_INTERVAL_MS) {
    await rebuildIndex(redis)
    lastLoadTime = now
  }

  if (!fuseIndex) return []

  const results = fuseIndex.search(query, { limit: maxResults }) as Array<{
    item: FreshdeskArticleMeta
    score?: number
  }>

  return results
    .filter(r => (r.score ?? 1) < 0.5) // only decent matches
    .map(r => ({
      source: 'freshdesk' as const,
      article_id: r.item.article_id,
      title: r.item.title,
      category: `${r.item.category_name} > ${r.item.folder_name}`,
      tags: r.item.tags,
      relevance_score: 1 - (r.score ?? 0), // invert: 1 = perfect
    }))
}

async function rebuildIndex(redis: Redis): Promise<void> {
  const articles = await loadFreshdeskIndex(redis)
  if (articles.length === 0) {
    fuseIndex = null
    return
  }

  // Simple hash to detect changes
  const hash = `${articles.length}:${articles[0]?.updated_at}:${articles[articles.length - 1]?.updated_at}`
  if (hash === lastIndexHash && fuseIndex) return

  fuseIndex = new Fuse(articles, {
    keys: [
      { name: 'title', weight: 0.4 },
      { name: 'description', weight: 0.3 },
      { name: 'tags', weight: 0.2 },
      { name: 'category_name', weight: 0.05 },
      { name: 'folder_name', weight: 0.05 },
    ],
    threshold: 0.4,
    includeScore: true,
    minMatchCharLength: 3,
    ignoreLocation: true,
  })

  lastIndexHash = hash
  logger.info({ articleCount: articles.length }, 'Freshdesk fuse.js index rebuilt')
}

/**
 * Force rebuild the index (called after sync).
 */
export async function invalidateFreshdeskIndex(): Promise<void> {
  lastIndexHash = ''
  lastLoadTime = 0
  fuseIndex = null
}
