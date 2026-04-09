// LUNA — PostgreSQL persistent store for memory v3
// Handles hot (messages), warm (session_summaries), cold (contact_memory) tiers,
// plus commitments, archives, and pipeline logs.

import { randomUUID } from 'node:crypto'
import type { Pool } from 'pg'
import pino from 'pino'
import type {
  StoredMessage,
  SessionSummary,
  SessionMeta,
  KeyFact,
  AgentContact,
  ContactMemory,
  Commitment,
  CommitmentStatus,
  PipelineLogEntry,
  HybridSearchResult,
  ConversationArchive,
} from './types.js'

const logger = pino({ name: 'memory:pg-store' })

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type DbRow = Record<string, any>

export class PgStore {
  constructor(private pool: Pool) {}

  // ═══════════════════════════════════════════
  // Messages — Hot tier (dual-write old + new columns)
  // ═══════════════════════════════════════════

  async saveMessage(message: StoredMessage): Promise<void> {
    try {
      await this.pool.query(
        `INSERT INTO messages (
          id, session_id, role, content_text, content_type, created_at,
          media_path, media_mime, media_analysis,
          intent, emotion, tokens_used, latency_ms, model_used, token_count, metadata
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
        ON CONFLICT (id) DO NOTHING`,
        [
          message.id,
          message.sessionId,
          message.role,
          message.contentText,
          message.contentType ?? 'text',
          message.createdAt,
          message.mediaPath ?? null,
          message.mediaMime ?? null,
          message.mediaAnalysis ?? null,
          message.intent ?? null,
          message.emotion ?? null,
          message.tokensUsed ?? null,
          message.latencyMs ?? null,
          message.modelUsed ?? null,
          message.tokenCount ?? null,
          message.metadata ? JSON.stringify(message.metadata) : '{}',
        ],
      )
    } catch (err) {
      logger.error({ err, messageId: message.id }, 'Failed to persist message to PostgreSQL')
    }
  }

  async getSessionMessages(sessionId: string, limit = 100): Promise<StoredMessage[]> {
    const result = await this.pool.query(
      `SELECT id, session_id, role, content_text, content_type, created_at,
              media_path, media_mime, media_analysis,
              intent, emotion, tokens_used, latency_ms, model_used, token_count, metadata
       FROM messages
       WHERE session_id = $1
       ORDER BY created_at ASC
       LIMIT $2`,
      [sessionId, limit],
    )

    return result.rows.map((row: DbRow) => ({
      id: row.id,
      sessionId: row.session_id,
      channelName: '',
      senderType: row.role === 'assistant' ? 'agent' as const : 'user' as const,
      senderId: '',
      content: { type: row.content_type ?? 'text', text: row.content_text ?? '' },
      role: row.role ?? 'user',
      contentText: row.content_text ?? '',
      contentType: row.content_type ?? 'text',
      mediaPath: row.media_path,
      mediaMime: row.media_mime,
      mediaAnalysis: row.media_analysis,
      intent: row.intent,
      emotion: row.emotion,
      tokensUsed: row.tokens_used,
      latencyMs: row.latency_ms,
      modelUsed: row.model_used,
      tokenCount: row.token_count,
      metadata: row.metadata ?? {},
      createdAt: new Date(row.created_at),
    }))
  }

  // ═══════════════════════════════════════════
  // Agent-Contact — Cold tier relationship
  // ═══════════════════════════════════════════

  async getAgentContact(contactId: string): Promise<AgentContact | null> {
    try {
      const result = await this.pool.query(
        `SELECT id, contact_id, lead_status, qualification_data, qualification_score,
                agent_data, assigned_to, assigned_at, follow_up_count, last_follow_up_at,
                next_follow_up_at, source_campaign, source_channel, contact_memory,
                created_at, updated_at
         FROM agent_contacts
         WHERE contact_id = $1`,
        [contactId],
      )
      if (result.rows.length === 0) return null
      return this.mapAgentContactRow(result.rows[0]!)
    } catch (err) {
      logger.warn({ err, contactId }, 'Failed to get agent_contact')
      return null
    }
  }

