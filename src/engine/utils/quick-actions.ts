// LUNA Engine — Quick Action Detector
// Detecta patrones rápidos que no necesitan LLM (stop, escalar, sí/no).

import type { QuickAction } from '../types.js'

interface QuickActionPattern {
  type: QuickAction['type']
  patterns: RegExp[]
}

const QUICK_ACTION_PATTERNS: QuickActionPattern[] = [
  {
    type: 'stop',
    patterns: [
      /^(stop|para|parar|basta|detente|no\s+me\s+escribas|dejar?\s+de\s+escribir|unsubscribe)$/i,
      /^(no\s+más|no\s+mas|ya\s+no|cancela|cancelar)$/i,
    ],
  },
  {
    type: 'escalate',
    patterns: [
      /^(human[oa]?|agente|persona\s+real|quiero\s+hablar\s+con\s+(alguien|un\s+human[oa]?))$/i,
      /^(transfer|escalar?|hablar\s+con\s+(alguien|persona|agente|asesor))$/i,
      /^(necesito\s+(ayuda\s+de\s+)?(un\s+)?(human[oa]?|persona|agente|asesor))$/i,
    ],
  },
  {
    type: 'affirm',
    patterns: [
      /^(s[ií]|si|yes|yeah|yep|sip|ok|okey|okay|dale|va|claro|por\s+supuesto|correcto|exacto|eso|así\s+es)$/i,
      /^(afirmativo|confirm[oa]?|de\s+acuerdo|está\s+bien|esta\s+bien|perfecto|bueno)$/i,
      /^👍$/,
    ],
  },
  {
    type: 'deny',
    patterns: [
      /^(no|nope|nah|nel|nop|negativo|para\s+nada|ni|tampoco)$/i,
      /^(no\s+gracias|no\s+quiero|no\s+me\s+interesa|no\s+necesito)$/i,
      /^👎$/,
    ],
  },
]

/**
 * Detect quick action from message text.
 * Returns null if no quick action matches.
 */
export function detectQuickAction(text: string): QuickAction | null {
  const trimmed = text.trim()
  if (!trimmed || trimmed.length > 100) return null  // only short messages

  for (const { type, patterns } of QUICK_ACTION_PATTERNS) {
    for (const pattern of patterns) {
      if (pattern.test(trimmed)) {
        return { type, matched: trimmed }
      }
    }
  }

  return null
}
