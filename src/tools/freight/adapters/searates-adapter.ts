// LUNA — Tool: estimate_freight — SeaRates Adapter
// Logistics Explorer API (GraphQL). Cotiza ocean (FCL/LCL), air, ground (FTL/LTL).

import pino from 'pino'
import { BaseFreightAdapter } from './base-freight-adapter.js'
import type {
  FreightLocation,
  FreightEstimateInput,
  CarrierEstimate,
  CarrierId,
  ShippingType,
  FreightConfig,
  FreightSecrets,
} from '../types.js'

const logger = pino({ name: 'freight:searates' })

const SEARATES_GRAPHQL_URL = 'https://rates.searates.com/graphql'
const ADAPTER_TIMEOUT_MS = 10_000

// ─── SeaRates API response shapes ──────────────

interface SeaRatesRateResponse {
  data?: {
    rates?: SeaRatesRate[]
  }
  errors?: Array<{ message: string }>
}

interface SeaRatesRate {
  totalPrice: number
  totalCurrency: string
  totalTransitTime: number
  validityFrom?: string
  validityTo?: string
  provider?: string
  indicative?: boolean
  shippingType?: string
  containerType?: string
  points?: Array<{
    location?: { name?: string; country?: string }
    transitTime?: { rate?: number; port?: number }
  }>
}

interface SeaRatesAutoRatesResponse {
  data?: {
    autoRates?: Array<{
      shippingType: string
      rates: SeaRatesRate[]
    }>
  }
  errors?: Array<{ message: string }>
}

// ─── Shipping type map ─────────────────────────

const SEARATES_TYPE_MAP: Record<string, ShippingType> = {
  FCL: 'ocean_fcl',
  LCL: 'ocean_lcl',
  AIR: 'air',
  FTL: 'ground',
  LTL: 'ground',
}

const SERVICE_TO_SEARATES: Record<string, string[]> = {
  ocean: ['FCL', 'LCL'],
  air: ['AIR'],
  ground: ['FTL', 'LTL'],
}

export class SeaRatesAdapter extends BaseFreightAdapter {
  readonly carrierId: CarrierId = 'searates'
  readonly carrierName = 'SeaRates'

  constructor(
    private readonly secrets: FreightSecrets,
    private readonly config: FreightConfig,
  ) {
    super()
  }

  canQuote(
    origin: FreightLocation,
    destination: FreightLocation,
    serviceType?: string,
  ): boolean {
    // Solo rutas internacionales (cross-border)
    if (origin.country_code === destination.country_code) return false

    // Si se pide express, SeaRates no aplica
    if (serviceType === 'express') return false

    return true
  }

  async getEstimate(params: FreightEstimateInput): Promise<CarrierEstimate[]> {
    if (!this.secrets.searatesApiKey) {
      throw new Error('SeaRates API key not configured')
    }

    const origin = this.resolveCoordinates(params.origin)
    const destination = this.resolveCoordinates(params.destination)

    if (!origin.coordinates) {
      throw new Error(`Cannot resolve coordinates for origin: ${params.origin.city}, ${params.origin.country_code}`)
    }
    if (!destination.coordinates) {
      throw new Error(`Cannot resolve coordinates for destination: ${params.destination.city}, ${params.destination.country_code}`)
    }

    const weightKg = this.totalWeight(params.packages)
    const volumeCbm = this.totalVolumeCbm(params.packages)
    const readyDate = this.resolveReadyDate(
      params.ready_date,
      this.config.default_ready_days,
    )

    const coordsFrom: [number, number] = [origin.coordinates.lat, origin.coordinates.lng]
    const coordsTo: [number, number] = [destination.coordinates.lat, destination.coordinates.lng]

    // Si se pide un tipo específico, usar Get Rates; si no, usar Auto Rates
    if (params.service_type && params.service_type !== 'express') {
      const shippingTypes = SERVICE_TO_SEARATES[params.service_type] ?? []
      const results: CarrierEstimate[] = []

      for (const st of shippingTypes) {
        try {
          const rates = await this.getRates(
            st, coordsFrom, coordsTo, readyDate,
            weightKg, volumeCbm,
          )
          results.push(...rates)
        } catch (err) {
          logger.warn({ shippingType: st, error: String(err) }, 'SeaRates getRates failed for type')
        }
      }
      return results
    }

    // Auto Rates: SeaRates determina los shipping types posibles
    return this.getAutoRates(coordsFrom, coordsTo, readyDate, weightKg, volumeCbm)
  }

