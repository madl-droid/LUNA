// LUNA Engine — ACK Service
// Generates contextual acknowledgment messages using a fast LLM call.
// Falls back to predefined pool from DB or in-memory defaults.

import pino from 'pino'
import type { Registry } from '../../kernel/registry.js'
import type { AckGenerationContext } from './types.js'
import { DEFAULT_ACK_MESSAGES, ACTION_DESCRIPTIONS } from './ack-defaults.js'

const logger = pino({ name: 'engine:ack' })

const ACK_TIMEOUT_MS = 3000

/**
 * Generate a contextual ACK message.
 * 1. Try LLM (fast, cheap model with 3s timeout)
 * 2. If LLM fails → pick from DB pool
 * 3. If DB pool empty → pick from in-memory defaults
 * 4. Last resort → "Un momento..."
 */
export async function generateAck(
  ctx: AckGenerationContext,
  registry: Registry,
): Promise<string> {
  // Try LLM-generated ACK
  try {
    const gateway = registry.getOptional<{
      chat(req: unknown): Promise<{ text: string }>
    }>('llm:gateway')

    if (gateway) {
      const toneDesc = ctx.tone === 'formal' ? 'formal y profesional'
        : ctx.tone === 'casual' ? 'casual y amigable'
        : 'neutro y amable'

      const system = [
        'Eres un asistente. El usuario envió un mensaje y estás procesando la respuesta.',
        'Genera un aviso breve (máximo 15 palabras) indicando que estás trabajando en su solicitud.',
        'Reglas:',
        '- NO reveles qué estás haciendo internamente (no mencionar APIs, búsquedas, bases de datos)',
        `- Usa un tono ${toneDesc} y natural`,
        '- Si tienes el nombre del contacto, úsalo naturalmente (no forzado)',
        '- NO uses signos de exclamación excesivos',
        '- Responde SOLO con el mensaje de aviso, nada más',
      ].join('\n')

      const userMessage = [
        ctx.contactName ? `Nombre: ${ctx.contactName}` : '',
        `Mensaje del usuario: ${ctx.userMessage}`,
        `Tipo de acción: ${ctx.actionType}`,
      ].filter(Boolean).join('\n')

      const result = await gateway.chat({
        task: 'ack',
        system,
        messages: [{ role: 'user', content: userMessage }],
        maxTokens: 30,
        temperature: 0.8,
        timeoutMs: ACK_TIMEOUT_MS,
        traceId: `ack-${Date.now()}`,
      })

      const text = result.text.trim()
      if (text) {
        logger.debug({ text, tone: ctx.tone }, 'LLM ACK generated')
        return text
      }
    }
  } catch (err) {
    logger.debug({ err }, 'LLM ACK failed, falling back to predefined pool')
  }

  // Fallback to DB pool, then in-memory defaults
  return getDefaultAck(registry, '')
}

/**
 * Get a predefined ACK message from the DB pool or in-memory defaults.
 */
export async function getDefaultAck(
  registry: Registry,
  channel: string,
): Promise<string> {
  // Try DB pool first
  try {
    const db = registry.getDb()
    const { rows } = await db.query<{ text: string }>(
      `SELECT text FROM ack_messages WHERE active = true AND (channel = $1 OR channel = '') ORDER BY random() LIMIT 1`,
      [channel],
    )
    if (rows[0]?.text) return rows[0].text
  } catch {
    // DB not available or table doesn't exist yet
  }

  // In-memory defaults
  const channelMessages = DEFAULT_ACK_MESSAGES[channel]
  if (channelMessages && channelMessages.length > 0) {
    return channelMessages[Math.floor(Math.random() * channelMessages.length)]!
  }

  const globalMessages = DEFAULT_ACK_MESSAGES['']
  if (globalMessages && globalMessages.length > 0) {
    return globalMessages[Math.floor(Math.random() * globalMessages.length)]!
  }

  return 'Un momento...'
}

/**
 * Map an execution plan step type to a user-friendly action description.
 */
export function mapStepToAction(stepType: string): string {
  return ACTION_DESCRIPTIONS[stepType] ?? ACTION_DESCRIPTIONS['default']!
}
