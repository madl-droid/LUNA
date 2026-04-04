// LUNA Engine — create_commitment tool
// Registered with tools:registry so the evaluator can include it in execution plans.
// Validates against proactive.json commitment types.

import pino from 'pino'
import type { Registry } from '../../../kernel/registry.js'
import type { MemoryManager } from '../../../modules/memory/memory-manager.js'
import type { ProactiveConfig } from '../../types.js'
import { validateCommitment } from '../commitment-validator.js'

const logger = pino({ name: 'engine:tool:create-commitment' })

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
    handler: (input: Record<string, unknown>, ctx: { contactId?: string; correlationId: string }) => Promise<{ success: boolean; data?: unknown; error?: string }>
  }): Promise<void>
}

/**
 * Register the create_commitment tool with the tools registry.
 */
export async function registerCreateCommitmentTool(
  registry: Registry,
  proactiveConfig: ProactiveConfig,
): Promise<void> {
  const toolRegistry = registry.getOptional<ToolRegistry>('tools:registry')
  if (!toolRegistry) {
    logger.warn('tools:registry not available, create_commitment tool not registered')
    return
  }

  // Build enum of known commitment types from config
  const knownTypes = proactiveConfig.commitments.commitment_types.map(ct => ct.type)

  // Read business hours from engine config for dynamic description
  const bhSvc = registry.getOptional<{ get(): { start: number; end: number; days: number[] } }>('engine:business-hours')
  const bh = bhSvc?.get()
  const bhStart = bh?.start ?? 8
  const bhEnd = bh?.end ?? 17

  await toolRegistry.registerTool({
    definition: {
      name: 'create_commitment',
      displayName: 'Crear Compromiso',
      description: `Create a commitment (promise to the contact). The system will track it and remind you to fulfill it.

TIMING GUIDELINES — always set due_within_hours and scheduled_at_hours based on context, not defaults:
- If the contact said a specific time ("mañana", "el lunes", "en 2 horas"), honor it.
- If urgency is high or the contact is waiting, use short deadlines (1-4h).
- If it's a routine follow-up with no rush, 24-72h is appropriate.
- Use scheduled_at_hours to delay execution to business hours (${bhStart}:00-${bhEnd}:00 local) if the commitment would fire at night or on weekends.
- When the contact explicitly says they'll call back or needs time, set a longer due + scheduled_at to give them space.
- The system defaults are fallbacks only — you should ALWAYS provide explicit timing when context makes it clear.`,
      category: 'internal',
      sourceModule: 'engine',
      parameters: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            description: `Type of commitment. Known types: ${knownTypes.join(', ')}. Use a descriptive name if none match.`,
          },
          description: {
            type: 'string',
            description: 'What was promised to the contact. Be specific.',
          },
          category: {
            type: 'string',
            enum: ['followup', 'email', 'quote', 'meeting', 'delivery', 'call', 'voice', 'notification', 'send_message', 'schedule_appointment', 'reschedule'],
            description: 'Category of the commitment. Helps classify and set default deadlines.',
          },
          due_within_hours: {
            type: 'number',
            description: 'Hours from now until the commitment should be fulfilled. Default depends on type. No upper limit — use your best judgment.',
          },
          scheduled_at_hours: {
            type: 'number',
            description: 'Hours from now to schedule execution. If different from due_within_hours, the commitment will not trigger proactively until this time even if due_at has passed. Useful for respecting business hours or patient preferences.',
          },
        },
        required: ['type', 'description'],
      },
    },
    handler: async (input, ctx) => {
      const memMgr = registry.getOptional<MemoryManager>('memory:manager')
      if (!memMgr) {
        return { success: false, error: 'Memory manager not available' }
      }

      if (!ctx.contactId) {
        return { success: false, error: 'No contact_id in execution context' }
      }

      const validation = validateCommitment(
        {
          type: String(input.type ?? 'action'),
          description: String(input.description ?? ''),
          contactId: ctx.contactId,
          dueWithinHours: typeof input.due_within_hours === 'number' ? input.due_within_hours : undefined,
          category: input.category ? String(input.category) : undefined,
          scheduledAtHours: typeof input.scheduled_at_hours === 'number' ? input.scheduled_at_hours : undefined,
        },
        proactiveConfig,
        'tool',
      )

      if (validation.status === 'rejected') {
        logger.warn({ reason: validation.reason, contactId: ctx.contactId }, 'Commitment rejected')
        return { success: false, error: validation.reason }
      }

      try {
        const commitmentId = await memMgr.saveCommitment(validation.commitment)
        logger.info({
          commitmentId,
          type: validation.commitment.commitmentType,
          status: validation.status,
          contactId: ctx.contactId,
        }, 'Commitment created via tool')
        return {
          success: true,
          data: {
            commitment_id: commitmentId,
            type: validation.commitment.commitmentType,
            category: validation.status, // 'known' or 'generic'
            due_at: validation.commitment.dueAt?.toISOString(),
            auto_cancel_at: validation.commitment.autoCancelAt?.toISOString(),
          },
        }
      } catch (err) {
        logger.error({ err, contactId: ctx.contactId }, 'Failed to save commitment')
        return { success: false, error: 'Failed to save commitment' }
      }
    },
  })

  logger.info({ knownTypes }, 'create_commitment tool registered')
}