  async healthCheck(): Promise<boolean> {
    if (!this.secrets.searatesApiKey) return false
    try {
      const res = await fetch(SEARATES_GRAPHQL_URL, {
        method: 'POST',
        headers: this.buildHeaders(),
        body: JSON.stringify({ query: '{ __typename }' }),
        signal: AbortSignal.timeout(5000),
      })
      return res.ok
    } catch {
      return false
    }
  }

  // ─── Private: Get Rates (specific shipping type) ────

  private async getRates(
    shippingType: string,
    coordsFrom: [number, number],
    coordsTo: [number, number],
    date: string,
    weightKg: number,
    volumeCbm: number,
  ): Promise<CarrierEstimate[]> {
    const variables: Record<string, unknown> = {
      shippingType,
      coordinatesFrom: coordsFrom,
      coordinatesTo: coordsTo,
      date,
    }

    // FCL requiere tipo de container
    if (shippingType === 'FCL') {
      variables.container = this.selectContainer(volumeCbm)
    } else {
      // LCL, AIR, FTL, LTL requieren peso y volumen
      variables.weight = weightKg
      variables.volume = volumeCbm
    }

    const query = `
      query GetRates($shippingType: String!, $coordinatesFrom: [Float!]!, $coordinatesTo: [Float!]!, $date: String!${shippingType === 'FCL' ? ', $container: String!' : ', $weight: Float!, $volume: Float!'}) {
        rates(
          shippingType: $shippingType
          coordinatesFrom: $coordinatesFrom
          coordinatesTo: $coordinatesTo
          date: $date
          ${shippingType === 'FCL' ? 'container: $container' : 'weight: $weight\n          volume: $volume'}
        ) {
          totalPrice
          totalCurrency
          totalTransitTime
          validityFrom
          validityTo
          provider
          indicative
          shippingType
          containerType
          points {
            location { name country }
            transitTime { rate port }
          }
        }
      }
    `

    const body = JSON.stringify({ query, variables })

    logger.info(
      { shippingType, from: coordsFrom, to: coordsTo, weightKg, volumeCbm },
      'SeaRates getRates request',
    )

    const res = await fetch(SEARATES_GRAPHQL_URL, {
      method: 'POST',
      headers: this.buildHeaders(),
      body,
      signal: AbortSignal.timeout(ADAPTER_TIMEOUT_MS),
    })

    if (!res.ok) {
      throw new Error(`SeaRates API error: ${res.status} ${res.statusText}`)
    }

    const json = await res.json() as SeaRatesRateResponse

    if (json.errors?.length) {
      throw new Error(`SeaRates GraphQL error: ${json.errors[0]!.message}`)
    }

    const rates = json.data?.rates ?? []
    return rates.map(r => this.normalizeRate(r, shippingType))
  }

  // ─── Private: Auto Rates (auto-detect shipping types) ─

