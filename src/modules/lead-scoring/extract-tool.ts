// LUNA — Module: lead-scoring — Extract Qualification Tool (v3, code-only)
// Tool registered in tools:registry to register extracted qualification data.
// Zero LLM: the agentic loop extracts data as part of its reasoning and passes
// structured parameters to this tool. Tool only does merge + score + transition.

import type { Registry } from '../../kernel/registry.js'
import type { ToolRegistration, ToolExecutionContext } from '../tools/types.js'
import type { ToolRegistry } from '../tools/tool-registry.js'
import type { QualificationStatus } from './types.js'
import type { ConfigStore } from './config-store.js'
import {
  calculateScore,
  mergeQualificationData,
  resolveTransition,
} from './scoring-engine.js'
import pino from 'pino'

const logger = pino({ name: 'lead-scoring:extract-tool' })

/**
 * Build a dynamic tool description reflecting active criteria.
 * Called once at registration time (and on re-registration after config change).
 */
function buildToolDescription(configStore: ConfigStore): string {
  const config = configStore.getConfig()

  if (config.criteria.length === 0) {
    return 'Registra datos de calificación de leads. No hay criterios configurados.'
  }

  const criteriaDesc = config.criteria
    .filter(c => !c.neverAskDirectly)
    .map(c => {
      let desc = `${c.key} (${c.type}): ${c.name.en}`
      if (c.type === 'enum' && c.options) {
        desc += ` [${c.options.join(', ')}]`
      }
      return desc
    })
    .join('; ')

  const neverAsk = config.criteria
    .filter(c => c.neverAskDirectly)
    .map(c => c.name.en)
    .join(', ')

  let desc = `Registra datos de calificación extraídos de la conversación. `
  desc += `Dispara cuando el contacto mencione información relevante para calificar. `
  desc += `Criterios: ${criteriaDesc}. `
  if (neverAsk) {
    desc += `Criterios de inferencia (nunca preguntar directo, solo registrar si el lead lo menciona): ${neverAsk}. `
  }
  desc += `Incluir solo datos claramente expresados con confianza >= 0.4. No adivinar.`

  return desc
}

/**
 * Register the extract_qualification tool in the tools registry.
 * The agentic loop extracts data as part of its reasoning — this tool only
 * persists the structured result (merge + score + state transition).
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
      description: buildToolDescription(configStore),
      category: 'qualification',
      sourceModule: 'lead-scoring',
      parameters: {
        type: 'object',
        properties: {
          extracted: {
            type: 'object',
            description: 'Key-value pairs of extracted qualification data. Keys must match criterion keys from the qualification config. Values should be strings for text/enum types, booleans for boolean types.',
          },
          confidence: {
            type: 'object',
            description: 'Confidence scores (0.0-1.0) for each extracted field. Keys match the extracted object keys.',
          },
          disqualify_reason: {
            type: 'string',
            description: 'If a disqualification signal is detected, set to the reason key (e.g. "not_interested", "spam", "out_of_zone"). Otherwise omit.',
          },
        },
        required: ['extracted', 'confidence'],
      },
    },
    handler: async (input, ctx) => {
      return await handleExtraction(input, ctx, configStore, registry)
    },
  }

  await toolRegistry.registerTool(registration)
  logger.info('extract_qualification tool registered (code-only, zero LLM)')
}

/**
 * Handle extraction: validate keys, merge with existing data, recalculate
 * score, apply state transition. Zero LLM calls.
 */
async function handleExtraction(
  input: Record<string, unknown>,
  ctx: ToolExecutionContext,
  configStore: ConfigStore,
  registry: Registry,
): Promise<{ success: boolean; data?: unknown; error?: string }> {
  const extracted = input['extracted'] as Record<string, unknown> | undefined
  const confidence = input['confidence'] as Record<string, number> | undefined
  const disqualifyReason = input['disqualify_reason'] as string | undefined
  const contactId = ctx.contactId

  if (!extracted || Object.keys(extracted).length === 0) {
    return { success: true, data: { extracted: false, reason: 'no_data_provided' } }
  }
  if (!contactId) {
    return { success: false, error: 'Missing contactId in execution context' }
  }

  const config = configStore.getConfig()

  if (config.criteria.length === 0) {
    return { success: true, data: { extracted: false, reason: 'no_criteria_configured' } }
  }

  // Validate keys against configured criteria
  const validKeys = new Set(config.criteria.map(c => c.key))
  const validExtracted: Record<string, unknown> = {}
  const validConfidence: Record<string, number> = {}

  for (const [key, value] of Object.entries(extracted)) {
    if (validKeys.has(key)) {
      validExtracted[key] = value
      validConfidence[key] = confidence?.[key] ?? 0.5
    } else {
      logger.debug({ key }, 'Ignoring extracted key not in criteria config')
    }
  }

  if (Object.keys(validExtracted).length === 0) {
    return { success: true, data: { extracted: false, reason: 'no_valid_keys' } }
  }

  // Transactional merge + score + transition
  const db = ctx.db
  const client = await db.connect()
  try {
    await client.query('BEGIN')

    const freshRow = await client.query(
      `SELECT qualification_data, lead_status FROM agent_contacts
       WHERE contact_id = $1 FOR UPDATE`,
      [contactId],
    )

    const freshData = (freshRow.rows[0]?.qualification_data as Record<string, unknown>) ?? {}
    const freshStatus = (freshRow.rows[0]?.lead_status as QualificationStatus) ?? 'new'

    // Merge extracted data into existing
    const mergedData = mergeQualificationData(
      freshData,
      validExtracted,
      validConfidence,
      config.minConfidence ?? 0.4,
    )

    if (disqualifyReason) {
      mergedData['_disqualified'] = disqualifyReason
    }

    // Recalculate score (with decay applied inside calculateScore)
    const scoreResult = calculateScore(mergedData, config)
    const newStatus = resolveTransition(freshStatus, scoreResult.suggestedStatus)

    await client.query(
      `UPDATE agent_contacts
       SET qualification_data = $1,
           qualification_score = $2,
           lead_status = COALESCE($3, lead_status),
           updated_at = NOW()
       WHERE contact_id = $4`,
      [JSON.stringify(mergedData), scoreResult.totalScore, newStatus, contactId],
    )
    await client.query('COMMIT')

    if (newStatus) {
      logger.info(
        { contactId, from: freshStatus, to: newStatus, score: scoreResult.totalScore },
        'Lead qualification status changed',
      )
      await registry.runHook('contact:status_changed', {
        contactId,
        from: freshStatus,
        to: newStatus,
      })
    }

    return {
      success: true,
      data: {
        extracted: true,
        fields: Object.keys(validExtracted),
        score: scoreResult.totalScore,
        status: newStatus ?? freshStatus,
        disqualified: scoreResult.disqualified,
      },
    }
  } catch (txErr) {
    await client.query('ROLLBACK')
    logger.error({ err: txErr, contactId }, 'Extraction merge failed')
    return { success: false, error: 'Extraction merge failed: ' + String(txErr) }
  } finally {
    client.release()
  }
}
