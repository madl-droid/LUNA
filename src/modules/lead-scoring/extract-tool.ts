// LUNA — Module: lead-scoring — Extract Qualification Tool (v3)
// Tool registered in tools:registry to extract qualification data from conversation.
// Single-framework: uses config.criteria and config.stages directly.
// LLM extraction preserved here; Plan 2 will refactor to code-only.

import type { Registry } from '../../kernel/registry.js'
import type { PromptsService } from '../prompts/types.js'
import type { ToolRegistration, ToolExecutionContext } from '../tools/types.js'
import type { ToolRegistry } from '../tools/tool-registry.js'
import type {
  QualifyingConfig,
  ExtractionResult,
  FrameworkStage,
  QualificationStatus,
} from './types.js'
import type { ConfigStore } from './config-store.js'
import {
  calculateScore,
  mergeQualificationData,
  resolveTransition,
  getCurrentStage,
} from './scoring-engine.js'
import pino from 'pino'

const logger = pino({ name: 'lead-scoring:extract-tool' })

// ═══════════════════════════════════════════
// Prompt cache for static parts
// ═══════════════════════════════════════════

const promptCache = new Map<string, string>()

/** Clear the static prompt cache (called on config change) */
export function clearExtractionPromptCache(): void {
  promptCache.clear()
}

/**
 * Build the static part of the extraction prompt (criteria, stages, rules).
 * Cached per config fingerprint — only rebuilt on config change.
 */
function buildStaticPromptPart(config: QualifyingConfig): string {
  const cacheKey = `${config.preset}:${JSON.stringify(config.criteria.map(c => c.key))}`
  const cached = promptCache.get(cacheKey)
  if (cached) return cached

  const sortedStages = [...(config.stages ?? [])].sort((a, b) => a.order - b.order)
  const stageBlocks = sortedStages.map(stage => {
    const stageCriteria = config.criteria.filter(c => c.stage === stage.key)
    if (stageCriteria.length === 0) return ''

    const header = `\n## ${stage.name.en} (${stage.key})`
    const desc = stage.description.en

    const fields = stageCriteria.map(c => {
      let line = `  - ${c.key} (${c.type}): ${c.name.en}`
      if (c.type === 'enum' && c.options) {
        line += ` [options: ${c.options.join(', ')}]`
      }
      if (c.neverAskDirectly) {
        line += ' [NEVER ASK DIRECTLY — infer only]'
      }
      return line
    }).join('\n')

    return `${header}\n${desc}\n${fields}`
  }).filter(Boolean)

  // Include unstaged criteria
  const unstaggedCriteria = config.criteria.filter(c => !c.stage)
  if (unstaggedCriteria.length > 0) {
    const unstaggedFields = unstaggedCriteria.map(c => {
      let line = `  - ${c.key} (${c.type}): ${c.name.en}`
      if (c.type === 'enum' && c.options) {
        line += ` [options: ${c.options.join(', ')}]`
      }
      if (c.neverAskDirectly) {
        line += ' [NEVER ASK DIRECTLY — infer only]'
      }
      return line
    }).join('\n')
    stageBlocks.push(`\n## General\n${unstaggedFields}`)
  }

  const criteriaSection = stageBlocks.join('\n')

  const disqualifyList = config.disqualifyReasons.map(d =>
    `- ${d.key}: ${d.name.en}`
  ).join('\n')

  const result = `CRITERIA TO EXTRACT:
${criteriaSection}

DISQUALIFICATION REASONS (set disqualifyDetected if any detected):
${disqualifyList}`

  promptCache.set(cacheKey, result)
  return result
}

/**
 * Build the dynamic part: existing values + current stage focus.
 */
function buildDynamicPromptPart(
  config: QualifyingConfig,
  existingData: Record<string, unknown>,
  currentStage: FrameworkStage | null,
): string {
  const parts: string[] = []

  // Already known values
  const known: string[] = []
  for (const c of config.criteria) {
    const val = existingData[c.key]
    if (val !== undefined && val !== null && val !== '') {
      known.push(`  - ${c.key}: ${JSON.stringify(val)}`)
    }
  }
  if (known.length > 0) {
    parts.push(`\nALREADY KNOWN VALUES:\n${known.join('\n')}`)
  }

  // Current stage focus
  if (currentStage) {
    parts.push(`\nCURRENT STAGE FOCUS: "${currentStage.name.en}" — ${currentStage.description.en}`)
    parts.push('Prioritize extracting fields from this stage, but also capture any info for other stages if clearly present.')
  }

  return parts.join('\n')
}

/**
 * Build the full extraction prompt.
 */
