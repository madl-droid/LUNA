// hitl/ticket-store.ts — PostgreSQL CRUD for hitl_tickets + hitl_ticket_log

import type { Pool } from 'pg'
import type {
  HitlTicket,
  CreateTicketInput,
  HitlStatus,
  TicketEvent,
  TicketLogEntry,
  EscalationEntry,
} from './types.js'
import pino from 'pino'

const logger = pino({ name: 'hitl:store' })

// ═══════════════════════════════════════════
// Row → domain mapping
// ═══════════════════════════════════════════

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToTicket(r: any): HitlTicket {
  return {
    id: r.id,
    requesterContactId: r.requester_contact_id,
    requesterChannel: r.requester_channel,
    requesterSenderId: r.requester_sender_id,
    sessionId: r.session_id,
    correlationId: r.correlation_id,
    requestType: r.request_type,
    requestSummary: r.request_summary,
    requestContext: r.request_context ?? {},
    urgency: r.urgency,
    assignedUserId: r.assigned_user_id,
    assignedChannel: r.assigned_channel,
    assignedSenderId: r.assigned_sender_id,
    targetRole: r.target_role,
    escalationLevel: r.escalation_level,
    escalationHistory: r.escalation_history ?? [],
    handoffMode: r.handoff_mode,
    handoffActive: r.handoff_active,
    status: r.status,
    resolutionText: r.resolution_text,
    resolutionData: r.resolution_data,
    resolvedBy: r.resolved_by,
    resolvedAt: r.resolved_at ? new Date(r.resolved_at) : null,
    notificationCount: r.notification_count,
    lastNotifiedAt: r.last_notified_at ? new Date(r.last_notified_at) : null,
    createdAt: new Date(r.created_at),
    updatedAt: new Date(r.updated_at),
    expiresAt: r.expires_at ? new Date(r.expires_at) : null,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToLogEntry(r: any): TicketLogEntry {
  return {
    id: r.id,
    ticketId: r.ticket_id,
    event: r.event,
    actor: r.actor,
    details: r.details ?? {},
    createdAt: new Date(r.created_at),
  }
}

// ═══════════════════════════════════════════
// TicketStore class
// ═══════════════════════════════════════════

export class TicketStore {
  constructor(private readonly db: Pool) {}

  // ─── Create ─────────────────────────────
  async create(input: CreateTicketInput): Promise<HitlTicket> {
    const expiresAt = input.ttlHours
      ? new Date(Date.now() + input.ttlHours * 3600_000)
      : null

    const { rows } = await this.db.query(
      `INSERT INTO hitl_tickets (
        requester_contact_id, requester_channel, requester_sender_id,
        session_id, correlation_id,
        request_type, request_summary, request_context, urgency,
        assigned_user_id, assigned_channel, assigned_sender_id,
        target_role, handoff_mode, expires_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
      RETURNING *`,
      [
        input.requesterContactId, input.requesterChannel, input.requesterSenderId,
        input.sessionId ?? null, input.correlationId ?? null,
        input.requestType, input.requestSummary, JSON.stringify(input.requestContext ?? {}),
        input.urgency ?? 'normal',
        input.assignedUserId ?? null, input.assignedChannel ?? null, input.assignedSenderId ?? null,
        input.targetRole, input.handoffMode ?? 'intermediary', expiresAt,
      ],
    )
    const ticket = rowToTicket(rows[0]!)
    await this.log(ticket.id, 'created', 'system', { targetRole: input.targetRole })
    return ticket
  }

  // ─── Read ───────────────────────────────
  async getById(id: string): Promise<HitlTicket | null> {
    const { rows } = await this.db.query('SELECT * FROM hitl_tickets WHERE id = $1', [id])
    return rows[0] ? rowToTicket(rows[0]) : null
  }

  async findActiveByResponder(senderId: string, channel: string): Promise<HitlTicket | null> {
    const { rows } = await this.db.query(
      `SELECT * FROM hitl_tickets
       WHERE assigned_sender_id = $1 AND assigned_channel = $2
         AND status IN ('notified', 'waiting')
       ORDER BY created_at ASC LIMIT 1`,
      [senderId, channel],
    )
    return rows[0] ? rowToTicket(rows[0]) : null
  }

  async findActiveByRequester(senderId: string, channel: string): Promise<HitlTicket | null> {
    const { rows } = await this.db.query(
      `SELECT * FROM hitl_tickets
       WHERE requester_sender_id = $1 AND requester_channel = $2
         AND status NOT IN ('resolved', 'expired', 'cancelled')
       ORDER BY created_at DESC LIMIT 1`,
      [senderId, channel],
    )
    return rows[0] ? rowToTicket(rows[0]) : null
  }

  async findActiveHandoff(senderId: string, channel: string): Promise<HitlTicket | null> {
    const { rows } = await this.db.query(
      `SELECT * FROM hitl_tickets
       WHERE requester_sender_id = $1 AND requester_channel = $2
         AND handoff_active = true
       LIMIT 1`,
      [senderId, channel],
    )
    return rows[0] ? rowToTicket(rows[0]) : null
  }

  async countRecentTickets(senderId: string, channel: string, sessionId: string | null): Promise<number> {
    const { rows } = await this.db.query(
      `SELECT COUNT(*)::int AS cnt FROM hitl_tickets
       WHERE requester_sender_id = $1 AND requester_channel = $2
         AND ($3::uuid IS NULL OR session_id = $3::uuid)
         AND created_at > NOW() - INTERVAL '2 hours'`,
      [senderId, channel, sessionId],
    )
    return rows[0]?.cnt ?? 0
  }

  async listTickets(filters: {
    status?: HitlStatus
    targetRole?: string
    limit?: number
    offset?: number
  }): Promise<{ tickets: HitlTicket[]; total: number }> {
    const conditions: string[] = []
    const params: unknown[] = []
    let idx = 1

    if (filters.status) {
      conditions.push(`status = $${idx++}`)
      params.push(filters.status)
    }
    if (filters.targetRole) {
      conditions.push(`target_role = $${idx++}`)
      params.push(filters.targetRole)
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''
    const limit = filters.limit ?? 50
    const offset = filters.offset ?? 0

    const [dataRes, countRes] = await Promise.all([
      this.db.query(
        `SELECT * FROM hitl_tickets ${where} ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx}`,
        [...params, limit, offset],
      ),
      this.db.query(`SELECT COUNT(*)::int AS cnt FROM hitl_tickets ${where}`, params),
    ])

    return {
      tickets: dataRes.rows.map(rowToTicket),
      total: countRes.rows[0]?.cnt ?? 0,
    }
  }

  // ─── Update ─────────────────────────────
  async updateStatus(id: string, status: HitlStatus): Promise<void> {
    await this.db.query(
      'UPDATE hitl_tickets SET status = $1, updated_at = NOW() WHERE id = $2',
      [status, id],
    )
  }

  async resolve(id: string, resolutionText: string, resolvedBy: string, data?: Record<string, unknown>): Promise<void> {
    await this.db.query(
      `UPDATE hitl_tickets SET
        status = 'resolved', resolution_text = $1, resolved_by = $2,
        resolution_data = $3, resolved_at = NOW(), handoff_active = false, updated_at = NOW()
       WHERE id = $4`,
      [resolutionText, resolvedBy, JSON.stringify(data ?? {}), id],
    )
    await this.log(id, 'resolved', `human:${resolvedBy}`, { resolutionText })
  }

  async expire(id: string): Promise<void> {
    await this.db.query(
      `UPDATE hitl_tickets SET status = 'expired', handoff_active = false, updated_at = NOW() WHERE id = $1`,
      [id],
    )
    await this.log(id, 'expired', 'system')
  }

  async cancel(id: string, actor: string): Promise<void> {
    await this.db.query(
      `UPDATE hitl_tickets SET status = 'cancelled', handoff_active = false, updated_at = NOW() WHERE id = $1`,
      [id],
    )
    await this.log(id, 'cancelled', actor)
  }

  async setEscalated(id: string): Promise<void> {
    await this.db.query(
      `UPDATE hitl_tickets SET status = 'escalated', updated_at = NOW() WHERE id = $1`,
      [id],
    )
    await this.log(id, 'escalated', 'system', { reason: 'supervisor_chain_exhausted' })
  }

  async setNotified(id: string, assignedUserId: string, assignedChannel: string, assignedSenderId: string): Promise<void> {
    await this.db.query(
      `UPDATE hitl_tickets SET
        status = 'notified', assigned_user_id = $1, assigned_channel = $2,
        assigned_sender_id = $3, notification_count = 1, last_notified_at = NOW(), updated_at = NOW()
       WHERE id = $4`,
      [assignedUserId, assignedChannel, assignedSenderId, id],
    )
    await this.log(id, 'notified', 'system', { assignedUserId, assignedChannel })
  }

  async incrementFollowup(id: string): Promise<void> {
    await this.db.query(
      `UPDATE hitl_tickets SET
        status = 'waiting', notification_count = notification_count + 1,
        last_notified_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [id],
    )
    await this.log(id, 'reminded', 'system')
  }

  async escalate(id: string, newUser: { userId: string; channel: string; senderId: string }, previousHistory: EscalationEntry[]): Promise<void> {
    const history = [...previousHistory, {
      userId: newUser.userId,
      channel: newUser.channel,
      notifiedAt: new Date().toISOString(),
      followups: 0,
    }]
    await this.db.query(
      `UPDATE hitl_tickets SET
        assigned_user_id = $1, assigned_channel = $2, assigned_sender_id = $3,
        escalation_level = escalation_level + 1, escalation_history = $4,
        notification_count = 1, last_notified_at = NOW(), status = 'notified', updated_at = NOW()
       WHERE id = $5`,
      [newUser.userId, newUser.channel, newUser.senderId, JSON.stringify(history), id],
    )
    await this.log(id, 'escalated', 'system', { toUserId: newUser.userId })
  }

  async setHandoffActive(id: string, mode: string): Promise<void> {
    await this.db.query(
      `UPDATE hitl_tickets SET handoff_mode = $1, handoff_active = true, updated_at = NOW() WHERE id = $2`,
      [mode, id],
    )
    await this.log(id, 'handoff_started', 'system', { mode })
  }

  async clearHandoff(id: string): Promise<void> {
    await this.db.query(
      `UPDATE hitl_tickets SET handoff_active = false, updated_at = NOW() WHERE id = $1`,
      [id],
    )
    await this.log(id, 'handoff_returned', 'system')
  }

  // ─── Stale ticket finder (for follow-up job) ──
  async findStaleTickets(followupIntervalMs: number): Promise<HitlTicket[]> {
    const { rows } = await this.db.query(
      `SELECT * FROM hitl_tickets
       WHERE status IN ('notified', 'waiting')
         AND last_notified_at < NOW() - ($1 || ' milliseconds')::interval
       ORDER BY last_notified_at ASC`,
      [followupIntervalMs.toString()],
    )
    return rows.map(rowToTicket)
  }

  async findExpiredTickets(): Promise<HitlTicket[]> {
    const { rows } = await this.db.query(
      `SELECT * FROM hitl_tickets
       WHERE status NOT IN ('resolved', 'expired', 'cancelled')
         AND expires_at IS NOT NULL AND expires_at < NOW()`,
    )
    return rows.map(rowToTicket)
  }

  // ─── Audit log ──────────────────────────
  async log(ticketId: string, event: TicketEvent, actor: string, details: Record<string, unknown> = {}): Promise<void> {
    try {
      await this.db.query(
        `INSERT INTO hitl_ticket_log (ticket_id, event, actor, details) VALUES ($1, $2, $3, $4)`,
        [ticketId, event, actor, JSON.stringify(details)],
      )
    } catch (err) {
      logger.error({ err, ticketId, event }, 'Failed to write ticket log')
    }
  }

  async getTicketLog(ticketId: string): Promise<TicketLogEntry[]> {
    const { rows } = await this.db.query(
      `SELECT * FROM hitl_ticket_log WHERE ticket_id = $1 ORDER BY created_at ASC`,
      [ticketId],
    )
    return rows.map(rowToLogEntry)
  }

  // ─── Quote-based interception helpers ────

  async findByShortId(shortId: string): Promise<HitlTicket | null> {
    const { rows } = await this.db.query(
      `SELECT * FROM hitl_tickets
       WHERE RIGHT(id::text, 6) = $1
         AND status IN ('notified', 'waiting')
       ORDER BY created_at DESC
       LIMIT 1`,
      [shortId.toLowerCase()],
    )
    return rows[0] ? rowToTicket(rows[0]) : null
  }

  async listActiveByResponder(senderId: string, channel: string): Promise<HitlTicket[]> {
    const { rows } = await this.db.query(
      `SELECT * FROM hitl_tickets
       WHERE assigned_sender_id = $1
         AND assigned_channel = $2
         AND status IN ('notified', 'waiting')
       ORDER BY created_at ASC`,
      [senderId, channel],
    )
    return rows.map(rowToTicket)
  }
}
