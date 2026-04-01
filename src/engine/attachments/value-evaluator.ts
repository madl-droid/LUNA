// LUNA Engine — Attachment Value Evaluator
// Heuristic evaluation of attachment value for knowledge base.
// No LLM — pure regex/pattern matching for speed.
// Signals are persisted for later analysis and pattern tuning.

export interface ValueSignals {
  isValuable: boolean
  confidence: number
  reason: string | null
  signals: string[]
}

// ═══════════════════════════════════════════
// Configurable signal patterns
// ═══════════════════════════════════════════

const NAME_SIGNALS = /ficha|cotizaci[oó]n|propuesta|especificaci[oó]n|cat[aá]logo|contrato|precio|t[eé]cnic|manual|gu[ií]a|pol[ií]tica|procedimiento|instructivo|datasheet|brochure|tarifa|lista.de.precio/i

const CONTENT_SIGNALS = /precio|USD|EUR|\$\s*\d|CIF|FOB|especificaci[oó]n|dimensi[oó]n|garant[ií]a|condiciones|plazo|entrega|vigencia|cl[aá]usula|requisito|tolerancia|capacidad|peso.neto|certificad/i

const USER_EXPLICIT_SIGNALS = /esto es importante|es clave|guard[ae]|tom[ae] nota|es vital|es cr[ií]tico|no (lo |)pierda|es relevante|documento oficial|informaci[oó]n importante/i

// ═══════════════════════════════════════════
// Evaluate attachment value
// ═══════════════════════════════════════════

export function evaluateValue(
  filename: string,
  extractedText: string | null,
  category: string,
  mimeType: string,
  userMessage?: string,
): ValueSignals {
  let confidence = 0
  const signals: string[] = []

  // 1. Filename match
  if (NAME_SIGNALS.test(filename)) {
    confidence += 0.3
    signals.push('filename_match')
  }

  // 2. Content match (first 3000 chars)
  if (extractedText) {
    const sample = extractedText.slice(0, 3000)
    const matches = sample.match(new RegExp(CONTENT_SIGNALS.source, 'gi'))
    if (matches && matches.length >= 2) {
      confidence += 0.3
      signals.push('content_match')
    }
  }

  // 3. Structured document bonus (PDFs, spreadsheets with substantial content)
  if (
    (mimeType === 'application/pdf' || category === 'spreadsheets' || category === 'documents') &&
    extractedText && extractedText.length > 3000
  ) {
    confidence += 0.1
    signals.push('structured_document')
  }

  // 4. User explicit signal
  if (userMessage && USER_EXPLICIT_SIGNALS.test(userMessage)) {
    confidence += 0.4
    signals.push('user_explicit')
  }

  // Cap at 1.0
  confidence = Math.min(confidence, 1.0)
  const isValuable = confidence >= 0.3

  const reason = isValuable
    ? `Señales: ${signals.join(', ')} (confianza: ${(confidence * 100).toFixed(0)}%)`
    : null

  return { isValuable, confidence, reason, signals }
}
