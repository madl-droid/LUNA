// LUNA Engine — update_commitment tool
// Lets the agent update commitment status, action_taken, wait_type, etc.
// Closes the loop: without this, commitments are zombies that repeat forever.

import pino from 'pino'
import type { Registry } from '../../../kernel/registry.js'
import type { CommitmentStatus } from '../../../modules/memory/types.js'

const logger = pino({ name: 'engine:tool:update-commitment' })

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
    handler: (input: Record<string, unknown>, ctx: { contactId?: string; correlationId: string; db: import('pg').Pool }) => Promise<{ success: boolean; data?: unknown; error?: string }>
  }): Promise<void>
}

export async function registerUpdateCommitmentTool(registry: Registry): Promise<void> {
  const toolRegistry = registry.getOptional<ToolRegistry>('tools:registry')
  if (!toolRegistry) {
    logger.warn('tools:registry not available, update_commitment tool not registered')
    return
  }

  await toolRegistry.registerTool({
    definition: {
      name: 'update_commitment',
      displayName: 'Actualizar Compromiso',
      description: 'Update the status of an existing commitment. Use when fulfilling a promise (status=done + action_taken), when blocked (status=waiting + wait_type), or to cancel.',
      category: 'internal',
      sourceModule: 'engine',
      parameters: {
        type: 'object',
        properties: {
          commitment_id: {
            type: 'string',
            description: 'ID of the commitment to update',
          },
          status: {
            type: 'string',
            enum: ['pending', 'in_progress', 'waiting', 'done', 'cancelled'],
            description: 'New status. Use "done" when fulfilled, "waiting" when blocked, "cancelled" to abandon.',
          },
          action_taken: {
            type: 'string',
            description: 'What was done to fulfill the commitment. Required when status=done.',
          },
          wait_type: {
            type: 'string',
            enum: ['client_response', 'business_hours', 'info_needed', 'external_action'],
            description: 'Why the commitment is waiting. Used when status=waiting.',
          },
          blocked_reason: {
            type: 'string',
            description: 'Free-text reason for being blocked or cancelled.',
          },
          priority: {
            type: 'string',
            enum: ['low', 'normal', 'high', 'urgent'],
            description: 'Update priority level.',
          },
        },
        required: ['commitment_id', 'status'],
      },
    },
    handler: async (input, ctx) => {
      if (!ctx.contactId) {
        return { success: false, error: 'No contact_id in execution context' }
      }

      const commitmentId = String(input.commitment_id ?? '')
      const newStatus = String(input.status ?? '') as CommitmentStatus
      const actionTaken = input.action_taken ? String(input.action_taken) : null
      const waitType = input.wait_type ? String(input.wait_type) : null
      const blockedReason = input.blocked_reason ? String(input.blocked_reason) : null
      const priority = input.priority ? String(input.priority) : null

      if (!commitmentId) {
        return { success: false, error: 'commitment_id is required' }
      }

      // Validate: action_taken required for done
      if (newStatus === 'done' && !actionTaken) {
        return { success: false, error: 'action_taken is required when marking as done' }
      }

      try {
        // Verify the commitment exists and belongs to this contact (or is assigned to them)
        const { rows: existing } = await ctx.db.query(
          `SELECT id, contact_id, assigned_to, status, parent_id FROM commitments WHERE id = $1`,
          [commitmentId],
        )

        if (existing.length === 0) {
          return { success: false, error: 'Commitment not found' }
        }

        const commitment = existing[0]!

        // Security: commitment must belong to the contact in context,
        // OR be assigned to the current user (human closing an assigned commitment).
        if (commitment.contact_id !== ctx.contactId) {
          let isAssignedToMe = false
          if (commitment.assigned_to) {
            const { rows: channels } = await ctx.db.query(
              `SELECT 1 FROM contact_channels WHERE contact_id = $1 AND channel_identifier = $2 LIMIT 1`,
              [ctx.contactId, commitment.assigned_to],
            )
            isAssignedToMe = channels.length > 0
          }
          if (!isAssignedToMe) {
            return { success: false, error: 'Cannot update commitments for other contacts' }
          }
        }

        // Build dynamic UPDATE
        const sets: string[] = ['status = $1', 'updated_at = now()']
        const values: unknown[] = [newStatus]
        let paramIdx = 2

        if (newStatus === 'done') {
          sets.push(`completed_at = now()`)
        }

        if (actionTaken) {
          sets.push(`action_taken = $${paramIdx}`)
          values.push(actionTaken)
          paramIdx++
        }

        if (waitType) {
          sets.push(`wait_type = $${paramIdx}`)
          values.push(waitType)
          paramIdx++
        }

        if (blockedReason) {
          sets.push(`blocked_reason = $${paramIdx}`)
          values.push(blockedReason)
          paramIdx++
        }

        if (priority) {
          sets.push(`priority = $${paramIdx}`)
          values.push(priority)
          paramIdx++
        }

        // Increment attempt_count + last_attempt_at
        sets.push(`attempt_count = attempt_count + 1`)
        sets.push(`last_attempt_at = now()`)

        values.push(commitmentId)
        const whereIdx = paramIdx

        await ctx.db.query(
          `UPDATE commitments SET ${sets.join(', ')} WHERE id = $${whereIdx}`,
          values,
        )

        // Auto-complete parent if all children are done
        if (commitment.parent_id && newStatus === 'done') {
          const { rows: siblings } = await ctx.db.query(
            `SELECT COUNT(*)::int AS total,
                    COUNT(*) FILTER (WHERE status = 'done')::int AS done_count
             FROM commitments WHERE parent_id = $1`,
            [commitment.parent_id],
          )
          const sibling = siblings[0]
          if (sibling && sibling.total === sibling.done_count) {
            await ctx.db.query(
              `UPDATE commitments SET status = 'done', completed_at = now(),
                      action_taken = 'Auto-completed: all sub-tasks done', updated_at = now()
               WHERE id = $1 AND status NOT IN ('done', 'cancelled')`,
              [commitment.parent_id],
            )
            logger.info({ parentId: commitment.parent_id }, 'Parent commitment auto-completed')
          }
        }

        logger.info({
          commitmentId,
          newStatus,
          contactId: ctx.contactId,
          actionTaken: actionTaken?.slice(0, 100),
        }, 'Commitment updated via tool')

        return {
          success: true,
          data: {
            commitment_id: commitmentId,
            status: newStatus,
            action_taken: actionTaken,
            message: newStatus === 'done'
              ? 'Compromiso completado'
              : `Compromiso actualizado a "${newStatus}"`,
          },
        }
      } catch (err) {
        logger.error({ err, commitmentId, contactId: ctx.contactId }, 'Failed to update commitment')
        return { success: false, error: 'Failed to update commitment' }
      }
    },
  })

  logger.info('update_commitment tool registered')
}
