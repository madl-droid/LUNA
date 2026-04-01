import { describe, it, expect } from 'vitest'
import { findNextInChain } from '../../src/modules/hitl/responder-selector.js'
import type { Responder } from '../../src/modules/hitl/types.js'

describe('responder-selector', () => {
  describe('findNextInChain', () => {
    const chain: Responder[] = [
      { userId: 'USR-001', displayName: 'Supervisor 1', senderId: '+1111', channel: 'whatsapp' },
      { userId: 'USR-002', displayName: 'Supervisor 2', senderId: '+2222', channel: 'whatsapp' },
      { userId: 'USR-003', displayName: 'Admin', senderId: '+3333', channel: 'whatsapp' },
    ]

    it('returns first supervisor when none tried', () => {
      const result = findNextInChain(chain, [])
      expect(result).not.toBeNull()
      expect(result!.userId).toBe('USR-001')
    })

    it('skips already tried supervisors', () => {
      const result = findNextInChain(chain, ['USR-001'])
      expect(result).not.toBeNull()
      expect(result!.userId).toBe('USR-002')
    })

    it('returns last in chain when others tried', () => {
      const result = findNextInChain(chain, ['USR-001', 'USR-002'])
      expect(result).not.toBeNull()
      expect(result!.userId).toBe('USR-003')
    })

    it('returns null when all tried', () => {
      const result = findNextInChain(chain, ['USR-001', 'USR-002', 'USR-003'])
      expect(result).toBeNull()
    })

    it('returns null for empty chain', () => {
      const result = findNextInChain([], [])
      expect(result).toBeNull()
    })

    it('handles duplicate tried IDs', () => {
      const result = findNextInChain(chain, ['USR-001', 'USR-001'])
      expect(result!.userId).toBe('USR-002')
    })
  })
})
