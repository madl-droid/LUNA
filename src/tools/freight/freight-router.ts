// LUNA — Tool: estimate_freight — Freight Router
// Selecciona qué carriers consultar según ruta, tipo de servicio y config.
// Código puro, cero LLM.

import pino from 'pino'
import type { BaseFreightAdapter } from './adapters/base-freight-adapter.js'
import type { FreightLocation, FreightEstimateInput, FreightConfig } from './types.js'

const logger = pino({ name: 'freight:router' })

// ─── Continent mapping (ISO 3166 alpha-2 → continent) ─

const CONTINENT_MAP: Record<string, string> = {
  // North America
  US: 'NA', CA: 'NA', MX: 'NA',
  // Central America & Caribbean
  GT: 'CA', BZ: 'CA', SV: 'CA', HN: 'CA', NI: 'CA', CR: 'CA', PA: 'CA',
  CU: 'CA', DO: 'CA', JM: 'CA', HT: 'CA', TT: 'CA', PR: 'CA',
  // South America
  CO: 'SA', VE: 'SA', EC: 'SA', PE: 'SA', BR: 'SA', BO: 'SA',
  CL: 'SA', AR: 'SA', UY: 'SA', PY: 'SA', GY: 'SA', SR: 'SA',
  // Europe
  GB: 'EU', DE: 'EU', FR: 'EU', ES: 'EU', IT: 'EU', NL: 'EU',
  PT: 'EU', BE: 'EU', AT: 'EU', CH: 'EU', PL: 'EU', SE: 'EU',
  NO: 'EU', DK: 'EU', FI: 'EU', IE: 'EU', CZ: 'EU', RO: 'EU',
  // Asia
  CN: 'AS', JP: 'AS', KR: 'AS', IN: 'AS', TW: 'AS', HK: 'AS',
  SG: 'AS', TH: 'AS', VN: 'AS', MY: 'AS', ID: 'AS', PH: 'AS',
  // Oceania
  AU: 'OC', NZ: 'OC',
  // Africa
  ZA: 'AF', NG: 'AF', EG: 'AF', KE: 'AF', MA: 'AF',
  // Middle East
  AE: 'ME', SA: 'ME', IL: 'ME', TR: 'ME',
}

// LATAM = CA + SA (Central America + South America)
const LATAM_CONTINENTS = new Set(['CA', 'SA'])

function continentOf(countryCode: string): string {
  return CONTINENT_MAP[countryCode] ?? 'UNKNOWN'
}

function isLatam(countryCode: string): boolean {
  const continent = continentOf(countryCode)
  return LATAM_CONTINENTS.has(continent) || countryCode === 'MX'
}

export class FreightRouter {
  constructor(
    private readonly adapters: BaseFreightAdapter[],
    private readonly config: FreightConfig,
  ) {}

  selectCarriers(
    origin: FreightLocation,
    destination: FreightLocation,
    serviceType: FreightEstimateInput['service_type'],
    packages: FreightEstimateInput['packages'],
  ): BaseFreightAdapter[] {
    const selected: BaseFreightAdapter[] = []
    const isCrossBorder = origin.country_code !== destination.country_code

    // Peso total para validar límites
    const totalWeightPerPiece = Math.max(...packages.map(p => p.weight_kg))

    for (const adapter of this.adapters) {
      // Verificar que el carrier está habilitado en config
      if (!this.isCarrierEnabled(adapter.carrierId)) continue

      // Verificar peso máximo por pieza para DHL
      if (adapter.carrierId === 'dhl_express') {
        const maxWeight = this.config.carriers.dhl_express.max_weight_per_piece_kg
        if (totalWeightPerPiece > maxWeight) {
          logger.debug(
            { carrier: adapter.carrierId, weight: totalWeightPerPiece, maxWeight },
            'Skipping carrier: piece exceeds max weight',
          )
          continue
        }
      }

      // Consultar al adapter si puede cotizar esta ruta
      if (adapter.canQuote(origin, destination, serviceType)) {
        selected.push(adapter)
      }
    }

    logger.info(
      {
        origin: `${origin.city}, ${origin.country_code}`,
        destination: `${destination.city}, ${destination.country_code}`,
        serviceType,
        isCrossBorder,
        selected: selected.map(a => a.carrierId),
      },
      'Freight router selected carriers',
    )

    return selected
  }

  private isCarrierEnabled(carrierId: string): boolean {
    if (carrierId === 'searates') return this.config.carriers.searates.enabled
    if (carrierId === 'dhl_express') return this.config.carriers.dhl_express.enabled
    return false
  }
}

// Exported for testing
export { continentOf, isLatam }
