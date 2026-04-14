// Test 5: Normalizer — unicode cleanup, truncation, content type detection
// Verifies: normalizeText() and detectMessageType() handle edge cases

import { describe, it, expect } from 'vitest'
import { normalizeText, detectMessageType } from '../src/engine/utils/normalizer.js'

describe('normalizeText', () => {
  // ── Basic normalization ──

  it('returns empty string for null/undefined', () => {
    expect(normalizeText(null)).toBe('')
    expect(normalizeText(undefined)).toBe('')
    expect(normalizeText('')).toBe('')
  })

  it('trims whitespace', () => {
    expect(normalizeText('  hola  ')).toBe('hola')
  })

  // ── Unicode normalization ──

  it('converts smart quotes to regular quotes', () => {
    expect(normalizeText('\u201CHello\u201D')).toBe('"Hello"')
    expect(normalizeText('\u2018it\u2019s')).toBe("'it's")
  })

  it('converts em/en dashes to hyphens', () => {
    expect(normalizeText('esto\u2014aquello')).toBe('esto-aquello')
    expect(normalizeText('2024\u20132025')).toBe('2024-2025')
  })

  it('converts ellipsis to three dots', () => {
    expect(normalizeText('bueno\u2026')).toBe('bueno...')
  })

  it('converts non-breaking space to regular space', () => {
    expect(normalizeText('hola\u00A0mundo')).toBe('hola mundo')
  })

  // ── Invisible character removal ──

  it('strips zero-width characters', () => {
    expect(normalizeText('ho\u200Bla')).toBe('hola')
    expect(normalizeText('\uFEFFhola')).toBe('hola')
  })

  it('strips control characters', () => {
    expect(normalizeText('ho\u0000la')).toBe('hola')
    expect(normalizeText('ho\u001Fla')).toBe('hola')
  })

  // ── Whitespace collapsing ──

  it('collapses multiple newlines to max 2', () => {
    expect(normalizeText('a\n\n\n\nb')).toBe('a\n\nb')
  })

  it('collapses multiple spaces to one', () => {
    expect(normalizeText('hola    mundo')).toBe('hola mundo')
  })

  // ── Truncation ──

  it('truncates text longer than 5000 chars', () => {
    const long = 'a'.repeat(6000)
    const result = normalizeText(long)
    expect(result.length).toBe(5000)
  })

  it('does not truncate text at exactly 5000 chars', () => {
    const exact = 'b'.repeat(5000)
    expect(normalizeText(exact).length).toBe(5000)
  })

  it('handles surrogate pair safety on truncation', () => {
    // Create string that when truncated at 5000 would break a surrogate pair
    const filler = 'x'.repeat(4999)
    const emoji = '😀' // 2 chars in JS (surrogate pair)
    const text = filler + emoji
    const result = normalizeText(text)
    // Should not end with an orphan high surrogate
    const lastCode = result.charCodeAt(result.length - 1)
    expect(lastCode >= 0xD800 && lastCode <= 0xDBFF).toBe(false)
  })

  // ── Real-world WhatsApp messages ──

  it('normalizes a typical WhatsApp message with mixed unicode', () => {
    const msg = '  Hola\u200B, me\u00A0interesa el\u00ADproducto \u201Cpremium\u201D\u2026  '
    const result = normalizeText(msg)
    // \u200B (zero-width) stripped, \u00A0 (nbsp) → space, \u00AD (soft hyphen) stripped
    expect(result).toBe('Hola, me interesa elproducto "premium"...')
  })
})

describe('detectMessageType', () => {
  it('detects text type', () => {
    expect(detectMessageType({ type: 'text', text: 'hola' })).toBe('text')
  })

  it('detects image type', () => {
    expect(detectMessageType({ type: 'image' })).toBe('image')
  })

  it('detects audio type', () => {
    expect(detectMessageType({ type: 'audio' })).toBe('audio')
  })

  it('defaults unknown types to text', () => {
    expect(detectMessageType({ type: 'blockchain' })).toBe('text')
  })

  it('detects all valid types', () => {
    for (const type of ['text', 'image', 'audio', 'video', 'document', 'sticker', 'location', 'contact']) {
      expect(detectMessageType({ type, text: type === 'text' ? 'hi' : undefined })).toBe(type)
    }
  })
})
