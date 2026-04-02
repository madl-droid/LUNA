// LUNA Engine — Effort Router
// Classify incoming messages by complexity. Pure deterministic code, no LLM call.
// Must complete in <5ms.

import type { ContextBundle } from '../types.js'
import type { EffortLevel } from './types.js'

// ── Module-level compiled patterns ──

const GREETING_PATTERN = /^(hola|hey|buenas?|buenos?\s+(d[ií]as?|tardes?|noches?)|hi|hello|que tal|qué tal)\b/i

const THANKS_PATTERN = /^(gracias|thanks|thank you|ok|okay|listo|perfecto|genial|dale|va|bien|entendido|claro)\b/i

const EMOJI_PATTERN = /^[\p{Emoji_Presentation}\p{Extended_Pictographic}]+$/u

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
 * - 'low': greetings, thanks, simple acknowledgments -> cheap model (Haiku/Flash)
 * - 'medium': questions, information requests, single-tool tasks -> standard model (Sonnet)
 * - 'high': objections, multi-step requests, complex reasoning -> capable model (Sonnet/Opus)
 */
export function classifyEffort(ctx: ContextBundle): EffortLevel {
  const text = ctx.normalizedText
  const textLower = text.toLowerCase()

  // ── HIGH effort checks (evaluated first, any match → 'high') ──

  // 1. Long message (complex reasoning required)
  if (text.length > 500) return 'high'

  // 2. Multi-question message
  const questionMarks = (text.match(/\?/g) ?? []).length
  if (questionMarks >= 3) return 'high'

  // 3. Multiple attachments need reasoning
  if (ctx.attachmentMeta.length >= 2) return 'high'

  // 4. Pending commitments with time/date reference (commitment follow-up)
  if (ctx.pendingCommitments.length > 0 && TIME_DATE_PATTERN.test(text)) return 'high'

  // 5. HITL context requires careful handling
  if (ctx.hitlPendingContext !== null) return 'high'

  // 6. Objection keywords (case-insensitive substring match)
  for (const keyword of OBJECTION_KEYWORDS) {
    if (textLower.includes(keyword)) return 'high'
  }

  // 7. New contact with complex first message
  if (ctx.isNewContact && text.length > 200) return 'high'

  // ── LOW effort checks (any match → 'low', only if no 'high' matched) ──

  // 1. Short message
  if (text.length < 30) return 'low'

  // 2. Greeting pattern
  if (GREETING_PATTERN.test(text)) return 'low'

  // 3. Thanks/acknowledgment pattern
  if (THANKS_PATTERN.test(text)) return 'low'

  // 4. Single emoji or sticker
  if (ctx.messageType === 'sticker' || EMOJI_PATTERN.test(text)) return 'low'

  // ── Default: medium ──
  return 'medium'
}
