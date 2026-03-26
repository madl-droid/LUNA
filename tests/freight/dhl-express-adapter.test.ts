// LUNA — Tests: dhl-express-adapter
// Verifica el adapter de DHL Express con API responses mockeadas.

import { describe, it, expect, vi, afterEach } from 'vitest'
import { DhlExpressAdapter } from '../../src/tools/freight/adapters/dhl-express-adapter.js'
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
      dhl_express: { enabled: true, max_weight_per_piece_kg: 70, account_number: 'TEST123' },
    },
    known_origins: {},
  }
}

function makeSecrets(): FreightSecrets {
  return {
    searatesApiKey: undefined,
    searatesPlatformId: undefined,
    dhlExpressUsername: 'test-user',
    dhlExpressPassword: 'test-pass',
    dhlExpressAccountNumber: 'ACC123',
    dhlExpressTestMode: true,
  }
}

const baseInput: FreightEstimateInput = {
  origin: { city: 'San Diego', country_code: 'US', postal_code: '92101' },
  destination: { city: 'Lima', country_code: 'PE' },
  packages: [{ weight_kg: 25, length_cm: 80, width_cm: 60, height_cm: 40, quantity: 2 }],
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

describe('DhlExpressAdapter', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  describe('canQuote', () => {
    const adapter = new DhlExpressAdapter(makeSecrets(), makeConfig())

    it('returns true for express or unspecified service type', () => {
      expect(adapter.canQuote(
        { city: 'San Diego', country_code: 'US' },
        { city: 'Lima', country_code: 'PE' },
      )).toBe(true)

      expect(adapter.canQuote(
        { city: 'San Diego', country_code: 'US' },
        { city: 'Lima', country_code: 'PE' },
        'express',
      )).toBe(true)
    })

    it('returns false for non-express service types', () => {
      expect(adapter.canQuote(
        { city: 'San Diego', country_code: 'US' },
        { city: 'Lima', country_code: 'PE' },
        'ocean',
      )).toBe(false)

      expect(adapter.canQuote(
        { city: 'San Diego', country_code: 'US' },
        { city: 'Lima', country_code: 'PE' },
        'air',
      )).toBe(false)
    })
  })

  describe('getEstimate', () => {
    it('returns normalized estimates from DHL products', async () => {
      const adapter = new DhlExpressAdapter(makeSecrets(), makeConfig())

      mockFetch({
        products: [
          {
            productName: 'EXPRESS WORLDWIDE',
            productCode: 'P',
            totalPrice: [
              { currencyType: 'BILLC', priceCurrency: 'USD', price: 947.32 },
              { currencyType: 'PULCL', priceCurrency: 'PEN', price: 3500 },
            ],
            deliveryCapabilities: {
              estimatedDeliveryDateAndTime: '2026-04-02T23:59:00',
              totalTransitDays: 3,
            },
          },
          {
            productName: 'EXPRESS 12:00',
            productCode: 'Y',
            totalPrice: [
              { currencyType: 'BILLC', priceCurrency: 'USD', price: 1200.50 },
            ],
            deliveryCapabilities: {
              totalTransitDays: 2,
            },
          },
        ],
      })

      const result = await adapter.getEstimate(baseInput)

      expect(result).toHaveLength(2)

      // EXPRESS WORLDWIDE
      expect(result[0]!.service_name).toBe('EXPRESS WORLDWIDE')
      expect(result[0]!.shipping_type).toBe('express')
      expect(result[0]!.price_usd).toBe(947.32)
      expect(result[0]!.currency_original).toBe('USD')
      expect(result[0]!.transit_days_min).toBe(3)
      expect(result[0]!.transit_days_max).toBe(5)
      expect(result[0]!.is_indicative).toBe(true)

      // EXPRESS 12:00
      expect(result[1]!.service_name).toBe('EXPRESS 12:00')
      expect(result[1]!.price_usd).toBe(1200.50)
    })

    it('uses test base URL when testMode is true', async () => {
      const adapter = new DhlExpressAdapter(makeSecrets(), makeConfig())
      mockFetch({ products: [] })

      await adapter.getEstimate(baseInput)

      const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string
      expect(fetchCall).toContain('express.api.dhl.com/mydhlapi/test')
    })

    it('uses prod base URL when testMode is false', async () => {
      const secrets = makeSecrets()
      secrets.dhlExpressTestMode = false
      const adapter = new DhlExpressAdapter(secrets, makeConfig())
      mockFetch({ products: [] })

      await adapter.getEstimate(baseInput)

      const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string
      expect(fetchCall).toContain('express.api.dhl.com/mydhlapi/rates')
      expect(fetchCall).not.toContain('/test/')
    })

    it('throws when credentials are missing', async () => {
      const secrets = makeSecrets()
      secrets.dhlExpressUsername = undefined
      const adapter = new DhlExpressAdapter(secrets, makeConfig())

      await expect(adapter.getEstimate(baseInput)).rejects.toThrow('DHL Express credentials not configured')
    })

    it('throws when piece weight exceeds max', async () => {
      const adapter = new DhlExpressAdapter(makeSecrets(), makeConfig())

      const heavyInput: FreightEstimateInput = {
        ...baseInput,
        packages: [{ weight_kg: 80, length_cm: 100, width_cm: 80, height_cm: 60, quantity: 1 }],
      }

      await expect(adapter.getEstimate(heavyInput)).rejects.toThrow('Package exceeds DHL max weight')
    })

    it('throws on API error response', async () => {
      const adapter = new DhlExpressAdapter(makeSecrets(), makeConfig())
      mockFetch({ detail: 'Bad request' }, 400)

      await expect(adapter.getEstimate(baseInput)).rejects.toThrow('DHL API error: 400')
    })

    it('returns empty array when no products available', async () => {
      const adapter = new DhlExpressAdapter(makeSecrets(), makeConfig())
      mockFetch({ products: [] })

      const result = await adapter.getEstimate(baseInput)
      expect(result).toEqual([])
    })

    it('includes authorization header with basic auth', async () => {
      const adapter = new DhlExpressAdapter(makeSecrets(), makeConfig())
      mockFetch({ products: [] })

      await adapter.getEstimate(baseInput)

      const fetchCall = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]!
      const headers = fetchCall[1]?.headers as Record<string, string>
      expect(headers['Authorization']).toMatch(/^Basic /)
      // Verify it's base64 of test-user:test-pass
      const decoded = Buffer.from(headers['Authorization']!.replace('Basic ', ''), 'base64').toString()
      expect(decoded).toBe('test-user:test-pass')
    })

    it('builds correct URL params', async () => {
      const adapter = new DhlExpressAdapter(makeSecrets(), makeConfig())
      mockFetch({ products: [] })

      await adapter.getEstimate(baseInput)

      const url = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0]![0] as string
      expect(url).toContain('originCountryCode=US')
      expect(url).toContain('originCityName=San+Diego')
      expect(url).toContain('destinationCountryCode=PE')
      expect(url).toContain('destinationCityName=Lima')
      expect(url).toContain('unitOfMeasurement=metric')
      expect(url).toContain('isCustomsDeclarable=true')
      expect(url).toContain('originPostalCode=92101')
    })
  })
})