async function buildExtractionPrompt(
  config: QualifyingConfig,
  existingData: Record<string, unknown>,
  currentStage: FrameworkStage | null,
  registry?: Registry,
): Promise<string> {
  const staticPart = buildStaticPromptPart(config)
  const dynamicPart = buildDynamicPromptPart(config, existingData, currentStage)

  // Try to load from template first
  if (registry) {
    const svc = registry.getOptional<PromptsService>('prompts:service')
    if (svc) {
      const tmpl = await svc.getSystemPrompt('lead-scoring-extraction', {
        staticPart,
        dynamicPart,
      })
      if (tmpl) return tmpl
    }
  }

  return `You are an extraction assistant for lead qualification.
Your ONLY job is to extract structured data from the conversation.
DO NOT generate responses — only extract data.
${staticPart}
${dynamicPart}

RULES:
1. Only extract information that is CLEARLY stated or strongly implied.
2. Do not guess or infer weak signals.
3. For enum types, map to the closest option or leave null.
4. For text types, extract the relevant phrase or summary.
5. For boolean types, set true/false only if clearly indicated.
6. Include a confidence score (0.0-1.0) for each extracted field.
7. If a disqualification signal is detected, set disqualifyDetected to the reason key.
8. Only include fields you actually found data for — do not include null fields.
9. Extract data from ANY stage if present, not just the current focus stage.
10. Do NOT re-extract values that are already known unless new info contradicts them.

Respond ONLY with valid JSON matching this schema:
{
  "extracted": { "key": "value", ... },
  "confidence": { "key": 0.0-1.0, ... },
  "disqualifyDetected": "reason_key or null"
}`
}

/**
 * Register the extract_qualification tool in the tools registry.
 * The tool description is dynamic — reflects active criteria.
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
          message_text: {
            type: 'string',
            description: 'The conversation messages to extract qualification data from (last N messages)',
          },
        },
        required: ['message_text'],
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
 * Build a dynamic tool description that reflects the active criteria.
 */
function buildToolDescription(configStore: ConfigStore): string {
  const config = configStore.getConfig()

  if (config.criteria.length === 0) {
    return 'Extrae datos de calificación de leads. No hay criterios configurados.'
  }

  const presetLabel = config.preset ? config.preset.toUpperCase() : 'CUSTOM'
  const criteriaNames = config.criteria
    .filter(c => !c.neverAskDirectly)
    .slice(0, 6)
    .map(c => c.name.en)

  return `Extrae datos de calificación de leads. Framework: ${presetLabel}. Busca señales de: ${criteriaNames.join(', ')}. Dispara cuando el contacto mencione su problema, necesidad, presupuesto, urgencia, rol o contexto relevante.`
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
  const contactId = ctx.contactId

  if (!messageText) {
    return { success: false, error: 'Missing message_text' }
  }
  if (!contactId) {
    return { success: false, error: 'Missing contactId in execution context' }
  }

  const config = configStore.getConfig()
  const db = ctx.db

  if (config.criteria.length === 0) {
    return { success: true, data: { extracted: false, reason: 'no_criteria_configured' } }
  }

  // Load existing qualification data from agent_contacts
  const contactRow = await db.query(
    `SELECT ac.qualification_data, ac.lead_status, ac.qualification_score
     FROM agent_contacts ac
     WHERE ac.contact_id = $1`,
    [contactId],
  )

  if (contactRow.rows.length === 0) {
    return { success: false, error: 'Agent-contact relationship not found' }
  }

  const row = contactRow.rows[0]!
  const existingData = (row.qualification_data as Record<string, unknown>) ?? {}
  const currentStatus = (row.lead_status as QualificationStatus) ?? 'new'

  // Determine current stage for focused extraction
  const currentStage = getCurrentStage(existingData, config)

  // Build prompt and call LLM
  const systemPrompt = await buildExtractionPrompt(config, existingData, currentStage, registry)

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
      return { success: true, data: { extracted: false, reason: 'no_relevant_info' } }
    }

    // Transactional merge
    const client = await db.connect()
    let mergedData: Record<string, unknown>
    let scoreResult: ReturnType<typeof calculateScore>
    let newStatus: QualificationStatus | null
    try {
      await client.query('BEGIN')
      const freshRow = await client.query(
        `SELECT qualification_data, lead_status FROM agent_contacts
         WHERE contact_id = $1
         FOR UPDATE`,
        [contactId],
      )
      const freshData = (freshRow.rows[0]?.qualification_data as Record<string, unknown>) ?? {}
      const freshStatus = (freshRow.rows[0]?.lead_status as QualificationStatus) ?? currentStatus

      mergedData = mergeQualificationData(
        freshData,
        extraction.extracted,
        extraction.confidence ?? {},
        config.minConfidence ?? 0.4,
      )

      if (extraction.disqualifyDetected) {
        mergedData['_disqualified'] = extraction.disqualifyDetected
      }

      scoreResult = calculateScore(mergedData, config)
      newStatus = resolveTransition(freshStatus, scoreResult.suggestedStatus)

      await client.query(
        `UPDATE agent_contacts
         SET qualification_data = $1,
             qualification_score = $2,
             lead_status = COALESCE($3, lead_status),
             updated_at = NOW()
         WHERE contact_id = $4`,
        [
          JSON.stringify(mergedData),
          scoreResult.totalScore,
          newStatus,
          contactId,
        ],
      )
      await client.query('COMMIT')
    } catch (txErr) {
      await client.query('ROLLBACK')
      throw txErr
    } finally {
      client.release()
    }

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
        preset: config.preset,
        currentStage: currentStage?.key ?? null,
        stageScores: scoreResult.stageScores,
        disqualified: scoreResult.disqualified,
        disqualifyReason: scoreResult.disqualifyReason,
      },
    }
  } catch (err) {
    logger.error({ err, contactId }, 'Extraction failed')
    return { success: false, error: 'Extraction failed: ' + String(err) }
  }
}
