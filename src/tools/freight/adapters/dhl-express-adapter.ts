// LUNA — Tool: estimate_freight — DHL Express Adapter
// MyDHL API — Rating endpoint (REST/JSON). Express international shipping.

import pino from 'pino'
import { BaseFreightAdapter } from './base-freight-adapter.js'
import type {
  FreightLocation,
  FreightEstimateInput,
  CarrierEstimate,
  CarrierId,
  FreightConfig,
  FreightSecrets,
} from '../types.js'

const logger = pino({ name: 'freight:dhl-express' })

const DHL_BASE_URL_TEST = 'https://express.api.dhl.com/mydhlapi/test'
const DHL_BASE_URL_PROD = 'https://express.api.dhl.com/mydhlapi'
const ADAPTER_TIMEOUT_MS = 10_000

// ─── DHL API response shapes ──────────────────

interface DhlRatesResponse {
  products?: DhlProduct[]
}

interface DhlProduct {
  productName?: string
  productCode?: string
  totalPrice?: Array<{
    currencyType?: string
    priceCurrency?: string
    price?: number
  }>
  deliveryCapabilities?: {
    estimatedDeliveryDateAndTime?: string
    totalTransitDays?: number
  }
}

export class DhlExpressAdapter extends BaseFreightAdapter {
  readonly carrierId: CarrierId = 'dhl_express'
  readonly carrierName = 'DHL Express'

  private readonly baseUrl: string

  constructor(
    private readonly secrets: FreightSecrets,
    private readonly config: FreightConfig,
  ) {
    super()
    this.baseUrl = secrets.dhlExpressTestMode ? DHL_BASE_URL_TEST : DHL_BASE_URL_PROD
  }

  canQuote(
    _origin: FreightLocation,
    _destination: FreightLocation,
    serviceType?: string,
  ): boolean {
    // DHL Express solo si service_type es express o no especificado
    if (serviceType && serviceType !== 'express') return false

    // Verificar peso máximo por pieza (se valida en el handler, aquí es informativo)
    return true
  }

  async getEstimate(params: FreightEstimateInput): Promise<CarrierEstimate[]> {
    if (!this.secrets.dhlExpressUsername || !this.secrets.dhlExpressPassword) {
      throw new Error('DHL Express credentials not configured')
    }

    const maxWeight = this.config.carriers.dhl_express.max_weight_per_piece_kg
    const heaviest = this.maxPieceWeight(params.packages)
    if (heaviest > maxWeight) {
      throw new Error(`Package exceeds DHL max weight: ${heaviest}kg > ${maxWeight}kg limit`)
    }

    const readyDate = this.resolveReadyDate(
      params.ready_date,
      this.config.default_ready_days,
    )

    // DHL quiere peso y dimensiones totales o del paquete más grande.
    // Para múltiples paquetes, hacemos un request con el total consolidado.
    const totalWeight = this.totalWeight(params.packages)
    const largestPkg = this.getLargestPackage(params.packages)

    const accountNumber = this.resolveAccountNumber()
    const url = this.buildRateUrl(
      params.origin,
      params.destination,
      totalWeight,
      largestPkg,
      readyDate,
      accountNumber,
    )

    logger.info(
      {
        origin: `${params.origin.city}, ${params.origin.country_code}`,
        destination: `${params.destination.city}, ${params.destination.country_code}`,
        totalWeight,
      },
      'DHL Express rate request',
    )

    const res = await fetch(url, {
      method: 'GET',
      headers: this.buildHeaders(),
      signal: AbortSignal.timeout(ADAPTER_TIMEOUT_MS),
    })

    if (!res.ok) {
      const body = await res.text().catch(() => '')
      throw new Error(`DHL API error: ${res.status} ${res.statusText} — ${body.slice(0, 200)}`)
    }

    const json = await res.json() as DhlRatesResponse
    const products = json.products ?? []

    if (products.length === 0) {
      logger.warn('DHL returned no products for this route')
      return []
    }

    return products.map(p => this.normalizeProduct(p)).filter((e): e is CarrierEstimate => e !== null)
  }

  async healthCheck(): Promise<boolean> {
    if (!this.secrets.dhlExpressUsername || !this.secrets.dhlExpressPassword) return false
    try {
      // Simple check: hit the rates endpoint with minimal params
      const res = await fetch(`${this.baseUrl}/rates?accountNumber=test`, {
        method: 'GET',
        headers: this.buildHeaders(),
        signal: AbortSignal.timeout(5000),
      })
      // Even a 400 means the API is reachable
      return res.status !== 0
    } catch {
      return false
    }
  }

