// hitl/tool.ts — Register request_human_help tool with tools:registry

import type { Registry } from '../../kernel/registry.js'
import type { HitlConfig, RequestHumanHelpInput } from './types.js'
import { TicketStore } from './ticket-store.js'
import { selectResponder } from './responder-selector.js'
import { sendNotification } from './notifier.js'
import { getHandoffAction, activateHandoff } from './handoff.js'
import pino from 'pino'

const logger = pino({ name: 'hitl:tool' })

/** Minimal tool registry interface (avoids direct import from tools module) */
interface ToolRegistry {
  registerTool(def: {
    definition: Record<string, unknown>
    handler: (input: Record<string, unknown>, ctx: Record<string, unknown>) => Promise<Record<string, unknown>>
  }): Promise<void>
}

export async function registerHitlTool(
  registry: Registry,
  ticketStore: TicketStore,
  getConfig: () => HitlConfig,
): Promise<void> {
  const toolRegistry = registry.getOptional<ToolRegistry>('tools:registry')
  if (!toolRegistry) {
    logger.warn('tools:registry not available — HITL tool not registered')
    return
  }

  await toolRegistry.registerTool({
    definition: {
      name: 'request_human_help',
      displayName: 'Request Human Help',
      description:
        'Request help, authorization, or escalation from a human team member. '
        + 'Use target_role="admin" for approvals, authorizations, financial decisions, policy exceptions, escalations. '
        + 'Use target_role="coworker" for domain expertise, availability checks, technical questions. '
        + 'Returns immediately with pending status — the human responds asynchronously.',
      category: 'internal',
      sourceModule: 'hitl',
      parameters: {
        type: 'object',
        properties: {
          target_role: {
            type: 'string',
            enum: ['admin', 'coworker'],
            description: 'Who to contact: admin for authority decisions, coworker for domain help',
          },
          request_type: {
            type: 'string',
            enum: ['authorization', 'domain_help', 'availability', 'escalation', 'custom'],
            description: 'Type of request',
          },
          summary: {
            type: 'string',
            description: 'Clear summary of what you need from the human',
          },
          urgency: {
            type: 'string',
            enum: ['low', 'normal', 'high', 'critical'],
            description: 'Urgency level (default: normal)',
          },
          context: {
            type: 'string',
            description: 'Relevant conversation context for the human to understand the situation',
          },
        },
        required: ['target_role', 'request_type', 'summary'],
      },
    },

    handler: async (input: Record<string, unknown>, ctx: Record<string, unknown>) => {
      const config = getConfig()
      if (!config.HITL_ENABLED) {
        return { success: false, error: 'HITL is disabled' }
      }

      const params = input as unknown as RequestHumanHelpInput
      const contactId = (ctx.contactId as string) ?? 'unknown'
      const channelName = (ctx.channelName as string) ?? 'unknown'
      const senderId = (ctx.senderId as string) ?? contactId
      const sessionId = (ctx.sessionId as string) ?? null
      const correlationId = (ctx.correlationId as string) ?? null

      // Select a human responder
      const responder = await selectResponder(
        params.target_role,
        config.HITL_DEFAULT_CHANNEL,
        registry,
      )

      if (!responder) {
        logger.error({ targetRole: params.target_role }, 'No responder available for HITL')
        return {
          success: false,
          error: 'No team members available at this time',
        }
      }

      // Determine handoff mode
      const handoffMode = getHandoffAction(channelName)

      // Check for repetition trigger (2+ tickets in same session)
      const recentCount = await ticketStore.countRecentTickets(senderId, channelName, sessionId)
      const forceHandoff = recentCount >= 2

      // Create ticket
      const ticket = await ticketStore.create({
        requesterContactId: contactId,
        requesterChannel: channelName,
        requesterSenderId: senderId,
        sessionId: sessionId ?? undefined,
        correlationId: correlationId ?? undefined,
        requestType: params.request_type,
        requestSummary: params.summary,
        requestContext: {
          clientMessage: params.context ?? '',
          toolInput: params,
        },
        urgency: params.urgency,
        targetRole: params.target_role,
        assignedUserId: responder.userId,
        assignedChannel: responder.channel,
        assignedSenderId: responder.senderId,
        handoffMode: forceHandoff ? handoffMode : 'intermediary',
        ttlHours: config.HITL_TICKET_TTL_HOURS,
      })

      // Set notified status
      await ticketStore.setNotified(
        ticket.id, responder.userId, responder.channel, responder.senderId,
      )

      // If handoff triggered by repetition, activate it
      if (forceHandoff && handoffMode === 'full_handoff') {
        const redis = registry.getRedis()
        await activateHandoff(ticket, redis)
        await ticketStore.setHandoffActive(ticket.id, handoffMode)
      }

      // Set Redis pending key for context injection
      const redis = registry.getRedis()
      await redis.set(
        `hitl:pending:${channelName}:${senderId}`,
        JSON.stringify({ ticketId: ticket.id, requestType: ticket.requestType, summary: ticket.requestSummary }),
        'EX', config.HITL_TICKET_TTL_HOURS * 3600,
      )

      // Send notification to human
      await sendNotification(responder, { ...ticket, handoffMode: forceHandoff ? handoffMode : ticket.handoffMode }, registry)

      // Fire hook
      await registry.runHook('hitl:ticket_created', {
        ticketId: ticket.id,
        targetRole: params.target_role,
        requestType: params.request_type,
        urgency: params.urgency ?? 'normal',
      })

      logger.info({
        ticketId: ticket.id,
        responder: responder.userId,
        handoff: forceHandoff,
      }, 'HITL ticket created')

      return {
        success: true,
        data: {
          ticketId: ticket.id,
          status: 'pending',
          assignedTo: responder.displayName ?? responder.userId,
          assignedChannel: responder.channel,
          handoffTriggered: forceHandoff,
        },
      }
    },
  })

  logger.info('Registered request_human_help tool')
}
