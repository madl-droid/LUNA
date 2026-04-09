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
  MEMORY_SUMMARY_RETENTION_DAYS?: number
  MEMORY_ARCHIVE_RETENTION_YEARS?: number
  MEMORY_PIPELINE_LOGS_RETENTION_DAYS?: number
  MEMORY_HOT_MESSAGES_PURGE_AFTER_COMPRESS?: boolean
  MEMORY_PURGE_MERGED_SUMMARIES?: boolean
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

    // FIX-01: Fire-and-forget PG write with retry (non-blocking).
    // Retries only on transient errors (connection resets, timeouts), not constraint violations.
    const pgWriteWithRetry = async () => {
      const delays = [500, 1000, 2000]
      for (let attempt = 0; attempt < delays.length + 1; attempt++) {
        try {
          await this.pg.saveMessage(message)
          return
        } catch (err) {
          const isLast = attempt === delays.length
          const errMsg = err instanceof Error ? err.message : String(err)
          const isConstraint = errMsg.includes('duplicate key') || errMsg.includes('violates') || errMsg.includes('constraint')
          if (isLast || isConstraint) {
            if (isLast) logger.error({ err, messageId: message.id }, 'PG write failed after retries — message safe in Redis')
            return
          }
          await new Promise<void>(r => setTimeout(r, delays[attempt] ?? 500))
        }
      }
    }
    pgWriteWithRetry().catch((err) => {
      logger.error({ err, messageId: message.id }, 'PG write retry helper crashed')
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
    const redisMeta = await this.redis.getSessionMeta(sessionId)
    if (redisMeta) return redisMeta

    // FIX-05: Redis miss (e.g. after restart) — recover from PG
    const pgMeta = await this.pg.getSessionMetaForRecovery(sessionId)
    if (pgMeta) {
      // Repopulate Redis for subsequent reads
      this.redis.updateSessionMeta(pgMeta).catch((err) => {
        logger.warn({ err, sessionId }, 'Failed to repopulate Redis session meta after PG recovery')
      })
      logger.info({ sessionId }, 'Session meta recovered from PG after Redis miss')
    }
    return pgMeta
  }

  async updateSessionMeta(meta: SessionMeta): Promise<void> {
    await this.redis.updateSessionMeta(meta)

    // FIX-05: Fire-and-forget PG sync so session meta survives Redis restarts
    this.pg.persistSessionMeta(meta).catch((err) => {
      logger.warn({ err, sessionId: meta.sessionId }, 'Async PG session meta sync failed')
    })
  }

  async needsCompression(sessionId: string): Promise<boolean> {
    const turns = await this.redis.getTurnCount(sessionId)
    return turns >= this.redis.getConfig().MEMORY_COMPRESSION_THRESHOLD
  }

  async getTurnCount(sessionId: string): Promise<number> {
    return await this.redis.getTurnCount(sessionId)
  }

  getCompressionConfig(): { threshold: number; keepRecent: number } {
    const cfg = this.redis.getConfig()
    return {
      threshold: cfg.MEMORY_COMPRESSION_THRESHOLD,
      keepRecent: cfg.MEMORY_COMPRESSION_KEEP_RECENT,
    }
  }

  // ─── Buffer summary (inline compression) ───

  async getBufferSummary(sessionId: string): Promise<string | null> {
    return await this.redis.getBufferSummary(sessionId)
  }

  async setBufferSummary(sessionId: string, summary: string): Promise<void> {
    await this.redis.setBufferSummary(sessionId, summary)
  }

  async getOldestTurnMessages(sessionId: string, turnCount: number): Promise<import('./types.js').StoredMessage[]> {
    return await this.redis.getOldestTurnMessages(sessionId, turnCount)
  }

  async trimKeepingTurns(sessionId: string, keepTurns: number): Promise<void> {
    await this.redis.trimKeepingTurns(sessionId, keepTurns)
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.redis.deleteSession(sessionId)
  }

  // ═══════════════════════════════════════════
  // Agent-Contact — Cold tier
  // ═══════════════════════════════════════════

  async getAgentContact(contactId: string): Promise<AgentContact | null> {
    return await this.pg.getAgentContact(contactId)
  }

  async ensureAgentContact(contactId: string): Promise<AgentContact> {
    return await this.pg.ensureAgentContact(contactId)
  }

  async updateContactMemory(contactId: string, memory: ContactMemory): Promise<void> {
    await this.pg.updateContactMemory(contactId, memory)
  }

  async updateLeadStatus(
    contactId: string,
    status: string,
    qualificationData?: Record<string, unknown>,
    qualificationScore?: number,
  ): Promise<void> {
    await this.pg.updateLeadStatus(contactId, status, qualificationData, qualificationScore)
    // Invalidate cache
    await this.redis.invalidateLeadStatus(contactId)
  }

  // ═══════════════════════════════════════════
  // Lead status (cached)
  // ═══════════════════════════════════════════

  async getLeadStatus(contactId: string): Promise<string | null> {
    // Try Redis first
    const cached = await this.redis.getLeadStatus(contactId)
    if (cached) return cached

    // Fallback to PG
    const ac = await this.pg.getAgentContact(contactId)
    if (ac) {
      await this.redis.setLeadStatus(contactId, ac.leadStatus)
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
    // Run FTS (summaries + chunks) and recency in parallel
    const [ftsResults, chunkFtsResults, recentResults] = await Promise.all([
      this.pg.searchSummariesFTS(contactId, query, language, limit),
      this.pg.searchChunksFTS(contactId, query, limit),
      this.pg.getRecentSummaries(contactId, 3),
    ])

    // Deduplicate and merge by summaryId
    const seen = new Set<string>()
    const merged: HybridSearchResult[] = []

    // Chunk FTS first (most precise — individual semantic units)
    for (const r of chunkFtsResults) {
      if (!seen.has(r.summaryId)) {
        seen.add(r.summaryId)
        merged.push({ ...r, score: r.score * 1.2 })  // Boost chunk matches
      }
    }

    // Summary FTS (broader matches)
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
    contactId: string,
    channelIdentifier: string | null,
    compression: CompressionResult,
    startedAt: Date,
    closedAt: Date,
  ): Promise<string> {
    // Archive session BEFORE any deletes (legal backup)
    try {
      const messages = await this.pg.getSessionMessages(sessionId)
      if (messages.length > 0) {
        await this.pg.archiveSession({
          sessionId,
          contactId,
          channelIdentifier,
          channelType: null,
          contactSnapshot: {},
          messages,
          messageCount: messages.length,
          interactionStartedAt: startedAt,
          interactionClosedAt: closedAt,
        })
        logger.info({ sessionId, messageCount: messages.length }, 'Session archived before compression')
      }
    } catch (archiveErr) {
      // FIX-02: Archive failure ABORTS compression — never delete originals without a backup
      logger.error({ err: archiveErr, sessionId }, 'Archive before compression failed — aborting to preserve messages')
      throw archiveErr
    }

    // Save summary to warm tier
    const summaryId = await this.pg.saveSessionSummary({
      sessionId,
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

    // Generate semantic chunks from summary + key facts
    const chunks = this.splitSummaryIntoChunks(compression.summary, compression.keyFacts)
    if (chunks.length > 0) {
      const saved = await this.pg.saveChunks(summaryId, contactId, sessionId, chunks)
      logger.info({ sessionId, summaryId, chunks: saved }, 'Summary chunks saved')
    }

    // Mark session as compressed
    await this.pg.markSessionCompressed(sessionId)

    // Purge ALL hot messages — summary + chunks replace them.
    // Legal backup lives in session_archives (v2 tier).
    const deleted = await this.pg.deleteAllSessionMessages(sessionId)
    if (deleted > 0) logger.info({ sessionId, deleted }, 'Purged all messages after compression')

    // Delete Redis buffer for this session
    await this.redis.deleteSession(sessionId)

    logger.info({ sessionId, summaryId, messageCount: compression.originalCount }, 'Session compressed')
    return summaryId
  }

  /**
   * Split a summary into semantic chunks for individual embedding.
   * Strategy: each paragraph becomes a chunk, plus each key fact as a separate chunk.
   * Minimum chunk size: 20 chars (skip empty/trivial fragments).
   */
  splitSummaryIntoChunks(summaryText: string, keyFacts: Array<{ fact: string }>): string[] {
    const MIN_CHUNK_LENGTH = 20
    const chunks: string[] = []

    // Split summary by double newline (paragraphs) or bullet points
    const paragraphs = summaryText
      .split(/\n{2,}/)
      .flatMap(p => p.split(/^[-•*]\s+/m))
      .map(p => p.trim())
      .filter(p => p.length >= MIN_CHUNK_LENGTH)

    for (const p of paragraphs) {
      chunks.push(p)
    }

    // Each key fact as a standalone chunk (high precision for fact recall)
    for (const kf of keyFacts) {
      const factText = kf.fact.trim()
      if (factText.length >= MIN_CHUNK_LENGTH && !chunks.some(c => c.includes(factText))) {
        chunks.push(factText)
      }
    }

    return chunks
  }

  // ═══════════════════════════════════════════
  // Contact memory merge (warm → cold)
  // ═══════════════════════════════════════════

  async mergeToContactMemory(
    contactId: string,
    mergedMemory: ContactMemory,
    summaryIds: string[],
  ): Promise<void> {
    await this.pg.updateContactMemory(contactId, mergedMemory)
    await this.pg.markSummariesMerged(summaryIds)
    logger.info({ contactId, mergedSummaries: summaryIds.length }, 'Contact memory updated')
  }

  // ═══════════════════════════════════════════
  // Fact correction
  // ═══════════════════════════════════════════

  async applyFactCorrection(
    contactId: string,
    correction: FactCorrection,
  ): Promise<void> {
    const ac = await this.pg.getAgentContact(contactId)
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

    await this.pg.updateContactMemory(contactId, memory)
    logger.info({ contactId, correction: correction.newFact }, 'Fact correction applied')
  }

  // ═══════════════════════════════════════════
  // Commitments
  // ═══════════════════════════════════════════

  async saveCommitment(commitment: Omit<Commitment, 'id' | 'createdAt' | 'updatedAt' | 'completedAt'>): Promise<string> {
    return await this.pg.saveCommitment(commitment)
  }

  async getPendingCommitments(contactId: string, limit?: number): Promise<Commitment[]> {
    return await this.pg.getPendingCommitments(contactId, limit)
  }

  async getAssignedCommitments(assignedTo: string, limit?: number): Promise<Commitment[]> {
    return await this.pg.getAssignedCommitments(assignedTo, limit)
  }

  async getRecentCompletedCommitments(contactId: string, limit = 5): Promise<Commitment[]> {
    return await this.pg.getRecentCompletedCommitments(contactId, limit)
  }

  async updateCommitmentStatus(commitmentId: string, status: CommitmentStatus, actionTaken?: string): Promise<void> {
    await this.pg.updateCommitmentStatus(commitmentId, status, actionTaken)
  }

  async getOverdueCommitments(): Promise<Commitment[]> {
    return await this.pg.getOverdueCommitments()
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

  // ═══════════════════════════════════════════
  // Batch helpers (for nightly jobs)
  // ═══════════════════════════════════════════

  async getSessionsForCompression(): Promise<Array<{
    sessionId: string; contactId: string; channelIdentifier: string | null;
    messageCount: number; startedAt: Date; lastMessageAt: Date;
  }>> {
    return await this.pg.getSessionsForCompression(this.config.MEMORY_COMPRESSION_THRESHOLD)
  }

  async getUnmergedSummaries(contactId: string): Promise<SessionSummary[]> {
    return await this.pg.getUnmergedSummaries(contactId)
  }

  async getSummariesWithoutEmbeddings(limit?: number): Promise<Array<{ id: string; summaryText: string }>> {
    return await this.pg.getSummariesWithoutEmbeddings(limit)
  }

  async updateSummaryEmbedding(summaryId: string, embedding: number[]): Promise<void> {
    await this.pg.updateSummaryEmbedding(summaryId, embedding)
  }

  async getChunksBySummary(summaryId: string): Promise<Array<{ id: string; chunkText: string }>> {
    return await this.pg.getChunksBySummary(summaryId)
  }

  async getChunksWithoutEmbeddings(limit?: number): Promise<Array<{ id: string; chunkText: string }>> {
    return await this.pg.getChunksWithoutEmbeddings(limit)
  }

  async updateChunkEmbedding(chunkId: string, embedding: number[]): Promise<void> {
    await this.pg.updateChunkEmbedding(chunkId, embedding)
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

  async invalidateContext(contactId: string): Promise<void> {
    await this.redis.invalidateContext(contactId)
  }
}
