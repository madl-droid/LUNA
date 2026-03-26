// LUNA — Module: webhook-leads — Types
// Tipos para el webhook de registro externo de leads.

// ═══════════════════════════════════════════
// Webhook config (stored in config_store)
// ═══════════════════════════════════════════

export interface WebhookLeadsConfig {
  WEBHOOK_LEADS_ENABLED: boolean
  WEBHOOK_LEADS_TOKEN: string
  WEBHOOK_LEADS_PREFERRED_CHANNEL: string  // 'auto' | 'whatsapp' | 'email' | 'google-chat'
}

// ═══════════════════════════════════════════
// Request / Response
// ═══════════════════════════════════════════

export interface WebhookRegisterBody {
  email?: string
  phone?: string
  name?: string
  campaign: string  // keyword, visible_id, or UUID of an active campaign
}

export interface WebhookRegisterResult {
  ok: boolean
  contactId: string
  channel: string
  campaignId?: string
  campaignName?: string
  warning?: string
}

// ═══════════════════════════════════════════
// Log entry
// ═══════════════════════════════════════════

export interface WebhookLogEntry {
  id: string
  email: string | null
  phone: string | null
  displayName: string | null
  campaignKeyword: string | null
  campaignId: string | null
  contactId: string | null
  channelUsed: string | null
  success: boolean
  errorMessage: string | null
  createdAt: string
}
