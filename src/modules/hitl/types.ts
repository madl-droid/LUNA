// hitl/types.ts — Type definitions for the HITL module

// ═══════════════════════════════════════════
// Ticket status state machine
// ═══════════════════════════════════════════

export type HitlStatus = 'pending' | 'notified' | 'waiting' | 'resolved' | 'expired' | 'cancelled'

export type RequestType = 'authorization' | 'domain_help' | 'availability' | 'escalation' | 'custom'

export type Urgency = 'low' | 'normal' | 'high' | 'critical'

export type HandoffMode = 'intermediary' | 'share_contact' | 'full_handoff'

export type HumanReplyIntent = 'resolve' | 'handoff' | 'question'

// ═══════════════════════════════════════════
// Core ticket
// ═══════════════════════════════════════════

export interface HitlTicket {
  id: string
  // Context
  requesterContactId: string
  requesterChannel: string
  requesterSenderId: string
  agentId: string | null
  sessionId: string | null
  correlationId: string | null
  // Request
  requestType: RequestType
  requestSummary: string
  requestContext: Record<string, unknown>
  urgency: Urgency
  // Assignment
  assignedUserId: string | null
  assignedChannel: string | null
  assignedSenderId: string | null
  targetRole: string
  // Escalation
  escalationLevel: number
  escalationHistory: EscalationEntry[]
  // Handoff
  handoffMode: HandoffMode
  handoffActive: boolean
  // Resolution
  status: HitlStatus
  resolutionText: string | null
  resolutionData: Record<string, unknown> | null
  resolvedBy: string | null
  resolvedAt: Date | null
  // Follow-up
  notificationCount: number
  lastNotifiedAt: Date | null
  // Timestamps
  createdAt: Date
  updatedAt: Date
  expiresAt: Date | null
}

export interface EscalationEntry {
  userId: string
  channel: string
  notifiedAt: string
  followups: number
}

// ═══════════════════════════════════════════
// Ticket creation input
// ═══════════════════════════════════════════

export interface CreateTicketInput {
  requesterContactId: string
  requesterChannel: string
  requesterSenderId: string
  agentId?: string
  sessionId?: string
  correlationId?: string
  requestType: RequestType
  requestSummary: string
  requestContext?: Record<string, unknown>
  urgency?: Urgency
  targetRole: string
  assignedUserId?: string
  assignedChannel?: string
  assignedSenderId?: string
  handoffMode?: HandoffMode
  ttlHours?: number
}

// ═══════════════════════════════════════════
// Audit log
// ═══════════════════════════════════════════

export type TicketEvent =
  | 'created'
  | 'notified'
  | 'reminded'
  | 'escalated'
  | 'resolved'
  | 'expired'
  | 'cancelled'
  | 'handoff_started'
  | 'handoff_returned'
  | 'reassigned'

export interface TicketLogEntry {
  id: string
  ticketId: string
  event: TicketEvent
  actor: string
  details: Record<string, unknown>
  createdAt: Date
}

// ═══════════════════════════════════════════
// HITL Rules
// ═══════════════════════════════════════════

export interface HitlRule {
  id: string
  name: string
  condition: string
  targetRole: string
  requestType: string
  urgency: Urgency
  handoff: boolean
  enabled: boolean
  sortOrder: number
  createdAt: Date
  updatedAt: Date
}

export interface CreateRuleInput {
  name: string
  condition: string
  targetRole: string
  requestType?: string
  urgency?: Urgency
  handoff?: boolean
  enabled?: boolean
}

// ═══════════════════════════════════════════
// Responder selection
// ═══════════════════════════════════════════

export interface Responder {
  userId: string
  displayName: string | null
  senderId: string
  channel: string
}

// ═══════════════════════════════════════════
// Module config
// ═══════════════════════════════════════════

export interface HitlConfig {
  HITL_ENABLED: boolean
  HITL_DEFAULT_CHANNEL: string
  HITL_TICKET_TTL_HOURS: number
  HITL_FOLLOWUP_INTERVAL_MIN: number
  HITL_MAX_FOLLOWUPS: number
  HITL_AUTO_EXPIRE_NOTIFY: boolean
}

// ═══════════════════════════════════════════
// Tool input
// ═══════════════════════════════════════════

export interface RequestHumanHelpInput {
  target_role: 'admin' | 'coworker'
  request_type: RequestType
  summary: string
  urgency?: Urgency
  context?: string
}
