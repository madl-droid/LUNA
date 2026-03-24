// LUNA Engine — Attachment Processor
// Main service that orchestrates attachment processing: download, extract, validate, cache.
// Reuses knowledge extractors (PDF, DOCX, XLSX, images) — does NOT duplicate extraction logic.
//
// KEY DESIGN: Each attachment is an INDEPENDENT unit — processed, validated,
// and persisted to DB individually. Processing runs in parallel with
// concurrency control (max 3 simultaneous) to avoid overloading the system.
// All results are collected and returned as a single AttachmentContext.

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
} from './types.js'
import {
  MIME_TO_CATEGORY,
  CATEGORY_LABELS,
  FALLBACK_MESSAGES,
  SYSTEM_HARD_LIMITS,
  CHANNEL_SUPPORTED_CATEGORIES,
} from './types.js'
import { validateInjection } from './injection-validator.js'
import { transcribeAudio } from './audio-transcriber.js'
import { detectUrls, extractUrls } from './url-extractor.js'

const logger = pino({ name: 'engine:attachments' })

/** Max attachments processed simultaneously — prevents memory/CPU spikes */
const MAX_CONCURRENT = 3

/**
 * Run async tasks in parallel with a concurrency limit.
 * Each item is processed independently; results maintain input order.
 */
async function parallelWithLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let nextIndex = 0

  async function runNext(): Promise<void> {
    while (nextIndex < items.length) {
      const i = nextIndex++
      results[i] = await fn(items[i]!)
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => runNext())
  await Promise.all(workers)
  return results
}

/**
 * Process all attachments and URLs for a message.
 * Called from Phase 1 (Intake) after normalization and injection detection.
 *
 * Each attachment is processed as an INDEPENDENT file — its own extraction,
 * validation, and DB record. Processing runs in parallel with concurrency
 * control (MAX_CONCURRENT) so the system doesn't get overwhelmed.
 * All results are collected into a single AttachmentContext for the engine.
 */
