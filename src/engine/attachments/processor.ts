// LUNA Engine — Attachment Processor
// Main service that orchestrates attachment processing: download, extract, validate, cache.
// Reuses knowledge extractors (PDF, DOCX, XLSX, images) — does NOT duplicate extraction logic.

import { randomUUID } from 'node:crypto'
import pino from 'pino'
import type { Pool } from 'pg'
import type { Redis } from 'ioredis'
import type { Registry } from '../../kernel/registry.js'
import type { AttachmentMeta } from '../../channels/types.js'
import type {
  AttachmentContext,
  AttachmentEngineConfig,
  ChannelAttachmentConfig,
  ProcessedAttachment,
  AttachmentCategory,
  AttachmentSizeTier,
  UrlExtraction,
} from './types.js'
import { MIME_TO_CATEGORY, CATEGORY_LABELS, FALLBACK_MESSAGES } from './types.js'
import { validateInjection } from './injection-validator.js'
import { transcribeAudio } from './audio-transcriber.js'
import { detectUrls, extractUrls } from './url-extractor.js'

const logger = pino({ name: 'engine:attachments' })

/**
 * Process all attachments and URLs for a message.
 * Called from Phase 1 (Intake) after normalization and injection detection.
 */
export async function processAttachments(
  attachments: AttachmentMeta[],
  normalizedText: string,
  channelConfig: ChannelAttachmentConfig,
  engineConfig: AttachmentEngineConfig,
  sessionId: string,
  registry: Registry,
  db: Pool,
  redis: Redis,
): Promise<AttachmentContext> {
  const result: AttachmentContext = {
    attachments: [],
    urls: [],
    totalTokens: 0,
    fallbackMessages: [],
  }

  if (!engineConfig.enabled) return result

  // Process file attachments
  const attachmentLimit = Math.min(attachments.length, channelConfig.maxAttachmentsPerMessage)
  const attSlice = attachments.slice(0, attachmentLimit)

  const processedPromises = attSlice.map(att =>
    processOneAttachment(att, channelConfig, engineConfig, sessionId, registry, redis),
  )
  const processed = await Promise.allSettled(processedPromises)

  for (const [i, p] of processed.entries()) {
    if (p.status === 'fulfilled') {
      result.attachments.push(p.value)
    } else {
      const att = attSlice[i]!
      logger.error({ filename: att.filename, err: p.reason }, 'Attachment processing failed')
      result.attachments.push({
        id: randomUUID(),
        filename: att.filename,
        mimeType: att.mimeType,
        category: resolveCategory(att.mimeType),
        sizeBytes: att.size,
        extractedText: null,
        summary: null,
        tokenEstimate: 0,
        sizeTier: 'small',
        cacheKey: null,
        status: 'extraction_failed',
        injectionRisk: false,
        sourceType: 'file_attachment',
        sourceRef: att.id,
      })
      result.fallbackMessages.push(
        FALLBACK_MESSAGES.extraction_failed.replace('{filename}', att.filename),
      )
    }
  }

  // Process URLs in text
  if (engineConfig.urlEnabled && normalizedText) {
    const urls = detectUrls(normalizedText)
    if (urls.length > 0) {
      const urlResults = await extractUrls(urls, engineConfig)
      result.urls = urlResults
    }
  }

  // Calculate total tokens
  result.totalTokens =
    result.attachments.reduce((sum, a) => sum + a.tokenEstimate, 0) +
    result.urls.reduce((sum, u) => sum + u.tokenEstimate, 0)

  // Persist to DB (fire-and-forget)
  persistAttachments(result, sessionId, db).catch(err =>
    logger.warn({ err, sessionId }, 'Failed to persist attachment extractions'),
  )

  return result
}

