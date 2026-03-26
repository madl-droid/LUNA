// LUNA — Tests: freight-tool (integration)
// Verifica la tool completa: validación, routing, estimación, buffer.

import { describe, it, expect, vi, afterEach } from 'vitest'
import { handleEstimateFreight, inputSchema } from '../../src/tools/freight/freight-tool.js'
import type { FreightConfig, FreightSecrets } from '../../src/tools/freight/types.js'

// ─── Helpers ──────────────────────────────────

function makeConfig(): FreightConfig {
  return {
    enabled: true,
    buffer_percentage: 0.15,
    disclaimer_es: 'Estimado aproximado.',
    disclaimer_en: 'Approximate estimate.',
    default_ready_days: 3,
    max_packages: 20,
    carriers: {
      searates: { enabled: true, container_thresholds: { st20_max_cbm: 15, st40_max_cbm: 30 } },
      dhl_express: { enabled: true, max_weight_per_piece_kg: 70, account_number: 'TEST123' },
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
    dhlExpressUsername: 'test-user',
    dhlExpressPassword: 'test-pass',
    dhlExpressAccountNumber: 'ACC123',
    dhlExpressTestMode: true,
  }
}

const validInput = {
  origin: { city: 'Shenzhen', country_code: 'CN', coordinates: { lat: 22.54, lng: 114.05 } },
  destination: { city: 'Lima', country_code: 'PE', coordinates: { lat: -12.04, lng: -77.02 } },
  packages: [{ weight_kg: 28, length_cm: 130, width_cm: 85, height_cm: 25, quantity: 20 }],
}

// ─── Mock fetch ───────────────────────────────

const originalFetch = globalThis.fetch

function mockFetchForBothCarriers(): void {
  let callCount = 0
  globalThis.fetch = vi.fn().mockImplementation((url: string) => {
    callCount++
    // SeaRates calls go to graphql endpoint
    if (typeof url === 'string' && url.includes('searates.com')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          data: {
            autoRates: [{
              shippingType: 'FCL',
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
            }],
          },
        }),
      })
    }
    // DHL calls go to dhl.com
    if (typeof url === 'string' && url.includes('dhl.com')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          products: [{
            productName: 'EXPRESS WORLDWIDE',
            productCode: 'P',
            totalPrice: [{ currencyType: 'BILLC', priceCurrency: 'USD', price: 6200 }],
            deliveryCapabilities: { totalTransitDays: 4 },
          }],
        }),
      })
    }
    return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) })
  })
}

// ─── Tests: Input validation ──────────────────

describe('inputSchema', () => {
  it('validates correct input', () => {
    const result = inputSchema.safeParse(validInput)
    expect(result.success).toBe(true)
  })

  it('rejects missing origin', () => {
    const result = inputSchema.safeParse({ destination: validInput.destination, packages: validInput.packages })
    expect(result.success).toBe(false)
  })

  it('rejects empty packages array', () => {
    const result = inputSchema.safeParse({ ...validInput, packages: [] })
    expect(result.success).toBe(false)
  })

  it('rejects negative weight', () => {
    const result = inputSchema.safeParse({
      ...validInput,
      packages: [{ weight_kg: -5, length_cm: 10, width_cm: 10, height_cm: 10, quantity: 1 }],
    })
    expect(result.success).toBe(false)
  })

  it('rejects invalid country code length', () => {
    const result = inputSchema.safeParse({
      ...validInput,
      origin: { city: 'Test', country_code: 'USA' },
    })
    expect(result.success).toBe(false)
  })

  it('accepts valid service_type', () => {
    const result = inputSchema.safeParse({ ...validInput, service_type: 'ocean' })
    expect(result.success).toBe(true)
  })

  it('rejects invalid service_type', () => {
    const result = inputSchema.safeParse({ ...validInput, service_type: 'rail' })
    expect(result.success).toBe(false)
  })

  it('accepts valid ready_date format', () => {
    const result = inputSchema.safeParse({ ...validInput, ready_date: '2026-04-01' })
    expect(result.success).toBe(true)
  })

  it('rejects invalid ready_date format', () => {
    const result = inputSchema.safeParse({ ...validInput, ready_date: '04/01/2026' })
    expect(result.success).toBe(false)
  })
})

