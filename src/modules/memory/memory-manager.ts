// LUNA — Memory manager (v3)
// Orquesta Redis (buffer rápido) + PostgreSQL (persistencia).
// Adds hybrid search, session compression, contact memory merge, fact correction.

import type { Pool } from 'pg'
import type { Redis } from 'ioredis'
import pino from 'pino'
import { RedisBuffer } from './redis-buffer.js'
import { PgStore } from './pg-store.js'
import type {
  StoredMessage,
  SessionMeta,
  SessionSummary,
  Commitment,
  CommitmentStatus,
  ContactMemory,
  AgentContact,
  FactCorrection,
  HybridSearchResult,
  PipelineLogEntry,
  ConversationArchive,
  CompressionResult,
} from './types.js'

const logger = pino({ name: 'memory:manager' })

export interface MemoryConfig {
  MEMORY_BUFFER_MESSAGE_COUNT: number
  MEMORY_SESSION_MAX_TTL_HOURS: number
  MEMORY_COMPRESSION_THRESHOLD: number
  MEMORY_COMPRESSION_KEEP_RECENT: number
  MEMORY_COMPRESSION_MODEL?: string
  MEMORY_EMBEDDING_MODEL?: string
  MEMORY_MAX_CONTACT_MEMORY_WORDS?: number
  MEMORY_SUMMARY_RETENTION_DAYS?: number
  MEMORY_ARCHIVE_RETENTION_YEARS?: number
  MEMORY_PIPELINE_LOGS_RETENTION_DAYS?: number
  MEMORY_HOT_MESSAGES_PURGE_AFTER_COMPRESS?: boolean
  MEMORY_PURGE_MERGED_SUMMARIES?: boolean
  MEMORY_RECOMPRESSION_INTERVAL_DAYS?: number
}

export class MemoryManager {
  private redis: RedisBuffer
  private pg: PgStore

  constructor(db: Pool, redisClient: Redis, private config: MemoryConfig) {
    this.redis = new RedisBuffer(redisClient, config)
    this.pg = new PgStore(db)
  }

  async initialize(): Promise<void> {
    // Tables are created by kernel migrator (src/migrations/*.sql) — no ensureTable needed
    logger.info('Memory manager initialized (Redis + PostgreSQL)')
  }

  async shutdown(): Promise<void> {
    logger.info('Memory manager shut down')
  }

  // ═══════════════════════════════════════════
  // Messages — Hot tier
  // ═══════════════════════════════════════════

  async saveMessage(message: StoredMessage): Promise<void> {
    await this.redis.saveMessage(message)

    // Fire-and-forget write to PG
    this.pg.saveMessage(message).catch((err) => {
      logger.error({ err, messageId: message.id }, 'Async PG write failed')
    })
  }

  async getSessionMessages(sessionId: string): Promise<StoredMessage[]> {
    const redisMessages = await this.redis.getSessionMessages(sessionId)
    if (redisMessages.length > 0) {
      return redisMessages
    }

    logger.debug({ sessionId }, 'Redis empty, falling back to PostgreSQL')
    return await this.pg.getSessionMessages(sessionId)
  }

  async getSessionMeta(sessionId: string): Promise<SessionMeta | null> {
    return await this.redis.getSessionMeta(sessionId)
  }

  async updateSessionMeta(meta: SessionMeta): Promise<void> {
    await this.redis.updateSessionMeta(meta)
  }

  async needsCompression(sessionId: string): Promise<boolean> {
    const count = await this.redis.getMessageCount(sessionId)
    return count >= this.redis.getConfig().MEMORY_COMPRESSION_THRESHOLD
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.redis.deleteSession(sessionId)
  }

  // ═══════════════════════════════════════════
  // Agent-Contact — Cold tier
  // ═══════════════════════════════════════════

  async getAgentContact(agentId: string, contactId: string): Promise<AgentContact | null> {
    return await this.pg.getAgentContact(agentId, contactId)
  }

  async ensureAgentContact(agentId: string, contactId: string): Promise<AgentContact> {
    return await this.pg.ensureAgentContact(agentId, contactId)
  }

  async updateContactMemory(agentId: string, contactId: string, memory: ContactMemory): Promise<void> {
    await this.pg.updateContactMemory(agentId, contactId, memory)
  }

  async updateLeadStatus(
    agentId: string,
    contactId: string,
    status: string,
    qualificationData?: Record<string, unknown>,
    qualificationScore?: number,
  ): Promise<void> {
    await this.pg.updateLeadStatus(agentId, contactId, status, qualificationData, qualificationScore)
    // Invalidate cache
    await this.redis.invalidateLeadStatus(contactId, agentId)
  }

