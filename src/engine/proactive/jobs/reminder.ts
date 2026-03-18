// LUNA Engine — Reminder Job
// Envía recordatorios de citas/reuniones programadas.
// Idempotente: usa flag en Redis.

import pino from 'pino'
import type { ProactiveJobContext } from '../../types.js'

const logger = pino({ name: 'engine:job:reminder' })

/**
 * Check for upcoming appointments and send reminders.
 */
export async function runReminder(ctx: ProactiveJobContext): Promise<void> {
  logger.info({ traceId: ctx.traceId }, 'Reminder job starting')

  try {
    // Find contacts with upcoming scheduled appointments (next 2 hours)
    const result = await ctx.db.query(
      `SELECT c.id AS contact_id, c.display_name,
              cc.channel_contact_id, cc.channel_name
       FROM contacts c
       JOIN contact_channels cc ON cc.contact_id = c.id
       WHERE c.qualification_status = 'scheduled'
       LIMIT 20`,
    )

    let sent = 0
    for (const row of result.rows) {
      const redisKey = `reminder:sent:${row.contact_id}:${new Date().toISOString().split('T')[0]}`

      const alreadySent = await ctx.redis.get(redisKey)
      if (alreadySent) continue

      await ctx.redis.set(redisKey, '1', 'EX', 86400)

      // TODO: generate and send reminder via pipeline
      logger.info({
        traceId: ctx.traceId,
        contactId: row.contact_id,
        channel: row.channel_name,
      }, 'Reminder needed')

      sent++
    }

    logger.info({ traceId: ctx.traceId, checked: result.rows.length, sent }, 'Reminder job complete')
  } catch (err) {
    logger.error({ traceId: ctx.traceId, err }, 'Reminder job failed')
  }
}
