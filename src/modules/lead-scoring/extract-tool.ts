// LUNA — Module: lead-scoring — Extract Qualification Tool
// Tool que se registra en tools:registry para extraer datos de calificación
// de la conversación. Se activa en Phase 2 cuando el evaluador detecta info relevante.
// Framework-aware: adapts extraction prompt to active framework and current stage.

import type { Registry } from '../../kernel/registry.js'
import type { PromptsService } from '../prompts/types.js'
import type { ToolRegistration, ToolExecutionContext } from '../tools/types.js'
import type { ToolRegistry } from '../tools/tool-registry.js'
import type { QualifyingConfig, ExtractionResult, FrameworkStage } from './types.js'
import type { ConfigStore } from './config-store.js'
import { calculateScore, mergeQualificationData, resolveTransition, getCurrentStage } from './scoring-engine.js'
import type { QualificationStatus } from './types.js'
import pino from 'pino'

const logger = pino({ name: 'lead-scoring:extract-tool' })

// ═══════════════════════════════════════════
// Framework-specific extraction context
// ═══════════════════════════════════════════

const FRAMEWORK_CONTEXT: Record<string, { es: string; en: string }> = {
  champ: {
    es: 'Estás calificando un lead B2B usando el framework CHAMP (Challenges, Authority, Money, Prioritization).',
    en: 'You are qualifying a B2B lead using the CHAMP framework (Challenges, Authority, Money, Prioritization).',
  },
  spin: {
    es: 'Estás calificando un lead B2C usando SPIN Selling (Situación, Problema, Implicación, Cierre). La conversación avanza naturalmente por las etapas.',
    en: 'You are qualifying a B2C lead using SPIN Selling (Situation, Problem, Implication, Need-payoff). The conversation progresses naturally through stages.',
  },
  champ_gov: {
    es: 'Estás calificando un lead B2G (gobierno) usando CHAMP + Gov. Incluye etapas de proceso de compra pública y encaje normativo.',
    en: 'You are qualifying a B2G (government) lead using CHAMP + Gov. Includes procurement process stages and compliance fit.',
  },
  custom: {
    es: 'Estás calificando un lead usando criterios personalizados.',
    en: 'You are qualifying a lead using custom criteria.',
  },
}

/**
 * Builds the system prompt for the extraction LLM call.
 * Framework-aware: includes stage context and focuses on relevant criteria.
 * Tries to load from template first, falls back to hardcoded prompt.
 */
