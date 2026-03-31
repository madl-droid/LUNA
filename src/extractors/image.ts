// LUNA — Global Extractors — Image
// Prepara imágenes para procesamiento downstream.
// Verifica formato, mide dimensiones, calcula MD5.
// NO hace descripción LLM — eso es concern del consumer.
// Texto acompañante obligatorio (crea contexto mínimo si falta).

import type { Registry } from '../kernel/registry.js'
import type { ExtractedContent, ImageResult, LLMEnrichment } from './types.js'
import { computeMD5, MAX_IMAGE_SIZE } from './utils.js'
import pino from 'pino'

const logger = pino({ name: 'extractors:image' })

const ACCEPTED_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

// ═══════════════════════════════════════════
// Resultado estructurado (nuevo)
// ═══════════════════════════════════════════

export interface ImageExtractOptions {
  accompanyingText?: string
  senderId?: string
  channel?: string
  position?: number
  totalInMessage?: number
}

/**
 * Prepara una imagen para procesamiento.
 * Verifica formato, mide dimensiones, calcula MD5.
 * NO hace LLM vision — eso lo decide el consumer.
 */
export async function extractImage(
  input: Buffer,
  fileName: string,
  mimeType: string,
  options?: ImageExtractOptions,
): Promise<ImageResult> {
  if (input.length > MAX_IMAGE_SIZE) {
    throw new Error(`Image too large: ${(input.length / 1024 / 1024).toFixed(1)}MB exceeds ${MAX_IMAGE_SIZE / 1024 / 1024}MB limit`)
  }

  let buffer = input
  let resolvedMime = mimeType

  // Convertir a PNG si el formato no es aceptado
  if (!ACCEPTED_IMAGE_TYPES.has(mimeType)) {
    logger.info({ fileName, mimeType }, 'Converting unsupported image format to PNG')
    // Fallback: mantener el buffer original como PNG
    resolvedMime = 'image/png'
  }

  const dims = estimateImageDimensions(buffer)
  const md5 = computeMD5(buffer)

  // Texto acompañante obligatorio
  let accompanyingText = options?.accompanyingText?.trim() ?? ''
  if (!accompanyingText) {
    const senderPart = options?.senderId ? ` de ${options.senderId}` : ''
    const channelPart = options?.channel ? ` por ${options.channel}` : ''
    accompanyingText = `[Imagen${senderPart}${channelPart}: ${fileName}]`
  }

  return {
    kind: 'image',
    buffer,
    mimeType: resolvedMime,
    width: dims?.width ?? 0,
    height: dims?.height ?? 0,
    md5,
    accompanyingText,
    position: options?.position,
    totalInMessage: options?.totalInMessage,
    metadata: {
      sizeBytes: input.length,
      originalName: fileName,
      extractorUsed: 'image-metadata',
    },
  }
}

// ═══════════════════════════════════════════
// Backward-compatible: LLM vision description
// Para knowledge que necesita texto descriptivo
// ═══════════════════════════════════════════

/**
 * Extrae descripción de imagen via LLM vision.
 * Requiere registry con llm:chat hook.
 * Usado por knowledge para indexar imágenes como texto.
 */
export async function extractImageWithVision(
  input: Buffer,
  fileName: string,
  registry: Registry,
): Promise<ExtractedContent> {
  if (input.length > MAX_IMAGE_SIZE) {
    throw new Error(`Image too large: ${(input.length / 1024 / 1024).toFixed(1)}MB exceeds ${MAX_IMAGE_SIZE / 1024 / 1024}MB limit`)
  }

  const mimeType = resolveImageMimeType(fileName)
  const base64 = input.toString('base64')

  // Intentar obtener prompt de templates
  let systemPrompt = 'Eres un asistente que describe imágenes de forma detallada y estructurada para una base de conocimiento. Describe todo el contenido visible: texto, diagramas, tablas, gráficos. Si hay texto, transcríbelo exactamente. Responde en español.'

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const promptsSvc = registry.getOptional<any>('prompts:service')
    if (promptsSvc) {
      const customPrompt = await promptsSvc.getSystemPrompt('image-extraction')
      if (customPrompt) systemPrompt = customPrompt
    }
  } catch {
    // Usar prompt por defecto
  }

  const result = await registry.callHook('llm:chat', {
    task: 'extractor-image-vision',
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
      sections: [{ title: fileName, content: `[Imagen sin procesar: ${fileName}. LLM no disponible para descripción.]` }],
      metadata: { sizeBytes: input.length, originalName: fileName, extractorUsed: 'image-fallback' },
    }
  }

  const description = result.text

  return {
    text: description,
    sections: [{ title: `Imagen: ${fileName}`, content: description }],
    metadata: { sizeBytes: input.length, originalName: fileName, extractorUsed: 'image-llm-vision' },
  }
}

