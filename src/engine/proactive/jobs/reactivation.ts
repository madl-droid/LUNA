// LUNA Engine — Reactivation Scanner Job
// Finds cold leads inactive for > X days and attempts to re-engage.
// Runs on a cron schedule (daily by default).

import pino from 'pino'
import type { ProactiveJobContext, ProactiveCandidate } from '../../types.js'
import type { ChannelName } from '../../../channels/types.js'
import { processProactive } from '../proactive-pipeline.js'

const logger = pino({ name: 'engine:job:reactivation' })

export async function runReactivation(ctx: ProactiveJobContext): Promise<void> {
  const config = ctx.proactiveConfig
  if (!config.reactivation.enabled) return

  logger.info({ traceId: ctx.traceId }, 'Reactivation scanner starting')

  const daysInactive = config.reactivation.days_inactive
  const maxAttempts = config.reactivation.max_attempts
  const maxPerRun = config.reactivation.max_per_run
  try {
    // Find cold leads that haven't been reactivated too many times
    // Uses metadata JSONB to track reactivation attempts
    const result = await ctx.db.query(
      `SELECT ac.contact_id, ac.follow_up_count,
              c.display_name,
              cc.channel_identifier, cc.channel_type,
              COALESCE((ac.agent_data->>'reactivation_attempts')::int, 0) AS reactivation_attempts
       FROM agent_contacts ac
       JOIN contacts c ON c.id = ac.contact_id
       JOIN contact_channels cc ON cc.contact_id = ac.contact_id AND cc.is_primary = true
       WHERE ac.lead_status = 'cold'
         AND ac.updated_at < now() - interval '1 day' * $1
         AND COALESCE((ac.agent_data->>'reactivation_attempts')::int, 0) < $2
       ORDER BY ac.updated_at DESC
       LIMIT $3`,
      [daysInactive, maxAttempts, maxPerRun],
    )

    let processed = 0
    for (const row of result.rows) {
      const attempts = (row.reactivation_attempts as number) ?? 0

      const candidate: ProactiveCandidate = {
        contactId: row.contact_id,
        channelContactId: row.channel_identifier,
        channel: row.channel_type as ChannelName,
        displayName: row.display_name,
        triggerType: 'reactivation',
        reason: `Cold lead for >${daysInactive} days. Reactivation attempt ${attempts + 1}/${maxAttempts}.`,
      }

      try {
        const pipelineResult = await processProactive(
          candidate, ctx.db, ctx.redis, ctx.registry, ctx.engineConfig, config,
        )

        if (pipelineResult.success) {
          // Increment reactivation attempts in agent_data
          await ctx.db.query(
            `UPDATE agent_contacts
             SET agent_data = jsonb_set(
               COALESCE(agent_data, '{}'),
               '{reactivation_attempts}',
               to_jsonb(COALESCE((agent_data->>'reactivation_attempts')::int, 0) + 1)
             )
             WHERE contact_id = $1`,
            [row.contact_id],
          )
          processed++
        }
      } catch (err) {
        logger.error({ err, contactId: row.contact_id, traceId: ctx.traceId }, 'Reactivation pipeline failed')
      }
    }

    logger.info({ traceId: ctx.traceId, checked: result.rows.length, processed }, 'Reactivation scanner complete')
  } catch (err) {
    logger.error({ traceId: ctx.traceId, err }, 'Reactivation scanner failed')
  }
}