  async ensureAgentContact(contactId: string): Promise<AgentContact> {
    try {
      await this.pool.query(
        `INSERT INTO agent_contacts (contact_id)
         VALUES ($1)
         ON CONFLICT (contact_id) DO NOTHING`,
        [contactId],
      )
    } catch (err) {
      logger.warn({ err, contactId }, 'Failed to ensure agent_contact')
    }
    const ac = await this.getAgentContact(contactId)
    if (!ac) {
      // Fallback in-memory default
      return {
        id: '',
        contactId,
        leadStatus: 'unknown',
        qualificationData: {},
        qualificationScore: 0,
        agentData: {},
        followUpCount: 0,
        contactMemory: { summary: '', key_facts: [], preferences: {}, important_dates: [], relationship_notes: '' },
        createdAt: new Date(),
        updatedAt: new Date(),
      } as AgentContact
    }
    return ac
  }

  async updateContactMemory(contactId: string, memory: ContactMemory): Promise<void> {
    try {
      // FIX-06: Upsert instead of UPDATE-only — avoids silent data loss when agent_contacts row doesn't exist
      await this.pool.query(
        `INSERT INTO agent_contacts (contact_id, contact_memory)
         VALUES ($1, $2)
         ON CONFLICT (contact_id) DO UPDATE SET contact_memory = $2, updated_at = NOW()`,
        [contactId, JSON.stringify(memory)],
      )
    } catch (err) {
      logger.error({ err, contactId }, 'Failed to update contact_memory')
    }
  }

  // FIX-05: Persist SessionMeta to PG so it survives Redis restarts.
  // Only updates message_count and last_activity_at (status is managed by markSessionCompressed).
  async persistSessionMeta(meta: SessionMeta): Promise<void> {
    try {
      await this.pool.query(
        `UPDATE sessions
         SET message_count = GREATEST(message_count, $2),
             last_activity_at = GREATEST(COALESCE(last_activity_at, $3), $3)
         WHERE id = $1
           AND COALESCE(status, 'active') NOT IN ('compressed', 'done')`,
        [meta.sessionId, meta.messageCount, meta.lastActivityAt],
      )
    } catch (err) {
      logger.warn({ err, sessionId: meta.sessionId }, 'Failed to persist session meta to PG')
    }
  }

  // FIX-05: Load SessionMeta from PG for recovery after Redis restart.
  async getSessionMetaForRecovery(sessionId: string): Promise<SessionMeta | null> {
    try {
      const result = await this.pool.query(
        `SELECT id, contact_id, channel_name, started_at, last_activity_at,
                message_count, status, compressed_at
         FROM sessions WHERE id = $1`,
        [sessionId],
      )
      const row = result.rows[0]
      if (!row) return null

      const status = row.status ?? 'active'
      return {
        sessionId: row.id as string,
        contactId: (row.contact_id as string) ?? '',
        channelName: (row.channel_name as string) ?? '',
        startedAt: new Date(row.started_at as string),
        lastActivityAt: row.last_activity_at ? new Date(row.last_activity_at as string) : new Date(),
        messageCount: (row.message_count as number) ?? 0,
        compressed: status === 'compressed' || row.compressed_at != null,
        status: (status === 'compressed' ? 'compressed' : status === 'closed' ? 'closed' : 'active') as SessionMeta['status'],
      }
    } catch (err) {
      logger.warn({ err, sessionId }, 'Failed to load session meta from PG for recovery')
      return null
    }
  }

  async updateLeadStatus(
    contactId: string,
    status: string,
    qualificationData?: Record<string, unknown>,
    qualificationScore?: number,
  ): Promise<void> {
    try {
      const setClauses = ['lead_status = $2']
      const params: unknown[] = [contactId, status]
      let idx = 3

      if (qualificationData !== undefined) {
        setClauses.push(`qualification_data = $${idx++}`)
        params.push(JSON.stringify(qualificationData))
      }
      if (qualificationScore !== undefined) {
        setClauses.push(`qualification_score = $${idx++}`)
        params.push(qualificationScore)
      }

      await this.pool.query(
        `UPDATE agent_contacts SET ${setClauses.join(', ')} WHERE contact_id = $1`,
        params,
      )
    } catch (err) {
      logger.error({ err, contactId, status }, 'Failed to update lead status')
    }
  }

  // ═══════════════════════════════════════════
  // Session Summaries — Warm tier
  // ═══════════════════════════════════════════

