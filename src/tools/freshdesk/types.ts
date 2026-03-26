// LUNA — Tool: Freshdesk Knowledge Base — Types

// ═══════════════════════════════════════════
// Freshdesk API responses
// ═══════════════════════════════════════════

export interface FreshdeskCategory {
  id: number
  name: string
  description: string | null
  created_at: string
  updated_at: string
}

export interface FreshdeskFolder {
  id: number
  name: string
  category_id: number
  description: string | null
  articles_count: number
  created_at: string
  updated_at: string
}

export interface FreshdeskArticle {
  id: number
  title: string
  description: string            // HTML content
  description_text: string       // plain text content
  status: number                 // 1=draft, 2=published
  tags: string[]
  category_id: number
  folder_id: number
  created_at: string
  updated_at: string
}

export interface FreshdeskSearchResult {
  id: number
  title: string
  description_text: string       // snippet
  category_id: number
  folder_id: number
  status: number
  tags: string[]
}

// ═══════════════════════════════════════════
// Cached metadata (Redis)
// ═══════════════════════════════════════════

export interface FreshdeskArticleMeta {
  article_id: number
  title: string
  description: string            // short summary
  tags: string[]
  category_name: string
  folder_name: string
  status: number
  updated_at: string
}

// ═══════════════════════════════════════════
// Cached full article (Redis, 24h TTL)
// ═══════════════════════════════════════════

export interface FreshdeskCachedArticle {
  article_id: number
  title: string
  description_text: string
  category_name: string
  folder_name: string
  tags: string[]
  cached_at: string
}

// ═══════════════════════════════════════════
// Tool outputs
// ═══════════════════════════════════════════

export interface FreshdeskGetArticleResult {
  success: boolean
  article?: FreshdeskCachedArticle
  error?: string
  cache_hit: boolean
}

export interface FreshdeskSearchToolResult {
  success: boolean
  results: Array<{
    article_id: number
    title: string
    snippet: string
    tags: string[]
  }>
  error?: string
}

// ═══════════════════════════════════════════
// Module config (from configSchema)
// ═══════════════════════════════════════════

export interface FreshdeskModuleConfig {
  FRESHDESK_DOMAIN: string
  FRESHDESK_API_KEY: string
  FRESHDESK_SYNC_ENABLED: boolean
  FRESHDESK_SYNC_CRON: string
  FRESHDESK_CACHE_TTL_HOURS: number
  FRESHDESK_CATEGORIES: string
}

// ═══════════════════════════════════════════
// Phase 1 match (for ContextBundle)
// ═══════════════════════════════════════════

export interface FreshdeskMatch {
  source: 'freshdesk'
  article_id: number
  title: string
  category: string
  tags: string[]
  relevance_score: number
}
