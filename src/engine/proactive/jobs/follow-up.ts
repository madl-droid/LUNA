// LUNA Engine — Follow-Up Scanner Job
// Finds leads inactive for > X hours with status new/qualifying and < max follow-ups.
// Enqueues each as a ProactiveCandidate to the proactive pipeline.

import pino from 'pino'
import type { ProactiveJobContext, ProactiveCandidate } from '../../types.js'
import type { ChannelName } from '../../../channels/types.js'
import { processProactive } from '../proactive-pipeline.js'

const logger = pino({ name: 'engine:job:follow-up' })

export async function runFollowUp(ctx: ProactiveJobContext): Promise<void> {
  const config = ctx.proactiveConfig
  if (!config.follow_up.enabled) return

  logger.info({ traceId: ctx.traceId }, 'Follow-up scanner starting')

  const inactivityHours = config.follow_up.inactivity_hours
  const maxAttempts = config.follow_up.max_attempts

  try {
    // Find leads needing follow-up:
    // - Last interaction > X hours ago (but < 7 days to avoid ancient)
    // - Status is new or qualifying
    // - Follow-up count < max
    const result = await ctx.db.query(
      `SELECT ac.contact_id, ac.follow_up_count,
              c.display_name,
              cc.channel_contact_id, cc.channel_name
       FROM agent_contacts ac
       JOIN contacts c ON c.id = ac.contact_id
       JOIN contact_channels cc ON cc.contact_id = ac.contact_id AND cc.is_primary = true
       WHERE ac.agent_id = (SELECT id FROM agents WHERE slug = 'luna' LIMIT 1)
         AND ac.lead_status IN ('new', 'qualifying')
         AND ac.follow_up_count < $1
         AND ac.updated_at < now() - interval '1 hour' * $2
         AND ac.updated_at > now() - interval '7 days'
       ORDER BY ac.updated_at ASC
       LIMIT 20`,
      [maxAttempts, inactivityHours],
    )

    let processed = 0
    for (const row of result.rows) {
      const candidate: ProactiveCandidate = {
        contactId: row.contact_id,
        channelContactId: row.channel_contact_id,
        channel: row.channel_name as ChannelName,
        displayName: row.display_name,
        triggerType: 'follow_up',
        reason: `Lead inactive for >${inactivityHours}h. Follow-up ${(row.follow_up_count ?? 0) + 1}/${maxAttempts}.`,
      }

      try {
        const pipelineResult = await processProactive(
          candidate, ctx.db, ctx.redis, ctx.registry, ctx.engineConfig, config,
        )

        if (pipelineResult.success) {
          // Increment follow-up count
          await ctx.db.query(
            `UPDATE agent_contacts
             SET follow_up_count = follow_up_count + 1, last_follow_up_at = now()
             WHERE contact_id = $1 AND agent_id = (SELECT id FROM agents WHERE slug = 'luna' LIMIT 1)`,
            [row.contact_id],
          )
          processed++

          // Check if max attempts reached → transition to cold
          const newCount = (row.follow_up_count ?? 0) + 1
          if (newCount >= maxAttempts) {
            await transitionToCold(ctx, row.contact_id)
          }
        }
      } catch (err) {
        logger.error({ err, contactId: row.contact_id, traceId: ctx.traceId }, 'Follow-up pipeline failed for candidate')
      }
    }

    logger.info({ traceId: ctx.traceId, checked: result.rows.length, processed }, 'Follow-up scanner complete')
  } catch (err) {
    logger.error({ traceId: ctx.traceId, err }, 'Follow-up scanner failed')
  }
}

async function transitionToCold(ctx: ProactiveJobContext, contactId: string): Promise<void> {
  try {
    await ctx.db.query(
      `UPDATE agent_contacts SET lead_status = 'cold'
       WHERE contact_id = $1 AND agent_id = (SELECT id FROM agents WHERE slug = 'luna' LIMIT 1)
         AND lead_status IN ('new', 'qualifying')`,
      [contactId],
    )
    logger.info({ contactId, traceId: ctx.traceId }, 'Lead transitioned to cold after max follow-ups')
  } catch (err) {
    logger.warn({ err, contactId }, 'Failed to transition lead to cold')
  }
}
