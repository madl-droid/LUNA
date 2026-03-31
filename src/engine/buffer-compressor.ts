// LUNA Engine — Inline buffer compressor (Phase 3)
// Triggered fire-and-forget from Phase 5 after each response.
// Compresses oldest Redis buffer messages into a running summary stored in Redis.
// PG messages are NEVER touched — they remain intact for nightly batch session summaries.

import pino from 'pino'
import type { MemoryManager } from '../modules/memory/memory-manager.js'
import type { EngineConfig } from './types.js'
import { callLLM } from './utils/llm-client.js'

const logger = pino({ name: 'engine:buffer-compressor' })

/**
 * Check if the session buffer exceeds the compression threshold and compress if so.
 * Call without await from Phase 5 — this is fire-and-forget.
 *
 * Flow:
 * 1. Count messages in Redis buffer
 * 2. If count > threshold: get oldest (count - keepRecent) messages
 * 3. LLM summarizes them (cheap model — haiku)
 * 4. New summary stored in session:{id}:buffer_summary (cumulative)
 * 5. Oldest messages trimmed from Redis buffer
 * 6. Phase 1 of next turn loads: bufferSummary + last N turns
 */
export async function checkAndCompressBuffer(
  sessionId: string,
  memoryManager: MemoryManager,
  config: EngineConfig,
): Promise<void> {
  const { threshold, keepRecent } = memoryManager.getCompressionConfig()
  const count = await memoryManager.getMessageCount(sessionId)

  if (count <= threshold) return

  const toCompressCount = count - keepRecent
  if (toCompressCount <= 0) return

  // Get oldest messages (the ones we'll compress away)
  const oldMessages = await memoryManager.getOldestMessages(sessionId, toCompressCount)
  if (oldMessages.length === 0) return

  // Get existing buffer summary (cumulative — may already contain prior compressions)
  const existingSummary = await memoryManager.getBufferSummary(sessionId)

  const messagesText = oldMessages
    .map(m => `${m.role === 'user' ? 'Usuario' : 'Agente'}: ${m.contentText ?? ''}`)
    .filter(line => line.length > 10)
    .join('\n')

  const userPrompt = existingSummary
    ? `RESUMEN PREVIO DE LA SESIÓN:\n${existingSummary}\n\nMENSAJES A INTEGRAR:\n${messagesText}\n\nActualiza el resumen integrando los nuevos mensajes. Mantén hechos clave, intenciones del contacto y compromisos. Máximo 400 palabras:`
    : `MENSAJES DE LA CONVERSACIÓN:\n${messagesText}\n\nResume esta conversación capturando hechos clave, intenciones del contacto y compromisos. Máximo 400 palabras:`

  try {
    const result = await callLLM({
      task: 'buffer_compress',
      provider: config.classifyProvider,
      model: config.classifyModel,
      system: 'Eres un asistente que resume conversaciones de soporte y ventas de manera concisa. Responde SOLO con el resumen, sin introducción ni explicación.',
      messages: [{ role: 'user', content: userPrompt }],
      maxTokens: 500,
      temperature: 0.2,
    })

    // Save updated summary and trim the Redis buffer
    await memoryManager.setBufferSummary(sessionId, result.text.trim())
    await memoryManager.trimOldestMessages(sessionId, keepRecent)

    logger.info({ sessionId, compressed: toCompressCount, kept: keepRecent, totalWas: count }, 'Buffer compressed inline')
  } catch (err) {
    // Don't trim on failure — better to have extra messages than lose context
    logger.warn({ err, sessionId }, 'Inline buffer compression failed — buffer not trimmed')
  }
}
