// hitl/ticket-machine.ts — State machine for HITL ticket transitions

import type { HitlStatus } from './types.js'

// Valid state transitions
const TRANSITIONS: Record<HitlStatus, HitlStatus[]> = {
  pending:   ['notified', 'cancelled'],
  notified:  ['waiting', 'resolved', 'expired', 'cancelled'],
  waiting:   ['waiting', 'notified', 'resolved', 'expired', 'cancelled'],
  resolved:  [],
  expired:   [],
  cancelled: [],
}

export function canTransition(from: HitlStatus, to: HitlStatus): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false
}

export function isTerminal(status: HitlStatus): boolean {
  return status === 'resolved' || status === 'expired' || status === 'cancelled'
}

export function isActive(status: HitlStatus): boolean {
  return !isTerminal(status)
}
