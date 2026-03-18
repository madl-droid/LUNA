// LUNA — Module: lead-scoring — Extract Qualification Tool
// Tool que se registra en tools:registry para extraer datos de calificación
// de la conversación. Se activa en Phase 2 cuando el evaluador detecta info relevante.

import type { Registry } from '../../kernel/registry.js'
import type { ToolRegistration, ToolExecutionContext } from '../tools/types.js'
import type { ToolRegistry } from '../tools/tool-registry.js'
import type { QualifyingConfig, ExtractionResult } from './types.js'
import type { ConfigStore } from './config-store.js'
import { calculateScore, mergeQualificationData, resolveTransition } from './scoring-engine.js'
import type { QualificationStatus } from './types.js'
import pino from 'pino'

const logger = pino({ name: 'lead-scoring:extract-tool' })

/**
 * Builds the system prompt for the extraction LLM call.
 * Includes current criteria and what's already known.
 */
function buildExtractionPrompt(
  config: QualifyingConfig,
  existingData: Record<string, unknown>,
): string {
  const criteriaList = config.criteria.map(c => {
    const filled = existingData[c.key] !== undefined && existingData[c.key] !== null
    let desc = `- ${c.key} (${c.type}): ${c.name.es}`
    if (c.type === 'enum' && c.options) {
      desc += ` [opciones: ${c.options.join(', ')}]`
    }
    if (filled) {
      desc += ` [ALREADY KNOWN: ${JSON.stringify(existingData[c.key])}]`
    }
    if (c.neverAskDirectly) {
      desc += ' [NEVER ASK DIRECTLY]'
    }
    return desc
  }).join('\n')

  const disqualifyList = config.disqualifyReasons.map(d =>
    `- ${d.key}: ${d.name.es}`
  ).join('\n')

  return `You are an extraction assistant for lead qualification.
Your ONLY job is to extract structured data from the conversation message.
DO NOT generate responses — only extract data.

CRITERIA TO EXTRACT:
${criteriaList}

DISQUALIFICATION REASONS (set disqualifyDetected if any detected):
${disqualifyList}

RULES:
1. Only extract information that is CLEARLY stated or strongly implied in the message.
2. Do not guess or infer weak signals.
3. For enum types, map to the closest option or leave null.
4. For text types, extract the relevant phrase or summary.
5. For boolean types, set true/false only if clearly indicated.
6. Include a confidence score (0.0-1.0) for each extracted field.
7. If a disqualification signal is detected, set disqualifyDetected to the reason key.
8. Only include fields you actually found data for — do not include null fields.

Respond ONLY with valid JSON matching this schema:
{
  "extracted": { "key": "value", ... },
  "confidence": { "key": 0.0-1.0, ... },
  "disqualifyDetected": "reason_key or null"
}`
}

/**
 * Register the extract_qualification tool in the tools registry.
 */
export async function registerExtractionTool(
  registry: Registry,
  configStore: ConfigStore,
): Promise<void> {
  const toolRegistry = registry.get<ToolRegistry>('tools:registry')

  const registration: ToolRegistration = {
    definition: {
      name: 'extract_qualification',
      displayName: 'Extraer Calificación',
      description: 'Extrae datos de calificación de leads del mensaje actual. Solo se activa cuando el evaluador detecta información relevante de calificación.',
      category: 'qualification',
      sourceModule: 'lead-scoring',
      parameters: {
        type: 'object',
        properties: {
          message_text: {
            type: 'string',
            description: 'The message text to extract qualification data from',
          },
          contact_id: {
            type: 'string',
            description: 'The contact ID to update qualification data for',
          },
        },
        required: ['message_text', 'contact_id'],
      },
    },
    handler: async (input, ctx) => {
      return await handleExtraction(input, ctx, configStore, registry)
    },
  }

  await toolRegistry.registerTool(registration)
  logger.info('extract_qualification tool registered')
}

/**
 * Handle the extraction: call LLM, parse result, update DB.
 */
async function handleExtraction(
  input: Record<string, unknown>,
  ctx: ToolExecutionContext,
  configStore: ConfigStore,
  registry: Registry,
): Promise<{ success: boolean; data?: unknown; error?: string }> {
  const messageText = input['message_text'] as string
  const contactId = input['contact_id'] as string

  if (!messageText || !contactId) {
    return { success: false, error: 'Missing message_text or contact_id' }
  }

  const config = configStore.getConfig()
  const db = ctx.db

  // Load existing qualification data
  const contactRow = await db.query(
    'SELECT qualification_data, qualification_status, qualification_score FROM contacts WHERE id = $1',
    [contactId],
  )

  if (contactRow.rows.length === 0) {
    return { success: false, error: 'Contact not found' }
  }

  const existingData = (contactRow.rows[0].qualification_data as Record<string, unknown>) ?? {}
  const currentStatus = (contactRow.rows[0].qualification_status as QualificationStatus) ?? 'new'

  // Build prompt and call LLM
  const systemPrompt = buildExtractionPrompt(config, existingData)

  try {
    const llmResult = await registry.callHook('llm:chat', {
      task: 'extract_qualification',
      system: systemPrompt,
      messages: [{ role: 'user', content: messageText }],
      temperature: 0.1,
      maxTokens: 500,
    })

    if (!llmResult?.text) {
      return { success: false, error: 'LLM returned empty response' }
    }

    // Parse LLM response
    const cleaned = llmResult.text.replace(/```json?\n?/g, '').replace(/```/g, '').trim()
    let extraction: ExtractionResult

    try {
      extraction = JSON.parse(cleaned) as ExtractionResult
    } catch {
      logger.warn({ raw: llmResult.text }, 'Failed to parse extraction JSON')
      return { success: false, error: 'Failed to parse LLM extraction response' }
    }

    if (!extraction.extracted || Object.keys(extraction.extracted).length === 0) {
      // Nothing extracted — not an error, just no relevant info
      return { success: true, data: { extracted: false, reason: 'no_relevant_info' } }
    }

    // Merge new data with existing
    const mergedData = mergeQualificationData(
      existingData,
      extraction.extracted,
      extraction.confidence ?? {},
    )

    // Handle disqualification
    if (extraction.disqualifyDetected) {
      mergedData['_disqualified'] = extraction.disqualifyDetected
    }

    // Calculate new score
    const scoreResult = calculateScore(mergedData, config)

    // Resolve status transition
    const newStatus = resolveTransition(currentStatus, scoreResult.suggestedStatus)

    // Update database
    await db.query(
      `UPDATE contacts
       SET qualification_data = $1,
           qualification_score = $2,
           qualification_status = COALESCE($3, qualification_status),
           updated_at = NOW()
       WHERE id = $4`,
      [
        JSON.stringify(mergedData),
        scoreResult.totalScore,
        newStatus,
        contactId,
      ],
    )

    // Fire status changed hook if transition happened
    if (newStatus) {
      logger.info(
        { contactId, from: currentStatus, to: newStatus, score: scoreResult.totalScore },
        'Lead qualification status changed',
      )
      await registry.runHook('contact:status_changed', {
        contactId,
        from: currentStatus,
        to: newStatus,
      })
    }

    return {
      success: true,
      data: {
        extracted: true,
        fields: Object.keys(extraction.extracted),
        score: scoreResult.totalScore,
        status: newStatus ?? currentStatus,
        disqualified: scoreResult.disqualified,
        disqualifyReason: scoreResult.disqualifyReason,
      },
    }
  } catch (err) {
    logger.error({ err, contactId }, 'Extraction failed')
    return { success: false, error: 'Extraction failed: ' + String(err) }
  }
}