async function processOneAttachment(
  att: AttachmentMeta,
  channelConfig: ChannelAttachmentConfig,
  engineConfig: AttachmentEngineConfig,
  sessionId: string,
  registry: Registry,
  redis: Redis,
): Promise<ProcessedAttachment> {
  const id = randomUUID()
  const category = resolveCategory(att.mimeType)

  // Check if category is enabled for this channel
  if (!channelConfig.enabledCategories.includes(category)) {
    const label = CATEGORY_LABELS[category] ?? att.mimeType
    return {
      id,
      filename: att.filename,
      mimeType: att.mimeType,
      category,
      sizeBytes: att.size,
      extractedText: null,
      summary: null,
      tokenEstimate: 0,
      sizeTier: 'small',
      cacheKey: null,
      status: 'disabled_by_channel',
      injectionRisk: false,
      sourceType: 'file_attachment',
      sourceRef: att.id,
    }
  }

  // Size check
  const maxBytes = channelConfig.maxFileSizeMb * 1024 * 1024
  if (att.size > maxBytes) {
    return {
      id,
      filename: att.filename,
      mimeType: att.mimeType,
      category,
      sizeBytes: att.size,
      extractedText: null,
      summary: null,
      tokenEstimate: 0,
      sizeTier: 'small',
      cacheKey: null,
      status: 'too_large',
      injectionRisk: false,
      sourceType: 'file_attachment',
      sourceRef: att.id,
    }
  }

  // Download data via lazy loader
  const data = await att.getData()

  // Audio: transcribe instead of extract
  if (category === 'audio') {
    return processAudio(id, att, data, engineConfig, registry)
  }

  // Use knowledge extractors for content extraction
  const { extractContent } = await import('../../modules/knowledge/extractors/index.js')
  const extracted = await extractContent(data, att.filename, att.mimeType, registry)
  const rawText = extracted.text?.trim() ?? ''

  if (!rawText) {
    return {
      id,
      filename: att.filename,
      mimeType: att.mimeType,
      category,
      sizeBytes: att.size,
      extractedText: null,
      summary: `[Adjunto: ${att.filename}]`,
      tokenEstimate: 0,
      sizeTier: 'small',
      cacheKey: null,
      status: 'extraction_failed',
      injectionRisk: false,
      sourceType: category === 'images' ? 'image_vision' : 'file_attachment',
      sourceRef: att.id,
    }
  }

  // Validate injection
  const validation = validateInjection(rawText, category, att.filename)

  // Token estimation (~4 chars per token)
  const tokenEstimate = Math.ceil(rawText.length / 4)
  const sizeTier = classifySizeTier(tokenEstimate, engineConfig)

  // Cache large documents in Redis for query_attachment tool
  let cacheKey: string | null = null
  if (sizeTier === 'large' || sizeTier === 'medium') {
    cacheKey = `att:${sessionId}:${id}`
    try {
      await redis.set(cacheKey, rawText, 'PX', engineConfig.cacheTtlMs)
    } catch (err) {
      logger.warn({ err, cacheKey }, 'Failed to cache attachment in Redis')
      cacheKey = null
    }
  }

  // Build summary for large docs
  let summary: string | null = null
  if (sizeTier === 'large') {
    const maxChars = engineConfig.summaryMaxTokens * 4
    summary = `[Resumen de ${att.filename}]: ${rawText.slice(0, maxChars)}...`
  }

  return {
    id,
    filename: att.filename,
    mimeType: att.mimeType,
    category,
    sizeBytes: att.size,
    extractedText: validation.sanitizedText,
    summary,
    tokenEstimate,
    sizeTier,
    cacheKey,
    status: 'processed',
    injectionRisk: validation.injectionRisk,
    sourceType: category === 'images' ? 'image_vision' : 'file_attachment',
    sourceRef: att.id,
  }
}

