import { describe, it, expect } from 'vitest'
import { getHandoffAction, formatContactForHuman } from '../../src/modules/hitl/handoff.js'

describe('handoff', () => {
  describe('getHandoffAction', () => {
    it('WhatsApp → share_contact', () => {
      expect(getHandoffAction('whatsapp')).toBe('share_contact')
    })

    it('Google Chat → share_contact', () => {
      expect(getHandoffAction('google-chat')).toBe('share_contact')
    })

    it('Twilio Voice → share_contact', () => {
      expect(getHandoffAction('twilio-voice')).toBe('share_contact')
    })

    it('Gmail → full_handoff', () => {
      expect(getHandoffAction('gmail')).toBe('full_handoff')
    })

    it('Email → full_handoff', () => {
      expect(getHandoffAction('email')).toBe('full_handoff')
    })

    it('unknown channel → share_contact', () => {
      expect(getHandoffAction('unknown-channel')).toBe('share_contact')
    })
  })

  describe('formatContactForHuman', () => {
    it('formats full contact in Spanish', () => {
      const result = formatContactForHuman(
        { name: 'Juan Perez', phone: '+5491112345678', email: 'juan@test.com' },
        'es',
      )
      expect(result).toContain('Juan Perez')
      expect(result).toContain('+5491112345678')
      expect(result).toContain('juan@test.com')
      expect(result).toContain('Datos del cliente')
    })

    it('formats full contact in English', () => {
      const result = formatContactForHuman(
        { name: 'John Doe', phone: '+1234567890', email: 'john@test.com' },
        'en',
      )
      expect(result).toContain('Client contact info')
      expect(result).toContain('Name: John Doe')
      expect(result).toContain('Phone: +1234567890')
    })

    it('handles missing contact data', () => {
      const result = formatContactForHuman(
        { name: null, phone: null, email: null },
        'es',
      )
      expect(result).toContain('Sin datos de contacto disponibles')
    })

    it('handles partial data (only phone)', () => {
      const result = formatContactForHuman(
        { name: null, phone: '+5491112345678', email: null },
        'es',
      )
      expect(result).toContain('+5491112345678')
      expect(result).not.toContain('Email')
      expect(result).not.toContain('Nombre')
    })

    it('handles partial data (only email)', () => {
      const result = formatContactForHuman(
        { name: 'Test', phone: null, email: 'test@example.com' },
        'en',
      )
      expect(result).toContain('test@example.com')
      expect(result).toContain('Name: Test')
      expect(result).not.toContain('Phone')
    })
  })
})
