// LUNA Engine — query_pending_items tool
// Unified query for commitments + HITL tickets.
// Lets the agent inspect pending items on demand (beyond what Phase 1 injects).

import pino from 'pino'
import type { Registry } from '../../../kernel/registry.js'

const logger = pino({ name: 'engine:tool:query-pending-items' })

interface ToolRegistry {
  registerTool(toolDef: {
    definition: {
      name: string
      displayName: string
      description: string
      category: string
      sourceModule: string
      parameters: {
        type: 'object'
        properties: Record<string, { type: string; description: string; enum?: string[] }>
        required?: string[]
      }
    }
    handler: (input: Record<string, unknown>, ctx: {
      contactId?: string; contactType?: string; correlationId: string
      db: import('pg').Pool; senderId?: string; channelName?: string
    }) => Promise<{ success: boolean; data?: unknown; error?: string }>
  }): Promise<void>
}

export async function registerQueryPendingItemsTool(registry: Registry): Promise<void> {
  const toolRegistry = registry.getOptional<ToolRegistry>('tools:registry')
  if (!toolRegistry) {
    logger.warn('tools:registry not available, query_pending_items tool not registered')
    return
  }

  await toolRegistry.registerTool({
    definition: {
      name: 'query_pending_items',
      displayName: 'Consultar Pendientes',
      description: 'Query pending commitments and/or HITL tickets for this contact. Admins/coworkers can also see items assigned to them across contacts with include_assigned_to_me=true.',
      category: 'internal',
      sourceModule: 'engine',
      parameters: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            enum: ['commitments', 'hitl', 'all'],
            description: 'What to query. Default: all.',
          },
          include_assigned_to_me: {
            type: 'boolean',
            description: 'Include items assigned to me (the human I am talking to) as responsible. Useful for admins/coworkers asking "what do we have pending?".',
          },
          status_filter: {
            type: 'string',
            enum: ['active', 'all'],
            description: 'Filter: "active" (pending/in_progress/waiting/overdue/notified) or "all" (include done/cancelled/resolved). Default: active.',
          },
        },
      },
    },
    handler: async (input, ctx) => {
      if (!ctx.contactId) {
        return { success: false, error: 'No contact_id in execution context' }
      }

      const queryType = String(input.type ?? 'all')
      const includeAssigned = input.include_assigned_to_me === true
      const statusFilter = String(input.status_filter ?? 'active')

      const result: {
        commitments?: unknown[]
        hitl_tickets?: unknown[]
        summary: { total_commitments: number; total_hitl: number }
      } = {
        summary: { total_commitments: 0, total_hitl: 0 },
      }

      try {
        // ── Commitments ──
        if (queryType === 'commitments' || queryType === 'all') {
          const statusClause = statusFilter === 'active'
            ? `AND cm.status IN ('pending', 'in_progress', 'waiting', 'overdue')`
            : ''

          // Commitments for this contact
          const contactCommitments = await ctx.db.query(
            `SELECT cm.id, cm.description, cm.category, cm.commitment_type,
                    cm.status, cm.priority, cm.due_at, cm.scheduled_at,
                    cm.action_taken, cm.wait_type, cm.blocked_reason,
                    cm.attempt_count, cm.last_attempt_at, cm.next_check_at,
                    cm.created_at, cm.external_id, cm.external_provider,
                    EXTRACT(EPOCH FROM (now() - cm.created_at)) / 3600 AS hours_open
             FROM commitments cm
             WHERE cm.contact_id = $1 ${statusClause}
             ORDER BY
               CASE cm.status WHEN 'overdue' THEN 0 WHEN 'in_progress' THEN 1 WHEN 'pending' THEN 2 WHEN 'waiting' THEN 3 ELSE 4 END,
               CASE cm.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
               cm.due_at ASC NULLS LAST
             LIMIT 20`,
            [ctx.contactId],
          )

          const commitments = contactCommitments.rows.map(formatCommitment)

          // If admin/coworker wants their assigned items
          if (includeAssigned && ctx.senderId) {
            const assignedCommitments = await ctx.db.query(
              `SELECT cm.id, cm.description, cm.category, cm.commitment_type,
                      cm.status, cm.priority, cm.due_at, cm.scheduled_at,
                      cm.action_taken, cm.wait_type, cm.blocked_reason,
                      cm.attempt_count, cm.last_attempt_at, cm.next_check_at,
                      cm.created_at, cm.external_id, cm.external_provider,
                      EXTRACT(EPOCH FROM (now() - cm.created_at)) / 3600 AS hours_open,
                      c.display_name AS contact_name
               FROM commitments cm
               JOIN contacts c ON c.id = cm.contact_id
               WHERE cm.assigned_to = $1
                 AND cm.contact_id != $2
                 ${statusClause}
               ORDER BY cm.due_at ASC NULLS LAST
               LIMIT 10`,
              [ctx.senderId, ctx.contactId],
            )
            for (const row of assignedCommitments.rows) {
              commitments.push({ ...formatCommitment(row), contact_name: row.contact_name })
            }
          }

          result.commitments = commitments
          result.summary.total_commitments = commitments.length
        }

        // ── HITL Tickets ──
        if (queryType === 'hitl' || queryType === 'all') {
          const hitlStatusClause = statusFilter === 'active'
            ? `AND ht.status IN ('pending', 'notified', 'waiting')`
            : ''

          // HITL tickets for this contact
          const contactTickets = await ctx.db.query(
            `SELECT ht.id, ht.request_type, ht.request_summary, ht.status,
                    ht.urgency, ht.assigned_user_id, ht.assigned_channel,
                    ht.requester_channel, ht.target_role,
                    ht.resolution_text, ht.handoff_mode, ht.handoff_active,
                    ht.created_at, ht.expires_at, ht.resolved_at,
                    ht.notification_count,
                    EXTRACT(EPOCH FROM (now() - ht.created_at)) / 3600 AS hours_open
             FROM hitl_tickets ht
             WHERE ht.requester_contact_id = $1 ${hitlStatusClause}
             ORDER BY ht.created_at DESC
             LIMIT 10`,
            [ctx.contactId],
          )

          const tickets = contactTickets.rows.map(formatHitlTicket)

          // If admin/coworker wants their assigned HITL tickets
          if (includeAssigned && ctx.senderId) {
            const assignedTickets = await ctx.db.query(
              `SELECT ht.id, ht.request_type, ht.request_summary, ht.status,
                      ht.urgency, ht.assigned_user_id, ht.assigned_channel,
                      ht.requester_channel, ht.target_role,
                      ht.resolution_text, ht.handoff_mode, ht.handoff_active,
                      ht.created_at, ht.expires_at, ht.resolved_at,
                      ht.notification_count,
                      EXTRACT(EPOCH FROM (now() - ht.created_at)) / 3600 AS hours_open,
                      c.display_name AS contact_name
               FROM hitl_tickets ht
               JOIN contacts c ON c.id = ht.requester_contact_id
               WHERE ht.assigned_sender_id = $1
                 AND ht.requester_contact_id != $2
                 ${hitlStatusClause}
               ORDER BY ht.created_at DESC
               LIMIT 10`,
              [ctx.senderId, ctx.contactId],
            )
            for (const row of assignedTickets.rows) {
              tickets.push({ ...formatHitlTicket(row), contact_name: row.contact_name })
            }
          }

          result.hitl_tickets = tickets
          result.summary.total_hitl = tickets.length
        }

        return { success: true, data: result }
      } catch (err) {
        logger.error({ err, contactId: ctx.contactId }, 'Failed to query pending items')
        return { success: false, error: 'Failed to query pending items' }
      }
    },
  })

  logger.info('query_pending_items tool registered')
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function formatCommitment(row: any): Record<string, unknown> {
  return {
    id: row.id,
    description: row.description,
    category: row.category,
    type: row.commitment_type,
    status: row.status,
    priority: row.priority,
    due_at: row.due_at?.toISOString() ?? null,
    scheduled_at: row.scheduled_at?.toISOString() ?? null,
    action_taken: row.action_taken,
    wait_type: row.wait_type,
    blocked_reason: row.blocked_reason,
    attempt_count: row.attempt_count,
    last_attempt_at: row.last_attempt_at?.toISOString() ?? null,
    next_check_at: row.next_check_at?.toISOString() ?? null,
    created_at: row.created_at?.toISOString() ?? null,
    hours_open: row.hours_open ? Math.round(Number(row.hours_open) * 10) / 10 : null,
    external_ref: row.external_id ? `${row.external_provider ?? 'unknown'}:${row.external_id}` : null,
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function formatHitlTicket(row: any): Record<string, unknown> {
  return {
    ticket_id: row.id,
    request_type: row.request_type,
    summary: row.request_summary,
    status: row.status,
    urgency: row.urgency,
    assigned_to: row.assigned_user_id,
    assigned_channel: row.assigned_channel,
    requester_channel: row.requester_channel,
    target_role: row.target_role,
    resolution: row.resolution_text,
    handoff_active: row.handoff_active,
    created_at: row.created_at?.toISOString() ?? null,
    expires_at: row.expires_at?.toISOString() ?? null,
    resolved_at: row.resolved_at?.toISOString() ?? null,
    hours_open: row.hours_open ? Math.round(Number(row.hours_open) * 10) / 10 : null,
    notification_count: row.notification_count,
  }
}
