// LUNA — Module: tools — Tool Registry
// Clase central expuesta como servicio 'tools:registry'.
// Registro en memoria + sync DB + catálogo + ejecución.

import type { Pool } from 'pg'
import type { Redis } from 'ioredis'
import pino from 'pino'
import type { Registry } from '../../kernel/registry.js'
import type {
  ToolDefinition,
  ToolHandler,
  ToolRegistration,
  ToolSettings,
  ToolCatalogEntry,
  ToolResult,
  ToolExecutionContext,
  ToolAccessRule,
  ToolsConfig,
} from './types.js'
import { PgStore } from './pg-store.js'
import { ToolExecutor } from './tool-executor.js'
import { toNativeTools } from './tool-converter.js'

const logger = pino({ name: 'tools:registry' })

interface ToolEntry {
  definition: ToolDefinition
  handler: ToolHandler
  settings: ToolSettings
}

export class ToolRegistry {
  private tools = new Map<string, ToolEntry>()
  private accessRulesCache = new Map<string, ToolAccessRule[]>()

  constructor(
    private pgStore: PgStore,
    private executor: ToolExecutor,
    private config: ToolsConfig,
    _db: Pool,
    _redis: Redis,
    private registry: Registry,
  ) {}

  async initialize(): Promise<void> {
    // Cargar settings existentes de DB (tools registradas en runs anteriores)
    const existing = await this.pgStore.listEnabledTools()
    logger.info({ count: existing.length }, 'Loaded existing tool definitions from DB')
  }

  async registerTool(registration: ToolRegistration): Promise<void> {
    const { definition, handler } = registration
    const { name } = definition

    // Validar nombre único en memoria
    if (this.tools.has(name)) {
      logger.warn({ toolName: name }, 'Tool already registered, overwriting')
    }

    // Auto-generate shortDescription from first sentence of description if not provided
    if (!definition.shortDescription) {
      const firstSentence = definition.description.split(/[.!?]/)[0]?.trim()
      definition.shortDescription = firstSentence ?? definition.description
    }

    // Persistir definición en DB (no toca enabled/maxRetries/maxUsesPerLoop).
    // COALESCE in pg-store ensures user-edited shortDescription/detailedGuidance are not overwritten.
    await this.pgStore.upsertTool(
      name,
      definition.displayName,
      definition.description,
      definition.category,
      definition.sourceModule,
      definition.parameters,
      definition.shortDescription,
      definition.detailedGuidance,
    )

    // Cargar settings de DB (puede tener enabled=false y description overrides desde console)
    const settings = await this.pgStore.getToolSettings(name) ?? {
      toolName: name,
      enabled: true,
      maxRetries: 2,
      maxUsesPerLoop: 3,
    }

    // Apply DB-stored description overrides back to in-memory definition
    if (settings.shortDescription) definition.shortDescription = settings.shortDescription
    if (settings.detailedGuidance) definition.detailedGuidance = settings.detailedGuidance

    // Guardar en Map
    this.tools.set(name, { definition, handler, settings })

    // Emitir hook
    await this.registry.runHook('tools:register', {
      toolName: name,
      moduleName: definition.sourceModule,
    })

    logger.info(
      { toolName: name, module: definition.sourceModule, enabled: settings.enabled },
      'Tool registered',
    )
  }

  unregisterModuleTools(moduleName: string): void {
    const toRemove: string[] = []
    for (const [name, entry] of this.tools) {
      if (entry.definition.sourceModule === moduleName) {
        toRemove.push(name)
      }
    }
    for (const name of toRemove) {
      this.tools.delete(name)
      this.accessRulesCache.delete(name)
    }
    if (toRemove.length > 0) {
      logger.info({ moduleName, tools: toRemove }, 'Unregistered module tools')
    }
  }

  getCatalog(contactType?: string): ToolCatalogEntry[] {
    const catalog: ToolCatalogEntry[] = []
    for (const [, entry] of this.tools) {
      if (!entry.settings.enabled) continue
      if (contactType && !this.isToolAllowed(entry.definition.name, contactType)) continue
      catalog.push({
        name: entry.definition.name,
        description: entry.definition.shortDescription ?? entry.definition.description,
        category: entry.definition.category,
      })
    }
    return catalog
  }

