// LUNA — Module: prompts — Campaign matcher (fuse.js fuzzy matching)

import Fuse from 'fuse.js'
import type { CampaignRecord, CampaignMatchResult } from './types.js'

interface FuseItem {
  phrase: string
  campaignId: string
  campaignName: string
  promptContext: string
  threshold: number
}

export class CampaignMatcher {
  private fuse: Fuse<FuseItem> | null = null
  private items: FuseItem[] = []

  /**
   * Build the fuse.js index from campaign records.
   */
  load(campaigns: CampaignRecord[]): void {
    this.items = []

    for (const campaign of campaigns) {
      for (const phrase of campaign.matchPhrases) {
        if (phrase.trim()) {
          this.items.push({
            phrase: phrase.trim().toLowerCase(),
            campaignId: campaign.id,
            campaignName: campaign.name,
            promptContext: campaign.promptContext,
            threshold: campaign.matchThreshold,
          })
        }
      }
    }

    if (this.items.length > 0) {
      this.fuse = new Fuse(this.items, {
        keys: ['phrase'],
        threshold: 0.4, // loose initial threshold; we filter by campaign threshold after
        includeScore: true,
        ignoreLocation: true,
      })
    } else {
      this.fuse = null
    }
  }

  /**
   * Match text against campaign phrases.
   * Returns the best match that passes the campaign's threshold, or null.
   */
  match(text: string): CampaignMatchResult | null {
    if (!this.fuse || this.items.length === 0) return null

    const normalized = text.toLowerCase().trim()
    if (!normalized) return null

    const results = this.fuse.search(normalized)

    for (const result of results) {
      const score = result.score ?? 1
      // fuse.js score: 0 = perfect match, 1 = no match
      // campaign threshold: 0.95 means we need score <= 0.05
      const matchScore = 1 - score
      if (matchScore >= result.item.threshold) {
        return {
          campaignId: result.item.campaignId,
          name: result.item.campaignName,
          promptContext: result.item.promptContext,
        }
      }
    }

    return null
  }
}