  async saveSessionSummary(summary: Omit<SessionSummary, 'id' | 'createdAt' | 'mergedToMemoryAt'>): Promise<string> {
    // v2: write to session_summaries_v2 (legacy SessionSummary fields mapped to v2 schema)
    const title = (summary.summaryText.split('\n')[0] ?? summary.summaryText).slice(0, 200)
    const description = summary.summaryText.slice(0, 500)
    const result = await this.pool.query(
      `INSERT INTO session_summaries_v2 (session_id, contact_id, title, description, full_summary, sections, model_used, tokens_used)
       VALUES ($1, $2, $3, $4, $5, NULL, $6, $7)
       ON CONFLICT (session_id) DO UPDATE SET
         title = EXCLUDED.title, description = EXCLUDED.description,
         full_summary = EXCLUDED.full_summary,
         model_used = EXCLUDED.model_used, tokens_used = EXCLUDED.tokens_used
       RETURNING id`,
      [
        summary.sessionId,
        summary.contactId,
        title,
        description,
        summary.summaryText,
        summary.modelUsed,
        summary.compressionTokens ?? null,
      ],
    )
    return result.rows[0]!.id as string
  }

  async searchSummariesFTS(
    contactId: string,
    query: string,
    language: string = 'es',
    limit: number = 5,
  ): Promise<HybridSearchResult[]> {
    // v2: search session_summaries_v2.full_summary with inline tsvector
    const pgDict = this.langToDict(language)
    try {
      const result = await this.pool.query(
        `SELECT id::text AS id, session_id, full_summary AS summary_text,
                ts_rank(to_tsvector($3, full_summary), plainto_tsquery($3, $2)) AS rank,
                created_at AS interaction_started_at
         FROM session_summaries_v2
         WHERE contact_id = $1
           AND to_tsvector($3, full_summary) @@ plainto_tsquery($3, $2)
         ORDER BY rank DESC
         LIMIT $4`,
        [contactId, query, pgDict, limit],
      )
      return result.rows.map((row: DbRow) => ({
        summaryId: row.id,
        sessionId: row.session_id,
        summaryText: row.summary_text,
        keyFacts: [],
        score: parseFloat(row.rank),
        matchType: 'fts' as const,
        interactionStartedAt: row.interaction_started_at,
      }))
    } catch (err) {
      logger.warn({ err, contactId, query }, 'FTS search failed')
      return []
    }
  }

  async searchSummariesVector(
    contactId: string,
    embedding: number[],
    limit: number = 5,
  ): Promise<HybridSearchResult[]> {
    // v2: summary-level vector search delegated to chunk-level search
    return this.searchChunksVector(contactId, embedding, limit)
  }

  async getRecentSummaries(contactId: string, limit: number = 3): Promise<HybridSearchResult[]> {
    try {
      const result = await this.pool.query(
        `SELECT id::text AS id, session_id, full_summary AS summary_text, created_at AS interaction_started_at
         FROM session_summaries_v2
         WHERE contact_id = $1
         ORDER BY created_at DESC
         LIMIT $2`,
        [contactId, limit],
      )
      return result.rows.map((row: DbRow, idx: number) => ({
        summaryId: row.id,
        sessionId: row.session_id,
        summaryText: row.summary_text,
        keyFacts: [],
        score: 1.0 - idx * 0.1,
        matchType: 'recency' as const,
        interactionStartedAt: row.interaction_started_at,
      }))
    } catch (err) {
      logger.warn({ err, contactId }, 'Recent summaries query failed')
      return []
    }
  }

  async getUnmergedSummaries(contactId: string): Promise<SessionSummary[]> {
    try {
      // v2-only: read from session_summaries_v2
      const result = await this.pool.query(
        `SELECT id::text AS id, session_id, contact_id, NULL AS channel_identifier,
                full_summary AS summary_text, 'es' AS summary_language,
                '[]'::jsonb AS key_facts, '{}'::jsonb AS structured_data,
                0 AS original_message_count, model_used,
                tokens_used AS compression_tokens,
                created_at AS interaction_started_at, created_at AS interaction_closed_at,
                merged_to_memory_at, created_at
         FROM session_summaries_v2
         WHERE contact_id = $1 AND merged_to_memory_at IS NULL
         ORDER BY created_at ASC`,
        [contactId],
      )
      return result.rows.map((row: DbRow) => this.mapSessionSummaryRow(row))
    } catch (err) {
      logger.warn({ err, contactId }, 'Failed to get unmerged summaries')
      return []
    }
  }

  async markSummariesMerged(summaryIds: string[]): Promise<void> {
    if (summaryIds.length === 0) return
    try {
      // v2-only: update session_summaries_v2
      await this.pool.query(
        `UPDATE session_summaries_v2 SET merged_to_memory_at = now() WHERE id::text = ANY($1)`,
        [summaryIds],
      )
    } catch (err) {
      logger.warn({ err, count: summaryIds.length }, 'Failed to mark summaries as merged')
    }
  }

