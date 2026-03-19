// LUNA — PostgreSQL persistent store for memory v3
// Handles hot (messages), warm (session_summaries), cold (contact_memory) tiers,
// plus commitments, archives, and pipeline logs.

import type { Pool } from 'pg'
import pino from 'pino'
import type {
  StoredMessage,
  SessionSummary,
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

// ═══════════════════════════════════════════
// Table creation (for backwards compat with existing ensureTable call)
// ═══════════════════════════════════════════

const CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY,
  session_id TEXT NOT NULL,
  channel_name TEXT NOT NULL,
  sender_type TEXT NOT NULL,
  sender_id TEXT NOT NULL,
  content JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, created_at);
`

export class PgStore {
  constructor(private pool: Pool) {}

  async ensureTable(): Promise<void> {
    const client = await this.pool.connect()
    try {
      await client.query(CREATE_TABLE_SQL)
      logger.info('PostgreSQL messages table ensured')
    } finally {
      client.release()
    }
  }

  // ═══════════════════════════════════════════
  // Messages — Hot tier (dual-write old + new columns)
  // ═══════════════════════════════════════════

  async saveMessage(message: StoredMessage): Promise<void> {
    try {
      await this.pool.query(
        `INSERT INTO messages (
          id, session_id, channel_name, sender_type, sender_id, content, created_at,
          agent_id, role, content_text, content_type,
          media_path, media_mime, media_analysis,
          intent, emotion, tokens_used, latency_ms, model_used, token_count, metadata
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
        ON CONFLICT (id) DO NOTHING`,
        [
          message.id,
          message.sessionId,
          message.channelName,
          message.senderType,
          message.senderId,
          JSON.stringify(message.content),
          message.createdAt,
          message.agentId,
          message.role,
          message.contentText,
          message.contentType ?? 'text',
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
      `SELECT id, session_id, channel_name, sender_type, sender_id, content, created_at,
              agent_id, role, content_text, content_type,
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
      agentId: row.agent_id ?? '',
      channelName: row.channel_name,
      senderType: row.sender_type,
      senderId: row.sender_id,
      content: row.content,
      role: row.role ?? (row.sender_type === 'agent' ? 'assistant' : 'user'),
      contentText: row.content_text ?? row.content?.text ?? '',
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

  async getAgentContact(agentId: string, contactId: string): Promise<AgentContact | null> {
    try {
      const result = await this.pool.query(
        `SELECT id, agent_id, contact_id, lead_status, qualification_data, qualification_score,
                agent_data, assigned_to, assigned_at, follow_up_count, last_follow_up_at,
                next_follow_up_at, source_campaign, source_channel, contact_memory,
                created_at, updated_at
         FROM agent_contacts
         WHERE agent_id = $1 AND contact_id = $2`,
        [agentId, contactId],
      )
      if (result.rows.length === 0) return null
      return this.mapAgentContactRow(result.rows[0]!)
    } catch (err) {
      logger.warn({ err, agentId, contactId }, 'Failed to get agent_contact')
      return null
    }
  }

  async ensureAgentContact(agentId: string, contactId: string): Promise<AgentContact> {
    try {
      await this.pool.query(
        `INSERT INTO agent_contacts (agent_id, contact_id)
         VALUES ($1, $2)
         ON CONFLICT (agent_id, contact_id) DO NOTHING`,
        [agentId, contactId],
      )
    } catch (err) {
      logger.warn({ err, agentId, contactId }, 'Failed to ensure agent_contact')
    }
    const ac = await this.getAgentContact(agentId, contactId)
    if (!ac) {
      // Fallback in-memory default
      return {
        id: '',
        agentId,
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

  async updateContactMemory(agentId: string, contactId: string, memory: ContactMemory): Promise<void> {
    try {
      await this.pool.query(
        `UPDATE agent_contacts
         SET contact_memory = $1
         WHERE agent_id = $2 AND contact_id = $3`,
        [JSON.stringify(memory), agentId, contactId],
      )
    } catch (err) {
      logger.error({ err, agentId, contactId }, 'Failed to update contact_memory')
    }
  }

  async updateLeadStatus(
    agentId: string,
    contactId: string,
    status: string,
    qualificationData?: Record<string, unknown>,
    qualificationScore?: number,
  ): Promise<void> {
    try {
      const setClauses = ['lead_status = $3']
      const params: unknown[] = [agentId, contactId, status]
      let idx = 4

      if (qualificationData !== undefined) {
        setClauses.push(`qualification_data = $${idx++}`)
        params.push(JSON.stringify(qualificationData))
      }
      if (qualificationScore !== undefined) {
        setClauses.push(`qualification_score = $${idx++}`)
        params.push(qualificationScore)
      }

      await this.pool.query(
        `UPDATE agent_contacts SET ${setClauses.join(', ')} WHERE agent_id = $1 AND contact_id = $2`,
        params,
      )
    } catch (err) {
      logger.error({ err, agentId, contactId, status }, 'Failed to update lead status')
    }
  }

  // ═══════════════════════════════════════════
  // Session Summaries — Warm tier
  // ═══════════════════════════════════════════

  async saveSessionSummary(summary: Omit<SessionSummary, 'id' | 'createdAt' | 'mergedToMemoryAt'>): Promise<string> {
    const result = await this.pool.query(
      `INSERT INTO session_summaries (
        session_id, agent_id, contact_id, channel_identifier,
        summary_text, summary_language, key_facts, structured_data,
        original_message_count, model_used, compression_tokens,
        interaction_started_at, interaction_closed_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING id`,
      [
        summary.sessionId,
        summary.agentId,
        summary.contactId,
        summary.channelIdentifier ?? null,
        summary.summaryText,
        summary.summaryLanguage,
        JSON.stringify(summary.keyFacts),
        JSON.stringify(summary.structuredData),
        summary.originalMessageCount,
        summary.modelUsed,
        summary.compressionTokens ?? null,
        summary.interactionStartedAt,
        summary.interactionClosedAt,
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
    const pgDict = this.langToDict(language)
    try {
      const result = await this.pool.query(
        `SELECT id, session_id, summary_text, key_facts,
                ts_rank(search_vector, plainto_tsquery($3, $2)) AS rank,
                interaction_started_at
         FROM session_summaries
         WHERE contact_id = $1
           AND search_vector @@ plainto_tsquery($3, $2)
         ORDER BY rank DESC
         LIMIT $4`,
        [contactId, query, pgDict, limit],
      )
      return result.rows.map((row: DbRow) => ({
        summaryId: row.id,
        sessionId: row.session_id,
        summaryText: row.summary_text,
        keyFacts: row.key_facts ?? [],
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
    try {
      const result = await this.pool.query(
        `SELECT id, session_id, summary_text, key_facts,
                1 - (embedding <=> $2::vector) AS similarity,
                interaction_started_at
         FROM session_summaries
         WHERE contact_id = $1 AND embedding IS NOT NULL
         ORDER BY embedding <=> $2::vector
         LIMIT $3`,
        [contactId, `[${embedding.join(',')}]`, limit],
      )
      return result.rows.map((row: DbRow) => ({
        summaryId: row.id,
        sessionId: row.session_id,
        summaryText: row.summary_text,
        keyFacts: row.key_facts ?? [],
        score: parseFloat(row.similarity),
        matchType: 'vector' as const,
        interactionStartedAt: row.interaction_started_at,
      }))
    } catch (err) {
      logger.warn({ err, contactId }, 'Vector search failed')
      return []
    }
  }

  async getRecentSummaries(contactId: string, limit: number = 3): Promise<HybridSearchResult[]> {
    try {
      const result = await this.pool.query(
        `SELECT id, session_id, summary_text, key_facts, interaction_started_at
         FROM session_summaries
         WHERE contact_id = $1
         ORDER BY interaction_started_at DESC
         LIMIT $2`,
        [contactId, limit],
      )
      return result.rows.map((row: DbRow, idx: number) => ({
        summaryId: row.id,
        sessionId: row.session_id,
        summaryText: row.summary_text,
        keyFacts: row.key_facts ?? [],
        score: 1.0 - idx * 0.1,
        matchType: 'recency' as const,
        interactionStartedAt: row.interaction_started_at,
      }))
    } catch (err) {
      logger.warn({ err, contactId }, 'Recent summaries query failed')
      return []
    }
  }

  async getUnmergedSummaries(agentId: string, contactId: string): Promise<SessionSummary[]> {
    try {
      const result = await this.pool.query(
        `SELECT *
         FROM session_summaries
         WHERE agent_id = $1 AND contact_id = $2 AND merged_to_memory_at IS NULL
         ORDER BY interaction_started_at ASC`,
        [agentId, contactId],
      )
      return result.rows.map((row: DbRow) => this.mapSessionSummaryRow(row))
    } catch (err) {
      logger.warn({ err, agentId, contactId }, 'Failed to get unmerged summaries')
      return []
    }
  }

  async markSummariesMerged(summaryIds: string[]): Promise<void> {
    if (summaryIds.length === 0) return
    try {
      await this.pool.query(
        `UPDATE session_summaries SET merged_to_memory_at = now() WHERE id = ANY($1)`,
        [summaryIds],
      )
    } catch (err) {
      logger.warn({ err, count: summaryIds.length }, 'Failed to mark summaries as merged')
    }
  }

  async updateSummaryEmbedding(summaryId: string, embedding: number[]): Promise<void> {
    try {
      await this.pool.query(
        `UPDATE session_summaries SET embedding = $2::vector WHERE id = $1`,
        [summaryId, `[${embedding.join(',')}]`],
      )
    } catch (err) {
      logger.warn({ err, summaryId }, 'Failed to update embedding')
    }
  }

  async getSummariesWithoutEmbeddings(limit: number = 50): Promise<Array<{ id: string; summaryText: string }>> {
    try {
      const result = await this.pool.query(
        `SELECT id, summary_text FROM session_summaries WHERE embedding IS NULL ORDER BY created_at ASC LIMIT $1`,
        [limit],
      )
      return result.rows.map((row: DbRow) => ({ id: row.id, summaryText: row.summary_text }))
    } catch (err) {
      logger.warn({ err }, 'Failed to get summaries without embeddings')
      return []
    }
  }

  // ═══════════════════════════════════════════
  // Commitments
  // ═══════════════════════════════════════════

  async saveCommitment(commitment: Omit<Commitment, 'id' | 'createdAt' | 'updatedAt' | 'completedAt'>): Promise<string> {
    const result = await this.pool.query(
      `INSERT INTO commitments (
        agent_id, contact_id, session_id, commitment_by, description, category,
        priority, commitment_type, due_at, scheduled_at, event_starts_at, event_ends_at,
        external_id, external_provider, assigned_to, status, parent_id, sort_order, metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
      RETURNING id`,
      [
        commitment.agentId, commitment.contactId, commitment.sessionId ?? null,
        commitment.commitmentBy, commitment.description, commitment.category ?? null,
        commitment.priority, commitment.commitmentType,
        commitment.dueAt ?? null, commitment.scheduledAt ?? null,
        commitment.eventStartsAt ?? null, commitment.eventEndsAt ?? null,
        commitment.externalId ?? null, commitment.externalProvider ?? null,
        commitment.assignedTo ?? null, commitment.status,
        commitment.parentId ?? null, commitment.sortOrder ?? 0,
        JSON.stringify(commitment.metadata ?? {}),
      ],
    )
    return result.rows[0]!.id as string
  }

  async getPendingCommitments(agentId: string, contactId: string): Promise<Commitment[]> {
    try {
      const result = await this.pool.query(
        `SELECT * FROM commitments
         WHERE agent_id = $1 AND contact_id = $2
           AND status IN ('pending', 'in_progress', 'waiting')
         ORDER BY CASE priority
           WHEN 'urgent' THEN 0
           WHEN 'high' THEN 1
           WHEN 'normal' THEN 2
           WHEN 'low' THEN 3
         END, due_at ASC NULLS LAST`,
        [agentId, contactId],
      )
      return result.rows.map((row: DbRow) => this.mapCommitmentRow(row))
    } catch (err) {
      logger.warn({ err, agentId, contactId }, 'Failed to get pending commitments')
      return []
    }
  }

  async getRecentCompletedCommitments(agentId: string, contactId: string, limit = 5): Promise<Commitment[]> {
    try {
      const result = await this.pool.query(
        `SELECT * FROM commitments
         WHERE agent_id = $1 AND contact_id = $2 AND status = 'done'
         ORDER BY completed_at DESC
         LIMIT $3`,
        [agentId, contactId, limit],
      )
      return result.rows.map((row: DbRow) => this.mapCommitmentRow(row))
    } catch (err) {
      logger.warn({ err, agentId, contactId }, 'Failed to get completed commitments')
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

  async getOverdueCommitments(agentId: string): Promise<Commitment[]> {
    try {
      const result = await this.pool.query(
        `SELECT * FROM commitments
         WHERE agent_id = $1
           AND status IN ('pending', 'in_progress')
           AND due_at IS NOT NULL AND due_at < now()
         ORDER BY due_at ASC`,
        [agentId],
      )
      return result.rows.map((row: DbRow) => this.mapCommitmentRow(row))
    } catch (err) {
      logger.warn({ err, agentId }, 'Failed to get overdue commitments')
      return []
    }
  }

  async getCrossAgentCommitments(contactId: string, excludeAgentId: string): Promise<Commitment[]> {
    try {
      const result = await this.pool.query(
        `SELECT * FROM commitments
         WHERE contact_id = $1 AND agent_id != $2
           AND status IN ('pending', 'in_progress', 'waiting')
         ORDER BY due_at ASC NULLS LAST`,
        [contactId, excludeAgentId],
      )
      return result.rows.map((row: DbRow) => this.mapCommitmentRow(row))
    } catch (err) {
      logger.warn({ err, contactId }, 'Failed to get cross-agent commitments')
      return []
    }
  }

  // ═══════════════════════════════════════════
  // Conversation Archives — Legal backup
  // ═══════════════════════════════════════════

  async archiveSession(archive: Omit<ConversationArchive, 'id' | 'archivedAt'>): Promise<string> {
    const result = await this.pool.query(
      `INSERT INTO conversation_archives (
        session_id, contact_id, agent_id, channel_identifier, channel_type,
        contact_snapshot, messages, message_count,
        interaction_started_at, interaction_closed_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING id`,
      [
        archive.sessionId, archive.contactId, archive.agentId,
        archive.channelIdentifier ?? null, archive.channelType ?? null,
        JSON.stringify(archive.contactSnapshot), JSON.stringify(archive.messages),
        archive.messageCount,
        archive.interactionStartedAt, archive.interactionClosedAt,
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
          message_id, agent_id, contact_id, session_id,
          phase1_ms, phase2_ms, phase2_result, phase3_ms, phase3_result,
          phase4_ms, phase5_ms, total_ms,
          tokens_input, tokens_output, estimated_cost,
          models_used, tools_called, had_subagent, had_fallback, error
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
        [
          entry.messageId ?? null, entry.agentId, entry.contactId, entry.sessionId ?? null,
          entry.phase1Ms ?? null, entry.phase2Ms ?? null,
          entry.phase2Result ? JSON.stringify(entry.phase2Result) : null,
          entry.phase3Ms ?? null,
          entry.phase3Result ? JSON.stringify(entry.phase3Result) : null,
          entry.phase4Ms ?? null, entry.phase5Ms ?? null, entry.totalMs ?? null,
          entry.tokensInput ?? null, entry.tokensOutput ?? null, entry.estimatedCost ?? null,
          entry.modelsUsed ?? null, entry.toolsCalled ?? null,
          entry.hadSubagent ?? false, entry.hadFallback ?? false,
          entry.error ?? null,
        ],
      )
    } catch (err) {
      logger.warn({ err }, 'Failed to save pipeline log')
    }
  }

  // ═══════════════════════════════════════════
  // Agent resolution helper
  // ═══════════════════════════════════════════

  async resolveAgentId(slug: string): Promise<string | null> {
    try {
      const result = await this.pool.query(
        `SELECT id FROM agents WHERE slug = $1 AND status = 'active' LIMIT 1`,
        [slug],
      )
      return result.rows[0]?.id ?? null
    } catch (err) {
      logger.warn({ err, slug }, 'Failed to resolve agent ID')
      return null
    }
  }

  // ═══════════════════════════════════════════
  // Batch operations (for nightly jobs)
  // ═══════════════════════════════════════════

  async getSessionsForCompression(agentId: string, threshold: number, limit: number = 20): Promise<Array<{
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
         WHERE s.agent_id = $1
           AND s.message_count >= $2
           AND COALESCE(s.status, 'active') = 'active'
           AND s.contact_id IS NOT NULL
           AND NOT EXISTS (
             SELECT 1 FROM session_summaries ss WHERE ss.session_id = s.id
           )
         ORDER BY s.last_activity_at ASC
         LIMIT $3`,
        [agentId, threshold, limit],
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
      logger.warn({ err, agentId }, 'Failed to get sessions for compression')
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
      const result = await this.pool.query(
        `DELETE FROM conversation_archives WHERE archived_at < now() - interval '1 year' * $1`,
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
      agentId: row.agent_id as string,
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
      agentId: row.agent_id as string,
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
      agentId: row.agent_id as string,
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
