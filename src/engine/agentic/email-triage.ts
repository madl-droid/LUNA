// LUNA Engine — Email Triage Classifier
// Deterministic pre-agentic classification for the email channel.
// Must complete in <5ms. No LLM calls, no async, no I/O.
//
// Three decisions:
//   'respond' → full agentic loop (default)
//   'observe' → persist message in memory, no LLM response
//   'ignore'  → drop completely, only mark as read
//
// Built-in rules handle common patterns (auto-replies, DSN, CC-only, empty body).
// Domain/sender/subject filtering is handled separately by the existing gmail config.

import type { ContextBundle } from '../types.js'
import type { TriageResult } from './types.js'
import type { RawEmailMessage } from '../../modules/gmail/types.js'

// ── Built-in patterns ──

const AUTO_REPLY_SUBJECTS: readonly RegExp[] = [
  /\bout of office\b/i,
  /\bfuera de la oficina\b/i,
  /\bautomatic reply\b/i,
  /\brespuesta autom[aá]tica\b/i,
  /^auto:/i,
  /\bautoreply\b/i,
  /\bauto-reply\b/i,
  /\bvacation\s+reply\b/i,
  /\babsence\b.*\breply\b/i,
]

const RESPOND_DEFAULT: TriageResult = { decision: 'respond', reason: 'default' }

// ── Helpers ──

/** Safely extract the raw EmailMessage from ctx.message.raw. */
function getRawEmail(ctx: ContextBundle): RawEmailMessage | null {
  const raw = ctx.message.raw as Record<string, unknown> | undefined
  if (!raw || typeof raw !== 'object') return null
  if (typeof raw.from !== 'string' || typeof raw.subject !== 'string') return null
  if (!raw.rawHeaders || typeof raw.rawHeaders !== 'object') return null
  return {
    from: raw.from as string,
    to: Array.isArray(raw.to) ? raw.to as string[] : [],
    cc: Array.isArray(raw.cc) ? raw.cc as string[] : [],
    subject: raw.subject as string,
    rawHeaders: raw.rawHeaders as Record<string, string>,
  }
}

/** Check if agent's own address appears in a list of email addresses. */
function addressInList(addresses: string[], ownAddress: string): boolean {
  const lower = ownAddress.toLowerCase()
  return addresses.some((a) => a.toLowerCase() === lower)
}

// ── Main classifier ──

/**
 * Classify an incoming email before the agentic loop.
 * Deterministic, <5ms, no LLM calls.
 *
 * @param ctx - ContextBundle from Phase 1 intake
 * @param ownAddress - Agent's own email address (for CC-only detection)
 */
export function classifyEmailTriage(
  ctx: ContextBundle,
  ownAddress: string,
): TriageResult {
  const raw = getRawEmail(ctx)
  if (!raw) return RESPOND_DEFAULT

  // ── 1. Auto-Reply headers ──
  const autoSubmitted = raw.rawHeaders['auto-submitted'] ?? ''
  if (autoSubmitted && autoSubmitted !== 'no') {
    return { decision: 'ignore', reason: 'auto-reply-header' }
  }
  if (raw.rawHeaders['x-auto-response-suppress']) {
    return { decision: 'ignore', reason: 'auto-reply-header' }
  }
  const precedence = (raw.rawHeaders['precedence'] ?? '').toLowerCase()
  if (precedence === 'bulk' || precedence === 'auto_reply' || precedence === 'junk') {
    return { decision: 'ignore', reason: 'auto-reply-header' }
  }

  // ── 2. Auto-Reply subject patterns ──
  for (const pattern of AUTO_REPLY_SUBJECTS) {
    if (pattern.test(raw.subject)) {
      return { decision: 'ignore', reason: 'auto-reply-subject' }
    }
  }

  // ── 3. Delivery Status Notifications ──
  const contentType = (raw.rawHeaders['content-type'] ?? '').toLowerCase()
  if (contentType.includes('multipart/report') || contentType.includes('delivery-status')) {
    return { decision: 'ignore', reason: 'dsn' }
  }

  // ── 4. CC-only (agent not in To, but in CC) ──
  if (ownAddress) {
    const inTo = addressInList(raw.to, ownAddress)
    const inCc = addressInList(raw.cc, ownAddress)
    if (!inTo && inCc) {
      return { decision: 'observe', reason: 'cc-only' }
    }
  }

  // ── 5. Empty body ──
  if (ctx.normalizedText.trim().length === 0) {
    return { decision: 'ignore', reason: 'empty-body' }
  }

  // ── Default: respond ──
  return RESPOND_DEFAULT
}
