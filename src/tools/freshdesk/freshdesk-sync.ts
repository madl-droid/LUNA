// LUNA — Freshdesk Sync Job
// Weekly sync of article metadata from Freshdesk Knowledge Base to Redis.
// Stores: freshdesk:index (JSON array), freshdesk:sync_at (timestamp).

import type { Redis } from 'ioredis'
import pino from 'pino'
import { FreshdeskClient } from './freshdesk-client.js'
import type { FreshdeskArticleMeta, FreshdeskModuleConfig } from './types.js'

const logger = pino({ name: 'freshdesk:sync' })

const REDIS_KEY_INDEX = 'freshdesk:index'
const REDIS_KEY_SYNC_AT = 'freshdesk:sync_at'
const STALE_THRESHOLD_DAYS = 14

/**
 * Run full sync: fetch all published articles metadata from Freshdesk,
 * store in Redis as a JSON index.
 */
export async function runFreshdeskSync(
  redis: Redis,
  config: FreshdeskModuleConfig,
): Promise<{ articleCount: number; categoryCount: number }> {
  const client = new FreshdeskClient(config.FRESHDESK_DOMAIN, config.FRESHDESK_API_KEY)

  // Parse category filter
  const categoryFilter = config.FRESHDESK_CATEGORIES
    ? config.FRESHDESK_CATEGORIES.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n))
    : []

  const startMs = Date.now()
  const articles: FreshdeskArticleMeta[] = []

  try {
    // 1. Get all categories
    const categories = await client.getCategories()
    const categoryMap = new Map(categories.map(c => [c.id, c.name]))

    // Filter categories if configured
    const filteredCategories = categoryFilter.length > 0
      ? categories.filter(c => categoryFilter.includes(c.id))
      : categories

    logger.info({
      totalCategories: categories.length,
      filteredCategories: filteredCategories.length,
    }, 'Freshdesk categories loaded')

    // 2. For each category, get folders
    for (const category of filteredCategories) {
      let folders
      try {
        folders = await client.getFolders(category.id)
      } catch (err) {
        logger.warn({ categoryId: category.id, err: String(err) }, 'Failed to get folders for category')
        continue
      }

      // 3. For each folder, get articles (paginated)
      for (const folder of folders) {
        let page = 1
        let hasMore = true

        while (hasMore) {
          try {
            const pageArticles = await client.getArticles(folder.id, page)

            for (const article of pageArticles) {
              // Only published articles
              if (article.status !== 2) continue

              articles.push({
                article_id: article.id,
                title: article.title,
                description: truncateDescription(article.description_text),
                tags: article.tags ?? [],
                category_name: categoryMap.get(category.id) ?? 'Unknown',
                folder_name: folder.name,
                status: article.status,
                updated_at: article.updated_at,
              })
            }

            // Freshdesk returns 30 per page; if less, no more pages
            hasMore = pageArticles.length >= 30
            page++
          } catch (err) {
            logger.warn({ folderId: folder.id, page, err: String(err) }, 'Failed to get articles page')
            hasMore = false
          }
        }
      }
    }

    // 4. Store in Redis (atomic replace)
    const pipeline = redis.pipeline()
    pipeline.set(REDIS_KEY_INDEX, JSON.stringify(articles))
    pipeline.set(REDIS_KEY_SYNC_AT, new Date().toISOString())
    await pipeline.exec()

    const durationMs = Date.now() - startMs
    logger.info({
      articleCount: articles.length,
      categoryCount: filteredCategories.length,
      durationMs,
    }, 'Freshdesk sync complete')

    return { articleCount: articles.length, categoryCount: filteredCategories.length }
  } catch (err) {
    // Don't wipe existing cache on failure
    logger.error({ err: String(err) }, 'Freshdesk sync failed — keeping existing cache')
    throw err
  }
}

/**
 * Load the cached article index from Redis.
 * Returns empty array if no index exists.
 */
export async function loadFreshdeskIndex(redis: Redis): Promise<FreshdeskArticleMeta[]> {
  const raw = await redis.get(REDIS_KEY_INDEX)
  if (!raw) return []

  try {
    return JSON.parse(raw) as FreshdeskArticleMeta[]
  } catch {
    logger.warn('Failed to parse freshdesk:index from Redis')
    return []
  }
}

/**
 * Check if the sync is stale (>14 days old).
 */
export async function isSyncStale(redis: Redis): Promise<boolean> {
  const syncAt = await redis.get(REDIS_KEY_SYNC_AT)
  if (!syncAt) return true

  const syncDate = new Date(syncAt)
  const daysSince = (Date.now() - syncDate.getTime()) / (1000 * 60 * 60 * 24)
  if (daysSince > STALE_THRESHOLD_DAYS) {
    logger.warn({ daysSince: Math.round(daysSince), syncAt }, 'Freshdesk cache is stale (>14 days)')
    return true
  }
  return false
}

function truncateDescription(text: string): string {
  if (!text) return ''
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length > 200 ? clean.substring(0, 200) + '...' : clean
}