async function buildExtractionPrompt(
  config: QualifyingConfig,
  existingData: Record<string, unknown>,
  currentStage: FrameworkStage | null,
  registry?: Registry,
): Promise<string> {
  const frameworkCtx = FRAMEWORK_CONTEXT[config.framework] ?? FRAMEWORK_CONTEXT['custom']!

  // Group criteria by stage for better prompt structure
  let criteriaSection: string

  if (config.stages && config.stages.length > 0) {
    const sortedStages = [...config.stages].sort((a, b) => a.order - b.order)
    const stageBlocks = sortedStages.map(stage => {
      const stageCriteria = config.criteria.filter(c => c.stage === stage.key)
      if (stageCriteria.length === 0) return ''

      const isCurrent = currentStage?.key === stage.key
      const header = `\n## ${stage.name.en} (${stage.key})${isCurrent ? ' ← CURRENT FOCUS' : ''}`
      const desc = `${stage.description.en}`

      const fields = stageCriteria.map(c => {
        const filled = existingData[c.key] !== undefined && existingData[c.key] !== null
        let line = `  - ${c.key} (${c.type}): ${c.name.en}`
        if (c.type === 'enum' && c.options) {
          line += ` [options: ${c.options.join(', ')}]`
        }
        if (filled) {
          line += ` [ALREADY KNOWN: ${JSON.stringify(existingData[c.key])}]`
        }
        if (c.neverAskDirectly) {
          line += ' [NEVER ASK DIRECTLY]'
        }
        return line
      }).join('\n')

      return `${header}\n${desc}\n${fields}`
    }).filter(Boolean)

    criteriaSection = stageBlocks.join('\n')
  } else {
    // Flat criteria (custom framework, no stages)
    criteriaSection = config.criteria.map(c => {
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
  }

  const disqualifyList = config.disqualifyReasons.map(d =>
    `- ${d.key}: ${d.name.en}`
  ).join('\n')

  const stageInstruction = currentStage
    ? `\nCURRENT STAGE FOCUS: "${currentStage.name.en}" — ${currentStage.description.en}\nPrioritize extracting fields from this stage, but also capture any info for other stages if clearly present.`
    : ''

  // Try to load from template first
  if (registry) {
    const svc = registry.getOptional<PromptsService>('prompts:service')
    if (svc) {
      const tmpl = await svc.getSystemPrompt('lead-scoring-extraction', {
        frameworkContext: frameworkCtx.en,
        stageInstruction,
        criteriaSection,
        disqualifyList,
      })
      if (tmpl) return tmpl
    }
  }

  // Fallback to hardcoded prompt
  return `You are an extraction assistant for lead qualification.
${frameworkCtx.en}
Your ONLY job is to extract structured data from the conversation message.
DO NOT generate responses — only extract data.
${stageInstruction}

CRITERIA TO EXTRACT:
${criteriaSection}

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
9. Extract data from ANY stage if present, not just the current focus stage.

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

  // Load existing qualification data from agent_contacts
  const agentSlug = ctx.agentId ?? 'luna'
  const contactRow = await db.query(
    `SELECT ac.qualification_data, ac.lead_status, ac.qualification_score
     FROM agent_contacts ac
     WHERE ac.contact_id = $1
       AND ac.agent_id = (SELECT id FROM agents WHERE slug = $2 LIMIT 1)`,
    [contactId, agentSlug],
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
      // Nothing extracted — not an error, just no relevant info
      return { success: true, data: { extracted: false, reason: 'no_relevant_info' } }
    }

    // FIX: LS-1 — Re-read under FOR UPDATE to prevent lost writes from concurrent extractions
    const client = await db.connect()
    let mergedData: Record<string, unknown>
    let scoreResult: ReturnType<typeof calculateScore>
    let newStatus: QualificationStatus | null
    try {
      await client.query('BEGIN')
      const freshRow = await client.query(
        `SELECT qualification_data, lead_status FROM agent_contacts
         WHERE contact_id = $1 AND agent_id = (SELECT id FROM agents WHERE slug = $2 LIMIT 1)
         FOR UPDATE`,
        [contactId, agentSlug],
      )
      const freshData = (freshRow.rows[0]?.qualification_data as Record<string, unknown>) ?? {}
      const freshStatus = (freshRow.rows[0]?.lead_status as QualificationStatus) ?? currentStatus

      // Merge new data with fresh existing (respecting minConfidence threshold)
      mergedData = mergeQualificationData(
        freshData,
        extraction.extracted,
        extraction.confidence ?? {},
        config.minConfidence ?? 0.3,
      )

      // Handle disqualification
      if (extraction.disqualifyDetected) {
        mergedData['_disqualified'] = extraction.disqualifyDetected
      }

      // Calculate new score
      scoreResult = calculateScore(mergedData, config)

      // Resolve status transition
      newStatus = resolveTransition(freshStatus, scoreResult.suggestedStatus)

      // Update database (agent_contacts)
      await client.query(
        `UPDATE agent_contacts
         SET qualification_data = $1,
             qualification_score = $2,
             lead_status = COALESCE($3, lead_status),
             updated_at = NOW()
         WHERE contact_id = $4
           AND agent_id = (SELECT id FROM agents WHERE slug = $5 LIMIT 1)`,
        [
          JSON.stringify(mergedData),
          scoreResult.totalScore,
          newStatus,
          contactId,
          agentSlug,
        ],
      )
      await client.query('COMMIT')
    } catch (txErr) {
      await client.query('ROLLBACK')
      throw txErr
    } finally {
      client.release()
    }

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
        framework: config.framework,
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
