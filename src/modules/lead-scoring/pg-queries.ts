// LUNA — Module: lead-scoring — PostgreSQL Queries
// Queries para leads: listar, detalle, actualizar score/status, recalcular batch.
// Qualification data lives in agent_contacts (per-agent), not contacts.

import type { Pool } from 'pg'
import pino from 'pino'
import type { LeadSummary, LeadDetail, QualificationStatus } from './types.js'

// Local types (moved from types.ts — only used by this module)
interface MetricChannelBreakdown { channel: string; count: number }
interface StatusMetric { status: string; total: number; channels: MetricChannelBreakdown[] }

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
      conditions.push(`ac.lead_status = $${paramIdx++}`)
      params.push(status)
    }

    if (search) {
      conditions.push(`(c.display_name ILIKE $${paramIdx} OR ch.channel_identifier ILIKE $${paramIdx})`)
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
      score: 'ac.qualification_score',
      updated: 'ac.updated_at',
      created: 'c.created_at',
    }
    const sortCol = sortMap[sortBy] ?? 'ac.updated_at'
    const dir = sortDir === 'asc' ? 'ASC' : 'DESC'

    // Count total
    const countQuery = `
      SELECT COUNT(DISTINCT c.id) AS total
      FROM contacts c
      JOIN agent_contacts ac ON ac.contact_id = c.id
      LEFT JOIN contact_channels ch ON ch.contact_id = c.id AND ch.is_primary = true
      ${whereClause}
    `
    const countResult = await this.db.query(countQuery, params)
    const total = parseInt(countResult.rows[0]?.total ?? '0', 10)

    // Fetch leads with latest campaign
    const dataQuery = `
      SELECT
        c.id AS contact_id,
        c.display_name,
        COALESCE(ch.channel_identifier, '') AS channel_identifier,
        COALESCE(ch.channel_type, '') AS channel,
        c.contact_type,
        ac.lead_status AS qualification_status,
        COALESCE(ac.qualification_score, 0) AS qualification_score,
        COALESCE(ac.qualification_data, '{}') AS qualification_data,
        c.created_at,
        ac.updated_at,
        sa.last_activity_at,
        COALESCE(sa.message_count, 0) AS message_count,
        lc.campaign_id AS latest_campaign_id,
        lc.campaign_name AS latest_campaign_name,
        lc.campaign_visible_id AS latest_campaign_visible_id
      FROM contacts c
      JOIN agent_contacts ac ON ac.contact_id = c.id
      LEFT JOIN contact_channels ch ON ch.contact_id = c.id AND ch.is_primary = true
      LEFT JOIN (
        SELECT contact_id,
               MAX(last_activity_at) AS last_activity_at,
               COALESCE(SUM(message_count), 0)::int AS message_count
        FROM sessions
        GROUP BY contact_id
      ) sa ON sa.contact_id = c.id
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
      channelContactId: r.channel_identifier,
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
    // Query 1: Contact + agent_contacts + session aggregates + latest campaign
    // Query 2: Channels
    // Query 3: Recent messages
    const [contactResult, channelsResult, messagesResult] = await Promise.all([
      this.db.query(
        `SELECT
          c.id AS contact_id,
          c.display_name,
          c.contact_type,
          ac.lead_status AS qualification_status,
          COALESCE(ac.qualification_score, 0) AS qualification_score,
          COALESCE(ac.qualification_data, '{}') AS qualification_data,
          c.created_at,
          ac.updated_at,
          sa.last_activity_at,
          COALESCE(sa.message_count, 0) AS message_count,
          lc.campaign_id AS latest_campaign_id,
          lc.campaign_name AS latest_campaign_name,
          lc.campaign_visible_id AS latest_campaign_visible_id
        FROM contacts c
        LEFT JOIN agent_contacts ac ON ac.contact_id = c.id
        LEFT JOIN (
          SELECT contact_id,
                 MAX(last_activity_at) AS last_activity_at,
                 COALESCE(SUM(message_count), 0)::int AS message_count
          FROM sessions
          WHERE contact_id = $1
          GROUP BY contact_id
        ) sa ON sa.contact_id = c.id
        LEFT JOIN LATERAL (
          SELECT xcc.campaign_id, xc.name AS campaign_name, xc.visible_id AS campaign_visible_id
          FROM contact_campaigns xcc
          JOIN campaigns xc ON xc.id = xcc.campaign_id
          WHERE xcc.contact_id = c.id
          ORDER BY xcc.matched_at DESC
          LIMIT 1
        ) lc ON true
        WHERE c.id = $1`,
        [contactId],
      ),
      this.db.query(
        `SELECT channel_type, channel_identifier, is_primary
         FROM contact_channels
         WHERE contact_id = $1
         ORDER BY is_primary DESC`,
        [contactId],
      ),
      this.db.query(
        `SELECT m.id, m.role, m.content_text, m.created_at
         FROM messages m
         JOIN sessions s ON s.id = m.session_id
         WHERE s.contact_id = $1
         ORDER BY m.created_at DESC
         LIMIT 30`,
        [contactId],
      ),
    ])

    if (contactResult.rows.length === 0) return null
    const r = contactResult.rows[0]

    const primaryChannel = channelsResult.rows.find((ch: { is_primary: boolean }) => ch.is_primary)
    const lcRow = r as { latest_campaign_id: string | null; latest_campaign_name: string | null; latest_campaign_visible_id: number | null }

    return {
      contactId: r.contact_id,
      displayName: r.display_name,
      channelContactId: primaryChannel?.channel_identifier ?? '',
      channel: primaryChannel?.channel_type ?? '',
      contactType: r.contact_type,
      qualificationStatus: r.qualification_status ?? 'new',
      qualificationScore: parseInt(r.qualification_score ?? '0', 10),
      qualificationData: typeof r.qualification_data === 'string'
        ? JSON.parse(r.qualification_data)
        : (r.qualification_data ?? {}),
      createdAt: r.created_at?.toISOString() ?? '',
      updatedAt: r.updated_at?.toISOString() ?? '',
      lastActivityAt: r.last_activity_at?.toISOString() ?? null,
      messageCount: parseInt(r.message_count ?? '0', 10),
      latestCampaignId: lcRow.latest_campaign_id ?? null,
      latestCampaignName: lcRow.latest_campaign_name ?? null,
      latestCampaignVisibleId: lcRow.latest_campaign_visible_id ?? null,
      channels: channelsResult.rows.map((ch: { channel_type: string; channel_identifier: string; is_primary: boolean }) => ({
        channel: ch.channel_type,
        channelContactId: ch.channel_identifier,
        isPrimary: ch.is_primary,
      })),
      recentMessages: messagesResult.rows.map((m: { id: string; role: string; content_text: string; created_at: Date }) => ({
        id: m.id,
        senderType: m.role === 'assistant' ? 'agent' : 'user',
        content: { type: 'text', text: m.content_text ?? '' },
        createdAt: m.created_at?.toISOString() ?? '',
      })).reverse(), // chronological order
    }
  }

  /**
   * Update qualification data and score for a contact (writes to agent_contacts).
   */
  async updateQualification(
    contactId: string,
    data: Record<string, unknown>,
    score: number,
    status?: QualificationStatus,
  ): Promise<void> {
    const setClauses = ['qualification_data = $1', 'qualification_score = $2']
    const params: unknown[] = [JSON.stringify(data), score]
    let idx = 3

    if (status !== undefined) {
      setClauses.push(`lead_status = $${idx++}`)
      params.push(status)
    }

    params.push(contactId)
    await this.db.query(
      `UPDATE agent_contacts
       SET ${setClauses.join(', ')}, updated_at = NOW()
       WHERE contact_id = $${idx}`,
      params,
    )
  }

  /**
   * Get all leads that need recalculation (for batch recalc on config change).
   * Uses internal pagination to avoid loading all leads at once. Safety cap: 10000.
   */
  async getAllLeadsForRecalc(): Promise<Array<{
    contactId: string
    qualificationData: Record<string, unknown>
    qualificationStatus: QualificationStatus
  }>> {
    const allLeads: Array<{
      contactId: string
      qualificationData: Record<string, unknown>
      qualificationStatus: QualificationStatus
    }> = []
    let offset = 0
    const batchSize = 200

    while (true) {
      const result = await this.db.query(
        `SELECT ac.contact_id,
                COALESCE(ac.qualification_data, '{}') AS qualification_data,
                ac.lead_status AS qualification_status
         FROM agent_contacts ac
         JOIN contacts c ON c.id = ac.contact_id
         WHERE c.contact_type = 'lead'
           AND ac.lead_status NOT IN ('blocked', 'converted')
         ORDER BY ac.contact_id
         LIMIT $1 OFFSET $2`,
        [batchSize, offset],
      )

      if (result.rows.length === 0) break

      allLeads.push(...result.rows.map((r: { contact_id: string; qualification_data: unknown; qualification_status: string }) => ({
        contactId: r.contact_id,
        qualificationData: typeof r.qualification_data === 'string'
          ? JSON.parse(r.qualification_data)
          : r.qualification_data as Record<string, unknown>,
        qualificationStatus: r.qualification_status as QualificationStatus,
      })))

      offset += batchSize
      if (allLeads.length >= 10000) break // safety cap
    }

    return allLeads
  }

  /**
   * Batch update scores (used after config change recalculation).
   */
  async batchUpdateScores(
    updates: Array<{ contactId: string; score: number; status: QualificationStatus | null }>,
  ): Promise<number> {
    let updated = 0
    const client = await this.db.connect()
    try {
      await client.query('BEGIN')
      for (const u of updates) {
        await client.query(
          `UPDATE agent_contacts
           SET qualification_score = $1,
               lead_status = COALESCE($2, lead_status),
               updated_at = NOW()
           WHERE contact_id = $3`,
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
      `SELECT ac.lead_status, COUNT(*) AS count
       FROM agent_contacts ac
       JOIN contacts c ON c.id = ac.contact_id
       WHERE c.contact_type = 'lead'
       GROUP BY ac.lead_status`,
    )

    const stats: Record<string, number> = { total: 0 }
    for (const row of result.rows) {
      const count = parseInt(row.count, 10)
      stats[row.lead_status ?? 'new'] = count
      stats['total'] = (stats['total'] ?? 0) + count
    }
    return stats
  }

  /**
   * Get detailed stats with channel breakdown and optional filters.
   */
  async getStatsDetailed(opts: {
    period?: 'today' | '7d' | '30d' | '90d' | 'all'
    channels?: string[]
    qualification?: QualificationStatus
  } = {}): Promise<StatusMetric[]> {
    const { period = 'all', channels, qualification } = opts

    const conditions: string[] = [
      "c.contact_type = 'lead'",
    ]
    const params: unknown[] = []
    let paramIdx = 1

    if (period !== 'all') {
      const intervalMap: Record<string, string> = {
        today: '1 day',
        '7d': '7 days',
        '30d': '30 days',
        '90d': '90 days',
      }
      const interval = intervalMap[period]
      if (interval) {
        conditions.push(`ac.updated_at >= NOW() - INTERVAL '${interval}'`)
      }
    }

    if (channels && channels.length > 0) {
      conditions.push(`ch.channel_type IN (${channels.map(() => `$${paramIdx++}`).join(',')})`)
      params.push(...channels)
    }

    if (qualification) {
      conditions.push(`ac.lead_status = $${paramIdx++}`)
      params.push(qualification)
    }

    const targetStatuses = ['attended', 'cold', 'qualifying', 'qualified', 'converted', 'directo']

    const result = await this.db.query(
      `SELECT ac.lead_status AS status, ch.channel_type AS channel, COUNT(DISTINCT c.id) AS count
       FROM contacts c
       JOIN agent_contacts ac ON ac.contact_id = c.id
       LEFT JOIN contact_channels ch ON ch.contact_id = c.id AND ch.is_primary = true
       WHERE ${conditions.join(' AND ')}
         AND ac.lead_status = ANY($${paramIdx})
       GROUP BY ac.lead_status, ch.channel_type
       ORDER BY ac.lead_status, ch.channel_type`,
      [...params, targetStatuses],
    )

    const statusMap = new Map<string, { total: number; channels: Map<string, number> }>()
    for (const s of targetStatuses) {
      statusMap.set(s, { total: 0, channels: new Map() })
    }

    for (const row of result.rows) {
      const entry = statusMap.get(row.status)
      if (!entry) continue
      const count = parseInt(row.count, 10)
      entry.total += count
      const ch = row.channel ?? 'unknown'
      entry.channels.set(ch, (entry.channels.get(ch) ?? 0) + count)
    }

    const metrics: StatusMetric[] = []
    for (const [status, data] of statusMap) {
      metrics.push({
        status,
        total: data.total,
        channels: Array.from(data.channels.entries()).map(([channel, count]) => ({ channel, count })),
      })
    }

    return metrics
  }

  /**
   * Manually set disqualification on a contact.
   */
  async disqualifyLead(
    contactId: string,
    reasonKey: string,
    targetStatus: QualificationStatus,
  ): Promise<void> {
    await this.db.query(
      `UPDATE agent_contacts
       SET qualification_data = COALESCE(qualification_data, '{}'::jsonb) || $1::jsonb,
           lead_status = $2,
           updated_at = NOW()
       WHERE contact_id = $3`,
      [JSON.stringify({ _disqualified: reasonKey }), targetStatus, contactId],
    )
  }
}