  async updateSummaryEmbedding(_summaryId: string, _embedding: number[]): Promise<void> {
    // v2: summary-level embeddings removed — embeddings live in session_memory_chunks
    logger.debug('updateSummaryEmbedding is a no-op in v2 (embeddings are on chunks)')
  }

  async getSummariesWithoutEmbeddings(_limit: number = 50): Promise<Array<{ id: string; summaryText: string }>> {
    // v2: summary-level embeddings removed — use getChunksWithoutEmbeddings instead
    return []
  }

  // ═══════════════════════════════════════════
  // Summary Chunks — Semantic search tier
  // ═══════════════════════════════════════════

  async saveChunks(summaryId: string, contactId: string, sessionId: string, chunks: string[]): Promise<number> {
    if (chunks.length === 0) return 0
    // v2: write to session_memory_chunks with source_type='session_summary'
    const totalChunks = chunks.length
    const values: unknown[] = []
    const placeholders: string[] = []
    for (let i = 0; i < chunks.length; i++) {
      const offset = i * 7
      placeholders.push(
        `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4}, 'session_summary', 'text', $${offset + 5}, $${offset + 6}, $${offset + 7}, 'pending')`,
      )
      values.push(randomUUID(), sessionId, contactId, summaryId, i, totalChunks, chunks[i])
    }
    try {
      await this.pool.query(
        `INSERT INTO session_memory_chunks
           (id, session_id, contact_id, source_id, source_type, content_type, chunk_index, chunk_total, content, embedding_status)
         VALUES ${placeholders.join(', ')}
         ON CONFLICT (id) DO NOTHING`,
        values,
      )
      return chunks.length
    } catch (err) {
      logger.error({ err, summaryId, count: chunks.length }, 'Failed to save chunks')
      return 0
    }
  }

  async getChunksBySummary(summaryId: string): Promise<Array<{ id: string; chunkText: string }>> {
    try {
      // v2: query session_memory_chunks by source_id (summaryId)
      const result = await this.pool.query(
        `SELECT id, content AS chunk_text
         FROM session_memory_chunks
         WHERE source_id = $1 AND source_type = 'session_summary'
           AND embedding_status != 'embedded'
         ORDER BY chunk_index ASC`,
        [summaryId],
      )
      return result.rows.map((row: DbRow) => ({ id: row.id, chunkText: row.chunk_text }))
    } catch (err) {
      logger.warn({ err, summaryId }, 'Failed to get chunks by summary')
      return []
    }
  }

  async getChunksWithoutEmbeddings(limit: number = 100): Promise<Array<{ id: string; chunkText: string }>> {
    try {
      // v2: query session_memory_chunks with source_type='session_summary' and embedding_status='pending'
      const result = await this.pool.query(
        `SELECT id, content AS chunk_text
         FROM session_memory_chunks
         WHERE embedding_status = 'pending'
           AND source_type = 'session_summary'
           AND content IS NOT NULL
         ORDER BY source_id, chunk_index ASC
         LIMIT $1`,
        [limit],
      )
      return result.rows.map((row: DbRow) => ({ id: row.id, chunkText: row.chunk_text }))
    } catch (err) {
      logger.warn({ err }, 'Failed to get chunks without embeddings')
      return []
    }
  }

  /**
   * Direct embedding persistence — bypasses BullMQ queue.
   * Used by batch jobs (nightly-batch, vectorize-worker) that manage their own retry logic.
   * For normal flow, use EmbeddingQueue.enqueue() instead.
   */
  async updateChunkEmbedding(chunkId: string, embedding: number[]): Promise<void> {
    try {
      // v2: update session_memory_chunks and mark as embedded
      await this.pool.query(
        `UPDATE session_memory_chunks SET embedding = $2::vector, embedding_status = 'embedded' WHERE id = $1`,
        [chunkId, `[${embedding.join(',')}]`],
      )
    } catch (err) {
      logger.warn({ err, chunkId }, 'Failed to update chunk embedding')
    }
  }

