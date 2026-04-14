// Test 1: Effort Router — classifyEffort() deterministic classification
// Verifies: message length, question count, attachments, objections, HITL, commitments

import { describe, it, expect } from 'vitest'
import { classifyEffort } from '../src/engine/agentic/effort-router.js'
import type { ContextBundle } from '../src/engine/types.js'

/** Minimal ContextBundle stub — only the fields classifyEffort reads */
function makeCtx(overrides: Partial<{
  normalizedText: string
  attachmentMeta: unknown[]
  pendingCommitments: unknown[]
  hitlPendingContext: string | null
  isNewContact: boolean
}>): ContextBundle {
  return {
    normalizedText: overrides.normalizedText ?? 'hola',
    attachmentMeta: (overrides.attachmentMeta ?? []) as ContextBundle['attachmentMeta'],
    pendingCommitments: (overrides.pendingCommitments ?? []) as ContextBundle['pendingCommitments'],
    hitlPendingContext: overrides.hitlPendingContext ?? null,
    isNewContact: overrides.isNewContact ?? false,
  } as ContextBundle
}

describe('classifyEffort', () => {
  // ── Normal cases ──

  it('returns normal for short simple message', () => {
    expect(classifyEffort(makeCtx({ normalizedText: 'hola, buenos dias' }))).toBe('normal')
  })

  it('returns normal for message under 500 chars', () => {
    expect(classifyEffort(makeCtx({ normalizedText: 'a'.repeat(499) }))).toBe('normal')
  })

  it('returns normal for 2 question marks', () => {
    expect(classifyEffort(makeCtx({ normalizedText: 'cuando? cuanto?' }))).toBe('normal')
  })

  it('returns normal for 1 attachment', () => {
    expect(classifyEffort(makeCtx({
      attachmentMeta: [{ index: 0, type: 'image', name: 'foto.jpg', size: 1000, mime: 'image/jpeg' }],
    }))).toBe('normal')
  })

  // ── Complex cases ──

  it('returns complex for message > 500 chars', () => {
    expect(classifyEffort(makeCtx({ normalizedText: 'a'.repeat(501) }))).toBe('complex')
  })

  it('returns complex for 3+ question marks', () => {
    expect(classifyEffort(makeCtx({ normalizedText: 'cuando? cuanto? donde?' }))).toBe('complex')
  })

  it('returns complex for 2+ attachments', () => {
    const attachmentMeta = [
      { index: 0, type: 'image', name: 'a.jpg', size: 100, mime: 'image/jpeg' },
      { index: 1, type: 'document', name: 'b.pdf', size: 200, mime: 'application/pdf' },
    ]
    expect(classifyEffort(makeCtx({ attachmentMeta }))).toBe('complex')
  })

  it('returns complex for objection keywords', () => {
    expect(classifyEffort(makeCtx({ normalizedText: 'es muy caro para nosotros' }))).toBe('complex')
    expect(classifyEffort(makeCtx({ normalizedText: 'lo pensaré un poco' }))).toBe('complex')
    expect(classifyEffort(makeCtx({ normalizedText: 'no me interesa gracias' }))).toBe('complex')
    expect(classifyEffort(makeCtx({ normalizedText: 'tenemos otro proveedor' }))).toBe('complex')
  })

  it('returns complex when HITL context is present', () => {
    expect(classifyEffort(makeCtx({ hitlPendingContext: 'waiting for human' }))).toBe('complex')
  })

  it('returns complex for new contact with long first message', () => {
    expect(classifyEffort(makeCtx({
      isNewContact: true,
      normalizedText: 'a'.repeat(201),
    }))).toBe('complex')
  })

  it('returns normal for new contact with short message', () => {
    expect(classifyEffort(makeCtx({
      isNewContact: true,
      normalizedText: 'hola buenas',
    }))).toBe('normal')
  })

  it('returns complex for commitments with time reference', () => {
    expect(classifyEffort(makeCtx({
      pendingCommitments: [{ id: '1' }],
      normalizedText: 'nos vemos mañana a las 3pm',
    }))).toBe('complex')
  })

  it('returns normal for commitments without time reference', () => {
    expect(classifyEffort(makeCtx({
      pendingCommitments: [{ id: '1' }],
      normalizedText: 'ok perfecto gracias',
    }))).toBe('normal')
  })
})