  // ═══════════════════════════════════════════
  // Lead status (cached)
  // ═══════════════════════════════════════════

  async getLeadStatus(contactId: string, agentId: string): Promise<string | null> {
    // Try Redis first
    const cached = await this.redis.getLeadStatus(contactId, agentId)
    if (cached) return cached

    // Fallback to PG
    const ac = await this.pg.getAgentContact(agentId, contactId)
    if (ac) {
      await this.redis.setLeadStatus(contactId, agentId, ac.leadStatus)
      return ac.leadStatus
    }
    return null
  }

  // ═══════════════════════════════════════════
  // Session Summaries — Warm tier
  // ═══════════════════════════════════════════

  async saveSessionSummary(summary: Omit<SessionSummary, 'id' | 'createdAt' | 'mergedToMemoryAt'>): Promise<string> {
    return await this.pg.saveSessionSummary(summary)
  }

  // ═══════════════════════════════════════════
  // Hybrid search (FTS + vector + recency)
  // ═══════════════════════════════════════════

  async hybridSearch(
    contactId: string,
    query: string,
    language: string = 'es',
    limit: number = 5,
  ): Promise<HybridSearchResult[]> {
    // Run FTS and recency in parallel
    const [ftsResults, recentResults] = await Promise.all([
      this.pg.searchSummariesFTS(contactId, query, language, limit),
      this.pg.getRecentSummaries(contactId, 3),
    ])

    // Deduplicate and merge by summaryId
    const seen = new Set<string>()
    const merged: HybridSearchResult[] = []

    // FTS results first (higher relevance)
    for (const r of ftsResults) {
      if (!seen.has(r.summaryId)) {
        seen.add(r.summaryId)
        merged.push(r)
      }
    }

    // Then recency results
    for (const r of recentResults) {
      if (!seen.has(r.summaryId)) {
        seen.add(r.summaryId)
        // Scale recency score lower than FTS
        merged.push({ ...r, score: r.score * 0.7 })
      }
    }

    // Sort by score descending
    merged.sort((a, b) => b.score - a.score)

    return merged.slice(0, limit)
  }

  // ═══════════════════════════════════════════
  // Session compression
  // Caller provides LLM result; we handle storage.
  // ═══════════════════════════════════════════

  async compressSession(
    sessionId: string,
    agentId: string,
    contactId: string,
    channelIdentifier: string | null,
    compression: CompressionResult,
    startedAt: Date,
    closedAt: Date,
  ): Promise<string> {
    // Save summary to warm tier
    const summaryId = await this.pg.saveSessionSummary({
      sessionId,
      agentId,
      contactId,
      channelIdentifier,
      summaryText: compression.summary,
      summaryLanguage: 'es',
      keyFacts: compression.keyFacts,
      structuredData: compression.structuredData,
      originalMessageCount: compression.originalCount,
      modelUsed: compression.modelUsed,
      compressionTokens: compression.tokensUsed,
      interactionStartedAt: startedAt,
      interactionClosedAt: closedAt,
    })

    // Mark session as compressed
    await this.pg.markSessionCompressed(sessionId)

    // Optionally purge hot messages
    if (this.config.MEMORY_HOT_MESSAGES_PURGE_AFTER_COMPRESS) {
      const keepRecent = this.config.MEMORY_COMPRESSION_KEEP_RECENT
      const deleted = await this.pg.deleteSessionHotMessages(sessionId, keepRecent)
      logger.info({ sessionId, deleted, kept: keepRecent }, 'Purged hot messages after compression')
    }

    // Delete Redis buffer for this session
    await this.redis.deleteSession(sessionId)

    logger.info({ sessionId, summaryId, messageCount: compression.originalCount }, 'Session compressed')
    return summaryId
  }

  // ═══════════════════════════════════════════
  // Contact memory merge (warm → cold)
  // ═══════════════════════════════════════════

  async mergeToContactMemory(
    agentId: string,
    contactId: string,
    mergedMemory: ContactMemory,
    summaryIds: string[],
  ): Promise<void> {
    await this.pg.updateContactMemory(agentId, contactId, mergedMemory)
    await this.pg.markSummariesMerged(summaryIds)
    logger.info({ agentId, contactId, mergedSummaries: summaryIds.length }, 'Contact memory updated')
  }

  // ═══════════════════════════════════════════
  // Fact correction
  // ═══════════════════════════════════════════