  /**
   * Get the detailed guidance for a tool (injected into tool_result by the agentic post-processor).
   * Returns null if no detailed guidance was registered.
   */
  getToolGuidance(name: string): string | null {
    return this.tools.get(name)?.definition.detailedGuidance ?? null
  }

  getEnabledToolDefinitions(contactType?: string): ToolDefinition[] {
    const defs: ToolDefinition[] = []
    for (const [, entry] of this.tools) {
      if (!entry.settings.enabled) continue
      if (contactType && !this.isToolAllowed(entry.definition.name, contactType)) continue
      defs.push(entry.definition)
    }
    return defs
  }

  getToolsAsNative(
    provider: 'anthropic' | 'google',
    contactType?: string,
  ): unknown[] {
    const defs = this.getEnabledToolDefinitions(contactType)
    return toNativeTools(defs, provider)
  }

  async executeTool(
    name: string,
    input: Record<string, unknown>,
    context: ToolExecutionContext,
  ): Promise<ToolResult> {
    const entry = this.tools.get(name)
    if (!entry) {
      return {
        toolName: name,
        success: false,
        error: `Tool "${name}" not found`,
        durationMs: 0,
        retries: 0,
      }
    }

    // Validar enabled
    if (!entry.settings.enabled) {
      return {
        toolName: name,
        success: false,
        error: `Tool "${name}" is disabled`,
        durationMs: 0,
        retries: 0,
      }
    }

    // Validar access
    if (context.contactType && !this.isToolAllowed(name, context.contactType)) {
      return {
        toolName: name,
        success: false,
        error: `Tool "${name}" not allowed for contact type "${context.contactType}"`,
        durationMs: 0,
        retries: 0,
      }
    }

    // Validar required fields
    const missing = this.validateRequired(entry.definition, input)
    if (missing.length > 0) {
      return {
        toolName: name,
        success: false,
        error: `Missing required parameters: ${missing.join(', ')}`,
        durationMs: 0,
        retries: 0,
      }
    }

    // Emitir before_execute
    await this.registry.runHook('tools:before_execute', {
      toolName: name,
      input,
      messageId: context.messageId,
      contactType: context.contactType,
    })

    // Ejecutar
    const result = await this.executor.execute(
      name,
      entry.handler,
      input,
      context,
      entry.settings,
    )

    // Log to DB (fire-and-forget)
    this.pgStore.logExecution({
      toolName: name,
      messageId: context.messageId,
      contactId: context.contactId,
      input,
      output: result.data,
      status: result.success ? 'success' : (result.error?.includes('timed out') ? 'timeout' : 'failed'),
      error: result.error,
      durationMs: result.durationMs,
      retries: result.retries,
    })

    // Emitir executed
    await this.registry.runHook('tools:executed', {
      toolName: name,
      success: result.success,
      durationMs: result.durationMs,
      messageId: context.messageId,
      error: result.error,
    })

    return result
  }

  async executeTools(
    calls: Array<{ name: string; input: Record<string, unknown> }>,
    context: ToolExecutionContext,
  ): Promise<ToolResult[]> {
    // Limitar al máximo por turno
    const limited = calls.slice(0, this.config.PIPELINE_MAX_TOOL_CALLS_PER_TURN)

    const prepared = limited.map((call) => {
      const entry = this.tools.get(call.name)
      return { call, entry }
    })

    // Ejecutar en paralelo vía Promise.allSettled
    const results = await Promise.allSettled(
      prepared.map(({ call, entry }) => {
        if (!entry) {
          return Promise.resolve<ToolResult>({
            toolName: call.name,
            success: false,
            error: `Tool "${call.name}" not found`,
            durationMs: 0,
            retries: 0,
          })
        }
        return this.executeTool(call.name, call.input, context)
      }),
    )

    return results.map((result, idx) => {
      if (result.status === 'fulfilled') return result.value
      return {
        toolName: limited[idx]!.name,
        success: false,
        error: result.reason instanceof Error ? result.reason.message : String(result.reason),
        durationMs: 0,
        retries: 0,
      }
    })
  }

