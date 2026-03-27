// LUNA — Tool: freshdesk_get_article
// Fetches full article content from Freshdesk by ID.
// Cache: Redis with configurable TTL (default 24h).

import type { Redis } from 'ioredis'
import pino from 'pino'
import type { Registry } from '../../kernel/registry.js'
import type { ToolRegistry } from '../../modules/tools/tool-registry.js'
import { FreshdeskClient } from './freshdesk-client.js'
import type {
  FreshdeskModuleConfig,
  FreshdeskCachedArticle,
  FreshdeskGetArticleResult,
} from './types.js'
import { loadFreshdeskIndex } from './freshdesk-sync.js'

const logger = pino({ name: 'freshdesk:get-article' })

const REDIS_PREFIX = 'freshdesk:article:'

/**
 * Register the freshdesk_get_article tool with the tool registry.
 */
export async function registerFreshdeskGetArticleTool(
  registry: Registry,
  config: FreshdeskModuleConfig,
): Promise<void> {
  const toolRegistry = registry.getOptional<ToolRegistry>('tools:registry')
  if (!toolRegistry) {
    logger.warn('Tools module not available — skipping freshdesk_get_article registration')
    return
  }

  const redis = registry.getRedis()
  const client = new FreshdeskClient(config.FRESHDESK_DOMAIN, config.FRESHDESK_API_KEY)
  const ttlSeconds = config.FRESHDESK_CACHE_TTL_HOURS * 3600

  await toolRegistry.registerTool({
    definition: {
      name: 'freshdesk_get_article',
      displayName: 'Obtener artículo de Freshdesk',
      description: 'Obtiene el contenido completo de un artículo de soporte técnico de Freshdesk por su ID. Usar cuando se necesita información técnica detallada que aparece en los matches de la knowledge base de soporte.',
      category: 'knowledge',
      sourceModule: 'freshdesk',
      parameters: {
        type: 'object',
        properties: {
          article_id: {
            type: 'number',
            description: 'ID del artículo de Freshdesk',
          },
        },
        required: ['article_id'],
      },
    },
    handler: async (input) => {
      const articleId = input.article_id as number
      if (!articleId || typeof articleId !== 'number') {
        return { success: false, error: 'article_id is required and must be a number' }
      }

      const result = await getArticle(redis, client, articleId, ttlSeconds, config)
      return {
        success: result.success,
        data: result,
        error: result.error,
      }
    },
  })

  logger.info('freshdesk_get_article tool registered')
}

async function getArticle(
  redis: Redis,
  client: FreshdeskClient,
  articleId: number,
  ttlSeconds: number,
  _config: FreshdeskModuleConfig,
): Promise<FreshdeskGetArticleResult> {
  const cacheKey = `${REDIS_PREFIX}${articleId}`

  // 1. Check cache
  const cached = await redis.get(cacheKey)
  if (cached) {
    try {
      const article = JSON.parse(cached) as FreshdeskCachedArticle
      return { success: true, article, cache_hit: true }
    } catch {
      // Corrupted cache, fetch fresh
    }
  }

  // 2. Fetch from API
  try {
    const article = await client.getArticle(articleId)

    // Resolve category/folder names from index if available
    const index = await loadFreshdeskIndex(redis)
    const meta = index.find(a => a.article_id === articleId)

    const cachedArticle: FreshdeskCachedArticle = {
      article_id: article.id,
      title: article.title,
      description_text: article.description_text,
      category_name: meta?.category_name ?? 'Unknown',
      folder_name: meta?.folder_name ?? 'Unknown',
      tags: article.tags ?? [],
      cached_at: new Date().toISOString(),
    }

    // 3. Cache with TTL
    await redis.set(cacheKey, JSON.stringify(cachedArticle), 'EX', ttlSeconds)

    return { success: true, article: cachedArticle, cache_hit: false }
  } catch (err) {
    logger.error({ articleId, err: String(err) }, 'Failed to fetch article from Freshdesk')
    return { success: false, error: `Failed to fetch article ${articleId}: ${String(err)}`, cache_hit: false }
  }
}
