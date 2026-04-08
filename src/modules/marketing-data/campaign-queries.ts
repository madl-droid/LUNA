// LUNA — Module: marketing-data — Campaign PostgreSQL Queries
// CRUD para campañas, tags, contact-campaign history, stats.

import type { Pool } from 'pg'
import pino from 'pino'
import type {
  CampaignRecord,
  CampaignTag,
  ContactCampaignEntry,
  CampaignStatRow,
  CampaignDetailedStats,
  SourceBreakdown,
  UtmBreakdown,
} from './campaign-types.js'

const logger = pino({ name: 'marketing-data:campaigns-db' })

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
      // UTM Foundation columns
      `ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS utm_keys TEXT[] DEFAULT '{}'`,
      `ALTER TABLE campaigns ADD COLUMN IF NOT EXISTS origin TEXT DEFAULT 'manual'`,
      // contact_campaigns UTM tracking
      `ALTER TABLE contact_campaigns ADD COLUMN IF NOT EXISTS match_source TEXT DEFAULT 'keyword'`,
      `ALTER TABLE contact_campaigns ADD COLUMN IF NOT EXISTS utm_data JSONB DEFAULT '{}'`,
    ]
    for (const sql of alters) {
      await this.db.query(sql).catch(() => {
        // Column may already exist — non-critical
      })
    }

    // GIN index for utm_keys lookups
    await this.db.query(`
      CREATE INDEX IF NOT EXISTS idx_campaigns_utm_keys ON campaigns USING GIN (utm_keys)
    `).catch(() => {})

    // Unique index on name for auto_utm campaigns — prevents duplicates on race conditions
    await this.db.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_campaigns_auto_utm_name
        ON campaigns (name) WHERE origin = 'auto_utm'
    `).catch(() => {})

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
        contact_id TEXT NOT NULL,
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
             COALESCE(c.utm_keys, '{}') AS utm_keys,
             COALESCE(c.origin, 'manual') AS origin,
             c.created_at, COALESCE(c.updated_at, c.created_at) AS updated_at,
             COALESCE(
               json_agg(
                 json_build_object('id', t.id, 'name', t.name, 'tag_type', t.tag_type, 'color', t.color)
               ) FILTER (WHERE t.id IS NOT NULL),
               '[]'
             ) AS tags
      FROM campaigns c
      LEFT JOIN campaign_tag_assignments a ON a.campaign_id = c.id
      LEFT JOIN campaign_tags t ON t.id = a.tag_id
      ${where}
      GROUP BY c.id
      ORDER BY c.visible_id ASC
    `)

    return result.rows.map((row: Record<string, unknown>) => {
      const rawTags = (Array.isArray(row.tags) ? row.tags : JSON.parse(String(row.tags))) as Array<Record<string, string>>
      const tags: CampaignTag[] = rawTags.map(t => ({
        id: t.id!,
        name: t.name!,
        tagType: t.tag_type as 'platform' | 'source',
        color: t.color!,
      }))
      return this.mapCampaignRow(row, tags)
    })
  }

  async getCampaignById(id: string): Promise<CampaignRecord | null> {
    const result = await this.db.query(`
      SELECT c.id, c.visible_id, c.name, c.keyword,
             COALESCE(c.match_threshold, 0.95) AS match_threshold,
             COALESCE(c.match_max_rounds, 1) AS match_max_rounds,
             COALESCE(c.allowed_channels, '{}') AS allowed_channels,
             COALESCE(c.prompt_context, '') AS prompt_context,
             c.active, COALESCE(c.utm_data, '{}') AS utm_data,
             COALESCE(c.utm_keys, '{}') AS utm_keys,
             COALESCE(c.origin, 'manual') AS origin,
             c.created_at, COALESCE(c.updated_at, c.created_at) AS updated_at
      FROM campaigns c WHERE c.id = $1
    `, [id])

    if (result.rows.length === 0) return null
    const tags = await this.getTagsForCampaign(id)
    return this.mapCampaignRow(result.rows[0]!, tags)
  }

  async createCampaign(data: {
    name: string
    keyword?: string
    matchThreshold?: number
    matchMaxRounds?: number
    allowedChannels?: string[]
    promptContext?: string
    utmData?: Record<string, string>
    utmKeys?: string[]
    tagIds?: string[]
  }): Promise<CampaignRecord> {
    const promptCtx = (data.promptContext ?? data.keyword ?? '').slice(0, 200)
    const result = await this.db.query(`
      INSERT INTO campaigns (name, keyword, match_threshold, match_max_rounds, allowed_channels,
                             prompt_context, utm_data, utm_keys, origin, active, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'manual', true, now())
      RETURNING id, visible_id
    `, [
      data.name,
      data.keyword,
      data.matchThreshold ?? 0.95,
      Math.min(Math.max(data.matchMaxRounds ?? 1, 1), 3),
      data.allowedChannels ?? [],
      promptCtx,
      JSON.stringify(data.utmData ?? {}),
      (data.utmKeys ?? []).map(k => k.toLowerCase()),
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
    utmKeys?: string[]
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
    if (data.utmKeys !== undefined) { sets.push(`utm_keys = $${idx++}`); params.push(data.utmKeys.map(k => k.toLowerCase())) }

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
  // UTM lookup + auto-create
  // ═══════════════════════════════════════════

  /**
   * Busca campaña activa por valor de utm_campaign en utm_keys[].
   * Retorna la primera campaña que contenga el valor (case-insensitive).
   */
  async findByUtmCampaign(utmCampaignValue: string): Promise<{ id: string; name: string; visibleId: number; keyword: string; promptContext: string } | null> {
    const result = await this.db.query<{ id: string; name: string; visible_id: number; keyword: string; prompt_context: string }>(`
      SELECT id, name, visible_id, keyword, prompt_context
      FROM campaigns
      WHERE LOWER($1) = ANY(utm_keys) AND active = true
      LIMIT 1
    `, [utmCampaignValue])
    if (result.rows.length === 0) return null
    const r = result.rows[0]!
    return {
      id: r.id,
      name: r.name,
      visibleId: r.visible_id,
      keyword: r.keyword ?? '',
      promptContext: r.prompt_context ?? '',
    }
  }

  /**
   * Auto-crea campaña desde un utm_campaign value.
   * name = utmCampaignValue, keyword = null, utm_keys = [utmCampaignValue], origin = 'auto_utm'.
   */
  async autoCreateFromUtm(utmCampaignValue: string, utmData: Record<string, string>): Promise<{ id: string; name: string; visibleId: number }> {
    const result = await this.db.query<{ id: string; name: string; visible_id: number }>(`
      INSERT INTO campaigns (name, keyword, utm_keys, utm_data, origin, active, updated_at)
      VALUES ($1, NULL, ARRAY[LOWER($1)], $2, 'auto_utm', true, now())
      ON CONFLICT (name) WHERE origin = 'auto_utm'
        DO UPDATE SET utm_data = EXCLUDED.utm_data, updated_at = now()
      RETURNING id, name, visible_id
    `, [utmCampaignValue, JSON.stringify(utmData)])
    const r = result.rows[0]!
    logger.info({ name: utmCampaignValue }, 'Auto-created campaign from UTM')
    return { id: r.id, name: r.name, visibleId: r.visible_id }
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
    matchSource: string = 'keyword',
    utmData: Record<string, string> = {},
  ): Promise<void> {
    await this.db.query(`
      INSERT INTO contact_campaigns (contact_id, campaign_id, session_id, channel_name, match_score, match_source, utm_data)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (contact_id, campaign_id, session_id) DO NOTHING
    `, [contactId, campaignId, sessionId, channelName, matchScore, matchSource, JSON.stringify(utmData)])
  }

  async getContactCampaigns(contactId: string): Promise<ContactCampaignEntry[]> {
    const result = await this.db.query(`
      SELECT cc.id, cc.contact_id, cc.campaign_id, c.name AS campaign_name,
             c.visible_id AS campaign_visible_id, cc.session_id,
             cc.channel_name, cc.match_score, cc.match_source, cc.utm_data, cc.matched_at
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
      matchSource: (r.match_source as string | null) ?? null,
      utmData: (typeof r.utm_data === 'string'
        ? JSON.parse(r.utm_data)
        : (r.utm_data ?? {})) as Record<string, string>,
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
      JOIN agent_contacts ac ON ac.contact_id = lc.contact_id
      WHERE ac.lead_status = 'converted'
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
        (SELECT COUNT(*) FROM contacts c
          LEFT JOIN contact_campaigns cc ON cc.contact_id = c.id
          WHERE c.contact_type = 'lead' AND cc.id IS NULL) AS entries,
        (SELECT COUNT(*) FROM contacts c2
          JOIN agent_contacts ac2 ON ac2.contact_id = c2.id
          LEFT JOIN contact_campaigns cc2 ON cc2.contact_id = c2.id
          WHERE c2.contact_type = 'lead'
            AND ac2.lead_status = 'converted'
            AND cc2.id IS NULL) AS conversions
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
  // Detailed stats — breakdown by source & UTM
  // ═══════════════════════════════════════════

  async getCampaignDetailedStats(): Promise<CampaignDetailedStats[]> {
    const [
      baseStats,
      sourceEntriesResult,
      utmEntriesResult,
      firstTouchResult,
      sourceConversionsResult,
      utmConversionsResult,
    ] = await Promise.all([
      this.getCampaignStats(),

      // Query 1 — source entries per campaign
      this.db.query(`
        SELECT campaign_id,
               COALESCE(match_source, 'keyword') AS match_source,
               COUNT(DISTINCT contact_id) AS entries
        FROM contact_campaigns
        GROUP BY campaign_id, match_source
      `),

      // Query 2 — UTM entries per campaign
      this.db.query(`
        SELECT campaign_id,
               COALESCE(utm_data->>'utm_source', 'unknown') AS utm_source,
               COALESCE(utm_data->>'utm_medium', 'unknown') AS utm_medium,
               COUNT(DISTINCT contact_id) AS entries
        FROM contact_campaigns
        WHERE utm_data != '{}'::jsonb AND utm_data IS NOT NULL
        GROUP BY campaign_id, utm_data->>'utm_source', utm_data->>'utm_medium'
      `),

      // Query 3 — first-touch attribution
      this.db.query(`
        WITH first_campaign AS (
          SELECT DISTINCT ON (contact_id) contact_id, campaign_id
          FROM contact_campaigns
          ORDER BY contact_id, matched_at ASC
        )
        SELECT campaign_id, COUNT(*) AS first_touch_entries
        FROM first_campaign
        GROUP BY campaign_id
      `),

      // Query 4 — conversions by source
      this.db.query(`
        WITH last_campaign AS (
          SELECT DISTINCT ON (contact_id) contact_id, campaign_id, match_source
          FROM contact_campaigns
          ORDER BY contact_id, matched_at DESC
        )
        SELECT lc.campaign_id, COALESCE(lc.match_source, 'keyword') AS match_source, COUNT(*) AS conversions
        FROM last_campaign lc
        JOIN agent_contacts ac ON ac.contact_id = lc.contact_id
        WHERE ac.lead_status = 'converted'
        GROUP BY lc.campaign_id, lc.match_source
      `),

      // Query 5 — conversions by UTM source
      this.db.query(`
        WITH last_campaign AS (
          SELECT DISTINCT ON (contact_id) contact_id, campaign_id, utm_data
          FROM contact_campaigns
          ORDER BY contact_id, matched_at DESC
        )
        SELECT lc.campaign_id,
               COALESCE(lc.utm_data->>'utm_source', 'unknown') AS utm_source,
               COALESCE(lc.utm_data->>'utm_medium', 'unknown') AS utm_medium,
               COUNT(*) AS conversions
        FROM last_campaign lc
        JOIN agent_contacts ac ON ac.contact_id = lc.contact_id
        WHERE ac.lead_status = 'converted' AND lc.utm_data != '{}'::jsonb
        GROUP BY lc.campaign_id, lc.utm_data->>'utm_source', lc.utm_data->>'utm_medium'
      `),
    ])

    // Build lookup maps
    const sourceEntriesMap = new Map<string, Map<string, number>>()
    for (const r of sourceEntriesResult.rows) {
      if (!sourceEntriesMap.has(r.campaign_id)) sourceEntriesMap.set(r.campaign_id, new Map())
      sourceEntriesMap.get(r.campaign_id)!.set(r.match_source, parseInt(r.entries, 10))
    }

    const sourceConvMap = new Map<string, Map<string, number>>()
    for (const r of sourceConversionsResult.rows) {
      if (!sourceConvMap.has(r.campaign_id)) sourceConvMap.set(r.campaign_id, new Map())
      sourceConvMap.get(r.campaign_id)!.set(r.match_source, parseInt(r.conversions, 10))
    }

    const utmEntriesMap = new Map<string, Array<{ utm_source: string; utm_medium: string; entries: number }>>()
    for (const r of utmEntriesResult.rows) {
      if (!utmEntriesMap.has(r.campaign_id)) utmEntriesMap.set(r.campaign_id, [])
      utmEntriesMap.get(r.campaign_id)!.push({
        utm_source: r.utm_source,
        utm_medium: r.utm_medium,
        entries: parseInt(r.entries, 10),
      })
    }

    const utmConvMap = new Map<string, Map<string, number>>()
    for (const r of utmConversionsResult.rows) {
      if (!utmConvMap.has(r.campaign_id)) utmConvMap.set(r.campaign_id, new Map())
      const key = `${r.utm_source}::${r.utm_medium}`
      utmConvMap.get(r.campaign_id)!.set(key, parseInt(r.conversions, 10))
    }

    const firstTouchMap = new Map<string, number>()
    for (const r of firstTouchResult.rows) {
      firstTouchMap.set(r.campaign_id, parseInt(r.first_touch_entries, 10))
    }

    // Assemble detailed stats
    const SOURCES = ['keyword', 'url_utm', 'webhook', 'webhook_utm']
    return baseStats.map((base: CampaignStatRow) => {
      const cid = base.campaignId ?? ''

      const sourceBreakdown: SourceBreakdown[] = SOURCES
        .map(src => ({
          matchSource: src,
          entries: sourceEntriesMap.get(cid)?.get(src) ?? 0,
          conversions: sourceConvMap.get(cid)?.get(src) ?? 0,
        }))
        .filter(b => b.entries > 0 || b.conversions > 0)

      const utmEntries = utmEntriesMap.get(cid) ?? []
      const utmBreakdown: UtmBreakdown[] = utmEntries.map(u => {
        const key = `${u.utm_source}::${u.utm_medium}`
        return {
          utmSource: u.utm_source,
          utmMedium: u.utm_medium,
          entries: u.entries,
          conversions: utmConvMap.get(cid)?.get(key) ?? 0,
        }
      })

      return {
        ...base,
        sourceBreakdown,
        utmBreakdown,
        firstTouchEntries: firstTouchMap.get(cid) ?? 0,
      }
    })
  }

  async getGlobalUtmBreakdown(): Promise<UtmBreakdown[]> {
    const [entriesResult, conversionsResult] = await Promise.all([
      this.db.query(`
        SELECT COALESCE(utm_data->>'utm_source', 'unknown') AS utm_source,
               COALESCE(utm_data->>'utm_medium', 'unknown') AS utm_medium,
               COUNT(DISTINCT contact_id) AS entries
        FROM contact_campaigns
        WHERE utm_data != '{}'::jsonb AND utm_data IS NOT NULL
        GROUP BY utm_data->>'utm_source', utm_data->>'utm_medium'
        ORDER BY entries DESC
        LIMIT 50
      `),
      this.db.query(`
        WITH last_campaign AS (
          SELECT DISTINCT ON (contact_id) contact_id, utm_data
          FROM contact_campaigns
          ORDER BY contact_id, matched_at DESC
        )
        SELECT COALESCE(lc.utm_data->>'utm_source', 'unknown') AS utm_source,
               COALESCE(lc.utm_data->>'utm_medium', 'unknown') AS utm_medium,
               COUNT(*) AS conversions
        FROM last_campaign lc
        JOIN agent_contacts ac ON ac.contact_id = lc.contact_id
        WHERE ac.lead_status = 'converted' AND lc.utm_data != '{}'::jsonb
        GROUP BY lc.utm_data->>'utm_source', lc.utm_data->>'utm_medium'
      `),
    ])

    const convMap = new Map<string, number>()
    for (const r of conversionsResult.rows) {
      convMap.set(`${r.utm_source}::${r.utm_medium}`, parseInt(r.conversions, 10))
    }

    return entriesResult.rows.map((r: Record<string, unknown>) => ({
      utmSource: r.utm_source as string,
      utmMedium: r.utm_medium as string,
      entries: parseInt(r.entries as string, 10),
      conversions: convMap.get(`${r.utm_source}::${r.utm_medium}`) ?? 0,
    }))
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
      utmKeys: Array.isArray(row.utm_keys) ? row.utm_keys as string[] : [],
      origin: (row.origin as 'manual' | 'auto_utm') ?? 'manual',
      platformTags: tags.filter(t => t.tagType === 'platform'),
      sourceTags: tags.filter(t => t.tagType === 'source'),
      createdAt: (row.created_at as Date)?.toISOString() ?? '',
      updatedAt: (row.updated_at as Date)?.toISOString() ?? '',
    }
  }
}
