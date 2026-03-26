// LUNA — Module: lead-scoring — Campaign PostgreSQL Queries
// CRUD para campañas, tags, contact-campaign history, stats.

import type { Pool } from 'pg'
import pino from 'pino'
import type {
  CampaignRecord,
  CampaignTag,
  CampaignMatchResult,
  ContactCampaignEntry,
  CampaignStatRow,
} from './campaign-types.js'

const logger = pino({ name: 'lead-scoring:campaigns-db' })

export class CampaignQueries {
  constructor(private db: Pool) {}

  // ═══════════════════════════════════════════
  // Schema — ensure tables and columns exist
  // ═══════════════════════════════════════════

  async ensureTables(): Promise<void> {
    // Create campaigns table if it doesn't exist (base schema)
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS campaigns (
        id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name            TEXT NOT NULL,
        keyword         TEXT,
        destination_number TEXT,
        utm_data        JSONB DEFAULT '{}',
        active          BOOLEAN DEFAULT true,
        created_at      TIMESTAMPTZ DEFAULT now()
      )
    `)

    // Extend campaigns table with scoring columns
    const alters = [
      `ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS visible_id SERIAL`,
      `ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS match_threshold REAL DEFAULT 0.95`,
      `ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS match_max_rounds INTEGER DEFAULT 1`,
      `ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS allowed_channels TEXT[] DEFAULT '{}'`,
      `ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS prompt_context VARCHAR(200) DEFAULT ''`,
      `ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now()`,
    ]
    for (const sql of alters) {
      await this.db.query(sql).catch(() => {
        // Column may already exist — non-critical
      })
    }

    // Seed default "Sin campaña" (visible_id=0) if it doesn't exist
    await this.db.query(`
      INSERT INTO campaigns (id, name, keyword, active, visible_id)
      VALUES ('00000000-0000-0000-0000-000000000000', 'Sin campaña', NULL, true, 0)
      ON CONFLICT (id) DO NOTHING
    `).catch(() => {})

    // Campaign tags table
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS campaign_tags (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name TEXT NOT NULL,
        tag_type TEXT NOT NULL CHECK (tag_type IN ('platform', 'source')),
        color TEXT NOT NULL DEFAULT '#93c5fd',
        created_at TIMESTAMPTZ DEFAULT now(),
        UNIQUE (name, tag_type)
      )
    `)

