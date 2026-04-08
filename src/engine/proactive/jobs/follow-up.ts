// LUNA Engine — Follow-Up Scanner Job
// Finds leads inactive for > X hours with status new/qualifying and < max follow-ups.
// Enqueues each as a ProactiveCandidate to the proactive pipeline.
// Supports cross-channel follow-up: when primary channel exhausts attempts,
// tries secondary channels before transitioning to cold.
// Per-contact intensity: reads follow_up_intensity from agent_contacts and
// applies individual inactivity_hours / max_attempts instead of global defaults.

import pino from 'pino'
import type { Pool } from 'pg'
import type { ProactiveJobContext, ProactiveCandidate } from '../../types.js'
import type { ChannelName } from '../../../channels/types.js'
import { processProactive } from '../proactive-pipeline.js'
import { resolveIntensity } from '../intensity.js'

const logger = pino({ name: 'engine:job:follow-up' })

export async function runFollowUp(ctx: ProactiveJobContext): Promise<void> {
  const config = ctx.proactiveConfig
  if (!config.follow_up.enabled) return

  logger.info({ traceId: ctx.traceId }, 'Follow-up scanner starting')

  try {
    // Fetch all leads in active statuses updated within the last 7 days.
    // Filtering by inactivity_hours and max_attempts is done per-row in code
    // because each contact may have a different intensity level.
    const result = await ctx.db.query(
      `SELECT ac.contact_id, ac.follow_up_count, ac.follow_up_intensity, ac.updated_at,
              c.display_name,
              cc.channel_identifier, cc.channel_type
       FROM agent_contacts ac
       JOIN contacts c ON c.id = ac.contact_id
       JOIN contact_channels cc ON cc.contact_id = ac.contact_id AND cc.is_primary = true
       WHERE ac.lead_status IN ('new', 'qualifying')
         AND ac.updated_at > now() - interval '7 days'
       ORDER BY ac.updated_at ASC
       LIMIT 40`,
    )

    // Filter candidates by their individual intensity config
    const now = Date.now()
    const candidates = result.rows.filter((row: Record<string, unknown>) => {
      const intensity = resolveIntensity(
        row['follow_up_intensity'] as string | null,
        config.follow_up.inactivity_hours,
        config.follow_up.max_attempts,
      )

      const lastActivity = new Date(row['updated_at'] as string)
      const hoursSinceActivity = (now - lastActivity.getTime()) / (1000 * 60 * 60)
      if (hoursSinceActivity < intensity.inactivityHours) return false
      if ((row['follow_up_count'] as number ?? 0) >= intensity.maxAttempts) return false
      return true
    })

    let processed = 0
    for (const row of candidates) {
      const intensity = resolveIntensity(
        row['follow_up_intensity'] as string | null,
        config.follow_up.inactivity_hours,
        config.follow_up.max_attempts,
      )
      const followUpCount = (row['follow_up_count'] as number ?? 0)

      const candidate: ProactiveCandidate = {
        contactId: row['contact_id'] as string,
        channelContactId: row['channel_identifier'] as string,
        channel: row['channel_type'] as ChannelName,
        displayName: row['display_name'] as string | null,
        triggerType: 'follow_up',
        reason: `Lead inactive for >${intensity.inactivityHours}h. Follow-up ${followUpCount + 1}/${intensity.maxAttempts}.`,
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
             WHERE contact_id = $1`,
            [row['contact_id']],
          )
          processed++

          // Check if max attempts reached on primary channel (per-contact intensity)
          const newCount = followUpCount + 1
          if (newCount >= intensity.maxAttempts) {
            if (config.follow_up.cross_channel) {
              const crossResult = await tryCrossChannelFollowUp(
                ctx,
                row['contact_id'] as string,
                row['display_name'] as string | null,
                row['channel_type'] as ChannelName,
              )
              if (!crossResult) {
                await transitionToCold(ctx, row['contact_id'] as string)
              }
            } else {
              await transitionToCold(ctx, row['contact_id'] as string)
            }
          }
        }
      } catch (err) {
        logger.error({ err, contactId: row['contact_id'], traceId: ctx.traceId }, 'Follow-up pipeline failed for candidate')
      }
    }

    logger.info({ traceId: ctx.traceId, checked: result.rows.length, filtered: candidates.length, processed }, 'Follow-up scanner complete')
  } catch (err) {
    logger.error({ traceId: ctx.traceId, err }, 'Follow-up scanner failed')
  }
}

/**
 * Cross-channel follow-up: try secondary channels when primary is exhausted.
 * Returns true if a secondary channel was successfully used.
 */
async function tryCrossChannelFollowUp(
  ctx: ProactiveJobContext,
  contactId: string,
  displayName: string | null,
  primaryChannel: ChannelName,
): Promise<boolean> {
  const config = ctx.proactiveConfig
  const fallbackOrder = config.follow_up.channel_fallback_order

  // Get all channels for this contact (excluding primary which is already exhausted)
  const channelsResult = await ctx.db.query(
    `SELECT channel_type, channel_identifier
     FROM contact_channels
     WHERE contact_id = $1 AND is_primary = false
     ORDER BY created_at ASC`,
    [contactId],
  )

  if (channelsResult.rows.length === 0) {
    logger.debug({ contactId }, 'No secondary channels available for cross-channel follow-up')
    return false
  }

  // Check which secondary channels have already been tried (via outreach log)
  const outreachResult = await ctx.db.query(
    `SELECT DISTINCT channel
     FROM proactive_outreach_log
     WHERE contact_id = $1
       AND trigger_type = 'follow_up'
       AND action_taken = 'sent'
       AND channel != $2
       AND created_at > now() - interval '7 days'`,
    [contactId, primaryChannel],
  )

  const alreadyTriedChannels = new Set(outreachResult.rows.map((r: Record<string, unknown>) => r['channel'] as string))
  const availableSecondary = channelsResult.rows.map((r: Record<string, unknown>) => ({
    channel: r['channel_type'] as ChannelName,
    channelContactId: r['channel_identifier'] as string,
  }))

  // Try channels in fallback order, skip primary and already-tried
  for (const fallbackChannel of fallbackOrder) {
    if (fallbackChannel === primaryChannel) continue
    if (alreadyTriedChannels.has(fallbackChannel)) continue

    const match = availableSecondary.find((s: { channel: ChannelName; channelContactId: string }) => s.channel === fallbackChannel)
    if (!match) continue

    // Check if lead responded on ANY channel since our last outreach
    const responded = await hasRespondedSinceLastOutreach(ctx.db, contactId)
    if (responded) {
      logger.info({ contactId, channel: fallbackChannel }, 'Lead responded on another channel, skipping cross-channel follow-up')
      return true // Don't transition to cold — they're active
    }

    logger.info({ contactId, channel: fallbackChannel, traceId: ctx.traceId }, 'Attempting cross-channel follow-up')

    const candidate: ProactiveCandidate = {
      contactId,
      channelContactId: match.channelContactId,
      channel: fallbackChannel,
      displayName,
      triggerType: 'follow_up',
      reason: `Cross-channel follow-up: primary channel (${primaryChannel}) exhausted, trying ${fallbackChannel}.`,
    }

    try {
      const pipelineResult = await processProactive(
        candidate, ctx.db, ctx.redis, ctx.registry, ctx.engineConfig, config,
      )

      if (pipelineResult.success) {
        logger.info({ contactId, channel: fallbackChannel, traceId: ctx.traceId }, 'Cross-channel follow-up sent')
        return true
      }
    } catch (err) {
      logger.warn({ err, contactId, channel: fallbackChannel }, 'Cross-channel follow-up failed, trying next')
    }
  }

  logger.info({ contactId, traceId: ctx.traceId }, 'All channels exhausted for cross-channel follow-up')
  return false
}

/**
 * Check if the lead sent any message since our last proactive outreach.
 */
async function hasRespondedSinceLastOutreach(db: Pool, contactId: string): Promise<boolean> {
  const result = await db.query(
    `SELECT EXISTS(
       SELECT 1 FROM messages m
       WHERE m.contact_id = $1
         AND m.sender_type = 'user'
         AND m.created_at > COALESCE(
           (SELECT MAX(created_at) FROM proactive_outreach_log
            WHERE contact_id = $1 AND action_taken = 'sent'),
           '1970-01-01'::timestamptz
         )
     ) AS responded`,
    [contactId],
  )
  return result.rows[0]?.responded === true
}

async function transitionToCold(ctx: ProactiveJobContext, contactId: string): Promise<void> {
  try {
    await ctx.db.query(
      `UPDATE agent_contacts SET lead_status = 'cold'
       WHERE contact_id = $1
         AND lead_status IN ('new', 'qualifying')`,
      [contactId],
    )
    logger.info({ contactId, traceId: ctx.traceId }, 'Lead transitioned to cold after max follow-ups on all channels')
  } catch (err) {
    logger.warn({ err, contactId }, 'Failed to transition lead to cold')
  }
}
