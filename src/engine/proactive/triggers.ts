// LUNA Engine — Proactive Triggers
// Definición de triggers para flujos proactivos.

import type { ProactiveJob, ProactiveJobContext } from '../types.js'
import { runFollowUp } from './jobs/follow-up.js'
import { runReminder } from './jobs/reminder.js'
import { runCommitmentCheck } from './jobs/commitment-check.js'
import { runCacheRefresh } from './jobs/cache-refresh.js'
import { runNightlyBatch } from './jobs/nightly-batch.js'

/**
 * Get all proactive job definitions.
 * Intervals and crons are overridden by config in proactive-runner.
 */
export function getProactiveJobs(): ProactiveJob[] {
  return [
    {
      name: 'follow-up',
      triggerType: 'follow_up',
      intervalMs: 15 * 60 * 1000,  // every 15 min (configurable)
      handler: runFollowUp,
    },
    {
      name: 'reminder',
      triggerType: 'reminder',
      intervalMs: 30 * 60 * 1000,  // every 30 min
      handler: runReminder,
    },
    {
      name: 'commitment-check',
      triggerType: 'commitment_check',
      intervalMs: 5 * 60 * 1000,  // every 5 min
      handler: runCommitmentCheck,
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
      cron: '0 2 * * *',  // daily at 2 AM (configurable)
      handler: runNightlyBatch,
    },
  ]
}