    // Campaign ↔ tag join table
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS campaign_tag_assignments (
        campaign_id UUID NOT NULL REFERENCES campaigns(id) ON DELETE CASCADE,
        tag_id UUID NOT NULL REFERENCES campaign_tags(id) ON DELETE CASCADE,
        PRIMARY KEY (campaign_id, tag_id)
      )
    `)

    // Contact ↔ campaign history
    await this.db.query(`
      CREATE TABLE IF NOT EXISTS contact_campaigns (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        contact_id UUID NOT NULL,
        campaign_id UUID NOT NULL REFERENCES campaigns(id),
        session_id UUID,
        channel_name TEXT,
        match_score REAL,
        matched_at TIMESTAMPTZ DEFAULT now(),
        UNIQUE (contact_id, campaign_id, session_id)
      )
    `)

    // Indexes
    await this.db.query(`
      CREATE INDEX IF NOT EXISTS idx_contact_campaigns_contact ON contact_campaigns (contact_id, matched_at DESC)
    `).catch(() => {})
    await this.db.query(`
      CREATE INDEX IF NOT EXISTS idx_contact_campaigns_campaign ON contact_campaigns (campaign_id)
    `).catch(() => {})
    await this.db.query(`
      CREATE INDEX IF NOT EXISTS idx_campaign_tags_type ON campaign_tags (tag_type)
    `).catch(() => {})

    logger.info('Campaign tables ensured')
  }

  // ═══════════════════════════════════════════
  // Campaign CRUD
  // ═══════════════════════════════════════════

  async listActiveCampaigns(): Promise<CampaignRecord[]> {
    return this.listCampaigns(true)
  }

  async listAllCampaigns(): Promise<CampaignRecord[]> {
    return this.listCampaigns(false)
  }

  private async listCampaigns(activeOnly: boolean): Promise<CampaignRecord[]> {
    const where = activeOnly ? 'WHERE c.active = true' : ''
    const result = await this.db.query(`
      SELECT c.id, c.visible_id, c.name, c.keyword,
             COALESCE(c.match_threshold, 0.95) AS match_threshold,
             COALESCE(c.match_max_rounds, 1) AS match_max_rounds,
             COALESCE(c.allowed_channels, '{}') AS allowed_channels,
             COALESCE(c.prompt_context, '') AS prompt_context,
             c.active, COALESCE(c.utm_data, '{}') AS utm_data,
             c.created_at, COALESCE(c.updated_at, c.created_at) AS updated_at
      FROM campaigns c
      ${where}
      ORDER BY c.visible_id ASC
    `)

    const campaigns: CampaignRecord[] = []
    for (const row of result.rows) {
      const tags = await this.getTagsForCampaign(row.id)
      campaigns.push(this.mapCampaignRow(row, tags))
    }
    return campaigns
  }

  async getCampaignById(id: string): Promise<CampaignRecord | null> {
    const result = await this.db.query(`
      SELECT c.id, c.visible_id, c.name, c.keyword,
             COALESCE(c.match_threshold, 0.95) AS match_threshold,
             COALESCE(c.match_max_rounds, 1) AS match_max_rounds,
             COALESCE(c.allowed_channels, '{}') AS allowed_channels,
             COALESCE(c.prompt_context, '') AS prompt_context,
             c.active, COALESCE(c.utm_data, '{}') AS utm_data,
             c.created_at, COALESCE(c.updated_at, c.created_at) AS updated_at
      FROM campaigns c WHERE c.id = $1
    `, [id])

    if (result.rows.length === 0) return null
    const tags = await this.getTagsForCampaign(id)
    return this.mapCampaignRow(result.rows[0]!, tags)
  }

  async createCampaign(data: {
    name: string
    keyword: string
    matchThreshold?: number
    matchMaxRounds?: number
    allowedChannels?: string[]
    promptContext?: string
    utmData?: Record<string, string>
    tagIds?: string[]
  }): Promise<CampaignRecord> {
    const promptCtx = (data.promptContext ?? data.keyword).slice(0, 200)
    const result = await this.db.query(`
      INSERT INTO campaigns (name, keyword, match_threshold, match_max_rounds, allowed_channels,
                             prompt_context, utm_data, active, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, true, now())
      RETURNING id, visible_id
    `, [
      data.name,
      data.keyword,
      data.matchThreshold ?? 0.95,
      Math.min(Math.max(data.matchMaxRounds ?? 1, 1), 3),
      data.allowedChannels ?? [],
      promptCtx,
      JSON.stringify(data.utmData ?? {}),
    ])

    const { id } = result.rows[0]!
    if (data.tagIds && data.tagIds.length > 0) {
      await this.assignTags(id, data.tagIds)
    }

    return (await this.getCampaignById(id))!
  }

  async updateCampaign(id: string, data: {
    name?: string
    keyword?: string
    matchThreshold?: number
    matchMaxRounds?: number
    allowedChannels?: string[]
    promptContext?: string
    active?: boolean
    utmData?: Record<string, string>
    tagIds?: string[]
  }): Promise<CampaignRecord | null> {
    const sets: string[] = []
    const params: unknown[] = []
    let idx = 1

    if (data.name !== undefined) { sets.push(`name = $${idx++}`); params.push(data.name) }
    if (data.keyword !== undefined) { sets.push(`keyword = $${idx++}`); params.push(data.keyword) }
    if (data.matchThreshold !== undefined) { sets.push(`match_threshold = $${idx++}`); params.push(data.matchThreshold) }
    if (data.matchMaxRounds !== undefined) { sets.push(`match_max_rounds = $${idx++}`); params.push(Math.min(Math.max(data.matchMaxRounds, 1), 3)) }
    if (data.allowedChannels !== undefined) { sets.push(`allowed_channels = $${idx++}`); params.push(data.allowedChannels) }
    if (data.promptContext !== undefined) { sets.push(`prompt_context = $${idx++}`); params.push(data.promptContext.slice(0, 200)) }
    if (data.active !== undefined) { sets.push(`active = $${idx++}`); params.push(data.active) }
    if (data.utmData !== undefined) { sets.push(`utm_data = $${idx++}`); params.push(JSON.stringify(data.utmData)) }

    if (sets.length > 0) {
      sets.push(`updated_at = now()`)
      params.push(id)
      await this.db.query(
        `UPDATE campaigns SET ${sets.join(', ')} WHERE id = $${idx}`,
        params,
      )
    }

    if (data.tagIds !== undefined) {
      await this.db.query(`DELETE FROM campaign_tag_assignments WHERE campaign_id = $1`, [id])
      if (data.tagIds.length > 0) {
        await this.assignTags(id, data.tagIds)
      }
    }

    return this.getCampaignById(id)
  }

  async deleteCampaign(id: string): Promise<void> {
    await this.db.query(`DELETE FROM campaigns WHERE id = $1`, [id])
  }

  // ═══════════════════════════════════════════
  // Tag CRUD
  // ═══════════════════════════════════════════

  async listTags(type?: 'platform' | 'source'): Promise<CampaignTag[]> {
    const where = type ? 'WHERE tag_type = $1' : ''
    const params = type ? [type] : []
    const result = await this.db.query(
      `SELECT id, name, tag_type, color FROM campaign_tags ${where} ORDER BY name`,
      params,
    )
    return result.rows.map((r: Record<string, unknown>) => ({
      id: r.id as string,
      name: r.name as string,
      tagType: r.tag_type as 'platform' | 'source',
      color: r.color as string,
    }))
  }

  async createTag(name: string, tagType: 'platform' | 'source', color: string): Promise<CampaignTag> {
    const result = await this.db.query(
      `INSERT INTO campaign_tags (name, tag_type, color) VALUES ($1, $2, $3) RETURNING id`,
      [name, tagType, color],
    )
    return { id: result.rows[0]!.id, name, tagType, color }
  }

  async updateTag(id: string, data: { name?: string; color?: string }): Promise<void> {
    const sets: string[] = []
    const params: unknown[] = []
    let idx = 1
    if (data.name !== undefined) { sets.push(`name = $${idx++}`); params.push(data.name) }
    if (data.color !== undefined) { sets.push(`color = $${idx++}`); params.push(data.color) }
    if (sets.length > 0) {
      params.push(id)
      await this.db.query(`UPDATE campaign_tags SET ${sets.join(', ')} WHERE id = $${idx}`, params)
    }
  }

  async deleteTag(id: string): Promise<void> {
    await this.db.query(`DELETE FROM campaign_tags WHERE id = $1`, [id])
  }

  // ═══════════════════════════════════════════
  // Tag assignments
  // ═══════════════════════════════════════════

  private async assignTags(campaignId: string, tagIds: string[]): Promise<void> {
    for (const tagId of tagIds) {
      await this.db.query(
        `INSERT INTO campaign_tag_assignments (campaign_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [campaignId, tagId],
      ).catch(() => {})
    }
  }

  private async getTagsForCampaign(campaignId: string): Promise<CampaignTag[]> {
    const result = await this.db.query(`
      SELECT t.id, t.name, t.tag_type, t.color
      FROM campaign_tags t
      JOIN campaign_tag_assignments a ON a.tag_id = t.id
      WHERE a.campaign_id = $1
      ORDER BY t.tag_type, t.name
    `, [campaignId])
    return result.rows.map((r: Record<string, unknown>) => ({
      id: r.id as string,
      name: r.name as string,
      tagType: r.tag_type as 'platform' | 'source',
      color: r.color as string,
    }))
  }

  // ═══════════════════════════════════════════
  // Contact-campaign history
  // ═══════════════════════════════════════════

  async recordMatch(
    contactId: string,
    campaignId: string,
    sessionId: string | null,
    channelName: string | null,
    matchScore: number | null,
  ): Promise<void> {
    await this.db.query(`
      INSERT INTO contact_campaigns (contact_id, campaign_id, session_id, channel_name, match_score)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (contact_id, campaign_id, session_id) DO NOTHING
    `, [contactId, campaignId, sessionId, channelName, matchScore])
  }

  async getContactCampaigns(contactId: string): Promise<ContactCampaignEntry[]> {
    const result = await this.db.query(`
      SELECT cc.id, cc.contact_id, cc.campaign_id, c.name AS campaign_name,
             c.visible_id AS campaign_visible_id, cc.session_id,
             cc.channel_name, cc.match_score, cc.matched_at
      FROM contact_campaigns cc
      JOIN campaigns c ON c.id = cc.campaign_id
      WHERE cc.contact_id = $1
      ORDER BY cc.matched_at DESC
    `, [contactId])
    return result.rows.map((r: Record<string, unknown>) => ({
      id: r.id as string,
      contactId: r.contact_id as string,
      campaignId: r.campaign_id as string,
      campaignName: r.campaign_name as string,
      campaignVisibleId: r.campaign_visible_id as number,
      sessionId: r.session_id as string | null,
      channelName: r.channel_name as string | null,
      matchScore: r.match_score as number | null,
      matchedAt: (r.matched_at as Date)?.toISOString() ?? '',
    }))
  }

  async getLatestCampaignForContact(contactId: string): Promise<{ campaignId: string; name: string; visibleId: number } | null> {
    const result = await this.db.query(`
      SELECT cc.campaign_id, c.name, c.visible_id
      FROM contact_campaigns cc
      JOIN campaigns c ON c.id = cc.campaign_id
      WHERE cc.contact_id = $1
      ORDER BY cc.matched_at DESC
      LIMIT 1
    `, [contactId])
    if (result.rows.length === 0) return null
    const r = result.rows[0]!
    return { campaignId: r.campaign_id, name: r.name, visibleId: r.visible_id }
  }

  // ═══════════════════════════════════════════
  // Stats — entries + conversions per campaign
  // ═══════════════════════════════════════════

  async getCampaignStats(): Promise<CampaignStatRow[]> {
    // Entries per campaign (distinct contacts)
    const entriesResult = await this.db.query(`
      SELECT c.id AS campaign_id, c.visible_id, c.name,
             COUNT(DISTINCT cc.contact_id) AS entries
      FROM campaigns c
      LEFT JOIN contact_campaigns cc ON cc.campaign_id = c.id
      WHERE c.active = true
      GROUP BY c.id, c.visible_id, c.name
      ORDER BY c.visible_id ASC
    `)

    // Conversions: attributed to LAST campaign per contact
    const conversionsResult = await this.db.query(`
      WITH last_campaign AS (
        SELECT DISTINCT ON (contact_id) contact_id, campaign_id
        FROM contact_campaigns
        ORDER BY contact_id, matched_at DESC
      )
      SELECT lc.campaign_id, COUNT(*) AS conversions
      FROM last_campaign lc
      JOIN contacts co ON co.id = lc.contact_id
      WHERE co.qualification_status = 'converted'
      GROUP BY lc.campaign_id
    `)

    const conversionsMap = new Map<string, number>()
    for (const r of conversionsResult.rows) {
      conversionsMap.set(r.campaign_id, parseInt(r.conversions, 10))
    }

    const stats: CampaignStatRow[] = entriesResult.rows.map((r: Record<string, unknown>) => ({
      campaignId: r.campaign_id as string,
      visibleId: r.visible_id as number,
      name: r.name as string,
      entries: parseInt(r.entries as string, 10),
      conversions: conversionsMap.get(r.campaign_id as string) ?? 0,
    }))

    // "Sin campaña" row
    const noCampaignResult = await this.db.query(`
      SELECT
        (SELECT COUNT(*) FROM contacts WHERE contact_type = 'lead'
          AND id NOT IN (SELECT DISTINCT contact_id FROM contact_campaigns)) AS entries,
        (SELECT COUNT(*) FROM contacts WHERE contact_type = 'lead'
          AND qualification_status = 'converted'
          AND id NOT IN (SELECT DISTINCT contact_id FROM contact_campaigns)) AS conversions
    `)
    const nc = noCampaignResult.rows[0]
    if (nc) {
      stats.push({
        campaignId: null,
        visibleId: null,
        name: 'Sin campaña',
        entries: parseInt(nc.entries ?? '0', 10),
        conversions: parseInt(nc.conversions ?? '0', 10),
      })
    }

    return stats
  }

  // ═══════════════════════════════════════════
  // Helpers
  // ═══════════════════════════════════════════

  private mapCampaignRow(row: Record<string, unknown>, tags: CampaignTag[]): CampaignRecord {
    const allowedChannels = Array.isArray(row.allowed_channels)
      ? row.allowed_channels as string[]
      : []

    const utmData = typeof row.utm_data === 'string'
      ? JSON.parse(row.utm_data) as Record<string, string>
      : (row.utm_data ?? {}) as Record<string, string>

    return {
      id: row.id as string,
      visibleId: row.visible_id as number,
      name: row.name as string,
      keyword: (row.keyword as string) ?? '',
      matchThreshold: (row.match_threshold as number) ?? 0.95,
      matchMaxRounds: (row.match_max_rounds as number) ?? 1,
      allowedChannels,
      promptContext: (row.prompt_context as string) ?? '',
      active: (row.active as boolean) ?? true,
      utmData,
      platformTags: tags.filter(t => t.tagType === 'platform'),
      sourceTags: tags.filter(t => t.tagType === 'source'),
      createdAt: (row.created_at as Date)?.toISOString() ?? '',
      updatedAt: (row.updated_at as Date)?.toISOString() ?? '',
    }
  }
}
