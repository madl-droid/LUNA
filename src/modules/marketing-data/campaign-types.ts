// LUNA — Module: marketing-data — Campaign Types
// Types para el subsistema de campañas: tracking, matching, tags, stats.

// ═══════════════════════════════════════════
// Tags — platform & source
// ═══════════════════════════════════════════

export interface CampaignTag {
  id: string
  name: string
  tagType: 'platform' | 'source'
  color: string          // hex color, light palette (e.g. '#93c5fd')
}

// ═══════════════════════════════════════════
// Campaign record
// ═══════════════════════════════════════════

export interface CampaignRecord {
  id: string
  visibleId: number                  // SERIAL autoincremental (1, 2, 3...)
  name: string
  keyword: string                    // frase de matching (1 por campaña)
  matchThreshold: number             // 0-1, default 0.95
  matchMaxRounds: number             // 1-3, default 1
  allowedChannels: string[]          // empty = all non-voice channels
  promptContext: string              // max 200 chars, default = keyword
  active: boolean
  utmData: Record<string, string>
  platformTags: CampaignTag[]
  sourceTags: CampaignTag[]
  createdAt: string
  updatedAt: string
}

// ═══════════════════════════════════════════
// Campaign match result (from matcher)
// ═══════════════════════════════════════════

export interface CampaignMatchResult {
  campaignId: string
  visibleId: number
  name: string
  keyword: string
  promptContext: string
  score: number                      // match score 0-1
}

// ═══════════════════════════════════════════
// Contact-campaign history
// ═══════════════════════════════════════════

export interface ContactCampaignEntry {
  id: string
  contactId: string
  campaignId: string
  campaignName: string
  campaignVisibleId: number
  sessionId: string | null
  channelName: string | null
  matchScore: number | null
  matchedAt: string
}

// ═══════════════════════════════════════════
// Campaign stats (entries + conversions)
// ═══════════════════════════════════════════

export interface CampaignStatRow {
  campaignId: string | null          // null = "sin campaña"
  visibleId: number | null
  name: string
  entries: number
  conversions: number
}
