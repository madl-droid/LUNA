// LUNA Engine — Inline buffer compressor (agentic loop)
// Triggered fire-and-forget from delivery after each response.
// Compresses oldest Redis buffer messages into a running summary stored in Redis.
// PG messages are NEVER touched — they remain intact for nightly batch session summaries.

import pino from 'pino'
import type { MemoryManager } from '../modules/memory/memory-manager.js'
import type { EngineConfig } from './types.js'
import type { Registry } from '../kernel/registry.js'
import type { PromptsService } from '../modules/prompts/types.js'
import { callLLM } from './utils/llm-client.js'

const logger = pino({ name: 'engine:buffer-compressor' })

/**
 * Check if the session buffer exceeds the compression threshold and compress if so.
 * Call without await from delivery — this is fire-and-forget.
 *
 * Flow:
 * 1. Count messages in Redis buffer
 * 2. If count > threshold: get oldest (count - keepRecent) messages
 * 3. LLM summarizes them (cheap model — haiku)
 * 4. New summary stored in session:{id}:buffer_summary (cumulative)
 * 5. Oldest messages trimmed from Redis buffer
 * 6. Intake of next turn loads: bufferSummary + last N turns
 */
export async function checkAndCompressBuffer(
  sessionId: string,
  memoryManager: MemoryManager,
  _config: EngineConfig,
  registry?: Registry,
): Promise<void> {
  const { threshold: configuredThreshold, keepRecent } = memoryManager.getCompressionConfig()

  // Clamping: prevenir threshold imposible (cuando buffer es demasiado pequeño para el threshold configurado)
  const bufferMessageCount = memoryManager.getBufferMessageCount()
  const maxPossibleTurns = Math.floor(bufferMessageCount / 2)
  const threshold = Math.min(configuredThreshold, Math.max(1, maxPossibleTurns - keepRecent - 2))

  if (threshold !== configuredThreshold) {
    logger.debug(
      { configuredThreshold, effectiveThreshold: threshold, maxPossibleTurns },
      'Compression threshold clamped — buffer too small for configured value',
    )
  }

  // Count turns (assistant messages), not raw messages
  const turnCount = await memoryManager.getTurnCount(sessionId)

  if (turnCount <= threshold) return

  const turnsToCompress = turnCount - keepRecent
  if (turnsToCompress <= 0) return

  // Get all messages belonging to the oldest N turns
  const oldMessages = await memoryManager.getOldestTurnMessages(sessionId, turnsToCompress)
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
      system: await loadBufferCompressSystem(registry),
      messages: [{ role: 'user', content: userPrompt }],
      maxTokens: 1000,
      temperature: 0.2,
    })

    // Save updated summary and trim keeping last N complete turns
    await memoryManager.setBufferSummary(sessionId, result.text.trim())
    await memoryManager.trimKeepingTurns(sessionId, keepRecent)

    logger.info({ sessionId, turnsCompressed: turnsToCompress, turnsKept: keepRecent, totalTurns: turnCount, messagesCompressed: oldMessages.length }, 'Buffer compressed inline (turn-based)')
  } catch (err) {
    // Don't trim on failure — better to have extra messages than lose context
    logger.warn({ err, sessionId }, 'Inline buffer compression failed — buffer not trimmed')
  }
}

async function loadBufferCompressSystem(registry?: Registry): Promise<string> {
  if (!registry) return ''
  const promptsSvc = registry.getOptional<PromptsService>('prompts:service')
  if (!promptsSvc) return ''
  return promptsSvc.getSystemPrompt('buffer-compressor')
}
