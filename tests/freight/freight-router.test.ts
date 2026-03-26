// LUNA — Tests: freight-router
// Verifica selección de carriers según ruta, tipo de servicio y config.

import { describe, it, expect, vi } from 'vitest'
import { FreightRouter, continentOf, isLatam } from '../../src/tools/freight/freight-router.js'
import type { BaseFreightAdapter } from '../../src/tools/freight/adapters/base-freight-adapter.js'
import type { FreightConfig, FreightLocation, FreightPackage } from '../../src/tools/freight/types.js'

// ─── Helpers ──────────────────────────────────

function makeConfig(overrides?: Partial<FreightConfig>): FreightConfig {
  return {
    enabled: true,
    buffer_percentage: 0.15,
    disclaimer_es: 'test',
    disclaimer_en: 'test',
    default_ready_days: 3,
    max_packages: 20,
    carriers: {
      searates: { enabled: true, container_thresholds: { st20_max_cbm: 15, st40_max_cbm: 30 } },
      dhl_express: { enabled: true, max_weight_per_piece_kg: 70, account_number: 'TEST' },
    },
    known_origins: {},
    ...overrides,
  }
}

function makeMockAdapter(id: 'searates' | 'dhl_express', canQuoteResult: boolean): BaseFreightAdapter {
  return {
    carrierId: id,
    carrierName: id === 'searates' ? 'SeaRates' : 'DHL Express',
    canQuote: vi.fn().mockReturnValue(canQuoteResult),
    getEstimate: vi.fn().mockResolvedValue([]),
    healthCheck: vi.fn().mockResolvedValue(true),
  } as unknown as BaseFreightAdapter
}

const origin: FreightLocation = { city: 'Shenzhen', country_code: 'CN' }
const destLima: FreightLocation = { city: 'Lima', country_code: 'PE' }
const destUS: FreightLocation = { city: 'San Diego', country_code: 'US' }
const packages: FreightPackage[] = [{ weight_kg: 10, length_cm: 50, width_cm: 40, height_cm: 30, quantity: 1 }]

// ─── Tests ────────────────────────────────────

describe('continentOf', () => {
  it('returns correct continent for known countries', () => {
    expect(continentOf('US')).toBe('NA')
    expect(continentOf('CN')).toBe('AS')
    expect(continentOf('CO')).toBe('SA')
    expect(continentOf('PE')).toBe('SA')
    expect(continentOf('DE')).toBe('EU')
  })

  it('returns UNKNOWN for unmapped countries', () => {
    expect(continentOf('XX')).toBe('UNKNOWN')
  })
})

describe('isLatam', () => {
  it('returns true for LATAM countries', () => {
    expect(isLatam('CO')).toBe(true)
    expect(isLatam('PE')).toBe(true)
    expect(isLatam('MX')).toBe(true)
    expect(isLatam('CR')).toBe(true)
    expect(isLatam('BR')).toBe(true)
  })

  it('returns false for non-LATAM countries', () => {
    expect(isLatam('US')).toBe(false)
    expect(isLatam('CN')).toBe(false)
    expect(isLatam('DE')).toBe(false)
  })
})

describe('FreightRouter', () => {
  describe('selectCarriers', () => {
    it('selects both carriers for international route with no service type', () => {
      const searates = makeMockAdapter('searates', true)
      const dhl = makeMockAdapter('dhl_express', true)
      const router = new FreightRouter([searates, dhl], makeConfig())

      const result = router.selectCarriers(origin, destLima, undefined, packages)

      expect(result).toHaveLength(2)
      expect(result.map(a => a.carrierId)).toEqual(['searates', 'dhl_express'])
    })

    it('skips disabled carriers', () => {
      const searates = makeMockAdapter('searates', true)
      const dhl = makeMockAdapter('dhl_express', true)
      const config = makeConfig({
        carriers: {
          searates: { enabled: false, container_thresholds: { st20_max_cbm: 15, st40_max_cbm: 30 } },
          dhl_express: { enabled: true, max_weight_per_piece_kg: 70, account_number: 'TEST' },
        },
      })
      const router = new FreightRouter([searates, dhl], config)

      const result = router.selectCarriers(origin, destLima, undefined, packages)

      expect(result).toHaveLength(1)
      expect(result[0]!.carrierId).toBe('dhl_express')
    })

    it('skips DHL when piece weight exceeds max', () => {
      const searates = makeMockAdapter('searates', true)
      const dhl = makeMockAdapter('dhl_express', true)
      const router = new FreightRouter([searates, dhl], makeConfig())

      const heavyPackages: FreightPackage[] = [
        { weight_kg: 80, length_cm: 100, width_cm: 80, height_cm: 60, quantity: 1 },
      ]

      const result = router.selectCarriers(origin, destLima, undefined, heavyPackages)

      expect(result).toHaveLength(1)
      expect(result[0]!.carrierId).toBe('searates')
    })

    it('returns empty array when no carriers can quote', () => {
      const searates = makeMockAdapter('searates', false)
      const dhl = makeMockAdapter('dhl_express', false)
      const router = new FreightRouter([searates, dhl], makeConfig())

      const result = router.selectCarriers(origin, destLima, 'ocean', packages)

      expect(result).toHaveLength(0)
    })

    it('respects adapter canQuote for service type filtering', () => {
      const searates = makeMockAdapter('searates', false)
      const dhl = makeMockAdapter('dhl_express', true)
      const router = new FreightRouter([searates, dhl], makeConfig())

      const result = router.selectCarriers(origin, destLima, 'express', packages)

      expect(result).toHaveLength(1)
      expect(result[0]!.carrierId).toBe('dhl_express')
    })
  })
})
