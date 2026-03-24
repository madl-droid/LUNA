// LUNA — Handler mínimo: WhatsApp → Claude → WhatsApp
// Valida número autorizado, envía a Anthropic, devuelve respuesta.
// Temporal: se reemplazará por el pipeline completo (preprocess → classify → execute → respond → postprocess).

import Anthropic from '@anthropic-ai/sdk'
import pino from 'pino'
import { config } from '../config.js'
import type { BaileysAdapter } from '../channels/whatsapp/baileys-adapter.js'
import type { MessageHandler } from '../channels/types.js'

const logger = pino({ name: 'responder', level: config.logLevel })

// Números autorizados para testing. En el futuro esto vendrá de la base de datos
// como parte del sistema de contact_type.
const ALLOWED_NUMBERS = new Set([
  '573155524620',
  '573017279976',
  '18582097197',
])

const SYSTEM_PROMPT = 'Eres LUNA, asistente de ventas por WhatsApp. Responde de forma concisa y amigable.'

export function createMessageHandler(adapter: BaileysAdapter): MessageHandler {
  const client = new Anthropic({ apiKey: config.apiKeys.anthropic })

  return async (msg) => {
    // Validar número autorizado
    if (!ALLOWED_NUMBERS.has(msg.from)) {
      logger.debug({ from: msg.from }, 'Ignored message from unauthorized number')
      return
    }

    const text = msg.content.text?.trim()
    if (!text) {
      logger.debug({ from: msg.from, type: msg.content.type }, 'Ignored non-text or empty message')
      return
    }

    logger.info({ from: msg.from, messageId: msg.id }, 'Processing message')

    try {
      const response = await client.messages.create({
        model: config.llm.respond.model,
        max_tokens: config.llm.maxOutputTokens,
        temperature: config.llm.temperatureRespond,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: text }],
      })

      const reply = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map(block => block.text)
        .join('\n')

      if (!reply) {
        logger.warn({ from: msg.from, messageId: msg.id }, 'Empty response from Claude')
        return
      }

      const result = await adapter.sendMessage(msg.from, {
        to: msg.from,
        content: { type: 'text', text: reply },
      })

      if (result.success) {
        logger.info({ from: msg.from, messageId: msg.id, model: config.llm.respond.model }, 'Response sent')
      } else {
        logger.error({ from: msg.from, error: result.error }, 'Failed to send response')
      }
    } catch (err) {
      logger.error({ err, from: msg.from, messageId: msg.id }, 'Error calling Anthropic API')
    }
  }
}
