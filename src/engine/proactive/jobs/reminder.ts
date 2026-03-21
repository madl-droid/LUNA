// LUNA Engine — Reminder Scanner Job
// Finds upcoming events/appointments and sends reminders to lead + optionally salesperson.
// Checks commitments with event_starts_at in the next X hours.

import pino from 'pino'
import type { ProactiveJobContext, ProactiveCandidate } from '../../types.js'
import type { ChannelName } from '../../../channels/types.js'
import { processProactive } from '../proactive-pipeline.js'

const logger = pino({ name: 'engine:job:reminder' })

export async function runReminder(ctx: ProactiveJobContext): Promise<void> {
  const config = ctx.proactiveConfig
  if (!config.reminders.enabled) return

  logger.info({ traceId: ctx.traceId }, 'Reminder scanner starting')

  const hoursBefore = config.reminders.hours_before_event

  try {
    // Find commitments with upcoming events that haven't been reminded
    const result = await ctx.db.query(
      `SELECT cm.id AS commitment_id, cm.contact_id, cm.description,
              cm.event_starts_at, cm.commitment_type, cm.assigned_to,
              c.display_name,
              cc.channel_contact_id, cc.channel_name
       FROM commitments cm
       JOIN contacts c ON c.id = cm.contact_id
       JOIN contact_channels cc ON cc.contact_id = cm.contact_id AND cc.is_primary = true
       WHERE cm.status IN ('pending', 'in_progress')
         AND cm.commitment_type IN ('meeting', 'demo', 'call', 'appointment', 'schedule_meeting')
         AND cm.event_starts_at IS NOT NULL
         AND cm.event_starts_at > now()
         AND cm.event_starts_at < now() + interval '1 hour' * $1
         AND cm.reminder_sent = false
       ORDER BY cm.event_starts_at ASC
       LIMIT 20`,
      [hoursBefore],
    )

    let processed = 0
    for (const row of result.rows) {
      const candidate: ProactiveCandidate = {
        contactId: row.contact_id,
        channelContactId: row.channel_contact_id,
        channel: row.channel_name as ChannelName,
        displayName: row.display_name,
        triggerType: 'reminder',
        triggerId: row.commitment_id,
        reason: `Upcoming ${row.commitment_type}: "${row.description}" at ${(row.event_starts_at as Date).toISOString()}`,
      }

      try {
        const pipelineResult = await processProactive(
          candidate, ctx.db, ctx.redis, ctx.registry, ctx.engineConfig, config,
        )

        if (pipelineResult.success) {
          // Mark reminder as sent
          await ctx.db.query(
            `UPDATE commitments SET reminder_sent = true WHERE id = $1`,
            [row.commitment_id],
          )
          processed++

          // Also notify salesperson if configured and assigned
          if (config.reminders.notify_salesperson && row.assigned_to) {
            await notifySalesperson(ctx, row)
          }
        }
      } catch (err) {
        logger.error({ err, commitmentId: row.commitment_id, traceId: ctx.traceId }, 'Reminder pipeline failed')
      }
    }

    logger.info({ traceId: ctx.traceId, checked: result.rows.length, processed }, 'Reminder scanner complete')
  } catch (err) {
    logger.error({ traceId: ctx.traceId, err }, 'Reminder scanner failed')
  }
}

async function notifySalesperson(
  ctx: ProactiveJobContext,
  row: Record<string, unknown>,
): Promise<void> {
  // Look up salesperson's channel info
  try {
    const spResult = await ctx.db.query(
      `SELECT cc.channel_contact_id, cc.channel_name
       FROM contact_channels cc
       JOIN contacts c ON c.id = cc.contact_id
       WHERE c.display_name = $1 OR c.id::text = $1
       LIMIT 1`,
      [row.assigned_to],
    )
    if (spResult.rows.length === 0) {
      logger.debug({ assignedTo: row.assigned_to }, 'Salesperson not found for reminder notification')
      return
    }

    // Fire message:send directly (simple notification, no pipeline)
    const sp = spResult.rows[0]!
    await ctx.registry.runHook('message:send', {
      channel: sp.channel_name,
      to: sp.channel_contact_id,
      content: {
        type: 'text',
        text: `📅 Recordatorio: ${row.description} con ${row.display_name} — ${(row.event_starts_at as Date).toLocaleString('es-CO', { timeZone: ctx.proactiveConfig.business_hours.timezone })}`,
      },
      correlationId: ctx.traceId,
    })
  } catch (err) {
    logger.warn({ err, assignedTo: row.assigned_to }, 'Failed to notify salesperson')
  }
}
