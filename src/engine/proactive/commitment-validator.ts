// LUNA Engine — Commitment Validator
// Validates and classifies commitment creation requests.
// Three outcomes: known type (tool + deadline from config), generic (short auto-cancel), rejected.

import pino from 'pino'
import type { ProactiveConfig, CommitmentTypeConfig } from '../types.js'
import type { Commitment } from '../../modules/memory/types.js'
import { findCommitmentTypeConfig } from './proactive-config.js'

const logger = pino({ name: 'engine:commitment-validator' })

export interface CommitmentInput {
  type: string
  description: string
  contactId: string
  agentId: string
  sessionId?: string
  dueWithinHours?: number
}

export type ValidationResult =
  | { status: 'known'; commitment: Omit<Commitment, 'id' | 'createdAt' | 'updatedAt' | 'completedAt'> }
  | { status: 'generic'; commitment: Omit<Commitment, 'id' | 'createdAt' | 'updatedAt' | 'completedAt'> }
  | { status: 'rejected'; reason: string }

/**
 * Validate a commitment creation request.
 * Returns structured commitment data ready for saving, or rejection reason.
 */
export function validateCommitment(
  input: CommitmentInput,
  config: ProactiveConfig,
  createdVia: 'tool' | 'auto_detect',
): ValidationResult {
  // Basic validation
  if (!input.description || input.description.trim().length < 3) {
    return { status: 'rejected', reason: 'Description too short' }
  }

  if (!input.contactId) {
    return { status: 'rejected', reason: 'Missing contact_id' }
  }

  // Check for known type
  const typeConfig = findCommitmentTypeConfig(config, input.type)

  if (typeConfig) {
    return buildKnownCommitment(input, typeConfig, config, createdVia)
  }

  // Generic commitment (type not in config)
  return buildGenericCommitment(input, config, createdVia)
}

function buildKnownCommitment(
  input: CommitmentInput,
  typeConfig: CommitmentTypeConfig,
  config: ProactiveConfig,
  createdVia: 'tool' | 'auto_detect',
): ValidationResult {
  const now = new Date()

  // Calculate due_at: use provided hours or default from config
  const dueHours = input.dueWithinHours
    ? Math.min(input.dueWithinHours, typeConfig.max_due_hours)
    : typeConfig.max_due_hours
  const dueAt = new Date(now.getTime() + dueHours * 60 * 60 * 1000)

  // Validate due_at is not in the past
  if (dueAt <= now) {
    return { status: 'rejected', reason: 'Calculated deadline is in the past' }
  }

  // Calculate auto_cancel_at
  const autoCancelAt = new Date(dueAt.getTime() + typeConfig.auto_cancel_hours * 60 * 60 * 1000)

  const commitment: Omit<Commitment, 'id' | 'createdAt' | 'updatedAt' | 'completedAt'> = {
    agentId: input.agentId,
    contactId: input.contactId,
    sessionId: input.sessionId ?? null,
    commitmentBy: 'agent',
    description: input.description,
    category: typeConfig.type,
    priority: 'normal',
    commitmentType: typeConfig.type,
    dueAt,
    status: 'pending',
    attemptCount: 0,
    sortOrder: 0,
    reminderSent: false,
    requiresTool: typeConfig.requires_tool,
    autoCancelAt: autoCancelAt,
    createdVia,
  }

  logger.info({ type: typeConfig.type, dueAt, contactId: input.contactId }, 'Known commitment validated')
  return { status: 'known', commitment }
}

function buildGenericCommitment(
  input: CommitmentInput,
  config: ProactiveConfig,
  createdVia: 'tool' | 'auto_detect',
): ValidationResult {
  const now = new Date()

  // Generic: default 24h due, auto-cancel from config
  const dueHours = input.dueWithinHours ?? 24
  const dueAt = new Date(now.getTime() + dueHours * 60 * 60 * 1000)

  if (dueAt <= now) {
    return { status: 'rejected', reason: 'Calculated deadline is in the past' }
  }

  const autoCancelHours = config.commitments.generic_auto_cancel_hours
  const autoCancelAt = new Date(dueAt.getTime() + autoCancelHours * 60 * 60 * 1000)

  const commitment: Omit<Commitment, 'id' | 'createdAt' | 'updatedAt' | 'completedAt'> = {
    agentId: input.agentId,
    contactId: input.contactId,
    sessionId: input.sessionId ?? null,
    commitmentBy: 'agent',
    description: input.description,
    category: 'generic',
    priority: 'normal',
    commitmentType: input.type || 'action',
    dueAt,
    status: 'pending',
    attemptCount: 0,
    sortOrder: 0,
    reminderSent: false,
    requiresTool: null,
    autoCancelAt: autoCancelAt,
    createdVia,
  }

  logger.info({ type: input.type || 'action', dueAt, contactId: input.contactId, generic: true }, 'Generic commitment validated')
  return { status: 'generic', commitment }
}
