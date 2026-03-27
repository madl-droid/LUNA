// LUNA — Module: lead-scoring — PostgreSQL Queries
// Queries para leads: listar, detalle, actualizar score/status, recalcular batch.

import type { Pool } from 'pg'
import pino from 'pino'
import type { LeadSummary, LeadDetail, QualificationStatus } from './types.js'

const logger = pino({ name: 'lead-scoring:db' })

export class LeadQueries {
  constructor(private db: Pool) {}

  /**
   * List leads with optional filters and pagination.
   */
  async listLeads(opts: {
    status?: QualificationStatus
    search?: string
    campaignId?: string
    limit?: number
    offset?: number
    sortBy?: 'score' | 'updated' | 'created'
    sortDir?: 'asc' | 'desc'
  }): Promise<{ leads: LeadSummary[]; total: number }> {
    const {
      status,
      search,
      campaignId,
      limit = 50,
      offset = 0,
      sortBy = 'updated',
      sortDir = 'desc',
    } = opts

    const conditions: string[] = ["c.contact_type = 'lead'"]
    const params: unknown[] = []
    let paramIdx = 1

    if (status) {
      conditions.push(`c.qualification_status = $${paramIdx++}`)
      params.push(status)
    }

    if (search) {
      conditions.push(`(c.display_name ILIKE $${paramIdx} OR cc.channel_contact_id ILIKE $${paramIdx})`)
      params.push(`%${search}%`)
      paramIdx++
    }

    if (campaignId) {
      conditions.push(`EXISTS (SELECT 1 FROM contact_campaigns xcc WHERE xcc.contact_id = c.id AND xcc.campaign_id = $${paramIdx++})`)
      params.push(campaignId)
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    // Sort mapping
    const sortMap: Record<string, string> = {
      score: 'c.qualification_score',
      updated: 'c.updated_at',
      created: 'c.created_at',
    }
    const sortCol = sortMap[sortBy] ?? 'c.updated_at'
    const dir = sortDir === 'asc' ? 'ASC' : 'DESC'

    // Count total
    const countQuery = `
      SELECT COUNT(DISTINCT c.id) AS total
      FROM contacts c
      LEFT JOIN contact_channels cc ON cc.contact_id = c.id AND cc.is_primary = true
      ${whereClause}
    `
    const countResult = await this.db.query(countQuery, params)
    const total = parseInt(countResult.rows[0]?.total ?? '0', 10)

    // Fetch leads with latest campaign
    const dataQuery = `
      SELECT
        c.id AS contact_id,
        c.display_name,
        COALESCE(cc.channel_contact_id, '') AS channel_contact_id,
        COALESCE(cc.channel_name, '') AS channel,
        c.contact_type,
        c.qualification_status,
        COALESCE(c.qualification_score, 0) AS qualification_score,
        COALESCE(c.qualification_data, '{}') AS qualification_data,
        c.created_at,
        c.updated_at,
        (
          SELECT MAX(s.last_activity_at)
          FROM sessions s
          WHERE s.contact_id = c.id
        ) AS last_activity_at,
        (
          SELECT COALESCE(SUM(s.message_count), 0)
          FROM sessions s
          WHERE s.contact_id = c.id
        ) AS message_count,
        lc.campaign_id AS latest_campaign_id,
        lc.campaign_name AS latest_campaign_name,
        lc.campaign_visible_id AS latest_campaign_visible_id
      FROM contacts c
      LEFT JOIN contact_channels cc ON cc.contact_id = c.id AND cc.is_primary = true
      LEFT JOIN LATERAL (
        SELECT xcc.campaign_id, xc.name AS campaign_name, xc.visible_id AS campaign_visible_id
        FROM contact_campaigns xcc
        JOIN campaigns xc ON xc.id = xcc.campaign_id
        WHERE xcc.contact_id = c.id
        ORDER BY xcc.matched_at DESC
        LIMIT 1
      ) lc ON true
      ${whereClause}
      ORDER BY ${sortCol} ${dir}
      LIMIT $${paramIdx++} OFFSET $${paramIdx++}
    `
    params.push(limit, offset)

    const result = await this.db.query(dataQuery, params)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const leads: LeadSummary[] = result.rows.map((r: any) => ({
      contactId: r.contact_id,
      displayName: r.display_name,
      channelContactId: r.channel_contact_id,
      channel: r.channel,
      contactType: r.contact_type,
      qualificationStatus: r.qualification_status,
      qualificationScore: parseInt(r.qualification_score, 10),
      qualificationData: typeof r.qualification_data === 'string'
        ? JSON.parse(r.qualification_data)
        : r.qualification_data,
      createdAt: r.created_at?.toISOString() ?? '',
      updatedAt: r.updated_at?.toISOString() ?? '',
      lastActivityAt: r.last_activity_at?.toISOString() ?? null,
      messageCount: parseInt(r.message_count, 10),
      latestCampaignId: r.latest_campaign_id ?? null,
      latestCampaignName: r.latest_campaign_name ?? null,
      latestCampaignVisibleId: r.latest_campaign_visible_id != null
        ? parseInt(r.latest_campaign_visible_id, 10)
        : null,
    }))

    return { leads, total }
  }

  /**
   * Get full lead detail including channels and recent messages.
   */
  async getLeadDetail(contactId: string): Promise<LeadDetail | null> {
    // Contact info
    const contactResult = await this.db.query(
      `SELECT
        c.id AS contact_id,
        c.display_name,
        c.contact_type,
        c.qualification_status,
        COALESCE(c.qualification_score, 0) AS qualification_score,
        COALESCE(c.qualification_data, '{}') AS qualification_data,
        c.created_at,
        c.updated_at
      FROM contacts c
      WHERE c.id = $1`,
      [contactId],
    )

    if (contactResult.rows.length === 0) return null
    const r = contactResult.rows[0]

    // Channels
    const channelsResult = await this.db.query(
      `SELECT channel_name, channel_contact_id, is_primary
       FROM contact_channels
       WHERE contact_id = $1
       ORDER BY is_primary DESC`,
      [contactId],
    )

    // Session info
    const sessionResult = await this.db.query(
      `SELECT MAX(last_activity_at) AS last_activity_at,
              COALESCE(SUM(message_count), 0) AS message_count
       FROM sessions
       WHERE contact_id = $1`,
      [contactId],
    )

    // Recent messages (last 30 across sessions)
    const messagesResult = await this.db.query(
      `SELECT m.id, m.sender_type, m.content, m.created_at
       FROM messages m
       JOIN sessions s ON s.id = m.session_id
       WHERE s.contact_id = $1
       ORDER BY m.created_at DESC
       LIMIT 30`,
      [contactId],
    )

    // Latest campaign
    const latestCampaignResult = await this.db.query(
      `SELECT cc.campaign_id, c.name, c.visible_id
       FROM contact_campaigns cc
       JOIN campaigns c ON c.id = cc.campaign_id
       WHERE cc.contact_id = $1
       ORDER BY cc.matched_at DESC LIMIT 1`,
      [contactId],
    ).catch(() => ({ rows: [] }))

    const primaryChannel = channelsResult.rows.find((ch: { is_primary: boolean }) => ch.is_primary)
    const sessionRow = sessionResult.rows[0]
    const lcRow = latestCampaignResult.rows[0] as { campaign_id: string; name: string; visible_id: number } | undefined

    return {
      contactId: r.contact_id,
      displayName: r.display_name,
      channelContactId: primaryChannel?.channel_contact_id ?? '',
      channel: primaryChannel?.channel_name ?? '',
      contactType: r.contact_type,
      qualificationStatus: r.qualification_status,
      qualificationScore: parseInt(r.qualification_score, 10),
      qualificationData: typeof r.qualification_data === 'string'
        ? JSON.parse(r.qualification_data)
        : r.qualification_data,
      createdAt: r.created_at?.toISOString() ?? '',
      updatedAt: r.updated_at?.toISOString() ?? '',
      lastActivityAt: sessionRow?.last_activity_at?.toISOString() ?? null,
      messageCount: parseInt(sessionRow?.message_count ?? '0', 10),
      latestCampaignId: lcRow?.campaign_id ?? null,
      latestCampaignName: lcRow?.name ?? null,
      latestCampaignVisibleId: lcRow?.visible_id ?? null,
      channels: channelsResult.rows.map((ch: { channel_name: string; channel_contact_id: string; is_primary: boolean }) => ({
        channel: ch.channel_name,
        channelContactId: ch.channel_contact_id,
        isPrimary: ch.is_primary,
      })),
      recentMessages: messagesResult.rows.map((m: { id: string; sender_type: string; content: unknown; created_at: Date }) => ({
        id: m.id,
        senderType: m.sender_type,
        content: typeof m.content === 'string' ? JSON.parse(m.content) : m.content,
        createdAt: m.created_at?.toISOString() ?? '',
      })).reverse(), // chronological order
    }
  }

  /**
   * Update qualification data and score for a contact.
   */
  async updateQualification(
    contactId: string,
    data: Record<string, unknown>,
    score: number,
    status?: QualificationStatus,
  ): Promise<void> {
    await this.db.query(
      `UPDATE contacts
       SET qualification_data = $1,
           qualification_score = $2,
           qualification_status = COALESCE($3, qualification_status),
           updated_at = NOW()
       WHERE id = $4`,
      [JSON.stringify(data), score, status ?? null, contactId],
    )
  }

  /**
   * Get all leads that need recalculation (for batch recalc on config change).
   */
  async getAllLeadsForRecalc(): Promise<Array<{
    contactId: string
    qualificationData: Record<string, unknown>
    qualificationStatus: QualificationStatus
  }>> {
    const result = await this.db.query(
      `SELECT id AS contact_id,
              COALESCE(qualification_data, '{}') AS qualification_data,
              qualification_status
       FROM contacts
       WHERE contact_type = 'lead'
         AND qualification_status NOT IN ('blocked', 'converted')`,
    )

    return result.rows.map((r: { contact_id: string; qualification_data: unknown; qualification_status: string }) => ({
      contactId: r.contact_id,
      qualificationData: typeof r.qualification_data === 'string'
        ? JSON.parse(r.qualification_data)
        : r.qualification_data as Record<string, unknown>,
      qualificationStatus: r.qualification_status as QualificationStatus,
    }))
  }

  /**
   * Batch update scores (used after config change recalculation).
   */
  async batchUpdateScores(
    updates: Array<{ contactId: string; score: number; status: QualificationStatus | null }>,
  ): Promise<number> {
    let updated = 0
    // Use a transaction for batch updates
    const client = await this.db.connect()
    try {
      await client.query('BEGIN')
      for (const u of updates) {
        await client.query(
          `UPDATE contacts
           SET qualification_score = $1,
               qualification_status = COALESCE($2, qualification_status),
               updated_at = NOW()
           WHERE id = $3`,
          [u.score, u.status, u.contactId],
        )
        updated++
      }
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK')
      logger.error({ err }, 'Batch score update failed')
      throw err
    } finally {
      client.release()
    }

    logger.info({ count: updated }, 'Batch score recalculation complete')
    return updated
  }

  /**
   * Get stats for the dashboard.
   */
  async getStats(): Promise<Record<string, number>> {
    const result = await this.db.query(
      `SELECT qualification_status, COUNT(*) AS count
       FROM contacts
       WHERE contact_type = 'lead'
       GROUP BY qualification_status`,
    )

    const stats: Record<string, number> = { total: 0 }
    for (const row of result.rows) {
      const count = parseInt(row.count, 10)
      stats[row.qualification_status ?? 'new'] = count
      stats['total'] = (stats['total'] ?? 0) + count
    }
    return stats
  }

  /**
   * Manually set disqualification on a contact.
   */
  // FIX: SEC-8.4 — Atomic update sin read-modify-write via jsonb_set
  async disqualifyLead(
    contactId: string,
    reasonKey: string,
    targetStatus: QualificationStatus,
  ): Promise<void> {
    await this.db.query(
      `UPDATE contacts
       SET qualification_data = COALESCE(qualification_data, '{}'::jsonb) || $1::jsonb,
           qualification_status = $2,
           updated_at = NOW()
       WHERE id = $3`,
      [JSON.stringify({ _disqualified: reasonKey }), targetStatus, contactId],
    )
  }
}