  async applyFactCorrection(
    agentId: string,
    contactId: string,
    correction: FactCorrection,
  ): Promise<void> {
    const ac = await this.pg.getAgentContact(agentId, contactId)
    if (!ac) return

    const memory = ac.contactMemory
    const existingIdx = memory.key_facts.findIndex(
      (f) => f.fact.toLowerCase().includes(correction.oldFact.toLowerCase()),
    )

    if (existingIdx >= 0) {
      const old = memory.key_facts[existingIdx]!
      memory.key_facts[existingIdx] = {
        fact: correction.newFact,
        source: correction.source,
        confidence: correction.confidence,
        supersedes: `${old.fact} (${old.source})`,
      }
    } else {
      memory.key_facts.push({
        fact: correction.newFact,
        source: correction.source,
        confidence: correction.confidence,
      })
    }

    await this.pg.updateContactMemory(agentId, contactId, memory)
    logger.info({ agentId, contactId, correction: correction.newFact }, 'Fact correction applied')
  }

  // ═══════════════════════════════════════════
  // Commitments
  // ═══════════════════════════════════════════

  async saveCommitment(commitment: Omit<Commitment, 'id' | 'createdAt' | 'updatedAt' | 'completedAt'>): Promise<string> {
    return await this.pg.saveCommitment(commitment)
  }

  async getPendingCommitments(agentId: string, contactId: string): Promise<Commitment[]> {
    return await this.pg.getPendingCommitments(agentId, contactId)
  }

  async getRecentCompletedCommitments(agentId: string, contactId: string, limit = 5): Promise<Commitment[]> {
    return await this.pg.getRecentCompletedCommitments(agentId, contactId, limit)
  }

  async updateCommitmentStatus(commitmentId: string, status: CommitmentStatus, actionTaken?: string): Promise<void> {
    await this.pg.updateCommitmentStatus(commitmentId, status, actionTaken)
  }

  async getOverdueCommitments(agentId: string): Promise<Commitment[]> {
    return await this.pg.getOverdueCommitments(agentId)
  }

  async getCrossAgentCommitments(contactId: string, excludeAgentId: string): Promise<Commitment[]> {
    return await this.pg.getCrossAgentCommitments(contactId, excludeAgentId)
  }

  // ═══════════════════════════════════════════
  // Archives
  // ═══════════════════════════════════════════

  async archiveSession(archive: Omit<ConversationArchive, 'id' | 'archivedAt'>): Promise<string> {
    return await this.pg.archiveSession(archive)
  }

  // ═══════════════════════════════════════════
  // Pipeline logs
  // ═══════════════════════════════════════════

  async savePipelineLog(entry: PipelineLogEntry): Promise<void> {
    // Fire-and-forget
    this.pg.savePipelineLog(entry).catch((err) => {
      logger.warn({ err }, 'Async pipeline log write failed')
    })
  }

  // ═══════════════════════════════════════════
  // Agent resolution
  // ═══════════════════════════════════════════

  async resolveAgentId(slug: string): Promise<string | null> {
    return await this.pg.resolveAgentId(slug)
  }

  // ═══════════════════════════════════════════
  // Batch helpers (for nightly jobs)
  // ═══════════════════════════════════════════

  async getSessionsForCompression(agentId: string): Promise<Array<{
    sessionId: string; contactId: string; channelIdentifier: string | null;
    messageCount: number; startedAt: Date; lastMessageAt: Date;
  }>> {
    return await this.pg.getSessionsForCompression(agentId, this.config.MEMORY_COMPRESSION_THRESHOLD)
  }

  async getUnmergedSummaries(agentId: string, contactId: string): Promise<SessionSummary[]> {
    return await this.pg.getUnmergedSummaries(agentId, contactId)
  }

  async getSummariesWithoutEmbeddings(limit?: number): Promise<Array<{ id: string; summaryText: string }>> {
    return await this.pg.getSummariesWithoutEmbeddings(limit)
  }

  async updateSummaryEmbedding(summaryId: string, embedding: number[]): Promise<void> {
    await this.pg.updateSummaryEmbedding(summaryId, embedding)
  }

  async purgeOldPipelineLogs(): Promise<number> {
    const days = this.config.MEMORY_PIPELINE_LOGS_RETENTION_DAYS ?? 90
    return await this.pg.purgeOldPipelineLogs(days)
  }

  async purgeOldArchives(): Promise<number> {
    const years = this.config.MEMORY_ARCHIVE_RETENTION_YEARS ?? 2
    if (years === 0) return 0   // Desactivado — no purgar
    if (years >= 999) return 0  // Vitalicio — no purgar
    return await this.pg.purgeOldArchives(years)
  }

  // ═══════════════════════════════════════════
  // Context cache
  // ═══════════════════════════════════════════

  async invalidateContext(contactId: string, agentId: string): Promise<void> {
    await this.redis.invalidateContext(contactId, agentId)
  }
}
