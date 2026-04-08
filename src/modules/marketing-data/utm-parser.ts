// LUNA — Module: marketing-data — UTM Parser
// Utilidad pura para extraer y normalizar parámetros UTM de texto y webhook bodies.
// No depende de librerías externas — usa URL nativo de Node.js.

import type { UtmParams } from './campaign-types.js'

/**
 * Extrae parámetros UTM de URLs encontradas en texto.
 * Retorna el primer set de UTMs encontrado (prioridad: primera URL con utm_campaign).
 * Si no hay URLs con UTMs, retorna null.
 */
export function extractUtmFromText(text: string): UtmParams | null {
  if (!text) return null

  // Regex para encontrar URLs en el texto
  const urlRegex = /https?:\/\/[^\s<>"']+/g
  const urls = text.match(urlRegex)
  if (!urls) return null

  let fallbackUtms: UtmParams | null = null

  for (const rawUrl of urls) {
    try {
      const url = new URL(rawUrl)
      const params = url.searchParams

      const utm: UtmParams = {}
      let hasUtm = false

      for (const [key, value] of params.entries()) {
        if (key.startsWith('utm_') && value) {
          utm[key] = value
          hasUtm = true
        }
      }

      if (!hasUtm) continue

      // Si esta URL tiene utm_campaign, la retornamos inmediatamente (prioridad)
      if (utm.utm_campaign) {
        return utm
      }

      // Guarda como fallback si aún no tenemos uno
      if (!fallbackUtms) {
        fallbackUtms = utm
      }
    } catch {
      // URL malformada — ignorar y continuar
    }
  }

  return fallbackUtms
}

/**
 * Parsea un objeto plano de UTMs (para webhook body).
 * Normaliza keys a lowercase, filtra vacíos.
 * Retorna null si no hay ningún parámetro UTM válido.
 */
export function normalizeUtmData(raw: Record<string, string>): UtmParams | null {
  if (!raw || typeof raw !== 'object') return null

  const normalized: UtmParams = {}
  let hasAny = false

  for (const [key, value] of Object.entries(raw)) {
    if (typeof key === 'string' && typeof value === 'string' && value.trim()) {
      normalized[key.toLowerCase()] = value.trim()
      hasAny = true
    }
  }

  return hasAny ? normalized : null
}
