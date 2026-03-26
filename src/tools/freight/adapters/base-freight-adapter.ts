// LUNA — Tool: estimate_freight — Base Freight Adapter
// Clase abstracta que todos los carrier adapters implementan.

import type { FreightLocation, FreightEstimateInput, CarrierEstimate, CarrierId } from '../types.js'

export abstract class BaseFreightAdapter {
  abstract readonly carrierId: CarrierId
  abstract readonly carrierName: string

  /** Determina si este carrier puede cotizar esta ruta */
  abstract canQuote(
    origin: FreightLocation,
    destination: FreightLocation,
    serviceType?: string,
  ): boolean

  /** Obtiene estimados (implementación específica por carrier) */
  abstract getEstimate(params: FreightEstimateInput): Promise<CarrierEstimate[]>

  /** Health check del carrier API */
  abstract healthCheck(): Promise<boolean>

  /** Calcula peso total de todos los paquetes (kg) */
  protected totalWeight(packages: FreightEstimateInput['packages']): number {
    return packages.reduce((sum, p) => sum + p.weight_kg * p.quantity, 0)
  }

  /** Calcula volumen total en CBM (metros cúbicos) */
  protected totalVolumeCbm(packages: FreightEstimateInput['packages']): number {
    return packages.reduce((sum, p) => {
      const cbm = (p.length_cm / 100) * (p.width_cm / 100) * (p.height_cm / 100)
      return sum + cbm * p.quantity
    }, 0)
  }

  /** Peso máximo por pieza individual */
  protected maxPieceWeight(packages: FreightEstimateInput['packages']): number {
    return Math.max(...packages.map(p => p.weight_kg))
  }

  /** Calcula ready_date: si no se especifica, hoy + defaultDays */
  protected resolveReadyDate(readyDate: string | undefined, defaultDays: number): string {
    if (readyDate) return readyDate
    const d = new Date()
    d.setDate(d.getDate() + defaultDays)
    return d.toISOString().slice(0, 10)
  }
}
