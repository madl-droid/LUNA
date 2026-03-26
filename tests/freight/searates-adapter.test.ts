// LUNA — Tests: searates-adapter
// Verifica el adapter de SeaRates con API responses mockeadas.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { SeaRatesAdapter } from '../../src/tools/freight/adapters/searates-adapter.js'
import type { FreightConfig, FreightSecrets, FreightEstimateInput } from '../../src/tools/freight/types.js'

// ─── Helpers ──────────────────────────────────

function makeConfig(): FreightConfig {
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
    known_origins: {
      shenzhen: { city: 'Shenzhen', country_code: 'CN', postal_code: '518000', coordinates: { lat: 22.5431, lng: 114.0579 } },
    },
  }
}

function makeSecrets(): FreightSecrets {
  return {
    searatesApiKey: 'test-key',
    searatesPlatformId: 'test-platform',
    dhlExpressUsername: undefined,
    dhlExpressPassword: undefined,
    dhlExpressAccountNumber: undefined,
    dhlExpressTestMode: true,
  }
}

const baseInput: FreightEstimateInput = {
  origin: { city: 'Shenzhen', country_code: 'CN', coordinates: { lat: 22.54, lng: 114.05 } },
  destination: { city: 'Lima', country_code: 'PE', coordinates: { lat: -12.04, lng: -77.02 } },
  packages: [{ weight_kg: 28, length_cm: 130, width_cm: 85, height_cm: 25, quantity: 20 }],
}

// ─── Mock fetch ───────────────────────────────

const originalFetch = globalThis.fetch

function mockFetch(response: unknown, status = 200): void {
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    json: () => Promise.resolve(response),
    text: () => Promise.resolve(JSON.stringify(response)),
  })
}

// ─── Tests ────────────────────────────────────

