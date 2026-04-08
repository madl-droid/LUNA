// LUNA — Module: marketing-data — Campaign Matcher
// Fuzzy matching de keywords de campañas contra texto entrante usando fuse.js.
// Match dentro de párrafos (ignoreLocation: true), con filtros por canal y ronda.

import Fuse from 'fuse.js'
import pino from 'pino'
import type { CampaignRecord, CampaignMatchResult, UtmParams } from './campaign-types.js'
import type { CampaignQueries } from './campaign-queries.js'

const logger = pino({ name: 'marketing-data:campaign-matcher' })

interface FuseItem {
  keyword: string
  campaignId: string
  visibleId: number
  campaignName: string
  promptContext: string
  threshold: number
  maxRounds: number
  allowedChannels: string[]
}

export class CampaignMatcher {
  private fuse: Fuse<FuseItem> | null = null
  private items: FuseItem[] = []
  private campaignQueries: CampaignQueries | null = null

  setCampaignQueries(cq: CampaignQueries): void {
    this.campaignQueries = cq
  }

  /**
   * Build the fuse.js index from active campaign records.
   */
  load(campaigns: CampaignRecord[]): void {
    this.items = []

    for (const campaign of campaigns) {
      const kw = campaign.keyword?.trim()
      if (!kw) continue

      this.items.push({
        keyword: kw.toLowerCase(),
        campaignId: campaign.id,
        visibleId: campaign.visibleId,
        campaignName: campaign.name,
        promptContext: campaign.promptContext || kw,
        threshold: campaign.matchThreshold,
        maxRounds: campaign.matchMaxRounds,
        allowedChannels: campaign.allowedChannels,
      })
    }

    if (this.items.length > 0) {
      this.fuse = new Fuse(this.items, {
        keys: ['keyword'],
        threshold: 0.4,       // loose initial pass; per-campaign threshold applied after
        includeScore: true,
        ignoreLocation: true,  // match keyword anywhere in the text (within a paragraph)
      })
    } else {
      this.fuse = null
    }

    logger.info({ count: this.items.length }, 'Campaign matcher index loaded')
  }

  /**
   * Match text against campaign keywords.
   * @param text - normalized incoming text
   * @param channelName - channel name (e.g. 'whatsapp', 'email')
   * @param channelType - 'instant' | 'async' | 'voice'
   * @param roundNumber - message round in session (1-based)
   * @returns best match or null
   */
  match(
    text: string,
    channelName: string,
    channelType: string,
    roundNumber: number,
  ): CampaignMatchResult | null {
    // Never match on voice channels
    if (channelType === 'voice') return null
    if (!this.fuse || this.items.length === 0) return null

    const normalized = text.toLowerCase().trim()
    if (!normalized) return null

    try {
      return this.doMatch(normalized, channelName, roundNumber)
    } catch (err) {
      // Retry once on error
      logger.warn({ err }, 'Campaign match failed, retrying...')
      try {
        return this.doMatch(normalized, channelName, roundNumber)
      } catch (retryErr) {
        logger.error({ err: retryErr }, 'Campaign match retry failed')
        return null
      }
    }
  }

  private doMatch(
    normalized: string,
    channelName: string,
    roundNumber: number,
  ): CampaignMatchResult | null {
    const results = this.fuse!.search(normalized)

    for (const result of results) {
      const item = result.item

      // Filter by round number
      if (roundNumber > item.maxRounds) continue

      // Filter by allowed channels (empty = all non-voice channels)
      if (item.allowedChannels.length > 0 && !item.allowedChannels.includes(channelName)) continue

      // Score check: fuse.js score 0 = perfect, 1 = no match
      const score = result.score ?? 1
      const matchPercent = 1 - score

      if (matchPercent >= item.threshold) {
        return {
          campaignId: item.campaignId,
          visibleId: item.visibleId,
          name: item.campaignName,
          keyword: item.keyword,
          promptContext: item.promptContext,
          score: matchPercent,
          matchSource: 'keyword',
          utmData: {},
        }
      }
    }

    return null
  }

  /**
   * Intenta match por UTM: busca campaña por utm_campaign, auto-crea si no existe.
   * Retorna CampaignMatchResult con matchSource y utmData, o null si no hay UTMs.
   */
  async matchUtm(
    utmData: UtmParams,
    channelName: string,
    channelType: string,
  ): Promise<CampaignMatchResult | null> {
    // Never match on voice channels
    if (channelType === 'voice') return null
    // Without utm_campaign we can't map to a campaign
    if (!utmData.utm_campaign) return null
    if (!this.campaignQueries) {
      logger.warn('matchUtm called but campaignQueries not set')
      return null
    }

    const utmCampaign = utmData.utm_campaign
    const utmDataClean = Object.fromEntries(
      Object.entries(utmData).filter(([, v]) => v !== undefined),
    ) as Record<string, string>

    try {
      let found = await this.campaignQueries.findByUtmCampaign(utmCampaign)

      if (!found) {
        // Auto-create campaign from UTM
        const created = await this.campaignQueries.autoCreateFromUtm(utmCampaign, utmDataClean)
        found = { id: created.id, name: created.name, visibleId: created.visibleId, keyword: '', promptContext: '' }
        // Reload index so the new campaign is available for future keyword matching
        const active = await this.campaignQueries.listActiveCampaigns()
        this.load(active)
      }

      logger.info({ campaignId: found.id, name: found.name, channelName }, 'UTM campaign matched')

      return {
        campaignId: found.id,
        visibleId: found.visibleId,
        name: found.name,
        keyword: found.keyword,
        promptContext: found.promptContext,
        score: 1.0,
        matchSource: 'url_utm',
        utmData: utmDataClean,
      }
    } catch (err) {
      logger.error({ err, utmCampaign }, 'UTM campaign match/auto-create failed')
      return null
    }
  }
}
