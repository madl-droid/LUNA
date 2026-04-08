// LUNA Engine — Proactive Triggers
// Definición de triggers para flujos proactivos.
// Intervals/crons are overridden by proactive.json config in proactive-runner.

import type { ProactiveJob, ProactiveJobContext } from '../types.js'
import { runFollowUp } from './jobs/follow-up.js'
import { runReminder } from './jobs/reminder.js'
import { runCommitmentCheck } from './jobs/commitment-check.js'
import { runReactivation } from './jobs/reactivation.js'
import { runCacheRefresh } from './jobs/cache-refresh.js'
import { runNightlyBatch } from './jobs/nightly-batch.js'
import { findOrphanMessages, redispatchOrphan } from './orphan-recovery.js'
import pino from 'pino'

const logger = pino({ name: 'engine:proactive:orphan-job' })

/**
 * Orphan recovery job: find unanswered messages and re-dispatch them.
 * Runs every N minutes (configurable via proactive.json orphan_recovery.interval_minutes).
 */
async function runOrphanRecovery(ctx: ProactiveJobContext): Promise<void> {
  const orConfig = ctx.proactiveConfig.orphan_recovery
  const lookbackMinutes = orConfig?.lookback_minutes ?? 30
  const maxPerRun = orConfig?.max_per_run ?? 10

  const orphans = await findOrphanMessages(ctx.db, lookbackMinutes, maxPerRun)

  if (orphans.length === 0) {
    logger.debug('Orphan recovery: no orphan messages found')
    return
  }

  logger.info({ count: orphans.length, lookbackMinutes }, 'Orphan recovery: found orphan messages')

  // FIX-E10: Skip orphans whose contact has an active pipeline in-flight.
  // A pipeline that hasn't written its log yet would be falsely flagged as orphaned.
  const contactLockSvc = ctx.registry.getOptional<{ hasLock(channelContactId: string): boolean }>('engine:contact-lock')

  const redispatched: typeof orphans = []
  for (const orphan of orphans) {
    // Check if pipeline is currently running for this contact
    if (contactLockSvc?.hasLock(orphan.channelContactId)) {
      logger.info({ contactId: orphan.contactId, channelContactId: orphan.channelContactId }, 'Orphan recovery: skipping — contact has active pipeline (false orphan)')
      continue
    }
    const ok = await redispatchOrphan(orphan, ctx.registry)
    if (ok) redispatched.push(orphan)
  }

  logger.info({ found: orphans.length, redispatched: redispatched.length }, 'Orphan recovery complete')

  // Log each successfully redispatched orphan to proactive_outreach_log for dedup tracking
  for (const orphan of redispatched) {
    try {
      await ctx.db.query(
        `INSERT INTO proactive_outreach_log
           (contact_id, trigger_type, trigger_id, channel, action_taken, metadata)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT DO NOTHING`,
        [
          orphan.contactId,
          'orphan_recovery',
          orphan.messageId,
          orphan.channel,
          'sent',
          JSON.stringify({ sessionId: orphan.sessionId, originalMessageId: orphan.messageId }),
        ],
      )
    } catch (err) {
      logger.warn({ err, contactId: orphan.contactId }, 'Failed to log orphan recovery to outreach log')
    }
  }
}

/**
 * Get all proactive job definitions.
 * Intervals and crons are overridden by proactive.json in proactive-runner.
 */
export function getProactiveJobs(): ProactiveJob[] {
  return [
    {
      name: 'follow-up-scanner',
      triggerType: 'follow_up',
      intervalMs: 15 * 60 * 1000,  // default: every 15 min
      handler: runFollowUp,
    },
    {
      name: 'reminder-scanner',
      triggerType: 'reminder',
      intervalMs: 30 * 60 * 1000,  // default: every 30 min
      handler: runReminder,
    },
    {
      name: 'commitment-scanner',
      triggerType: 'commitment',
      intervalMs: 5 * 60 * 1000,   // default: every 5 min
      handler: runCommitmentCheck,
    },
    {
      name: 'reactivation-scanner',
      triggerType: 'reactivation',
      cron: '0 9 * * 1-5',  // default: Mon-Fri 9 AM (overridden by config)
      handler: runReactivation,
    },
    {
      name: 'cache-refresh',
      triggerType: 'cache_refresh',
      cron: '0 3 * * *',  // daily at 3 AM
      handler: runCacheRefresh,
    },
    {
      name: 'nightly-batch',
      triggerType: 'nightly_batch',
      cron: '0 2 * * *',  // daily at 2 AM
      handler: runNightlyBatch,
    },
    {
      name: 'orphan-recovery',
      triggerType: 'orphan_recovery',
      intervalMs: 5 * 60 * 1000,  // default: every 5 min (overridden by config)
      handler: runOrphanRecovery,
    },
  ]
}
