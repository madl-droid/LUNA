// Test 4: Output Sanitizer — tool call leakage, API key redaction, sensitive data
// Verifies: validateOutput() catches and cleans dangerous content in agent responses

import { describe, it, expect } from 'vitest'
import { validateOutput, sanitizeParts } from '../src/engine/output-sanitizer.js'

describe('validateOutput', () => {
  // ── Clean output ──

  it('passes clean text unchanged', () => {
    const result = validateOutput('Hola, su cita es el martes a las 3pm.')
    expect(result.passed).toBe(true)
    expect(result.sanitizedText).toBe('Hola, su cita es el martes a las 3pm.')
    expect(result.issues).toHaveLength(0)
  })

  // ── Tool call leakage detection ──

  it('detects TOOL_CALL marker leakage', () => {
    const result = validateOutput('Voy a verificar. [TOOL_CALL: check-availability] {"date": "2026-01-01"}')
    expect(result.passed).toBe(false)
    expect(result.issues.some(i => i.includes('tool_call_leakage'))).toBe(true)
  })

  it('detects function_calls XML leakage', () => {
    const result = validateOutput('Buscando info <function_calls><invoke name="search">test</invoke></function_calls>')
    expect(result.passed).toBe(false)
    expect(result.issues.some(i => i.includes('tool_call_leakage'))).toBe(true)
  })

  it('detects tool_use JSON leakage', () => {
    const result = validateOutput('Revisando {"type": "tool_use", "name": "search", "input": {}}')
    expect(result.passed).toBe(false)
  })

  it('sanitizes tool call markers from output', () => {
    const result = validateOutput('Hola [TOOL_CALL: search] {"q": "test"} aqui esta la info')
    expect(result.sanitizedText).not.toContain('TOOL_CALL')
    expect(result.sanitizedText).toContain('Hola')
  })

  // ── API key redaction ──

  it('redacts Anthropic API keys', () => {
    const result = validateOutput('Mi clave es sk-ant-abcdefghijklmnopqrstuvwx y funciona')
    expect(result.passed).toBe(false)
    expect(result.sanitizedText).toContain('[REDACTED]')
    expect(result.sanitizedText).not.toContain('sk-ant-')
  })

  it('redacts Google API keys', () => {
    const result = validateOutput('Key: AIzaSyAbcDEFghIJKLMNopQRSTuvWXYZ0123456789')
    expect(result.passed).toBe(false)
    expect(result.sanitizedText).toContain('[REDACTED]')
    expect(result.sanitizedText).not.toContain('AIza')
  })

  it('redacts Bearer tokens', () => {
    const result = validateOutput('Header: Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.payload.signature')
    expect(result.passed).toBe(false)
    expect(result.sanitizedText).toContain('Bearer [REDACTED]')
  })

  it('redacts password/secret/token values', () => {
    const result = validateOutput('La config es password: mysuperpassword123')
    expect(result.passed).toBe(false)
    expect(result.sanitizedText).toContain('[REDACTED]')
    expect(result.sanitizedText).not.toContain('mysuperpassword123')
  })
})

describe('sanitizeParts', () => {
  it('sanitizes multiple parts independently', () => {
    const { parts, issues } = sanitizeParts([
      'Parte limpia',
      'Parte con [TOOL_CALL: search] leakage',
      'Otra parte limpia',
    ])
    expect(parts[0]).toBe('Parte limpia')
    expect(parts[1]).not.toContain('TOOL_CALL')
    expect(parts[2]).toBe('Otra parte limpia')
    expect(issues.length).toBeGreaterThan(0)
  })

  it('returns no issues for all clean parts', () => {
    const { parts, issues } = sanitizeParts(['Hola', 'Buenos dias', 'Gracias'])
    expect(issues).toHaveLength(0)
    expect(parts).toEqual(['Hola', 'Buenos dias', 'Gracias'])
  })
})