  async searchChunksVector(
    contactId: string,
    embedding: number[],
    limit: number = 5,
  ): Promise<HybridSearchResult[]> {
    try {
      // v2: search session_memory_chunks with LEFT JOIN to session_summaries_v2
      const result = await this.pool.query(
        `SELECT smc.id AS chunk_id, smc.content AS chunk_text, smc.source_id AS summary_id,
                smc.session_id,
                COALESCE(ssv2.full_summary, smc.content) AS summary_text,
                COALESCE(ssv2.created_at, '1970-01-01'::timestamptz) AS interaction_started_at,
                1 - (smc.embedding <=> $2::vector) AS similarity
         FROM session_memory_chunks smc
         LEFT JOIN session_summaries_v2 ssv2 ON ssv2.id::text = smc.source_id
         WHERE smc.contact_id = $1 AND smc.embedding_status = 'embedded'
         ORDER BY smc.embedding <=> $2::vector
         LIMIT $3`,
        [contactId, `[${embedding.join(',')}]`, limit],
      )
      return result.rows.map((row: DbRow) => ({
        summaryId: row.summary_id,
        sessionId: row.session_id,
        summaryText: row.chunk_text,
        keyFacts: [],
        score: parseFloat(row.similarity),
        matchType: 'chunk_vector' as const,
        interactionStartedAt: row.interaction_started_at,
      }))
    } catch (err) {
      logger.warn({ err, contactId }, 'Chunk vector search failed')
      return []
    }
  }

  async searchChunksFTS(
    contactId: string,
    query: string,
    limit: number = 10,
  ): Promise<HybridSearchResult[]> {
    try {
      // v2: use session_memory_chunks.tsv column + LEFT JOIN session_summaries_v2
      const result = await this.pool.query(
        `SELECT smc.source_id AS summary_id, smc.session_id, smc.content AS chunk_text,
                COALESCE(ssv2.created_at, '1970-01-01'::timestamptz) AS interaction_started_at,
                ts_rank(smc.tsv, plainto_tsquery('simple', $2)) AS rank
         FROM session_memory_chunks smc
         LEFT JOIN session_summaries_v2 ssv2 ON ssv2.id::text = smc.source_id
         WHERE smc.contact_id = $1
           AND smc.tsv @@ plainto_tsquery('simple', $2)
         ORDER BY rank DESC
         LIMIT $3`,
        [contactId, query, limit],
      )
      return result.rows.map((row: DbRow) => ({
        summaryId: row.summary_id,
        sessionId: row.session_id,
        summaryText: row.chunk_text,
        keyFacts: [],
        score: parseFloat(row.rank),
        matchType: 'chunk_vector' as const,
        interactionStartedAt: row.interaction_started_at,
      }))
    } catch (err) {
      logger.warn({ err, contactId, query }, 'Chunk FTS search failed')
      return []
    }
  }

  async deleteAllSessionMessages(sessionId: string): Promise<number> {
    try {
      const result = await this.pool.query(
        `DELETE FROM messages WHERE session_id = $1`,
        [sessionId],
      )
      return result.rowCount ?? 0
    } catch (err) {
      logger.warn({ err, sessionId }, 'Failed to delete all session messages')
      return 0
    }
  }

  // ═══════════════════════════════════════════
  // Commitments
  // ═══════════════════════════════════════════

  async saveCommitment(commitment: Omit<Commitment, 'id' | 'createdAt' | 'updatedAt' | 'completedAt'>): Promise<string> {
    const result = await this.pool.query(
      `INSERT INTO commitments (
        contact_id, session_id, commitment_by, description, category,
        priority, commitment_type, due_at, scheduled_at, event_starts_at, event_ends_at,
        external_id, external_provider, assigned_to, status, parent_id, sort_order,
        requires_tool, auto_cancel_at, created_via, context_summary, metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
      RETURNING id`,
      [
        commitment.contactId, commitment.sessionId ?? null,
        commitment.commitmentBy, commitment.description, commitment.category ?? null,
        commitment.priority, commitment.commitmentType,
        commitment.dueAt ?? null, commitment.scheduledAt ?? null,
        commitment.eventStartsAt ?? null, commitment.eventEndsAt ?? null,
        commitment.externalId ?? null, commitment.externalProvider ?? null,
        commitment.assignedTo ?? null, commitment.status,
        commitment.parentId ?? null, commitment.sortOrder ?? 0,
        commitment.requiresTool ?? null, commitment.autoCancelAt ?? null,
        commitment.createdVia ?? 'tool',
        commitment.contextSummary ?? null,
        JSON.stringify(commitment.metadata ?? {}),
      ],
    )
    return result.rows[0]!.id as string
  }

