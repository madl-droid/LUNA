// LUNA — Tool: estimate_freight — Types
// Todas las interfaces del módulo de estimación de flete.

// ═══════════════════════════════════════════
// Input de la tool (lo que el LLM envía)
// ═══════════════════════════════════════════

export interface FreightLocation {
  city: string
  country_code: string          // ISO 3166-1 alpha-2
  postal_code?: string
  coordinates?: {
    lat: number
    lng: number
  }
}

export interface FreightPackage {
  weight_kg: number
  length_cm: number
  width_cm: number
  height_cm: number
  quantity: number
  description?: string           // Descripción para aduanas (DHL)
}

export interface FreightEstimateInput {
  origin: FreightLocation
  destination: FreightLocation
  packages: FreightPackage[]
  service_type?: 'ocean' | 'air' | 'ground' | 'express'
  ready_date?: string            // ISO date YYYY-MM-DD. Default: hoy + 3 días
}

// ═══════════════════════════════════════════
// Output de la tool (lo que el LLM recibe)
// ═══════════════════════════════════════════

export type ShippingType = 'ocean_fcl' | 'ocean_lcl' | 'air' | 'ground' | 'express'
export type CarrierId = 'searates' | 'dhl_express'

export interface FreightEstimate {
  carrier: CarrierId
  service_name: string
  shipping_type: ShippingType
  price_usd: number              // Precio total estimado (ya con buffer)
  price_original_usd: number     // Precio sin buffer
  currency_original: string      // Moneda original del carrier
  transit_days_min: number
  transit_days_max: number
  valid_until: string            // ISO date
  is_indicative: boolean         // true = estimado market, false = rate negociado
  details?: {
    route_points?: string[]      // Ej: ['Shenzhen', 'Long Beach', 'Lima']
    container_type?: string      // '20st', '40hq', etc.
    provider_name?: string       // Nombre del carrier/naviera
  }
}

export interface FreightEstimateResult {
  success: boolean
  estimates: FreightEstimate[]
  buffer_applied: number         // 0.15 = 15%
  disclaimer: string
  errors?: Array<{
    carrier: string
    error: string
  }>
}

// ═══════════════════════════════════════════
// Carrier adapter — output normalizado
// ═══════════════════════════════════════════

export interface CarrierEstimate {
  service_name: string
  shipping_type: ShippingType
  price_usd: number
  currency_original: string
  transit_days_min: number
  transit_days_max: number
  valid_until: string
  is_indicative: boolean
  details?: {
    route_points?: string[]
    container_type?: string
    provider_name?: string
  }
}

// ═══════════════════════════════════════════
// Config del tenant (instance/tools/freight.json)
// ═══════════════════════════════════════════

export interface KnownOrigin {
  city: string
  country_code: string
  postal_code: string
  coordinates: { lat: number; lng: number }
}

export interface FreightConfig {
  enabled: boolean
  buffer_percentage: number
  disclaimer_es: string
  disclaimer_en: string
  default_ready_days: number
  max_packages: number
  carriers: {
    searates: {
      enabled: boolean
      container_thresholds: {
        st20_max_cbm: number
        st40_max_cbm: number
      }
    }
    dhl_express: {
      enabled: boolean
      max_weight_per_piece_kg: number
      account_number: string
    }
  }
  known_origins: Record<string, KnownOrigin>
}

// ═══════════════════════════════════════════
// Secrets (env vars)
// ═══════════════════════════════════════════

export interface FreightSecrets {
  searatesApiKey?: string
  searatesPlatformId?: string
  dhlExpressUsername?: string
  dhlExpressPassword?: string
  dhlExpressAccountNumber?: string
  dhlExpressTestMode: boolean
}
