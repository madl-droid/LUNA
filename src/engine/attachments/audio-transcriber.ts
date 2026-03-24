// LUNA Engine — Audio Transcriber
// Transcribes audio attachments to text via the LLM module's STT capability.
// NOTE: The llm:chat hook payload type (LLMChatPayload) only declares text content,
// but the actual LLM gateway supports multimodal content parts. We use a type assertion
// to pass audio content until LLMChatPayload is formally extended.

import pino from 'pino'
import type { Registry } from '../../kernel/registry.js'

const logger = pino({ name: 'engine:audio-transcriber' })

/**
 * Transcribe audio buffer to text using the LLM module.
 * Uses llm:chat hook with task 'stt' and audio content part.
 * Returns transcribed text or null if transcription fails.
 */
export async function transcribeAudio(
  audioBuffer: Buffer,
  mimeType: string,
  registry: Registry,
): Promise<string | null> {
  try {
    // Encode audio as base64 for the LLM content part
    const base64Audio = audioBuffer.toString('base64')

    // Normalize MIME type (strip codec params for API compatibility)
    const cleanMime = mimeType.split(';')[0]!.trim()

    // The LLM gateway supports multimodal content parts internally,
    // even though the hook type only declares string content.
    // We use a type assertion to pass the structured content.
    const multimodalMessage = {
      role: 'user' as const,
      content: `[audio:${cleanMime}:base64]${base64Audio}[/audio]\nTranscribe el audio anterior. Devuelve SOLO el texto transcrito.`,
    }

    const result = await registry.callHook('llm:chat', {
      task: 'stt',
      messages: [multimodalMessage],
      maxTokens: 4096,
      temperature: 0.1,
    })

    if (result && typeof result === 'object' && 'text' in result) {
      const text = (result as { text: string }).text?.trim()
      if (text) {
        logger.info({ mimeType: cleanMime, textLength: text.length }, 'Audio transcribed successfully')
        return text
      }
    }

    logger.warn({ mimeType: cleanMime }, 'STT returned empty result')
    return null
  } catch (err) {
    logger.error({ err, mimeType }, 'Audio transcription failed')
    return null
  }
}
