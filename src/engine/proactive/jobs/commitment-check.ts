// LUNA Engine — Commitment Check Job
// Verifica compromisos vencidos (promesas del agente al contacto).
// Idempotente: usa flag en Redis.

import pino from 'pino'
import type { ProactiveJobContext } from '../../types.js'

const logger = pino({ name: 'engine:job:commitment-check' })

/**
 * Check for expired commitments and trigger follow-up actions.
 */
export async function runCommitmentCheck(ctx: ProactiveJobContext): Promise<void> {
  logger.info({ traceId: ctx.traceId }, 'Commitment check job starting')

  // TODO: implement commitment tracking
  // Commitments are stored in a future `commitments` table:
  // - id, session_id, contact_id, description, due_at, completed, created_at
  // For now, this is a placeholder

  logger.info({ traceId: ctx.traceId }, 'Commitment check job complete (noop)')
}