  private async getAutoRates(
    coordsFrom: [number, number],
    coordsTo: [number, number],
    date: string,
    weightKg: number,
    volumeCbm: number,
  ): Promise<CarrierEstimate[]> {
    const query = `
      query GetAutoRates($coordinatesFrom: [Float!]!, $coordinatesTo: [Float!]!, $date: String!, $weight: Float!, $volume: Float!) {
        autoRates(
          coordinatesFrom: $coordinatesFrom
          coordinatesTo: $coordinatesTo
          date: $date
          weight: $weight
          volume: $volume
        ) {
          shippingType
          rates {
            totalPrice
            totalCurrency
            totalTransitTime
            validityFrom
            validityTo
            provider
            indicative
            containerType
            points {
              location { name country }
              transitTime { rate port }
            }
          }
        }
      }
    `

    const variables = {
      coordinatesFrom: coordsFrom,
      coordinatesTo: coordsTo,
      date,
      weight: weightKg,
      volume: volumeCbm,
    }

    logger.info(
      { from: coordsFrom, to: coordsTo, weightKg, volumeCbm },
      'SeaRates getAutoRates request',
    )

    const res = await fetch(SEARATES_GRAPHQL_URL, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify({ query, variables }),
      signal: AbortSignal.timeout(ADAPTER_TIMEOUT_MS),
    })

    if (!res.ok) {
      throw new Error(`SeaRates API error: ${res.status} ${res.statusText}`)
    }

    const json = await res.json() as SeaRatesAutoRatesResponse

    if (json.errors?.length) {
      throw new Error(`SeaRates GraphQL error: ${json.errors[0]!.message}`)
    }

    const results: CarrierEstimate[] = []
    for (const group of json.data?.autoRates ?? []) {
      for (const rate of group.rates) {
        results.push(this.normalizeRate(rate, group.shippingType))
      }
    }
    return results
  }

  // ─── Private: Normalize rate to standard format ────

  private normalizeRate(rate: SeaRatesRate, shippingType: string): CarrierEstimate {
    const mappedType = SEARATES_TYPE_MAP[shippingType] ?? 'air'
    const transitDays = rate.totalTransitTime ?? 0

    // Extraer route points
    const routePoints = rate.points
      ?.map(p => p.location?.name)
      .filter((n): n is string => !!n)

    // Validez: usar validityTo o default +30 días
    const validUntil = rate.validityTo ?? this.defaultValidUntil()

    // Construir service name
    let serviceName = shippingType
    if (rate.containerType) {
      serviceName = `${shippingType} ${rate.containerType}`
    }

    return {
      service_name: serviceName,
      shipping_type: mappedType,
      price_usd: rate.totalPrice,
      currency_original: rate.totalCurrency ?? 'USD',
      transit_days_min: Math.max(1, Math.floor(transitDays * 0.85)),
      transit_days_max: Math.ceil(transitDays * 1.15),
      valid_until: validUntil,
      is_indicative: rate.indicative !== false,
      details: {
        route_points: routePoints,
        container_type: rate.containerType,
        provider_name: rate.provider,
      },
    }
  }

  // ─── Private: Helpers ────────────────────────────

  private buildHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.secrets.searatesApiKey}`,
    }
  }

  private selectContainer(volumeCbm: number): string {
    const thresholds = this.config.carriers.searates.container_thresholds
    if (volumeCbm <= thresholds.st20_max_cbm) return 'ST20'
    if (volumeCbm <= thresholds.st40_max_cbm) return 'ST40'
    return 'HC40'
  }

  /** Resuelve coordenadas: usa las del input o busca en known_origins */
  private resolveCoordinates(location: FreightLocation): FreightLocation {
    if (location.coordinates) return location

    // Buscar en known_origins por city+country_code
    for (const origin of Object.values(this.config.known_origins)) {
      if (
        origin.city.toLowerCase() === location.city.toLowerCase() &&
        origin.country_code === location.country_code
      ) {
        return {
          ...location,
          coordinates: origin.coordinates,
          postal_code: location.postal_code ?? origin.postal_code,
        }
      }
    }

    return location
  }

  private defaultValidUntil(): string {
    const d = new Date()
    d.setDate(d.getDate() + 30)
    return d.toISOString().slice(0, 10)
  }
}
