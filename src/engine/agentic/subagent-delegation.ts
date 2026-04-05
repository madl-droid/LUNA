import type { Registry } from '../../kernel/registry.js'
import type {
  ContextBundle,
  EngineConfig,
  ExecutionStep,
  LLMToolDef,
  ToolDefinition,
} from '../types.js'
import type { SubagentCatalogEntry } from '../../modules/subagents/types.js'
import { runSubagentV2 } from '../subagent/subagent.js'

export const RUN_SUBAGENT_TOOL_NAME = 'run_subagent'

interface SubagentCatalogReader {
  getEnabledTypes(): SubagentCatalogEntry[]
}

interface ToolRegistryReader {
  getEnabledToolDefinitions(contactType?: string): ToolDefinition[]
}

export function getAgenticSubagentCatalog(
  ctx: ContextBundle,
  registry: Registry,
): SubagentCatalogEntry[] {
  if (!ctx.userPermissions.subagents) return []
  const catalog = registry.getOptional<SubagentCatalogReader>('subagents:catalog')
  const all = catalog?.getEnabledTypes() ?? []
  // Filter by allowed list: undefined/empty = all, otherwise whitelist by slug
  const allowed = ctx.userPermissions.allowedSubagents
  if (!allowed || allowed.length === 0) return all
  return all.filter(sa => allowed.includes(sa.slug))
}

export function filterAgenticTools<T extends { name: string }>(
  tools: T[],
  subagentCatalog: SubagentCatalogEntry[],
): T[] {
  // Collect ALL exclusive tools from ALL enabled subagents — these are
  // removed from the main agent so the LLM is forced to delegate via run_subagent.
  const exclusive = new Set<string>()
  for (const sa of subagentCatalog) {
    for (const tool of sa.exclusiveTools) exclusive.add(tool)
  }
  if (exclusive.size === 0) return tools
  return tools.filter(tool => !exclusive.has(tool.name))
}

export function buildRunSubagentToolDef(
  subagentCatalog: SubagentCatalogEntry[],
): LLMToolDef | null {
  if (subagentCatalog.length === 0) return null

  return {
    name: RUN_SUBAGENT_TOOL_NAME,
    description: 'Delega una tarea a un subagente especializado. Usa esto para investigación web, trabajo multi-herramienta o tareas autónomas largas.',
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      properties: {
        subagent_slug: {
          type: 'string',
          enum: subagentCatalog.map(sa => sa.slug),
          description: 'Slug del subagente especializado que debe ejecutar la tarea.',
        },
        task: {
          type: 'string',
          description: 'Descripción clara y auto-contenida de la tarea para el subagente.',
        },
        tools: {
          type: 'array',
          items: { type: 'string' },
          description: 'Subset opcional de tools que el subagente necesita para esta tarea.',
        },
      },
      required: ['subagent_slug', 'task'],
    },
  }
}

export async function executeRunSubagentTool(
  ctx: ContextBundle,
  input: Record<string, unknown>,
  engineConfig: EngineConfig,
  registry: Registry,
): Promise<{
  success: boolean
  data: unknown
  error?: string
  durationMs: number
}> {
  const startMs = Date.now()

  const subagentSlug = typeof input.subagent_slug === 'string'
    ? input.subagent_slug.trim()
    : ''
  const task = typeof input.task === 'string'
    ? input.task.trim()
    : ''
  const requestedTools = Array.isArray(input.tools)
    ? input.tools.filter((tool): tool is string => typeof tool === 'string' && tool.trim().length > 0)
    : []

  if (!subagentSlug || !task) {
    return {
      success: false,
      data: null,
      error: 'Invalid input: subagent_slug and task are required strings',
      durationMs: Date.now() - startMs,
    }
  }

  const toolsRegistry = registry.getOptional<ToolRegistryReader>('tools:registry')
  const allToolDefs = toolsRegistry?.getEnabledToolDefinitions(ctx.userType) ?? []
  const toolDefs = requestedTools.length > 0
    ? allToolDefs.filter(tool => requestedTools.includes(tool.name))
    : allToolDefs

  const step: ExecutionStep = {
    type: 'subagent',
    subagentSlug,
    description: task,
    params: requestedTools.length > 0 ? { tools: requestedTools } : undefined,
  }

  const result = await runSubagentV2(ctx, step, toolDefs, engineConfig, registry)

  return {
    success: result.success,
    data: {
      subagentSlug: result.subagentSlug,
      success: result.success,
      data: result.data ?? null,
      iterations: result.iterations,
      tokensUsed: result.tokensUsed,
      childSpawned: result.childSpawned,
      error: result.error,
      verification: result.verification,
    },
    error: result.error,
    durationMs: Date.now() - startMs,
  }
}

/**
 * Generate mandatory routing hints for tools claimed as exclusive by subagents.
 * These tools are REMOVED from the main agent's toolkit; the hints explain
 * which subagent to delegate to for each exclusive tool.
 */
export function describeSubagentTooling(
  subagentCatalog: SubagentCatalogEntry[],
): string[] {
  if (subagentCatalog.length === 0) return []

  const lines: string[] = []
  for (const sa of subagentCatalog) {
    if (sa.exclusiveTools.length === 0) continue
    lines.push(`- Para ${sa.exclusiveTools.join(', ')} → DELEGA a "${sa.slug}" via run_subagent. NO uses esas tools directamente.`)
  }

  if (lines.length === 0) return []

  return [
    'DELEGACIÓN OBLIGATORIA — las siguientes herramientas NO están disponibles directamente. Debes usar run_subagent:',
    ...lines,
  ]
}
