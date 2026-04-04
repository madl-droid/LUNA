// LUNA — Module: lead-scoring — Extract Qualification Tool
// Tool que se registra en tools:registry para extraer datos de calificación
// de la conversación. Framework-aware: adapts extraction prompt to active framework.
// Supports multi-framework with client_type detection and directo flow.
// Receives conversation buffer (not just single message) for better context.

import type { Registry } from '../../kernel/registry.js'
import type { PromptsService } from '../prompts/types.js'
import type { ToolRegistration, ToolExecutionContext } from '../tools/types.js'
import type { ToolRegistry } from '../tools/tool-registry.js'
import type {
  QualifyingConfig,
  FrameworkConfig,
  ExtractionResult,
  FrameworkStage,
  ClientType,
  QualificationStatus,
} from './types.js'
import type { ConfigStore } from './config-store.js'
import {
  calculateScore,
  mergeQualificationData,
  resolveTransition,
  getCurrentStage,
  resolveFramework,
} from './scoring-engine.js'
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
}

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
 * Cached per framework type — only rebuilt on config change.
 */
function buildStaticPromptPart(fw: FrameworkConfig): string {
  const cacheKey = `${fw.type}:${JSON.stringify(fw.criteria.map(c => c.key))}`
  const cached = promptCache.get(cacheKey)
  if (cached) return cached

  const frameworkCtx = FRAMEWORK_CONTEXT[fw.type]?.en ?? ''

  const sortedStages = [...(fw.stages ?? [])].sort((a, b) => a.order - b.order)
  const stageBlocks = sortedStages.map(stage => {
    const stageCriteria = fw.criteria.filter(c => c.stage === stage.key)
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

  const criteriaSection = stageBlocks.join('\n')

  const disqualifyList = fw.disqualifyReasons.map(d =>
    `- ${d.key}: ${d.name.en}`
  ).join('\n')

  const result = `${frameworkCtx.length > 0 ? frameworkCtx + '\n' : ''}
CRITERIA TO EXTRACT:
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
  fw: FrameworkConfig,
  existingData: Record<string, unknown>,
  currentStage: FrameworkStage | null,
): string {
  const parts: string[] = []

  // Already known values
  const known: string[] = []
  for (const c of fw.criteria) {
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
 * Build client_type detection prompt for multi-framework mode.
 */
function buildClientTypeDetectionPrompt(activeFrameworks: FrameworkConfig[]): string {
  const fwList = activeFrameworks.map(f => {
    const ctx = FRAMEWORK_CONTEXT[f.type]
    return `- ${f.type}: ${ctx?.en ?? f.type}`
  }).join('\n')

  return `You are a client type classifier. Determine what type of client this is.

Active frameworks:
${fwList}

Based on the conversation, classify the client type:
- "b2b" if they represent a company/business
- "b2c" if they are an individual consumer/person
- "b2g" if they represent a government entity/institution

Respond ONLY with valid JSON:
{
  "clientTypeDetected": "b2b" | "b2c" | "b2g" | null,
  "confidence": 0.0-1.0,
  "extracted": {},
  "confidence_map": {}
}

Set clientTypeDetected to null ONLY if there is truly not enough information to determine client type.`
}

/**
 * Build the full extraction prompt.
 */
async function buildExtractionPrompt(
  fw: FrameworkConfig,
  existingData: Record<string, unknown>,
  currentStage: FrameworkStage | null,
  registry?: Registry,
): Promise<string> {
  const staticPart = buildStaticPromptPart(fw)
  const dynamicPart = buildDynamicPromptPart(fw, existingData, currentStage)

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
10. Do NOT re-extract values that are already known unless the new information contradicts them.

Respond ONLY with valid JSON matching this schema:
{
  "extracted": { "key": "value", ... },
  "confidence": { "key": 0.0-1.0, ... },
  "disqualifyDetected": "reason_key or null"
}`
}

/**
 * Register the extract_qualification tool in the tools registry.
 * The tool description is dynamic — reflects active frameworks and criteria.
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
 * Build a dynamic tool description that reflects active frameworks.
 * This is what the evaluator LLM sees to decide when to trigger extraction.
 */
function buildToolDescription(configStore: ConfigStore): string {
  const config = configStore.getConfig()
  const active = config.frameworks.filter(f => f.enabled)

  if (active.length === 0) {
    return 'Extrae datos de calificación de leads. No hay frameworks activos.'
  }

  const fwNames = active.map(f => {
    const names: Record<string, string> = {
      champ: 'CHAMP (B2B: challenges, authority, money, prioritization)',
      spin: 'SPIN (B2C: situation, problem, implication, need-payoff)',
      champ_gov: 'CHAMP+Gov (B2G: CHAMP + process + compliance)',
    }
    return names[f.type] ?? f.type
  })

  const criteriaNames = active.flatMap(f =>
    f.criteria.filter(c => !c.neverAskDirectly).slice(0, 4).map(c => c.name.en)
  ).slice(0, 6)

  return `Extrae datos de calificación de leads. Frameworks activos: ${fwNames.join(', ')}. Busca señales de: ${criteriaNames.join(', ')}. Dispara cuando el contacto mencione su problema, empresa, presupuesto, urgencia, rol, o contexto relevante.`
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

  // Determine active frameworks
  const active = config.frameworks.filter(f => f.enabled)
  if (active.length === 0) {
    return { success: true, data: { extracted: false, reason: 'no_active_frameworks' } }
  }

  // Multi-framework: detect client type first if unknown
  const clientType = existingData['_client_type'] as ClientType | undefined
  if (!clientType && active.length > 1) {
    const detection = await handleClientTypeDetection(messageText, contactId, existingData, currentStatus, config, db, registry)
    if (!detection.success) return detection
    // If client type was detected, update existingData in memory so resolveFramework works
    const detectedType = (detection.data as Record<string, unknown> | undefined)?.clientTypeDetected
    if (detectedType) {
      existingData['_client_type'] = detectedType
    } else {
      // Could not determine client type — return without extracting
      return detection
    }
    // Fall through to normal extraction with the now-known client type
  }

  // Resolve framework
  const fw = resolveFramework(config, existingData)
  if (!fw) {
    return { success: true, data: { extracted: false, reason: 'no_framework_resolved' } }
  }

  // Determine current stage for focused extraction
  const currentStage = getCurrentStage(existingData, fw)

  // Build prompt and call LLM
  const systemPrompt = await buildExtractionPrompt(fw, existingData, currentStage, registry)

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
        config.minConfidence ?? 0.3,
      )

      if (extraction.disqualifyDetected) {
        mergedData['_disqualified'] = extraction.disqualifyDetected
      }

      scoreResult = calculateScore(mergedData, config, fw)
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
        framework: fw.type,
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

/**
 * Handle client type detection in multi-framework mode.
 * First extraction in multi-framework always tries to detect client type.
 */
async function handleClientTypeDetection(
  messageText: string,
  contactId: string,
  _existingData: Record<string, unknown>,
  currentStatus: QualificationStatus,
  config: QualifyingConfig,
  db: import('pg').Pool,
  registry: Registry,
): Promise<{ success: boolean; data?: unknown; error?: string }> {
  const active = config.frameworks.filter(f => f.enabled)
  const systemPrompt = buildClientTypeDetectionPrompt(active)

  try {
    const llmResult = await registry.callHook('llm:chat', {
      task: 'extract_qualification',
      system: systemPrompt,
      messages: [{ role: 'user', content: messageText }],
      temperature: 0.1,
      maxTokens: 200,
    })

    if (!llmResult?.text) {
      return { success: true, data: { extracted: false, reason: 'client_type_detection_failed' } }
    }

    const cleaned = llmResult.text.replace(/```json?\n?/g, '').replace(/```/g, '').trim()
    let parsed: { clientTypeDetected?: ClientType | null; confidence?: number }
    try {
      parsed = JSON.parse(cleaned) as { clientTypeDetected?: ClientType | null; confidence?: number }
    } catch {
      return { success: true, data: { extracted: false, reason: 'client_type_parse_failed' } }
    }

    if (!parsed.clientTypeDetected) {
      return { success: true, data: { extracted: false, reason: 'client_type_not_determined' } }
    }

    // Save client type
    const client = await db.connect()
    try {
      await client.query('BEGIN')
      const freshRow = await client.query(
        `SELECT qualification_data, lead_status FROM agent_contacts
         WHERE contact_id = $1
         FOR UPDATE`,
        [contactId],
      )
      const freshData = (freshRow.rows[0]?.qualification_data as Record<string, unknown>) ?? {}
      freshData['_client_type'] = parsed.clientTypeDetected

      await client.query(
        `UPDATE agent_contacts
         SET qualification_data = $1, updated_at = NOW()
         WHERE contact_id = $2`,
        [JSON.stringify(freshData), contactId],
      )
      await client.query('COMMIT')
    } catch (txErr) {
      await client.query('ROLLBACK')
      throw txErr
    } finally {
      client.release()
    }

    logger.info({ contactId, clientType: parsed.clientTypeDetected }, 'Client type detected')

    return {
      success: true,
      data: {
        extracted: true,
        clientTypeDetected: parsed.clientTypeDetected,
        status: currentStatus,
      },
    }
  } catch (err) {
    logger.error({ err, contactId }, 'Client type detection failed')
    return { success: false, error: 'Client type detection failed: ' + String(err) }
  }
}