  async getPendingCommitments(contactId: string, limit?: number): Promise<Commitment[]> {
    try {
      const limitClause = limit ? ` LIMIT ${Math.max(1, Math.floor(limit))}` : ''
      const result = await this.pool.query(
        `SELECT * FROM commitments
         WHERE contact_id = $1
           AND status IN ('pending', 'in_progress', 'waiting')
         ORDER BY CASE priority
           WHEN 'urgent' THEN 0
           WHEN 'high' THEN 1
           WHEN 'normal' THEN 2
           WHEN 'low' THEN 3
         END, due_at ASC NULLS LAST${limitClause}`,
        [contactId],
      )
      return result.rows.map((row: DbRow) => this.mapCommitmentRow(row))
    } catch (err) {
      logger.warn({ err, contactId }, 'Failed to get pending commitments')
      return []
    }
  }

  async getAssignedCommitments(assignedTo: string, limit = 10): Promise<Commitment[]> {
    try {
      const result = await this.pool.query(
        `SELECT * FROM commitments
         WHERE assigned_to = $1
           AND status IN ('pending', 'in_progress', 'waiting', 'overdue')
         ORDER BY CASE priority
           WHEN 'urgent' THEN 0
           WHEN 'high' THEN 1
           WHEN 'normal' THEN 2
           ELSE 3
         END, due_at ASC NULLS LAST
         LIMIT ${Math.max(1, Math.floor(limit))}`,
        [assignedTo],
      )
      return result.rows.map((r: Record<string, unknown>) => this.mapCommitmentRow(r))
    } catch (err) {
      logger.warn({ err, assignedTo }, 'Failed to load assigned commitments')
      return []
    }
  }

  async getRecentCompletedCommitments(contactId: string, limit = 5): Promise<Commitment[]> {
    try {
      const result = await this.pool.query(
        `SELECT * FROM commitments
         WHERE contact_id = $1 AND status = 'done'
         ORDER BY completed_at DESC
         LIMIT $2`,
        [contactId, limit],
      )
      return result.rows.map((row: DbRow) => this.mapCommitmentRow(row))
    } catch (err) {
      logger.warn({ err, contactId }, 'Failed to get completed commitments')
      return []
    }
  }

  async updateCommitmentStatus(
    commitmentId: string,
    status: CommitmentStatus,
    actionTaken?: string,
  ): Promise<void> {
    try {
      const completedAt = status === 'done' ? new Date() : null
      await this.pool.query(
        `UPDATE commitments
         SET status = $1, action_taken = COALESCE($2, action_taken),
             completed_at = COALESCE($3, completed_at),
             attempt_count = attempt_count + 1,
             last_attempt_at = now()
         WHERE id = $4`,
        [status, actionTaken ?? null, completedAt, commitmentId],
      )
    } catch (err) {
      logger.error({ err, commitmentId, status }, 'Failed to update commitment status')
    }
  }

  async getOverdueCommitments(): Promise<Commitment[]> {
    try {
      const result = await this.pool.query(
        `SELECT * FROM commitments
         WHERE status IN ('pending', 'in_progress')
           AND due_at IS NOT NULL AND due_at < now()
         ORDER BY due_at ASC`,
      )
      return result.rows.map((row: DbRow) => this.mapCommitmentRow(row))
    } catch (err) {
      logger.warn({ err }, 'Failed to get overdue commitments')
      return []
    }
  }

  // ═══════════════════════════════════════════
  // Session Archives — Legal backup (v2)
  // ═══════════════════════════════════════════

  async archiveSession(archive: Omit<ConversationArchive, 'id' | 'archivedAt'>): Promise<string> {
    // v2: write to session_archives (maps ConversationArchive fields to v2 schema)
    const channel = archive.channelIdentifier ?? archive.channelType ?? 'unknown'
    const result = await this.pool.query(
      `INSERT INTO session_archives (session_id, contact_id, channel, started_at, closed_at, message_count, messages_json, attachments_meta)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NULL)
       RETURNING id`,
      [
        archive.sessionId,
        archive.contactId,
        channel,
        archive.interactionStartedAt,
        archive.interactionClosedAt,
        archive.messageCount,
        JSON.stringify(archive.messages),
      ],
    )
    return result.rows[0]!.id as string
  }

  // ═══════════════════════════════════════════
  // Pipeline Logs — Observability
  // ═══════════════════════════════════════════