  // ─── Private: Build rate URL ────────────────────

  private buildRateUrl(
    origin: FreightLocation,
    destination: FreightLocation,
    totalWeight: number,
    largestPkg: { length_cm: number; width_cm: number; height_cm: number },
    readyDate: string,
    accountNumber: string,
  ): string {
    const params = new URLSearchParams()
    params.set('accountNumber', accountNumber)
    params.set('originCountryCode', origin.country_code)
    params.set('originCityName', origin.city)
    params.set('destinationCountryCode', destination.country_code)
    params.set('destinationCityName', destination.city)
    params.set('weight', String(Math.ceil(totalWeight)))
    params.set('length', String(Math.ceil(largestPkg.length_cm)))
    params.set('width', String(Math.ceil(largestPkg.width_cm)))
    params.set('height', String(Math.ceil(largestPkg.height_cm)))
    params.set('plannedShippingDate', readyDate)
    params.set('isCustomsDeclarable', 'true')
    params.set('unitOfMeasurement', 'metric')

    if (origin.postal_code) params.set('originPostalCode', origin.postal_code)
    if (destination.postal_code) params.set('destinationPostalCode', destination.postal_code)

    return `${this.baseUrl}/rates?${params.toString()}`
  }

  // ─── Private: Normalize DHL product ─────────────

  private normalizeProduct(product: DhlProduct): CarrierEstimate | null {
    // Find the bill currency price (BILLC)
    const priceEntry = product.totalPrice?.find(p => p.currencyType === 'BILLC')
      ?? product.totalPrice?.[0]

    if (!priceEntry?.price) return null

    const transitDays = product.deliveryCapabilities?.totalTransitDays ?? 0

    // Parse delivery date to calculate transit range
    let transitMin = Math.max(1, transitDays)
    let transitMax = transitDays + 2 // DHL is pretty precise, small buffer

    if (transitDays === 0 && product.deliveryCapabilities?.estimatedDeliveryDateAndTime) {
      // Calculate from estimated delivery date
      const deliveryDate = new Date(product.deliveryCapabilities.estimatedDeliveryDateAndTime)
      const now = new Date()
      const days = Math.ceil((deliveryDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
      transitMin = Math.max(1, days - 1)
      transitMax = days + 1
    }

    // Validity: DHL rates are typically valid for the shipping date
    const validUntil = this.defaultValidUntil()

    return {
      service_name: product.productName ?? `DHL ${product.productCode ?? 'Express'}`,
      shipping_type: 'express',
      price_usd: priceEntry.price,
      currency_original: priceEntry.priceCurrency ?? 'USD',
      transit_days_min: transitMin,
      transit_days_max: transitMax,
      valid_until: validUntil,
      is_indicative: true, // DHL rates are indicative until booking
      details: {
        provider_name: 'DHL Express',
      },
    }
  }

  // ─── Private: Helpers ────────────────────────────

  private buildHeaders(): Record<string, string> {
    const credentials = Buffer.from(
      `${this.secrets.dhlExpressUsername}:${this.secrets.dhlExpressPassword}`,
    ).toString('base64')

    return {
      'Authorization': `Basic ${credentials}`,
      'Accept': 'application/json',
    }
  }

  private resolveAccountNumber(): string {
    const fromConfig = this.config.carriers.dhl_express.account_number
    if (fromConfig && fromConfig !== 'FROM_ENV') return fromConfig
    return this.secrets.dhlExpressAccountNumber ?? ''
  }

  private getLargestPackage(packages: FreightEstimateInput['packages']): {
    length_cm: number
    width_cm: number
    height_cm: number
  } {
    let largest = packages[0]!
    let maxVol = 0
    for (const p of packages) {
      const vol = p.length_cm * p.width_cm * p.height_cm
      if (vol > maxVol) {
        maxVol = vol
        largest = p
      }
    }
    return { length_cm: largest.length_cm, width_cm: largest.width_cm, height_cm: largest.height_cm }
  }

  private defaultValidUntil(): string {
    const d = new Date()
    d.setDate(d.getDate() + 7)
    return d.toISOString().slice(0, 10)
  }
}
