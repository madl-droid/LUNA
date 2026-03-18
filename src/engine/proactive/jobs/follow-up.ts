// LUNA Engine — Follow-Up Job
// Envía seguimiento a leads que no han respondido.
// Idempotente: usa flag en Redis.

import pino from 'pino'
import type { ProactiveJobContext } from '../../types.js'

const logger = pino({ name: 'engine:job:follow-up' })

/**
 * Find leads with inactive sessions and send follow-up messages.
 * Idempotent: Redis flag `followup:sent:{sessionId}` prevents duplicates.
 */
export async function runFollowUp(ctx: ProactiveJobContext): Promise<void> {
  logger.info({ traceId: ctx.traceId }, 'Follow-up job starting')

  try {
    // Find sessions that need follow-up:
    // - Last activity > 30 min ago
    // - Not already followed up
    // - Contact is a lead with active qualification
    const result = await ctx.db.query(
      `SELECT s.id AS session_id, s.contact_id, s.channel_name, s.channel_contact_id,
              c.display_name, c.qualification_status
       FROM sessions s
       JOIN contacts c ON c.id = s.contact_id
       WHERE s.last_activity_at < now() - interval '30 minutes'
         AND s.last_activity_at > now() - interval '24 hours'
         AND c.qualification_status IN ('new', 'qualifying')
       ORDER BY s.last_activity_at ASC
       LIMIT 20`,
    )

    let sent = 0
    for (const row of result.rows) {
      const redisKey = `followup:sent:${row.session_id}`

      // Check idempotency flag
      const alreadySent = await ctx.redis.get(redisKey)
      if (alreadySent) continue

      // Mark as sent (TTL 24h)
      await ctx.redis.set(redisKey, '1', 'EX', 86400)

      // TODO: generate and send follow-up message via pipeline
      // For now, just log
      logger.info({
        traceId: ctx.traceId,
        sessionId: row.session_id,
        contactId: row.contact_id,
        channel: row.channel_name,
      }, 'Follow-up needed')

      sent++
    }

    logger.info({ traceId: ctx.traceId, checked: result.rows.length, sent }, 'Follow-up job complete')
  } catch (err) {
    logger.error({ traceId: ctx.traceId, err }, 'Follow-up job failed')
  }
}
