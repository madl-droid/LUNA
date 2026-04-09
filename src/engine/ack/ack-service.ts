// LUNA Engine — ACK Service
// Generates contextual acknowledgment messages using a fast LLM call.
// Falls back to predefined pool from DB or in-memory defaults.

import pino from 'pino'
import type { Registry } from '../../kernel/registry.js'
import type { PromptsService } from '../../modules/prompts/types.js'
import type { AckGenerationContext } from './types.js'
import { pickDefaultAck, ACTION_DESCRIPTIONS } from './ack-defaults.js'

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
      let system = ''
      const promptsSvc = registry.getOptional<PromptsService>('prompts:service')
      if (promptsSvc) {
        system = await promptsSvc.getSystemPrompt('ack-system')
      }

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
        logger.debug({ text }, 'LLM ACK generated')
        return text
      }
    }
  } catch (err) {
    logger.debug({ err }, 'LLM ACK failed, falling back to predefined pool')
  }

  // Fallback: DB pool, then in-memory defaults
  return getDefaultAck(registry)
}

/**
 * Get a predefined ACK message from the DB pool or in-memory defaults.
 */
export async function getDefaultAck(registry: Registry): Promise<string> {
  try {
    const db = registry.getDb()
    const { rows } = await db.query<{ text: string }>(
      `SELECT text FROM ack_messages WHERE active = true ORDER BY random() LIMIT 1`,
    )
    if (rows[0]?.text) return rows[0].text
  } catch {
    logger.debug('ACK DB query failed or table missing, using in-memory defaults')
  }

  return pickDefaultAck()
}

/**
 * Map an execution plan step type to a user-friendly action description.
 */
export function mapStepToAction(stepType: string): string {
  return ACTION_DESCRIPTIONS[stepType] ?? ACTION_DESCRIPTIONS['default']!
}
