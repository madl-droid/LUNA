import type { Pool } from 'pg'
import type { Redis } from 'ioredis'
import type { Registry } from '../../kernel/registry.js'
import type { MemoryManager } from '../../modules/memory/memory-manager.js'
import type {
  ContextBundle,
  DeliveryResult,
  EngineConfig,
  LLMToolDef,
  PipelineResult,
  ToolCatalogEntry,
  ToolDefinition,
} from '../types.js'
import { delivery } from '../boundaries/delivery.js'
import { buildAgenticPrompt, type AgenticPromptOptions } from '../prompts/agentic.js'
import { loadSkillCatalog, filterSkillsByTools } from '../prompts/skills.js'
import { buildSkillReadToolDef } from './skill-delegation.js'
import {
  buildRunSubagentToolDef,
  filterAgenticTools,
  getAgenticSubagentCatalog,
} from './subagent-delegation.js'
import { classifyEffort, postProcess, runAgenticLoop } from './index.js'
import type { AgenticConfig, AgenticResult, EffortLevel } from './types.js'

interface ToolRegistryLike {
  getCatalog(contactType?: string): ToolCatalogEntry[]
  getEnabledToolDefinitions(contactType?: string): ToolDefinition[]
}

export interface AgenticDeliveryInput {
  ctx: ContextBundle
  mode: 'reactive' | 'proactive'
  registry: Registry
  db: Pool
  redis: Redis
  engineConfig: EngineConfig
  totalStart: number
  intakeDurationMs: number
  effortOverride?: EffortLevel
  maxTurnsCap?: number
  promptOptions?: Omit<AgenticPromptOptions, 'subagentCatalog'>
  noActionSentinel?: string
}

export interface AgenticDeliveryOutput {
  pipelineResult: PipelineResult
  agenticResult: AgenticResult
  deliveryResult: DeliveryResult | null
  responseText: string | null
  effortLevel: EffortLevel
  noAction: boolean
}

/**
 * Map effort level to canonical task name.
 * The task router resolves the task to the configured model/provider.
 */
export function getTaskForEffort(effort: EffortLevel): string {
  return effort === 'complex' ? 'complex' : 'main'
}

export function toLLMToolDefs(defs: ToolDefinition[]): LLMToolDef[] {
  return defs.map((d) => ({ name: d.name, description: d.description, inputSchema: d.parameters }))
}

export async function runAgenticDelivery(input: AgenticDeliveryInput): Promise<AgenticDeliveryOutput> {
  const {
    ctx,
    registry,
    db,
    redis,
    engineConfig,
    totalStart,
    intakeDurationMs,
    effortOverride,
    maxTurnsCap,
    promptOptions,
    noActionSentinel,
  } = input

  const classifiedEffort = engineConfig.effortRoutingEnabled ? classifyEffort(ctx) : 'normal'
  const effortLevel = effortOverride ?? classifiedEffort
  const task = getTaskForEffort(effortLevel)

  const toolRegistry = registry.getOptional<ToolRegistryLike>('tools:registry')
  const subagentCatalog = getAgenticSubagentCatalog(ctx, registry)
  const toolCatalog = filterAgenticTools(toolRegistry?.getCatalog(ctx.userType) ?? [], subagentCatalog)
  const toolDefs = filterAgenticTools(toolRegistry?.getEnabledToolDefinitions(ctx.userType) ?? [], subagentCatalog)
  const llmToolDefs = toLLMToolDefs(toolDefs)

  const runSubagentTool = buildRunSubagentToolDef(subagentCatalog)
  if (runSubagentTool) llmToolDefs.push(runSubagentTool)

  const skillCatalog = await loadSkillCatalog(registry, ctx.userType)
  const activeToolNames = new Set(toolCatalog.map((tool) => tool.name))
  const skillsByTools = filterSkillsByTools(skillCatalog, activeToolNames)
  // Filter by user permissions: empty/['*'] = all, otherwise whitelist by name
  const allowedSkills = ctx.userPermissions.skills
  const filteredSkills = (!allowedSkills || allowedSkills.length === 0 || allowedSkills.includes('*'))
    ? skillsByTools
    : skillsByTools.filter(s => allowedSkills.includes(s.name))
  const skillReadTool = buildSkillReadToolDef(filteredSkills.map((skill) => skill.name))
  if (skillReadTool) llmToolDefs.push(skillReadTool)

  const agenticPrompt = await buildAgenticPrompt(ctx, toolCatalog, registry, {
    ...promptOptions,
    subagentCatalog,
  })

  const agenticConfig: AgenticConfig = {
    maxToolTurns: maxTurnsCap ? Math.min(engineConfig.agenticMaxTurns, maxTurnsCap) : engineConfig.agenticMaxTurns,
    maxConcurrentTools: engineConfig.maxConcurrentSteps,
    effort: effortLevel,
    task,
    maxOutputTokens: engineConfig.maxOutputTokens,
    criticizerMode: engineConfig.criticizerMode,
  }

  const agenticResult = await runAgenticLoop(
    ctx,
    agenticPrompt.system,
    llmToolDefs,
    agenticConfig,
    registry,
    engineConfig,
    agenticPrompt.userMessage,
  )

  const noAction = noActionSentinel !== undefined && agenticResult.responseText.trim() === noActionSentinel
  if (noAction) {
    return {
      pipelineResult: {
        traceId: ctx.traceId,
        success: true,
        intakeDurationMs,
        deliveryDurationMs: 0,
        totalDurationMs: Date.now() - totalStart,
        agenticResult,
        effortLevel,
      },
      agenticResult,
      deliveryResult: null,
      responseText: null,
      effortLevel,
      noAction: true,
    }
  }

  const composed = await postProcess(agenticResult, ctx, engineConfig, registry)
  const deliveryStart = Date.now()
  const deliveryResult = await delivery(ctx, composed, registry, db, redis, engineConfig)
  const deliveryDurationMs = Date.now() - deliveryStart
  const totalDurationMs = Date.now() - totalStart

  const memMgr = registry.getOptional<MemoryManager>('memory:manager')
  if (memMgr) {
    memMgr.savePipelineLog({
      messageId: input.mode === 'proactive' ? ctx.traceId : ctx.message.id,
      contactId: ctx.contactId ?? null,
      sessionId: ctx.session.id,
      intakeMs: intakeDurationMs,
      deliveryMs: deliveryDurationMs,
      totalMs: totalDurationMs,
      toolsCalled: agenticResult.toolsUsed,
    }).catch(() => {})
  }

  return {
      pipelineResult: {
      traceId: ctx.traceId,
      success: deliveryResult.sent,
      intakeDurationMs,
      deliveryDurationMs,
      totalDurationMs,
      responseText: composed.responseText,
      deliveryResult,
      agenticResult,
      effortLevel,
    },
    agenticResult,
    deliveryResult,
    responseText: composed.responseText,
    effortLevel,
    noAction: false,
  }
}