// ─── Tests: Full estimation flow ──────────────

describe('handleEstimateFreight', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  it('returns validation error for invalid input', async () => {
    const result = await handleEstimateFreight({}, makeConfig(), makeSecrets())

    expect(result.success).toBe(false)
    expect(result.estimates).toEqual([])
    expect(result.errors).toBeDefined()
    expect(result.errors![0]!.carrier).toBe('validation')
  })

  it('returns error when too many packages', async () => {
    const config = makeConfig()
    config.max_packages = 1
    const result = await handleEstimateFreight(
      { ...validInput, packages: [validInput.packages[0], validInput.packages[0]] },
      config,
      makeSecrets(),
    )

    expect(result.success).toBe(false)
    expect(result.errors![0]!.error).toContain('Too many package types')
  })

  it('returns estimates from multiple carriers with buffer applied', async () => {
    mockFetchForBothCarriers()

    const result = await handleEstimateFreight(validInput, makeConfig(), makeSecrets())

    expect(result.success).toBe(true)
    expect(result.buffer_applied).toBe(0.15)
    expect(result.disclaimer).toBe('Estimado aproximado.')
    expect(result.estimates.length).toBeGreaterThan(0)

    // Check buffer was applied: original 1800 * 1.15 = 2070
    const fclEstimate = result.estimates.find(e => e.shipping_type === 'ocean_fcl')
    if (fclEstimate) {
      expect(fclEstimate.price_usd).toBe(2070)
      expect(fclEstimate.price_original_usd).toBe(1800)
      expect(fclEstimate.carrier).toBe('searates')
    }

    // DHL estimate: 6200 * 1.15 = 7130
    const expressEstimate = result.estimates.find(e => e.shipping_type === 'express')
    if (expressEstimate) {
      expect(expressEstimate.price_usd).toBe(7130)
      expect(expressEstimate.price_original_usd).toBe(6200)
      expect(expressEstimate.carrier).toBe('dhl_express')
    }
  })

  it('returns partial results when one carrier fails', async () => {
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      if (typeof url === 'string' && url.includes('searates.com')) {
        return Promise.reject(new Error('Network error'))
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          products: [{
            productName: 'EXPRESS WORLDWIDE',
            totalPrice: [{ currencyType: 'BILLC', priceCurrency: 'USD', price: 500 }],
            deliveryCapabilities: { totalTransitDays: 3 },
          }],
        }),
      })
    })

    const result = await handleEstimateFreight(validInput, makeConfig(), makeSecrets())

    expect(result.success).toBe(true)
    expect(result.estimates.length).toBeGreaterThan(0)
    expect(result.errors).toBeDefined()
    expect(result.errors!.length).toBeGreaterThan(0)
  })

  it('returns success=false when all carriers fail', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('All down'))

    const result = await handleEstimateFreight(validInput, makeConfig(), makeSecrets())

    expect(result.success).toBe(false)
    expect(result.estimates).toEqual([])
    expect(result.errors).toBeDefined()
  })

  it('returns no carriers error when no adapters match', async () => {
    const config = makeConfig()
    config.carriers.searates.enabled = false
    config.carriers.dhl_express.enabled = false

    const result = await handleEstimateFreight(validInput, config, makeSecrets())

    expect(result.success).toBe(false)
    expect(result.errors![0]!.carrier).toBe('router')
    expect(result.errors![0]!.error).toContain('No carriers available')
  })

  it('skips carriers without credentials', async () => {
    const secrets = makeSecrets()
    secrets.searatesApiKey = undefined
    secrets.dhlExpressUsername = undefined

    const result = await handleEstimateFreight(validInput, makeConfig(), secrets)

    expect(result.success).toBe(false)
    expect(result.errors![0]!.error).toContain('No carriers available')
  })
})
