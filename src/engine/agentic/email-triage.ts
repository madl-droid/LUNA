// LUNA Engine — Email Triage Classifier
// Deterministic pre-agentic classification for the email channel.
// Must complete in <5ms. No LLM calls, no async, no I/O.
//
// Three decisions:
//   'respond' → full agentic loop (default)
//   'observe' → persist message in memory, no LLM response
//   'ignore'  → drop completely, only mark as read
//
// Custom rules (from console config) are evaluated first.
// Built-in rules handle common patterns (auto-replies, DSN, CC-only, empty body).

import type { ContextBundle } from '../types.js'
import type { TriageResult } from './types.js'
import type { EmailTriageRule } from '../../modules/gmail/types.js'

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

interface RawEmailMessage {
  from: string
  to: string[]
  cc: string[]
  bcc: string[]
  subject: string
  bodyText: string
  rawHeaders: Record<string, string>
}

/** Safely extract the raw EmailMessage from ctx.message.raw. */
function getRawEmail(ctx: ContextBundle): RawEmailMessage | null {
  const raw = ctx.message.raw as Record<string, unknown> | undefined
  if (!raw || typeof raw !== 'object') return null
  return raw as unknown as RawEmailMessage
}

/** Check if agent's own address appears in a list of email addresses. */
function addressInList(addresses: string[], ownAddress: string): boolean {
  const lower = ownAddress.toLowerCase()
  return addresses.some((a) => a.toLowerCase() === lower)
}

/** Safely test a regex pattern string. Returns false on invalid regex. */
function testPattern(pattern: string, text: string): boolean {
  try {
    return new RegExp(pattern, 'i').test(text)
  } catch {
    return false
  }
}

// ── Custom rule evaluation ──

function evaluateCustomRules(
  raw: RawEmailMessage,
  bodyText: string,
  rules: EmailTriageRule[],
  ownAddress: string,
): TriageResult | null {
  for (const rule of rules) {
    if (!rule.enabled) continue
    if (!rule.conditions || typeof rule.conditions !== 'object') continue

    const c = rule.conditions
    let allMatch = true

    // from: regex on sender email
    if (c.from && !testPattern(c.from, raw.from)) allMatch = false

    // subject: regex on subject
    if (allMatch && c.subject && !testPattern(c.subject, raw.subject)) allMatch = false

    // to_cc: where does the agent appear?
    if (allMatch && c.to_cc) {
      if (c.to_cc === 'to' && !addressInList(raw.to, ownAddress)) allMatch = false
      if (c.to_cc === 'cc' && !addressInList(raw.cc, ownAddress)) allMatch = false
      if (c.to_cc === 'bcc' && !addressInList(raw.bcc, ownAddress)) allMatch = false
    }

    // has_header: check if header exists (lowercased key)
    if (allMatch && c.has_header) {
      const headerKey = c.has_header.toLowerCase()
      if (!raw.rawHeaders[headerKey]) allMatch = false
    }

    // body: regex on body text
    if (allMatch && c.body && !testPattern(c.body, bodyText)) allMatch = false

    if (allMatch) {
      const action = rule.action === 'respond' || rule.action === 'observe' || rule.action === 'ignore'
        ? rule.action
        : 'respond'
      return { decision: action, reason: `rule:${rule.name}` }
    }
  }

  return null
}

// ── Main classifier ──

/**
 * Classify an incoming email before the agentic loop.
 * Deterministic, <5ms, no LLM calls.
 *
 * @param ctx - ContextBundle from Phase 1 intake
 * @param rules - Custom triage rules from console config
 * @param ownAddress - Agent's own email address (for CC-only detection)
 */
export function classifyEmailTriage(
  ctx: ContextBundle,
  rules: EmailTriageRule[],
  ownAddress: string,
): TriageResult {
  const raw = getRawEmail(ctx)
  if (!raw) return RESPOND_DEFAULT

  const bodyText = ctx.normalizedText

  // ── 1. Custom rules (evaluated first, in order) ──
  if (rules.length > 0) {
    const customResult = evaluateCustomRules(raw, bodyText, rules, ownAddress)
    if (customResult) return customResult
  }

  // ── 2. Built-in: Auto-Reply headers ──
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

  // ── 3. Built-in: Auto-Reply subject patterns ──
  for (const pattern of AUTO_REPLY_SUBJECTS) {
    if (pattern.test(raw.subject)) {
      return { decision: 'ignore', reason: 'auto-reply-subject' }
    }
  }

  // ── 4. Built-in: Delivery Status Notifications ──
  const contentType = (raw.rawHeaders['content-type'] ?? '').toLowerCase()
  if (contentType.includes('multipart/report') || contentType.includes('delivery-status')) {
    return { decision: 'ignore', reason: 'dsn' }
  }

  // ── 5. Built-in: CC-only (agent not in To, but in CC) ──
  if (ownAddress) {
    const inTo = addressInList(raw.to, ownAddress)
    const inCc = addressInList(raw.cc, ownAddress)
    if (!inTo && inCc) {
      return { decision: 'observe', reason: 'cc-only' }
    }
  }

  // ── 6. Built-in: Empty body ──
  if (bodyText.trim().length === 0) {
    return { decision: 'ignore', reason: 'empty-body' }
  }

  // ── Default: respond ──
  return RESPOND_DEFAULT
}