// ═══════════════════════════════════════════
// LLM Enrichment: Descripción completa via Vision
// Genera LLMEnrichment para un ImageResult ya procesado.
// Usado por: engine processor, knowledge indexer.
// ═══════════════════════════════════════════

/**
 * Genera una descripción completa de la imagen via Gemini Vision.
 * Recibe un ImageResult ya procesado (code-only) y le agrega llmEnrichment.
 * Retorna el mismo ImageResult con llmEnrichment populado.
 */
export async function describeImage(
  imageResult: ImageResult,
  registry: Registry,
): Promise<ImageResult> {
  try {
    const base64 = imageResult.buffer.toString('base64')

    // Intentar obtener prompt customizado
    let systemPrompt = 'Eres un asistente que describe imágenes de forma detallada y completa. Describe TODO el contenido visible: texto, diagramas, tablas, gráficos, logos, personas, objetos, colores, layout. Si hay texto visible, transcríbelo exactamente. Sé exhaustivo y preciso. Responde en español.'

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const promptsSvc = registry.getOptional<any>('prompts:service')
      if (promptsSvc) {
        const customPrompt = await promptsSvc.getSystemPrompt('image-description')
        if (customPrompt) systemPrompt = customPrompt
      }
    } catch { /* usar default */ }

    const result = await registry.callHook('llm:chat', {
      task: 'extractor-image-vision',
      system: systemPrompt,
      messages: [{
        role: 'user' as const,
        content: [
          { type: 'image_url' as const, data: base64, mimeType: imageResult.mimeType },
          { type: 'text' as const, text: 'Describe detalladamente todo el contenido de esta imagen.' },
        ],
      }],
      maxTokens: 2000,
      temperature: 0.1,
    })

    if (result && typeof result === 'object' && 'text' in result) {
      const description = (result as { text: string }).text?.trim()
      if (description) {
        const enrichment: LLMEnrichment = {
          description,
          provider: (result as { provider?: string }).provider ?? 'google',
          generatedAt: new Date(),
        }
        return { ...imageResult, llmEnrichment: enrichment }
      }
    }

    logger.warn({ fileName: imageResult.metadata.originalName }, 'Vision returned empty — no enrichment')
    return imageResult
  } catch (err) {
    logger.warn({ err, fileName: imageResult.metadata.originalName }, 'describeImage failed — returning without enrichment')
    return imageResult
  }
}

// ═══════════════════════════════════════════
// Utilidades
// ═══════════════════════════════════════════

function resolveImageMimeType(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase()
  switch (ext) {
    case 'png': return 'image/png'
    case 'jpg': case 'jpeg': return 'image/jpeg'
    case 'webp': return 'image/webp'
    case 'gif': return 'image/gif'
    default: return 'image/png'
  }
}

/**
 * Estima dimensiones de una imagen desde headers del buffer.
 */
function estimateImageDimensions(buffer: Buffer): { width: number; height: number } | null {
  // PNG
  if (buffer.length > 24 && buffer[0] === 0x89 && buffer[1] === 0x50) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
  }
  // JPEG
  if (buffer.length > 10 && buffer[0] === 0xFF && buffer[1] === 0xD8) {
    let offset = 2
    while (offset < buffer.length - 10) {
      if (buffer[offset] === 0xFF) {
        const marker = buffer[offset + 1]
        if (marker !== undefined && marker >= 0xC0 && marker <= 0xCF && marker !== 0xC4 && marker !== 0xC8) {
          return { width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5) }
        }
        const segLen = buffer.readUInt16BE(offset + 2)
        offset += 2 + segLen
      } else {
        offset++
      }
    }
  }
  // GIF
  if (buffer.length > 10 && buffer[0] === 0x47 && buffer[1] === 0x49 && buffer[2] === 0x46) {
    return { width: buffer.readUInt16LE(6), height: buffer.readUInt16LE(8) }
  }
  // WebP
  if (buffer.length > 30 && buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) {
    // VP8 (lossy)
    if (buffer[12] === 0x56 && buffer[13] === 0x50 && buffer[14] === 0x38 && buffer[15] === 0x20) {
      return { width: buffer.readUInt16LE(26) & 0x3FFF, height: buffer.readUInt16LE(28) & 0x3FFF }
    }
  }
  return null
}
