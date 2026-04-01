import { describe, it, expect } from 'vitest'
import { canTransition, isTerminal, isActive } from '../../src/modules/hitl/ticket-machine.js'

describe('ticket-machine', () => {
  describe('canTransition', () => {
    // Valid transitions
    it('pending → notified', () => expect(canTransition('pending', 'notified')).toBe(true))
    it('pending → cancelled', () => expect(canTransition('pending', 'cancelled')).toBe(true))
    it('notified → waiting', () => expect(canTransition('notified', 'waiting')).toBe(true))
    it('notified → resolved', () => expect(canTransition('notified', 'resolved')).toBe(true))
    it('notified → expired', () => expect(canTransition('notified', 'expired')).toBe(true))
    it('notified → cancelled', () => expect(canTransition('notified', 'cancelled')).toBe(true))
    it('waiting → waiting (follow-up)', () => expect(canTransition('waiting', 'waiting')).toBe(true))
    it('waiting → notified (re-assign)', () => expect(canTransition('waiting', 'notified')).toBe(true))
    it('waiting → resolved', () => expect(canTransition('waiting', 'resolved')).toBe(true))
    it('waiting → expired', () => expect(canTransition('waiting', 'expired')).toBe(true))
    it('waiting → cancelled', () => expect(canTransition('waiting', 'cancelled')).toBe(true))

    // Invalid transitions
    it('pending → resolved (invalid)', () => expect(canTransition('pending', 'resolved')).toBe(false))
    it('pending → waiting (invalid)', () => expect(canTransition('pending', 'waiting')).toBe(false))
    it('pending → expired (invalid)', () => expect(canTransition('pending', 'expired')).toBe(false))
    it('resolved → anything (terminal)', () => {
      expect(canTransition('resolved', 'pending')).toBe(false)
      expect(canTransition('resolved', 'notified')).toBe(false)
      expect(canTransition('resolved', 'waiting')).toBe(false)
      expect(canTransition('resolved', 'expired')).toBe(false)
      expect(canTransition('resolved', 'cancelled')).toBe(false)
    })
    it('expired → anything (terminal)', () => {
      expect(canTransition('expired', 'pending')).toBe(false)
      expect(canTransition('expired', 'resolved')).toBe(false)
    })
    it('cancelled → anything (terminal)', () => {
      expect(canTransition('cancelled', 'pending')).toBe(false)
      expect(canTransition('cancelled', 'resolved')).toBe(false)
    })
  })

  describe('isTerminal', () => {
    it('resolved is terminal', () => expect(isTerminal('resolved')).toBe(true))
    it('expired is terminal', () => expect(isTerminal('expired')).toBe(true))
    it('cancelled is terminal', () => expect(isTerminal('cancelled')).toBe(true))
    it('pending is not terminal', () => expect(isTerminal('pending')).toBe(false))
    it('notified is not terminal', () => expect(isTerminal('notified')).toBe(false))
    it('waiting is not terminal', () => expect(isTerminal('waiting')).toBe(false))
  })

  describe('isActive', () => {
    it('pending is active', () => expect(isActive('pending')).toBe(true))
    it('notified is active', () => expect(isActive('notified')).toBe(true))
    it('waiting is active', () => expect(isActive('waiting')).toBe(true))
    it('resolved is not active', () => expect(isActive('resolved')).toBe(false))
    it('expired is not active', () => expect(isActive('expired')).toBe(false))
    it('cancelled is not active', () => expect(isActive('cancelled')).toBe(false))
  })
})
