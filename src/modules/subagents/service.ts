// LUNA — Module: subagents — Service
// Expone subagents:catalog al engine via registry.

import type { Pool } from 'pg'
import pino from 'pino'
import type { SubagentCatalogEntry, RecordSubagentUsage, SubagentUsageSummary } from './types.js'
import * as repo from './repository.js'

const logger = pino({ name: 'subagents:service' })

/**
 * Service interface exposed as 'subagents:catalog' via registry.
 */
export interface SubagentsCatalogService {
  /** Get all enabled subagent types (for Phase 2 prompt injection) */
  getEnabledTypes(): SubagentCatalogEntry[]
  /** Get a specific subagent type by slug (for Phase 3 execution) */
  getBySlug(slug: string): SubagentCatalogEntry | null
  /** Record a subagent execution for usage tracking */
  recordUsage(record: RecordSubagentUsage): Promise<void>
  /** Get usage summary for console display */
  getUsageSummary(period: 'hour' | 'day' | 'week' | 'month'): Promise<SubagentUsageSummary>
  /** Reload catalog from DB (called on config change) */
  reload(): Promise<void>
}

/**
 * Create the subagents catalog service.
 * Caches enabled types in memory for fast access during pipeline.
 */
export function createCatalogService(db: Pool): SubagentsCatalogService {
  // In-memory cache of enabled types
  let cache: SubagentCatalogEntry[] = []
  let cacheBySlug = new Map<string, SubagentCatalogEntry>()

  async function loadCache(): Promise<void> {
    try {
      const types = await repo.getEnabledTypes(db)
      cache = types.map(t => ({
        id: t.id,
        slug: t.slug,
        name: t.name,
        description: t.description,
        modelTier: t.modelTier,
        tokenBudget: t.tokenBudget,
        verifyResult: t.verifyResult,
        canSpawnChildren: t.canSpawnChildren,
        allowedTools: t.allowedTools,
        allowedKnowledgeCategories: t.allowedKnowledgeCategories,
        systemPrompt: t.systemPrompt,
      }))
      cacheBySlug = new Map(cache.map(e => [e.slug, e]))
      logger.info({ count: cache.length }, 'Subagent catalog loaded')
    } catch (err) {
      logger.error({ err }, 'Failed to load subagent catalog')
    }
  }

  return {
    getEnabledTypes(): SubagentCatalogEntry[] {
      return cache
    },

    getBySlug(slug: string): SubagentCatalogEntry | null {
      return cacheBySlug.get(slug) ?? null
    },

    async recordUsage(record: RecordSubagentUsage): Promise<void> {
      try {
        await repo.recordUsage(db, record)
      } catch (err) {
        // Fire-and-forget — never block pipeline on tracking
        logger.error({ err, slug: record.subagentSlug }, 'Failed to record subagent usage')
      }
    },

    async getUsageSummary(period: 'hour' | 'day' | 'week' | 'month'): Promise<SubagentUsageSummary> {
      return repo.getUsageSummary(db, period)
    },

    async reload(): Promise<void> {
      await loadCache()
    },
  }
}
