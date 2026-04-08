// LUNA Engine — set_follow_up_intensity tool
// Lets the agent adjust follow-up intensity for a contact based on conversation context.

import pino from 'pino'
import type { Registry } from '../../../kernel/registry.js'
import { INTENSITY_LEVELS, type FollowUpIntensity } from '../intensity.js'

const logger = pino({ name: 'engine:tool:set-intensity' })

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
      contactId?: string; correlationId: string; db: import('pg').Pool
    }) => Promise<{ success: boolean; data?: unknown; error?: string }>
  }): Promise<void>
}

export async function registerSetIntensityTool(registry: Registry): Promise<void> {
  const toolRegistry = registry.getOptional<ToolRegistry>('tools:registry')
  if (!toolRegistry) {
    logger.warn('tools:registry not available, set_follow_up_intensity tool not registered')
    return
  }

  const levels = Object.entries(INTENSITY_LEVELS)
    .map(([k, v]) => `${k}: follow-up every ${v.inactivityHours}h, max ${v.maxAttempts} attempts`)
    .join('; ')

  await toolRegistry.registerTool({
    definition: {
      name: 'set_follow_up_intensity',
      displayName: 'Configurar Intensidad de Seguimiento',
      description: `Set follow-up intensity for this contact. Levels: ${levels}. Use based on contact's engagement and interest level.`,
      category: 'internal',
      sourceModule: 'engine',
      parameters: {
        type: 'object',
        properties: {
          intensity: {
            type: 'string',
            enum: Object.keys(INTENSITY_LEVELS),
            description: "Follow-up intensity level. aggressive=hot lead, normal=standard, gentle=don't push, minimal=almost no follow-up.",
          },
          reason: {
            type: 'string',
            description: 'Why this intensity was chosen (for audit trail).',
          },
        },
        required: ['intensity'],
      },
    },
    handler: async (input, ctx) => {
      if (!ctx.contactId) {
        return { success: false, error: 'No contact_id in execution context' }
      }

      const intensity = String(input['intensity']) as FollowUpIntensity
      if (!(intensity in INTENSITY_LEVELS)) {
        return {
          success: false,
          error: `Invalid intensity: ${intensity}. Use: ${Object.keys(INTENSITY_LEVELS).join(', ')}`,
        }
      }

      try {
        await ctx.db.query(
          `UPDATE agent_contacts SET follow_up_intensity = $1, updated_at = now()
           WHERE contact_id = $2`,
          [intensity, ctx.contactId],
        )

        const config = INTENSITY_LEVELS[intensity]
        logger.info({ contactId: ctx.contactId, intensity, reason: input['reason'] }, 'Follow-up intensity updated')

        return {
          success: true,
          data: {
            intensity,
            inactivity_hours: config.inactivityHours,
            max_attempts: config.maxAttempts,
            message: `Seguimiento configurado: ${intensity} (cada ${config.inactivityHours}h, máx ${config.maxAttempts} intentos)`,
          },
        }
      } catch (err) {
        logger.error({ err, contactId: ctx.contactId }, 'Failed to set follow-up intensity')
        return { success: false, error: 'Failed to update follow-up intensity' }
      }
    },
  })

  logger.info('set_follow_up_intensity tool registered')
}