async function processAudio(
  id: string,
  att: AttachmentMeta,
  data: Buffer,
  engineConfig: AttachmentEngineConfig,
  registry: Registry,
): Promise<ProcessedAttachment> {
  const transcription = await transcribeAudio(data, att.mimeType, registry)

  if (!transcription) {
    return {
      id,
      filename: att.filename,
      mimeType: att.mimeType,
      category: 'audio',
      sizeBytes: att.size,
      extractedText: null,
      summary: `[Audio: ${att.filename} — no se pudo transcribir]`,
      tokenEstimate: 0,
      sizeTier: 'small',
      cacheKey: null,
      status: 'extraction_failed',
      injectionRisk: false,
      sourceType: 'audio_transcription',
      sourceRef: att.id,
    }
  }

  const validation = validateInjection(transcription, 'audio', att.filename)
  const tokenEstimate = Math.ceil(transcription.length / 4)
  const sizeTier = classifySizeTier(tokenEstimate, engineConfig)

  return {
    id,
    filename: att.filename,
    mimeType: att.mimeType,
    category: 'audio',
    sizeBytes: att.size,
    extractedText: validation.sanitizedText,
    summary: null,
    tokenEstimate,
    sizeTier,
    cacheKey: null,
    status: 'processed',
    injectionRisk: validation.injectionRisk,
    sourceType: 'audio_transcription',
    sourceRef: att.id,
  }
}

function resolveCategory(mimeType: string): AttachmentCategory {
  // Handle MIME types with parameters (e.g., "audio/ogg; codecs=opus")
  const baseMime = mimeType.split(';')[0]!.trim()
  return MIME_TO_CATEGORY[mimeType] ?? MIME_TO_CATEGORY[baseMime] ?? 'documents'
}

function classifySizeTier(tokens: number, config: AttachmentEngineConfig): AttachmentSizeTier {
  if (tokens <= config.smallDocTokens) return 'small'
  if (tokens <= config.mediumDocTokens) return 'medium'
  return 'large'
}

/** Build fallback messages for non-processable attachments */
export function buildFallbackMessages(
  attachments: ProcessedAttachment[],
  channelConfig: ChannelAttachmentConfig,
): string[] {
  const messages: string[] = []

  for (const att of attachments) {
    switch (att.status) {
      case 'disabled_by_channel': {
        const label = CATEGORY_LABELS[att.category] ?? att.mimeType
        messages.push(
          FALLBACK_MESSAGES.disabled_by_channel.replace('{fileType}', label),
        )
        break
      }
      case 'too_large': {
        const sizeMb = (att.sizeBytes / 1024 / 1024).toFixed(1)
        messages.push(
          FALLBACK_MESSAGES.too_large
            .replace('{filename}', att.filename)
            .replace('{sizeMb}', sizeMb)
            .replace('{maxMb}', String(channelConfig.maxFileSizeMb)),
        )
        break
      }
      case 'extraction_failed':
        messages.push(
          FALLBACK_MESSAGES.extraction_failed.replace('{filename}', att.filename),
        )
        break
      case 'disabled_by_channel':
        // Already handled above
        break
    }
  }

  return messages
}

/** Persist processed attachments to DB (fire-and-forget) */
async function persistAttachments(
  context: AttachmentContext,
  sessionId: string,
  db: Pool,
): Promise<void> {
  for (const att of context.attachments) {
    if (att.status === 'disabled_by_channel') continue

    await db.query(
      `INSERT INTO attachment_extractions
       (id, session_id, message_id, channel, filename, mime_type, size_bytes, category, source_type, extracted_text, token_estimate, status, injection_risk, source_ref)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       ON CONFLICT DO NOTHING`,
      [
        att.id,
        sessionId,
        '', // message_id populated later by engine
        '', // channel populated later
        att.filename,
        att.mimeType,
        att.sizeBytes,
        att.category,
        att.sourceType,
        att.extractedText,
        att.tokenEstimate,
        att.status,
        att.injectionRisk,
        att.sourceRef,
      ],
    )
  }

  for (const url of context.urls) {
    if (url.status === 'needs_subagent' && !url.extractedText) continue

    await db.query(
      `INSERT INTO attachment_extractions
       (session_id, message_id, channel, filename, mime_type, size_bytes, category, source_type, extracted_text, token_estimate, status, injection_risk, source_ref)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       ON CONFLICT DO NOTHING`,
      [
        sessionId,
        '',
        '',
        url.title ?? url.url,
        'text/html',
        0,
        'web_link',
        'url_extraction',
        url.extractedText,
        url.tokenEstimate,
        url.status,
        url.injectionRisk,
        url.url,
      ],
    )
  }
}
