// LUNA Engine — Effort Router
// Classify incoming messages by complexity. Pure deterministic code, no LLM call.
// Must complete in <5ms.
//
// Two levels:
//   'normal'  → task 'main'    (Sonnet — default for most messages)
//   'complex' → task 'complex' (Opus  — objections, multi-step, HITL, long messages)
//
// See docs/architecture/task-routing.md for the full routing design.

import type { ContextBundle } from '../types.js'
import type { EffortLevel } from './types.js'

// ── Module-level compiled patterns ──

const TIME_DATE_PATTERN = /\b(hoy|mañana|ayer|lunes|martes|miércoles|jueves|viernes|sábado|domingo|enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre|\d{1,2}\/\d{1,2}|\d{1,2}:\d{2}|a\.m\.|p\.m\.|am\b|pm\b|hora|fecha|día|semana|mes|año)\b/i

const OBJECTION_KEYWORDS: readonly string[] = [
  'no me interesa',
  'muy caro',
  'es mucho',
  'no puedo',
  'competencia',
  'otro proveedor',
  'lo pensaré',
  'no estoy seguro',
  'cancelar',
  'devolver',
]

/**
 * Classify message complexity to route to the appropriate model tier.
 * Must complete in <5ms. No LLM calls, no async, no I/O.
 *
 * - 'normal': most messages → task 'main' (Sonnet)
 * - 'complex': objections, multi-step requests, HITL, long messages → task 'complex' (Opus)
 */
export function classifyEffort(ctx: ContextBundle): EffortLevel {
  const text = ctx.normalizedText
  const textLower = text.toLowerCase()

  // ── COMPLEX checks (any match → 'complex') ──

  // 1. Long message (complex reasoning required)
  if (text.length > 500) return 'complex'

  // 2. Multi-question message
  const questionMarks = (text.match(/\?/g) ?? []).length
  if (questionMarks >= 3) return 'complex'

  // 3. Multiple attachments need reasoning
  if (ctx.attachmentMeta.length >= 2) return 'complex'

  // 4. Pending commitments with time/date reference (commitment follow-up)
  if (ctx.pendingCommitments.length > 0 && TIME_DATE_PATTERN.test(text)) return 'complex'

  // 5. HITL context requires careful handling
  if (ctx.hitlPendingContext !== null) return 'complex'

  // 6. Objection keywords (case-insensitive substring match)
  for (const keyword of OBJECTION_KEYWORDS) {
    if (textLower.includes(keyword)) return 'complex'
  }

  // 7. New contact with complex first message
  if (ctx.isNewContact && text.length > 200) return 'complex'

  // ── Default: normal ──
  return 'normal'
}
