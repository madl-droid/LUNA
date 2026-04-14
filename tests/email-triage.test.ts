// Test 2: Email Triage — classifyEmailTriage() deterministic classification
// Verifies: auto-replies, DSN, CC-only, empty body, default respond

import { describe, it, expect } from 'vitest'
import { classifyEmailTriage } from '../src/engine/agentic/email-triage.js'
import type { ContextBundle } from '../src/engine/types.js'

const OWN_EMAIL = 'luna@empresa.com'

/** Build a minimal ContextBundle with email raw data */
function makeEmailCtx(overrides: {
  normalizedText?: string
  from?: string
  to?: string[]
  cc?: string[]
  subject?: string
  rawHeaders?: Record<string, string>
}): ContextBundle {
  return {
    normalizedText: overrides.normalizedText ?? 'Hola, quiero información',
    message: {
      id: 'msg-1',
      channelName: 'email',
      channelMessageId: 'email-1',
      from: overrides.from ?? 'cliente@gmail.com',
      timestamp: new Date(),
      content: { type: 'text', text: overrides.normalizedText ?? 'Hola' },
      raw: {
        from: overrides.from ?? 'cliente@gmail.com',
        to: overrides.to ?? [OWN_EMAIL],
        cc: overrides.cc ?? [],
        subject: overrides.subject ?? 'Consulta',
        rawHeaders: overrides.rawHeaders ?? {},
      },
    },
  } as unknown as ContextBundle
}

describe('classifyEmailTriage', () => {
  // ── Default: respond ──

  it('returns respond for normal email', () => {
    const result = classifyEmailTriage(makeEmailCtx({}), OWN_EMAIL)
    expect(result.decision).toBe('respond')
  })

  // ── Auto-reply detection ──

  it('ignores auto-submitted header', () => {
    const result = classifyEmailTriage(makeEmailCtx({
      rawHeaders: { 'auto-submitted': 'auto-replied' },
    }), OWN_EMAIL)
    expect(result.decision).toBe('ignore')
    expect(result.reason).toBe('auto-reply-header')
  })

  it('ignores x-auto-response-suppress header', () => {
    const result = classifyEmailTriage(makeEmailCtx({
      rawHeaders: { 'x-auto-response-suppress': 'All' },
    }), OWN_EMAIL)
    expect(result.decision).toBe('ignore')
  })

  it('ignores bulk precedence', () => {
    const result = classifyEmailTriage(makeEmailCtx({
      rawHeaders: { 'precedence': 'bulk' },
    }), OWN_EMAIL)
    expect(result.decision).toBe('ignore')
  })

  it('does NOT ignore auto-submitted: no', () => {
    const result = classifyEmailTriage(makeEmailCtx({
      rawHeaders: { 'auto-submitted': 'no' },
    }), OWN_EMAIL)
    expect(result.decision).toBe('respond')
  })

  // ── Auto-reply subject patterns ──

  it('ignores out of office subject', () => {
    const result = classifyEmailTriage(makeEmailCtx({
      subject: 'Re: Out of Office - Maria Garcia',
    }), OWN_EMAIL)
    expect(result.decision).toBe('ignore')
    expect(result.reason).toBe('auto-reply-subject')
  })

  it('ignores respuesta automatica subject', () => {
    const result = classifyEmailTriage(makeEmailCtx({
      subject: 'Respuesta automática: Cotización',
    }), OWN_EMAIL)
    expect(result.decision).toBe('ignore')
  })

  // ── DSN (Delivery Status Notification) ──

  it('ignores delivery status notifications', () => {
    const result = classifyEmailTriage(makeEmailCtx({
      rawHeaders: { 'content-type': 'multipart/report; report-type=delivery-status' },
    }), OWN_EMAIL)
    expect(result.decision).toBe('ignore')
    expect(result.reason).toBe('dsn')
  })

  // ── CC-only ──

  it('observes when agent is in CC but not in To', () => {
    const result = classifyEmailTriage(makeEmailCtx({
      to: ['jefe@empresa.com'],
      cc: [OWN_EMAIL],
    }), OWN_EMAIL)
    expect(result.decision).toBe('observe')
    expect(result.reason).toBe('cc-only')
  })

  it('responds when agent is in To (even if also in CC)', () => {
    const result = classifyEmailTriage(makeEmailCtx({
      to: [OWN_EMAIL],
      cc: ['otro@empresa.com'],
    }), OWN_EMAIL)
    expect(result.decision).toBe('respond')
  })

  // ── Empty body ──

  it('ignores empty body email', () => {
    const result = classifyEmailTriage(makeEmailCtx({
      normalizedText: '   ',
    }), OWN_EMAIL)
    expect(result.decision).toBe('ignore')
    expect(result.reason).toBe('empty-body')
  })

  // ── Without raw data ──

  it('defaults to respond when no raw email data', () => {
    const ctx = { normalizedText: 'hola', message: { raw: null } } as unknown as ContextBundle
    const result = classifyEmailTriage(ctx, OWN_EMAIL)
    expect(result.decision).toBe('respond')
  })
})
