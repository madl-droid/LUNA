// LUNA Engine — Attachment Processor (v2)
// Orchestrates attachment processing with dual-result extraction:
//   1. Code-processed result (text extraction, format conversion) — for embeddings
//   2. LLM-enriched result (vision description, STT transcription) — for conversation injection
//
// KEY DESIGN: Each attachment is an INDEPENDENT unit — processed, validated,
// and persisted to DB individually. Processing runs in parallel with
// concurrency control (max 3 simultaneous) to avoid overloading the system.
// All results are collected and returned as a single AttachmentContext.
//
// Size classification uses Gemini Embedding 2 token limit (8192) as threshold:
//   - Small (≤ 8192 tokens): inject full extracted content with [Category] label
//   - Large (> 8192 tokens): inject [Category] + LLM-generated description
// Each processed attachment is stored in interaction DB as a message-like record.

import { randomUUID, createHash } from 'node:crypto'
import { writeFile, mkdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import pino from 'pino'
import type { Pool } from 'pg'
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
  CATEGORY_LABEL_MAP,
  FALLBACK_MESSAGES,
  SYSTEM_HARD_LIMITS,
  resolveEffectiveCategories,
} from './types.js'
import { validateInjection } from './injection-validator.js'
import { transcribeAudio } from './audio-transcriber.js'
import { detectUrls, extractUrls } from './url-extractor.js'
import { evaluateValue } from './value-evaluator.js'

const logger = pino({ name: 'engine:attachments' })

/** Max attachments processed simultaneously — prevents memory/CPU spikes */
const MAX_CONCURRENT = 3

/** Directory for stored image binaries (relative to process.cwd()) */
const MEDIA_DIR = resolve(process.cwd(), 'instance', 'knowledge', 'media')

/**
 * Save an image binary to disk for re-consultation.
 * Returns the relative file path (from instance/) or null on failure.
 * Uses content hash prefix + sanitized filename to avoid collisions.
 */
