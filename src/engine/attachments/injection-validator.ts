// LUNA Engine — Attachment Injection Validator
// Validates external content (documents, URLs) before injecting into pipeline context.
// Extends the base injection-detector patterns with document-specific checks.

import { detectInputInjection } from '../utils/injection-detector.js'
import type { InjectionValidationResult } from './types.js'

// Document-specific injection patterns (hidden text in PDFs, metadata manipulation, etc.)
const DOCUMENT_INJECTION_PATTERNS: RegExp[] = [
  // Hidden instructions in documents
  /\[SYSTEM\]/i,
  /\[INST\]/i,
  /<<\s*SYS\s*>>/i,
  /<\|im_start\|>/i,
  // Attempts to override agent behavior via document content
  /ignore\s+(all\s+)?previous\s+(instructions?|context)/i,
  /you\s+must\s+(now|always)\s+(respond|act|behave|say)/i,
  /new\s+system\s+prompt/i,
  /override\s+(system|safety|security)/i,
  /from\s+now\s+on,?\s+(you|ignore|forget)/i,
  // Hidden text markers (common in malicious PDFs)
  /\x00{3,}/,  // null byte sequences
  /[\u200B-\u200F\u2028-\u202F\uFEFF]{5,}/,  // excessive zero-width characters
  // XML/HTML injection in documents
  /<script[\s>]/i,
  /<iframe[\s>]/i,
  /javascript:/i,
  /on(load|error|click)\s*=/i,
]

/**
 * Validate external content for injection attempts.
 * Returns sanitized text wrapped in trust boundaries.
 */
export function validateInjection(
  content: string,
  sourceType: string,
  sourceName: string,
): InjectionValidationResult {
  const threats: string[] = []

  // Check with base input injection detector
  if (detectInputInjection(content)) {
    threats.push('Base injection pattern detected')
  }

  // Check document-specific patterns
  for (const pattern of DOCUMENT_INJECTION_PATTERNS) {
    if (pattern.test(content)) {
      threats.push(`Document injection pattern: ${pattern.source.slice(0, 50)}`)
    }
  }

  const injectionRisk = threats.length > 0
  const safe = !injectionRisk

  // Wrap content with trust boundaries regardless of risk
  const sanitizedText = wrapWithTrustBoundary(content, sourceType, sourceName)

  return { safe, injectionRisk, threats, sanitizedText }
}

/**
 * Wrap external content with explicit trust boundary markers.
 * These markers signal to the LLM that the content is user-provided, not system instructions.
 */
function wrapWithTrustBoundary(content: string, sourceType: string, sourceName: string): string {
  return `[CONTENIDO EXTERNO — tipo: ${sourceType}, fuente: ${sourceName}]\n${content}\n[FIN CONTENIDO EXTERNO]`
}