export async function processAttachments(
  attachments: AttachmentMeta[],
  normalizedText: string,
  channelConfig: ChannelAttachmentConfig,
  engineConfig: AttachmentEngineConfig,
  channelName: string,
  sessionId: string,
  messageId: string,
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

  // Enforce system hard limit on attachment count (cannot be overridden by channel)
  const effectiveMaxCount = Math.min(
    channelConfig.maxAttachmentsPerMessage,
    SYSTEM_HARD_LIMITS.maxAttachmentsPerMessage,
  )

  // If more attachments than the limit, notify user about skipped ones
  if (attachments.length > effectiveMaxCount) {
    result.fallbackMessages.push(
      FALLBACK_MESSAGES.too_many_attachments
        .replace('{count}', String(attachments.length))
        .replace(/\{max\}/g, String(effectiveMaxCount)),
    )
    logger.warn({
      total: attachments.length,
      limit: effectiveMaxCount,
      channelLimit: channelConfig.maxAttachmentsPerMessage,
      systemLimit: SYSTEM_HARD_LIMITS.maxAttachmentsPerMessage,
      channelName,
    }, 'Attachments exceed limit — excess will be skipped')
  }

  const attSlice = attachments.slice(0, effectiveMaxCount)

  // Resolve effective enabled categories: intersection of channel config + platform capabilities
  const platformCapabilities = CHANNEL_SUPPORTED_CATEGORIES[channelName] ?? []
  const effectiveCategories = channelConfig.enabledCategories.filter(
    cat => platformCapabilities.includes(cat),
  )
  const effectiveChannelConfig: ChannelAttachmentConfig = {
    ...channelConfig,
    enabledCategories: effectiveCategories,
    // Enforce system hard limit on file size
    maxFileSizeMb: Math.min(channelConfig.maxFileSizeMb, SYSTEM_HARD_LIMITS.maxFileSizeMb),
  }

  // Process each attachment as an INDEPENDENT file, in parallel with concurrency control.
  // Each gets its own extraction, validation, and DB row.
  const processedResults = await parallelWithLimit(
    attSlice,
    MAX_CONCURRENT,
    async (att): Promise<ProcessedAttachment> => {
      try {
        const processed = await processOneAttachment(
          att, effectiveChannelConfig, engineConfig, sessionId, registry, redis,
        )
        // Persist to DB immediately after this individual file is done (fire-and-forget)
        persistOneAttachment(processed, sessionId, messageId, channelName, db).catch(err =>
          logger.warn({ err, attachmentId: processed.id, filename: processed.filename }, 'Failed to persist attachment'),
        )
        return processed
      } catch (err) {
        logger.error({ filename: att.filename, err }, 'Attachment processing failed')
        const failed: ProcessedAttachment = {
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
        }
        persistOneAttachment(failed, sessionId, messageId, channelName, db).catch(e =>
          logger.warn({ e, filename: att.filename }, 'Failed to persist failed attachment'),
        )
        return failed
      }
    },
  )

  // Collect all independently-processed results into a single context
  for (const processed of processedResults) {
    result.attachments.push(processed)
    if (processed.status === 'extraction_failed') {
      result.fallbackMessages.push(
        FALLBACK_MESSAGES.extraction_failed.replace('{filename}', processed.filename),
      )
    }
  }

  // Process URLs in text
  if (engineConfig.urlEnabled && normalizedText) {
    const urls = detectUrls(normalizedText)
    if (urls.length > 0) {
      const urlResults = await extractUrls(urls, engineConfig)
      result.urls = urlResults

      // Persist each URL extraction independently
      for (const url of urlResults) {
        if (url.status === 'needs_subagent' && !url.extractedText) continue
        persistOneUrl(url, sessionId, messageId, channelName, db).catch(err =>
          logger.warn({ err, url: url.url }, 'Failed to persist URL extraction'),
        )
      }
    }
  }

  // Calculate total tokens
  result.totalTokens =
    result.attachments.reduce((sum, a) => sum + a.tokenEstimate, 0) +
    result.urls.reduce((sum, u) => sum + u.tokenEstimate, 0)

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
    logger.debug({ filename: att.filename, category, label }, 'Attachment category disabled for channel')
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

  // Size check: enforce min(channel limit, system hard limit)
  const effectiveMaxMb = Math.min(channelConfig.maxFileSizeMb, SYSTEM_HARD_LIMITS.maxFileSizeMb)
  const maxBytes = effectiveMaxMb * 1024 * 1024
  if (att.size > maxBytes) {
    // Distinguish between system hard limit and channel limit
    const isSystemLimit = att.size > SYSTEM_HARD_LIMITS.maxFileSizeMb * 1024 * 1024
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
      status: isSystemLimit ? 'too_large' : 'too_large',
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
        const effectiveMax = Math.min(channelConfig.maxFileSizeMb, SYSTEM_HARD_LIMITS.maxFileSizeMb)
        messages.push(
          FALLBACK_MESSAGES.too_large
            .replace('{filename}', att.filename)
            .replace('{sizeMb}', sizeMb)
            .replace('{maxMb}', String(effectiveMax)),
        )
        break
      }
      case 'extraction_failed':
        messages.push(
          FALLBACK_MESSAGES.extraction_failed.replace('{filename}', att.filename),
        )
        break
    }
  }

  return messages
}

/** Persist a single processed attachment to DB immediately */
async function persistOneAttachment(
  att: ProcessedAttachment,
  sessionId: string,
  messageId: string,
  channel: string,
  db: Pool,
): Promise<void> {
  if (att.status === 'disabled_by_channel') return

  await db.query(
    `INSERT INTO attachment_extractions
     (id, session_id, message_id, channel, filename, mime_type, size_bytes, category, source_type, extracted_text, token_estimate, status, injection_risk, source_ref)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     ON CONFLICT DO NOTHING`,
    [
      att.id,
      sessionId,
      messageId,
      channel,
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

/** Persist a single URL extraction to DB immediately */
async function persistOneUrl(
  url: import('./types.js').UrlExtraction,
  sessionId: string,
  messageId: string,
  channel: string,
  db: Pool,
): Promise<void> {
  await db.query(
    `INSERT INTO attachment_extractions
     (session_id, message_id, channel, filename, mime_type, size_bytes, category, source_type, extracted_text, token_estimate, status, injection_risk, source_ref)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     ON CONFLICT DO NOTHING`,
    [
      sessionId,
      messageId,
      channel,
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
