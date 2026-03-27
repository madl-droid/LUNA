// LUNA — Module: knowledge — Image Extractor
// Describe imágenes usando LLM con capacidad de visión.
// Requiere llm:gateway activo. Costoso — solo bajo demanda.

import type { Registry } from '../../../kernel/registry.js'
import type { PromptsService } from '../../prompts/types.js'
import type { ExtractedContent } from '../types.js'
import pino from 'pino'

const logger = pino({ name: 'knowledge:extractor:image' })

/**
 * Extract text description from an image using LLM vision.
 * Falls back gracefully if llm:gateway is not available.
 */
// FIX: K-DOS1 — Límite de tamaño para prevenir OOM en base64 conversion
const MAX_IMAGE_SIZE = 20 * 1024 * 1024 // 20MB

export async function extractImage(
  input: Buffer,
  fileName: string,
  registry: Registry,
): Promise<ExtractedContent> {
  if (input.length > MAX_IMAGE_SIZE) {
    throw new Error(`Image too large: ${(input.length / 1024 / 1024).toFixed(1)}MB exceeds ${MAX_IMAGE_SIZE / 1024 / 1024}MB limit`)
  }
  const mimeType = getMimeType(fileName)
  const base64 = input.toString('base64')

  // Load system prompt from template, fallback to hardcoded
  const promptsSvc = registry.getOptional<PromptsService>('prompts:service')
  let systemPrompt = ''
  if (promptsSvc) {
    systemPrompt = await promptsSvc.getSystemPrompt('image-extraction')
  }
  if (!systemPrompt) {
    systemPrompt = 'Eres un asistente que describe imágenes de forma detallada y estructurada para una base de conocimiento. Describe todo el contenido visible: texto, diagramas, tablas, gráficos. Si hay texto, transcríbelo exactamente. Responde en español.'
  }

  // Try to use LLM gateway for vision
  const result = await registry.callHook('llm:chat', {
    task: 'knowledge-image-extract',
    system: systemPrompt,
    messages: [{
      role: 'user' as const,
      content: [
        { type: 'image_url' as const, data: base64, mimeType },
        { type: 'text' as const, text: 'Describe detalladamente el contenido de esta imagen para indexarlo en una base de conocimiento.' },
      ],
    }],
    maxTokens: 2000,
    temperature: 0.1,
  })

  if (!result) {
    logger.warn({ fileName }, 'LLM gateway not available for image extraction')
    return {
      text: `[Imagen: ${fileName}]`,
      sections: [{
        title: fileName,
        content: `[Imagen sin procesar: ${fileName}. LLM no disponible para descripción.]`,
      }],
      metadata: {
        sizeBytes: input.length,
        originalName: fileName,
        extractorUsed: 'image-fallback',
      },
    }
  }

  const description = result.text

  return {
    text: description,
    sections: [{
      title: `Imagen: ${fileName}`,
      content: description,
    }],
    metadata: {
      sizeBytes: input.length,
      originalName: fileName,
      extractorUsed: 'image-llm-vision',
    },
  }
}

function getMimeType(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'png': return 'image/png'
    case 'jpg': case 'jpeg': return 'image/jpeg'
    case 'webp': return 'image/webp'
    case 'gif': return 'image/gif'
    default: return 'image/png'
  }
}