async function saveImageToDisk(buffer: Buffer, filename: string): Promise<string | null> {
  try {
    await mkdir(MEDIA_DIR, { recursive: true })
    const hash = createHash('sha256').update(buffer).digest('hex').substring(0, 12)
    const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_').substring(0, 80)
    const diskName = `${hash}_${safeName}`
    const fullPath = join(MEDIA_DIR, diskName)
    await writeFile(fullPath, buffer)
    logger.debug({ filename, diskName }, 'Image binary saved to disk')
    return `instance/knowledge/media/${diskName}`
  } catch (err) {
    logger.warn({ err, filename }, 'Failed to save image binary to disk')
    return null
  }
}

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

  // Resolve effective enabled categories: engine capabilities × platform capabilities × admin enabled
  const effectiveCategories = resolveEffectiveCategories(channelName, channelConfig.enabledCategories)
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
          att, effectiveChannelConfig, engineConfig, registry,
        )
        // Persist to DB immediately after this individual file is done (fire-and-forget)
        persistOneAttachment(processed, sessionId, messageId, channelName, db).catch(err =>
          logger.warn({ err, attachmentId: processed.id, filename: processed.filename }, 'Failed to persist attachment'),
        )
        return processed
      } catch (err) {
        logger.error({ filename: att.filename, err }, 'Attachment processing failed')
        const failedCategory = resolveCategory(att.mimeType)
        const failed: ProcessedAttachment = {
          id: randomUUID(),
          filename: att.filename,
          mimeType: att.mimeType,
          category: failedCategory,
          sizeBytes: att.size,
          extractedText: null,
          llmText: null,
          categoryLabel: CATEGORY_LABEL_MAP[failedCategory] ?? failedCategory,
          summary: null,
          tokenEstimate: 0,
          sizeTier: 'small',
          status: 'extraction_failed',
          injectionRisk: false,
          sourceType: 'file_attachment',
          sourceRef: att.id,
          llmEnriched: false,
          filePath: null,
          metadata: null,
          contentHash: null,
          knowledgeMatch: null,
          isValuable: false, valueConfidence: 0, valueSignals: [],
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

  // Process URLs in text (3-tier routing: Drive → Authorized → Unauthorized)
  if (engineConfig.urlEnabled && normalizedText) {
    const urls = detectUrls(normalizedText)
    if (urls.length > 0) {
      const urlResults = await extractUrls(urls, engineConfig, registry)
      result.urls = urlResults

      // Persist each URL extraction independently (including Drive refs for lifecycle tracking)
      for (const url of urlResults) {
        // Skip only needs_subagent with no content — everything else gets a DB row
        if (url.status === 'needs_subagent' && !url.extractedText) continue
        if (url.status === 'unauthorized') continue // unauthorized URLs are ephemeral
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
  registry: Registry,
): Promise<ProcessedAttachment> {
  const id = randomUUID()
  const category = resolveCategory(att.mimeType)

  const categoryLabel = CATEGORY_LABEL_MAP[category] ?? category

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
      llmText: null,
      categoryLabel,
      summary: null,
      tokenEstimate: 0,
      sizeTier: 'small',
      status: 'disabled_by_channel',
      injectionRisk: false,
      sourceType: 'file_attachment',
      sourceRef: att.id,
      llmEnriched: false,
      filePath: null,
      metadata: null,
      contentHash: null,
      knowledgeMatch: null,
      isValuable: false, valueConfidence: 0, valueSignals: [],
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
      llmText: null,
      categoryLabel,
      summary: null,
      tokenEstimate: 0,
      sizeTier: 'small',
      status: isSystemLimit ? 'system_limit_exceeded' : 'too_large',
      injectionRisk: false,
      sourceType: 'file_attachment',
      sourceRef: att.id,
      llmEnriched: false,
      filePath: null,
      metadata: null,
      contentHash: null,
      knowledgeMatch: null,
      isValuable: false, valueConfidence: 0, valueSignals: [],
    }
  }

  // Download data via lazy loader
  const data = await att.getData()

  // Dedup: check if content already exists in knowledge base
  const contentHash = createHash('sha256').update(data).digest('hex')
  const knowledgePgStore = registry.getOptional<{
    getDocumentByHash(hash: string): Promise<{ id: string; title: string } | null>
  }>('knowledge:pg-store')

  if (knowledgePgStore) {
    try {
      const existingDoc = await knowledgePgStore.getDocumentByHash(contentHash)
      if (existingDoc) {
        logger.info({ filename: att.filename, knowledgeDocId: existingDoc.id, title: existingDoc.title },
          'Attachment matches existing knowledge document — skipping extraction')
        return {
          id, filename: att.filename, mimeType: att.mimeType, category,
          sizeBytes: att.size,
          extractedText: `[Documento ya indexado en knowledge: "${existingDoc.title}"]`,
          llmText: null, categoryLabel,
          summary: `[${categoryLabel}] ${att.filename} — ya existe en knowledge como "${existingDoc.title}"`,
          tokenEstimate: 0, sizeTier: 'small',
          status: 'knowledge_match', injectionRisk: false,
          sourceType: 'file_attachment', sourceRef: att.id,
          llmEnriched: false, filePath: null, metadata: null,
          contentHash, knowledgeMatch: existingDoc.id,
          isValuable: false, valueConfidence: 0, valueSignals: [],
        }
      }
    } catch (err) {
      logger.debug({ err, filename: att.filename }, 'Knowledge dedup check failed (non-fatal)')
    }
  }

  // Audio: transcribe instead of extract
  if (category === 'audio') {
    return processAudio(id, att, data, engineConfig, registry)
  }

  // Use global extractors for content extraction
  const { extractContent, enrichWithLLM, classifyMimeType } = await import('../../extractors/index.js')
  const { extractImage } = await import('../../extractors/image.js')
  const { extractVideo } = await import('../../extractors/video.js')

  const mimeCategory = classifyMimeType(att.mimeType)

  // ── Step 1: Code extraction (result for embeddings) ──
  let rawText = ''
  let llmText: string | null = null
  let llmEnriched = false
  let filePath: string | null = null
  let metadata: Record<string, unknown> | null = null

  if (mimeCategory === 'image') {
    // Image: code extraction → metadata only, LLM → vision description
    const imageResult = await extractImage(data, att.filename, att.mimeType)
    const enriched = await enrichWithLLM(imageResult, registry)
    rawText = enriched.kind === 'image' && enriched.llmEnrichment?.description
      ? enriched.llmEnrichment.description
      : `[Imagen: ${att.filename}]`
    llmText = enriched.kind === 'image' ? enriched.llmEnrichment?.description ?? null : null
    llmEnriched = !!llmText
    // Save image binary to disk for re-consultation
    filePath = await saveImageToDisk(data, att.filename)
  } else if (mimeCategory === 'video') {
    // Video: code extraction → format/duration, LLM → multimodal description + transcription
    const videoResult = await extractVideo(data, att.filename, att.mimeType)
    metadata = { duration: videoResult.durationSeconds, hasAudio: videoResult.hasAudio }
    const enriched = await enrichWithLLM(videoResult, registry)
    if (enriched.kind === 'video' && enriched.llmEnrichment) {
      const parts: string[] = []
      if (enriched.llmEnrichment.description) parts.push(enriched.llmEnrichment.description)
      if (enriched.llmEnrichment.transcription) parts.push(`[Transcripción]: ${enriched.llmEnrichment.transcription}`)
      rawText = parts.join('\n\n')
      llmText = rawText
      llmEnriched = true
    } else {
      rawText = `[Video: ${att.filename}, ${videoResult.durationSeconds}s]`
    }
  } else {
    // Text-based formats (PDF, DOCX, XLSX, TXT, etc.)
    const extracted = await extractContent(data, att.filename, att.mimeType, registry)
    rawText = extracted.text?.trim() ?? ''
  }

  if (!rawText) {
    return {
      id,
      filename: att.filename,
      mimeType: att.mimeType,
      category,
      sizeBytes: att.size,
      extractedText: null,
      llmText: null,
      categoryLabel,
      summary: `[${categoryLabel}] ${att.filename} — no se pudo extraer contenido`,
      tokenEstimate: 0,
      sizeTier: 'small',
      status: 'extraction_failed',
      injectionRisk: false,
      sourceType: category === 'images' ? 'image_vision' : category === 'video' ? 'video_multimodal' : 'file_attachment',
      sourceRef: att.id,
      llmEnriched,
      filePath,
      metadata,
      contentHash,
      knowledgeMatch: null,
      isValuable: false, valueConfidence: 0, valueSignals: [],
    }
  }

  // Validate injection
  const validation = validateInjection(rawText, category, att.filename)

  // Token estimation (~4 chars per token)
  const tokenEstimate = Math.ceil(rawText.length / 4)
  const sizeTier = classifySizeTier(tokenEstimate, engineConfig)

  // ── Step 2: For large text-based files, generate LLM description ──
  if (!llmEnriched && sizeTier === 'large') {
    try {
      const totalChars = rawText.length
      const sampledText = distributedSample(rawText, 30000)
      const truncationNote = totalChars > 30000
        ? `\n\n[NOTA: El documento tiene ${String(totalChars)} caracteres (~${String(tokenEstimate)} tokens). Se muestran muestras del inicio, mitad y final. Resume lo que puedas ver y menciona que hay contenido intermedio no visible.]`
        : ''
      const descResult = await registry.callHook('llm:chat', {
        task: 'extractor-summarize-large',
        system: 'Eres un asistente que resume documentos. Genera una descripción concisa pero completa del documento, cubriendo los puntos principales, estructura y datos relevantes. Responde en español. Máximo 500 palabras.',
        messages: [{
          role: 'user' as const,
          content: [
            { type: 'text' as const, text: `Resume este documento (${att.filename}):\n\n${sampledText}${truncationNote}` },
          ],
        }],
        maxTokens: 1500,
        temperature: 0.1,
      })
      if (descResult && typeof descResult === 'object' && 'text' in descResult) {
        const desc = (descResult as { text: string }).text?.trim()
        if (desc) {
          llmText = desc
          llmEnriched = true
        }
      }
    } catch (err) {
      logger.warn({ err, filename: att.filename }, 'Failed to generate LLM description for large file')
    }
  }

  // Build summary for large docs (uses LLM description if available, otherwise truncate)
  let summary: string | null = null
  if (sizeTier === 'large') {
    const truncNote = `[documento de ~${String(tokenEstimate)} tokens, contenido resumido]`
    summary = llmText
      ? `[${categoryLabel}] ${att.filename} ${truncNote} — ${llmText}`
      : `[${categoryLabel}] ${att.filename} ${truncNote}: ${rawText.slice(0, engineConfig.summaryMaxTokens * 4)}...`
  }

  // Evaluate value for potential knowledge base promotion
  const valueEval = evaluateValue(att.filename, validation.sanitizedText, category, att.mimeType)

  return {
    id,
    filename: att.filename,
    mimeType: att.mimeType,
    category,
    sizeBytes: att.size,
    extractedText: validation.sanitizedText,
    llmText,
    categoryLabel,
    summary,
    tokenEstimate,
    sizeTier,
    status: 'processed',
    injectionRisk: validation.injectionRisk,
    sourceType: category === 'images' ? 'image_vision' : category === 'video' ? 'video_multimodal' : 'file_attachment',
    sourceRef: att.id,
    llmEnriched,
    filePath,
    metadata,
    contentHash,
    knowledgeMatch: null,
    isValuable: valueEval.isValuable,
    valueConfidence: valueEval.confidence,
    valueSignals: valueEval.signals,
  }
}

async function processAudio(
  id: string,
  att: AttachmentMeta,
  data: Buffer,
  engineConfig: AttachmentEngineConfig,
  registry: Registry,
): Promise<ProcessedAttachment> {
  const categoryLabel = CATEGORY_LABEL_MAP.audio

  // Extract audio metadata (duration) for downstream chunking
  let audioMetadata: Record<string, unknown> | null = null
  try {
    const { extractAudio } = await import('../../extractors/audio.js')
    const audioResult = await extractAudio(data, att.filename, att.mimeType)
    audioMetadata = { duration: audioResult.durationSeconds }
  } catch {
    // Non-fatal: duration metadata is optional
  }

  const transcription = await transcribeAudio(data, att.mimeType, registry)

  if (!transcription) {
    return {
      id,
      filename: att.filename,
      mimeType: att.mimeType,
      category: 'audio',
      sizeBytes: att.size,
      extractedText: null,
      llmText: null,
      categoryLabel,
      summary: `[${categoryLabel}] ${att.filename} — no se pudo transcribir`,
      tokenEstimate: 0,
      sizeTier: 'small',
      status: 'extraction_failed',
      injectionRisk: false,
      sourceType: 'audio_transcription',
      sourceRef: att.id,
      llmEnriched: false,
      filePath: null,
      metadata: audioMetadata,
      contentHash: null,
      knowledgeMatch: null,
      isValuable: false, valueConfidence: 0, valueSignals: [],
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
    llmText: transcription, // STT transcription IS the LLM text
    categoryLabel,
    summary: null,
    tokenEstimate,
    sizeTier,
    status: 'processed',
    injectionRisk: validation.injectionRisk,
    sourceType: 'audio_transcription',
    sourceRef: att.id,
    llmEnriched: true, // STT is LLM-powered
    filePath: null,
    metadata: audioMetadata,
    contentHash: null,
    knowledgeMatch: null,
    isValuable: false, valueConfidence: 0, valueSignals: [],
  }
}

function resolveCategory(mimeType: string): AttachmentCategory {
  // Handle MIME types with parameters (e.g., "audio/ogg; codecs=opus")
  const baseMime = mimeType.split(';')[0]!.trim()
  return MIME_TO_CATEGORY[mimeType] ?? MIME_TO_CATEGORY[baseMime] ?? 'documents'
}

/**
 * Distributed sampling: takes start + middle + end of a document.
 * Ensures the LLM sees representative content from the entire document.
 * Cuts at paragraph boundaries (\n\n) when possible.
 */
function distributedSample(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text

  const third = Math.floor(maxChars / 3)

  // Start: first third
  const startEnd = findParagraphBreak(text, third)
  const startSection = text.slice(0, startEnd)

  // Middle: centered around midpoint — clamp to avoid overlap with start section
  const midPoint = Math.floor(text.length / 2)
  const midHalf = Math.floor(third / 2)
  const midStartRaw = findParagraphBreak(text, midPoint - midHalf, 'backward')
  const midEndRaw = findParagraphBreak(text, midPoint + midHalf)
  const clampedMidStart = Math.max(startEnd, midStartRaw)
  const clampedMidEnd = Math.max(clampedMidStart, midEndRaw)
  const midSection = text.slice(clampedMidStart, clampedMidEnd)

  // End: last third — clamp to avoid overlap with middle section
  const endStartRaw = findParagraphBreak(text, text.length - third, 'backward')
  const clampedEndStart = Math.max(clampedMidEnd, endStartRaw)
  const endSection = text.slice(clampedEndStart)

  return `${startSection}\n\n[... contenido omitido ...]\n\n${midSection}\n\n[... contenido omitido ...]\n\n${endSection}`
}

/** Find nearest paragraph break (\n\n) near position. Returns adjusted position. */
function findParagraphBreak(text: string, pos: number, direction: 'forward' | 'backward' = 'forward'): number {
  const MAX_SEARCH = 500 // max chars to search for a clean break
  if (direction === 'forward') {
    const idx = text.indexOf('\n\n', pos)
    return (idx !== -1 && idx - pos < MAX_SEARCH) ? idx + 2 : pos
  } else {
    const idx = text.lastIndexOf('\n\n', pos)
    return (idx !== -1 && pos - idx < MAX_SEARCH) ? idx + 2 : pos
  }
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
      case 'system_limit_exceeded': {
        messages.push(
          FALLBACK_MESSAGES.system_limit_exceeded
            .replace('{filename}', att.filename)
            .replace('{maxMb}', String(SYSTEM_HARD_LIMITS.maxFileSizeMb)),
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
     (id, session_id, message_id, channel, filename, mime_type, size_bytes, category, source_type, extracted_text, llm_text, category_label, token_estimate, status, injection_risk, source_ref, file_path, metadata, content_hash, knowledge_match_id, is_valuable, value_confidence, value_signals)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)
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
      att.llmText,
      att.categoryLabel,
      att.tokenEstimate,
      att.status,
      att.injectionRisk,
      att.sourceRef,
      att.filePath,
      att.metadata ? JSON.stringify(att.metadata) : null,
      att.contentHash,
      att.knowledgeMatch,
      att.isValuable,
      att.valueConfidence,
      att.valueSignals.length > 0 ? `{${att.valueSignals.join(',')}}` : null,
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
  // Drive references: store driveMeta in metadata JSONB for lifecycle + re-consultation
  const isDrive = url.status === 'drive_reference' || url.status === 'drive_no_access'
  const category = isDrive ? 'drive' : 'web_link'
  const sourceType = isDrive ? 'drive_reference' : 'url_extraction'
  const mimeType = url.driveMeta?.mimeType ?? 'text/html'
  const metadata = url.driveMeta ? JSON.stringify(url.driveMeta) : null

  await db.query(
    `INSERT INTO attachment_extractions
     (session_id, message_id, channel, filename, mime_type, size_bytes, category, source_type, extracted_text, token_estimate, status, injection_risk, source_ref, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
     ON CONFLICT DO NOTHING`,
    [
      sessionId,
      messageId,
      channel,
      url.title ?? url.url,
      mimeType,
      0,
      category,
      sourceType,
      url.extractedText,
      url.tokenEstimate,
      url.status,
      url.injectionRisk,
      url.url,
      metadata,
    ],
  )
}