describe('SeaRatesAdapter', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  describe('canQuote', () => {
    const adapter = new SeaRatesAdapter(makeSecrets(), makeConfig())

    it('returns true for international routes', () => {
      expect(adapter.canQuote(
        { city: 'Shenzhen', country_code: 'CN' },
        { city: 'Lima', country_code: 'PE' },
      )).toBe(true)
    })

    it('returns false for same-country routes', () => {
      expect(adapter.canQuote(
        { city: 'Shanghai', country_code: 'CN' },
        { city: 'Shenzhen', country_code: 'CN' },
      )).toBe(false)
    })

    it('returns false for express service type', () => {
      expect(adapter.canQuote(
        { city: 'Shenzhen', country_code: 'CN' },
        { city: 'Lima', country_code: 'PE' },
        'express',
      )).toBe(false)
    })

    it('returns true for ocean service type', () => {
      expect(adapter.canQuote(
        { city: 'Shenzhen', country_code: 'CN' },
        { city: 'Lima', country_code: 'PE' },
        'ocean',
      )).toBe(true)
    })
  })

  describe('getEstimate', () => {
    it('returns normalized estimates from auto rates', async () => {
      const adapter = new SeaRatesAdapter(makeSecrets(), makeConfig())

      mockFetch({
        data: {
          autoRates: [
            {
              shippingType: 'FCL',
              rates: [{
                totalPrice: 1800,
                totalCurrency: 'USD',
                totalTransitTime: 32,
                validityTo: '2026-04-25',
                provider: 'MSC',
                indicative: true,
                containerType: 'ST20',
                points: [
                  { location: { name: 'Shenzhen', country: 'CN' }, transitTime: { rate: 28 } },
                  { location: { name: 'Callao', country: 'PE' }, transitTime: { rate: 32 } },
                ],
              }],
            },
            {
              shippingType: 'AIR',
              rates: [{
                totalPrice: 4500,
                totalCurrency: 'USD',
                totalTransitTime: 6,
                validityTo: '2026-04-25',
                provider: 'LATAM Cargo',
                indicative: true,
                points: [],
              }],
            },
          ],
        },
      })

      const result = await adapter.getEstimate(baseInput)

      expect(result).toHaveLength(2)

      // FCL estimate
      expect(result[0]!.shipping_type).toBe('ocean_fcl')
      expect(result[0]!.price_usd).toBe(1800)
      expect(result[0]!.currency_original).toBe('USD')
      expect(result[0]!.is_indicative).toBe(true)
      expect(result[0]!.details?.provider_name).toBe('MSC')
      expect(result[0]!.details?.container_type).toBe('ST20')
      expect(result[0]!.details?.route_points).toContain('Shenzhen')

      // AIR estimate
      expect(result[1]!.shipping_type).toBe('air')
      expect(result[1]!.price_usd).toBe(4500)
    })

    it('throws on API key missing', async () => {
      const secrets = makeSecrets()
      secrets.searatesApiKey = undefined
      const adapter = new SeaRatesAdapter(secrets, makeConfig())

      await expect(adapter.getEstimate(baseInput)).rejects.toThrow('SeaRates API key not configured')
    })

    it('throws on API error response', async () => {
      const adapter = new SeaRatesAdapter(makeSecrets(), makeConfig())
      mockFetch({}, 500)

      await expect(adapter.getEstimate(baseInput)).rejects.toThrow('SeaRates API error: 500')
    })

    it('throws on GraphQL errors', async () => {
      const adapter = new SeaRatesAdapter(makeSecrets(), makeConfig())
      mockFetch({ errors: [{ message: 'Rate not found' }] })

      await expect(adapter.getEstimate(baseInput)).rejects.toThrow('SeaRates GraphQL error: Rate not found')
    })

    it('resolves coordinates from known_origins when not provided', async () => {
      const adapter = new SeaRatesAdapter(makeSecrets(), makeConfig())
      mockFetch({ data: { autoRates: [] } })

      const input: FreightEstimateInput = {
        origin: { city: 'Shenzhen', country_code: 'CN' }, // no coords
        destination: { city: 'Lima', country_code: 'PE', coordinates: { lat: -12.04, lng: -77.02 } },
        packages: [{ weight_kg: 10, length_cm: 50, width_cm: 40, height_cm: 30, quantity: 1 }],
      }

      // Should not throw because Shenzhen is in known_origins
      const result = await adapter.getEstimate(input)
      expect(result).toEqual([])

      // Verify fetch was called (meaning coords were resolved)
      expect(globalThis.fetch).toHaveBeenCalled()
    })

    it('throws when coordinates cannot be resolved', async () => {
      const adapter = new SeaRatesAdapter(makeSecrets(), makeConfig())

      const input: FreightEstimateInput = {
        origin: { city: 'Unknown City', country_code: 'XX' }, // no coords, not in known_origins
        destination: { city: 'Lima', country_code: 'PE', coordinates: { lat: -12.04, lng: -77.02 } },
        packages: [{ weight_kg: 10, length_cm: 50, width_cm: 40, height_cm: 30, quantity: 1 }],
      }

      await expect(adapter.getEstimate(input)).rejects.toThrow('Cannot resolve coordinates for origin')
    })

    it('uses specific shipping type when service_type is provided', async () => {
      const adapter = new SeaRatesAdapter(makeSecrets(), makeConfig())
      mockFetch({
        data: {
          rates: [{
            totalPrice: 1800,
            totalCurrency: 'USD',
            totalTransitTime: 32,
            validityTo: '2026-04-25',
            provider: 'MSC',
            indicative: true,
            containerType: 'ST20',
            points: [],
          }],
        },
      })

      const input: FreightEstimateInput = {
        ...baseInput,
        service_type: 'ocean',
      }

      const result = await adapter.getEstimate(input)
      // Should make multiple calls for FCL and LCL
      expect(globalThis.fetch).toHaveBeenCalled()
    })
  })

  describe('healthCheck', () => {
    it('returns true when API is reachable', async () => {
      const adapter = new SeaRatesAdapter(makeSecrets(), makeConfig())
      mockFetch({ data: { __typename: 'Query' } })

      const result = await adapter.healthCheck()
      expect(result).toBe(true)
    })

    it('returns false when API key is missing', async () => {
      const secrets = makeSecrets()
      secrets.searatesApiKey = undefined
      const adapter = new SeaRatesAdapter(secrets, makeConfig())

      const result = await adapter.healthCheck()
      expect(result).toBe(false)
    })
  })
})
