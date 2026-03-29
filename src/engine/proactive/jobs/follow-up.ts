// LUNA Engine — Follow-Up Scanner Job
// Finds leads inactive for > X hours with status new/qualifying and < max follow-ups.
// Enqueues each as a ProactiveCandidate to the proactive pipeline.
// Supports cross-channel follow-up: when primary channel exhausts attempts,
// tries secondary channels before transitioning to cold.

import pino from 'pino'
import type { Pool } from 'pg'
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
  // FIX: E-30 — Use agent slug from config instead of hardcoded 'luna'
  const agentSlug = ctx.engineConfig.agentSlug

  try {
    // Find leads needing follow-up:
    // - Last interaction > X hours ago (but < 7 days to avoid ancient)
    // - Status is new or qualifying
    // - Follow-up count < max
    const result = await ctx.db.query(
      `SELECT ac.contact_id, ac.follow_up_count,
              c.display_name,
              cc.channel_identifier, cc.channel_type
       FROM agent_contacts ac
       JOIN contacts c ON c.id = ac.contact_id
       JOIN contact_channels cc ON cc.contact_id = ac.contact_id AND cc.is_primary = true
       WHERE ac.agent_id = (SELECT id FROM agents WHERE slug = $3 LIMIT 1)
         AND ac.lead_status IN ('new', 'qualifying')
         AND ac.follow_up_count < $1
         AND ac.updated_at < now() - interval '1 hour' * $2
         AND ac.updated_at > now() - interval '7 days'
       ORDER BY ac.updated_at ASC
       LIMIT 20`,
      [maxAttempts, inactivityHours, agentSlug],
    )

    let processed = 0
    for (const row of result.rows) {
      const candidate: ProactiveCandidate = {
        contactId: row.contact_id,
        channelContactId: row.channel_identifier,
        channel: row.channel_type as ChannelName,
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
             WHERE contact_id = $1 AND agent_id = (SELECT id FROM agents WHERE slug = $2 LIMIT 1)`,
            [row.contact_id, agentSlug],
          )
          processed++

          // Check if max attempts reached on primary channel
          const newCount = (row.follow_up_count ?? 0) + 1
          if (newCount >= maxAttempts) {
            if (config.follow_up.cross_channel) {
              // Try secondary channels before giving up
              const crossResult = await tryCrossChannelFollowUp(ctx, row.contact_id, row.display_name, row.channel_type as ChannelName)
              if (!crossResult) {
                await transitionToCold(ctx, row.contact_id)
              }
            } else {
              await transitionToCold(ctx, row.contact_id)
            }
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

  const alreadyTriedChannels = new Set(outreachResult.rows.map((r: Record<string, unknown>) => r.channel as string))
  const availableSecondary = channelsResult.rows.map((r: Record<string, unknown>) => ({
    channel: r.channel_type as ChannelName,
    channelContactId: r.channel_identifier as string,
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
       WHERE contact_id = $1 AND agent_id = (SELECT id FROM agents WHERE slug = $2 LIMIT 1)
         AND lead_status IN ('new', 'qualifying')`,
      [contactId, ctx.engineConfig.agentSlug],
    )
    logger.info({ contactId, traceId: ctx.traceId }, 'Lead transitioned to cold after max follow-ups on all channels')
  } catch (err) {
    logger.warn({ err, contactId }, 'Failed to transition lead to cold')
  }
}