  async savePipelineLog(entry: PipelineLogEntry): Promise<void> {
    try {
      await this.pool.query(
        `INSERT INTO pipeline_logs (
          message_id, contact_id, session_id, phase1_ms,
          phase2_ms, phase2_result, phase3_ms, phase3_result,
          phase4_ms, phase5_ms, total_ms,
          tokens_input, tokens_output, estimated_cost,
          models_used, tools_called, had_subagent, had_fallback, error,
          replan_attempts, subagent_iterations
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
        [
          entry.messageId ?? null, entry.contactId ?? null, entry.sessionId ?? null, entry.intakeMs ?? null,
          entry.phase2Ms ?? null,
          entry.phase2Result ? JSON.stringify(entry.phase2Result) : null,
          entry.phase3Ms ?? null,
          entry.phase3Result ? JSON.stringify(entry.phase3Result) : null,
          entry.phase4Ms ?? null, entry.deliveryMs ?? null, entry.totalMs ?? null,
          entry.tokensInput ?? null, entry.tokensOutput ?? null, entry.estimatedCost ?? null,
          entry.modelsUsed ?? null, entry.toolsCalled ?? null,
          entry.hadSubagent ?? false, entry.hadFallback ?? false,
          entry.error ?? null,
          entry.replanAttempts ?? 0, entry.subagentIterations ?? 0,
        ],
      )
    } catch (err) {
      logger.warn({ err }, 'Failed to save pipeline log')
    }
  }

  // ═══════════════════════════════════════════
  // Agent resolution helper
  // ═══════════════════════════════════════════

  // ═══════════════════════════════════════════
  // Batch operations (for nightly jobs)
  // ═══════════════════════════════════════════

  async getSessionsForCompression(threshold: number, limit: number = 20): Promise<Array<{
    sessionId: string
    contactId: string
    channelIdentifier: string | null
    messageCount: number
    startedAt: Date
    lastMessageAt: Date
  }>> {
    try {
      const result = await this.pool.query(
        `SELECT s.id AS session_id, s.contact_id,
                COALESCE(s.channel_identifier, s.channel_contact_id) AS channel_identifier,
                s.message_count,
                s.started_at,
                COALESCE(s.last_message_at, s.last_activity_at) AS last_message_at
         FROM sessions s
         WHERE s.message_count >= $1
           AND COALESCE(s.status, 'active') = 'active'
           AND s.contact_id IS NOT NULL
           AND NOT EXISTS (
             SELECT 1 FROM session_summaries_v2 ss WHERE ss.session_id = s.id
           )
         ORDER BY s.last_activity_at ASC
         LIMIT $2`,
        [threshold, limit],
      )
      return result.rows.map((row: DbRow) => ({
        sessionId: row.session_id,
        contactId: row.contact_id,
        channelIdentifier: row.channel_identifier,
        messageCount: row.message_count,
        startedAt: row.started_at,
        lastMessageAt: row.last_message_at,
      }))
    } catch (err) {
      logger.warn({ err }, 'Failed to get sessions for compression')
      return []
    }
  }

  async markSessionCompressed(sessionId: string): Promise<void> {
    try {
      await this.pool.query(
        `UPDATE sessions SET status = 'compressed', compressed_at = now() WHERE id = $1`,
        [sessionId],
      )
    } catch (err) {
      logger.warn({ err, sessionId }, 'Failed to mark session as compressed')
    }
  }

  async deleteSessionHotMessages(sessionId: string, keepRecent: number): Promise<number> {
    try {
      const result = await this.pool.query(
        `DELETE FROM messages
         WHERE session_id = $1
           AND id NOT IN (
             SELECT id FROM messages WHERE session_id = $1 ORDER BY created_at DESC LIMIT $2
           )`,
        [sessionId, keepRecent],
      )
      return result.rowCount ?? 0
    } catch (err) {
      logger.warn({ err, sessionId }, 'Failed to delete hot messages')
      return 0
    }
  }

  async purgeOldPipelineLogs(retentionDays: number): Promise<number> {
    try {
      const result = await this.pool.query(
        `DELETE FROM pipeline_logs WHERE created_at < now() - interval '1 day' * $1`,
        [retentionDays],
      )
      return result.rowCount ?? 0
    } catch (err) {
      logger.warn({ err }, 'Failed to purge pipeline logs')
      return 0
    }
  }

  async purgeOldArchives(retentionYears: number): Promise<number> {
    try {
      // v2: purge from session_archives
      const result = await this.pool.query(
        `DELETE FROM session_archives WHERE created_at < now() - interval '1 year' * $1`,
        [retentionYears],
      )
      return result.rowCount ?? 0
    } catch (err) {
      logger.warn({ err }, 'Failed to purge old archives')
      return 0
    }
  }

  // ═══════════════════════════════════════════
  // Row mappers (private)
  // ═══════════════════════════════════════════

  private mapAgentContactRow(row: Record<string, unknown>): AgentContact {
    return {
      id: row.id as string,
      contactId: row.contact_id as string,
      leadStatus: row.lead_status as AgentContact['leadStatus'],
      qualificationData: (row.qualification_data ?? {}) as Record<string, unknown>,
      qualificationScore: parseFloat(String(row.qualification_score ?? 0)),
      agentData: (row.agent_data ?? {}) as Record<string, unknown>,
      assignedTo: row.assigned_to as string | null,
      assignedAt: row.assigned_at ? new Date(row.assigned_at as string) : null,
      followUpCount: (row.follow_up_count as number) ?? 0,
      lastFollowUpAt: row.last_follow_up_at ? new Date(row.last_follow_up_at as string) : null,
      nextFollowUpAt: row.next_follow_up_at ? new Date(row.next_follow_up_at as string) : null,
      sourceCampaign: row.source_campaign as string | null,
      sourceChannel: row.source_channel as string | null,
      contactMemory: (row.contact_memory ?? {
        summary: '', key_facts: [], preferences: {}, important_dates: [], relationship_notes: '',
      }) as ContactMemory,
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
    }
  }

  private mapSessionSummaryRow(row: Record<string, unknown>): SessionSummary {
    return {
      id: row.id as string,
      sessionId: row.session_id as string,
      contactId: row.contact_id as string,
      channelIdentifier: row.channel_identifier as string | null,
      summaryText: row.summary_text as string,
      summaryLanguage: row.summary_language as string,
      keyFacts: (row.key_facts ?? []) as KeyFact[],
      structuredData: (row.structured_data ?? {}) as Record<string, unknown>,
      originalMessageCount: row.original_message_count as number,
      modelUsed: row.model_used as string,
      compressionTokens: row.compression_tokens as number | null,
      interactionStartedAt: new Date(row.interaction_started_at as string),
      interactionClosedAt: new Date(row.interaction_closed_at as string),
      mergedToMemoryAt: row.merged_to_memory_at ? new Date(row.merged_to_memory_at as string) : null,
      createdAt: new Date(row.created_at as string),
    }
  }

  private mapCommitmentRow(row: Record<string, unknown>): Commitment {
    return {
      id: row.id as string,
      contactId: row.contact_id as string,
      sessionId: row.session_id as string | null,
      commitmentBy: row.commitment_by as 'agent' | 'contact',
      description: row.description as string,
      category: row.category as string | null,
      priority: row.priority as Commitment['priority'],
      commitmentType: row.commitment_type as Commitment['commitmentType'],
      dueAt: row.due_at ? new Date(row.due_at as string) : null,
      scheduledAt: row.scheduled_at ? new Date(row.scheduled_at as string) : null,
      eventStartsAt: row.event_starts_at ? new Date(row.event_starts_at as string) : null,
      eventEndsAt: row.event_ends_at ? new Date(row.event_ends_at as string) : null,
      externalId: row.external_id as string | null,
      externalProvider: row.external_provider as string | null,
      assignedTo: row.assigned_to as string | null,
      status: row.status as Commitment['status'],
      attemptCount: (row.attempt_count as number) ?? 0,
      lastAttemptAt: row.last_attempt_at ? new Date(row.last_attempt_at as string) : null,
      nextCheckAt: row.next_check_at ? new Date(row.next_check_at as string) : null,
      blockedReason: row.blocked_reason as string | null,
      waitType: row.wait_type as string | null,
      actionTaken: row.action_taken as string | null,
      parentId: row.parent_id as string | null,
      sortOrder: (row.sort_order as number) ?? 0,
      watchMetadata: row.watch_metadata as Record<string, unknown> | null,
      reminderSent: (row.reminder_sent as boolean) ?? false,
      requiresTool: (row.requires_tool as string | null) ?? null,
      autoCancelAt: row.auto_cancel_at ? new Date(row.auto_cancel_at as string) : null,
      createdVia: (row.created_via as 'tool' | 'auto_detect' | null) ?? null,
      contextSummary: (row.context_summary as string | null) ?? null,
      metadata: (row.metadata ?? {}) as Record<string, unknown>,
      createdAt: new Date(row.created_at as string),
      updatedAt: new Date(row.updated_at as string),
      completedAt: row.completed_at ? new Date(row.completed_at as string) : null,
    }
  }

  private langToDict(lang: string): string {
    const map: Record<string, string> = {
      es: 'spanish', en: 'english', pt: 'portuguese',
      fr: 'french', de: 'german', it: 'italian',
    }
    return map[lang] ?? 'simple'
  }
}