  getToolSettings(name: string): ToolSettings | null {
    return this.tools.get(name)?.settings ?? null
  }

  async updateToolSettings(
    name: string,
    updates: { enabled?: boolean; maxRetries?: number; maxUsesPerLoop?: number; shortDescription?: string | null; detailedGuidance?: string | null },
  ): Promise<void> {
    await this.pgStore.updateToolSettings(name, updates)

    // Actualizar en memoria
    const entry = this.tools.get(name)
    if (entry) {
      if (updates.enabled !== undefined) entry.settings.enabled = updates.enabled
      if (updates.maxRetries !== undefined) entry.settings.maxRetries = updates.maxRetries
      if (updates.maxUsesPerLoop !== undefined) entry.settings.maxUsesPerLoop = updates.maxUsesPerLoop
      // Apply description overrides to in-memory definition for immediate effect
      if ('shortDescription' in updates) {
        entry.definition.shortDescription = updates.shortDescription ?? entry.definition.description.split(/[.!?]/)[0]?.trim() ?? entry.definition.description
      }
      if ('detailedGuidance' in updates) {
        entry.definition.detailedGuidance = updates.detailedGuidance ?? undefined
      }
    }

    logger.info({ toolName: name, updates }, 'Tool settings updated')
  }

  getToolsByModule(moduleName: string): Array<{
    name: string
    displayName: string
    description: string
    category: string
    enabled: boolean
    maxRetries: number
    maxUsesPerLoop: number
  }> {
    const result: Array<{
      name: string
      displayName: string
      description: string
      category: string
      enabled: boolean
      maxRetries: number
      maxUsesPerLoop: number
    }> = []

    for (const [, entry] of this.tools) {
      if (entry.definition.sourceModule === moduleName) {
        result.push({
          name: entry.definition.name,
          displayName: entry.definition.displayName,
          description: entry.definition.description,
          category: entry.definition.category,
          enabled: entry.settings.enabled,
          maxRetries: entry.settings.maxRetries,
          maxUsesPerLoop: entry.settings.maxUsesPerLoop,
        })
      }
    }
    return result.sort((a, b) => a.name.localeCompare(b.name))
  }

  isToolAllowed(name: string, contactType: string): boolean {
    const rules = this.accessRulesCache.get(name)
    if (!rules || rules.length === 0) return true // Sin reglas = permitido
    const rule = rules.find((r) => r.contactType === contactType)
    if (!rule) return true // Sin regla específica = permitido
    return rule.allowed
  }

  async getAccessRules(toolName: string): Promise<ToolAccessRule[]> {
    const rules = await this.pgStore.getAccessRules(toolName)
    this.accessRulesCache.set(toolName, rules)
    return rules
  }

  async setAccessRule(toolName: string, contactType: string, allowed: boolean): Promise<void> {
    await this.pgStore.setAccessRule(toolName, contactType, allowed)
    // Refresh cache
    await this.getAccessRules(toolName)
    logger.info({ toolName, contactType, allowed }, 'Access rule set')
  }

  async deleteAccessRule(toolName: string, contactType: string): Promise<void> {
    await this.pgStore.deleteAccessRule(toolName, contactType)
    await this.getAccessRules(toolName)
    logger.info({ toolName, contactType }, 'Access rule deleted')
  }

  async getRecentExecutions(toolName?: string, limit?: number) {
    return this.pgStore.getRecentExecutions(toolName, limit)
  }

  async cleanupOldTools(): Promise<void> {
    const activeNames = [...this.tools.keys()]
    await this.pgStore.cleanupOldTools(activeNames)
  }

  private validateRequired(definition: ToolDefinition, input: Record<string, unknown>): string[] {
    const required = definition.parameters.required ?? []
    return required.filter((key) => input[key] === undefined || input[key] === null)
  }
}
