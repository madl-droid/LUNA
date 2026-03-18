// LUNA — Module: tools — Types
// Todas las interfaces del sistema de herramientas del agente.

import type { Pool } from 'pg'
import type { Redis } from 'ioredis'

// ═══════════════════════════════════════════
// Tool definition — lo que un módulo registra
// ═══════════════════════════════════════════

export interface ToolDefinition {
  name: string                     // único, kebab-case: 'calendar-check'
  displayName: string              // 'Verificar Disponibilidad'
  description: string              // 1 línea para catálogo del evaluador
  category: string                 // 'calendar', 'sheets', 'media', 'internal'
  sourceModule: string             // nombre del módulo que la registró
  parameters: ToolParameterSchema  // JSON Schema del input
}

export interface ToolParameterSchema {
  type: 'object'
  properties: Record<string, {
    type: 'string' | 'number' | 'boolean' | 'array' | 'object'
    description: string
    enum?: string[]
    default?: unknown
    items?: { type: string; description?: string }
  }>
  required?: string[]
}

// ═══════════════════════════════════════════
// Tool settings — config por tool (DB, oficina)
// ═══════════════════════════════════════════

export interface ToolSettings {
  toolName: string
  enabled: boolean        // si se envía al contexto del LLM o no
  maxRetries: number      // default 2, configurable por tool
  maxUsesPerLoop: number  // default 3, cuántas veces puede usarse en un loop
}

// ═══════════════════════════════════════════
// Catálogo liviano para Phase 2 (evaluador)
// ═══════════════════════════════════════════

export interface ToolCatalogEntry {
  name: string
  description: string
  category: string
}

// ═══════════════════════════════════════════
// Ejecución
// ═══════════════════════════════════════════

export interface ToolResult {
  toolName: string
  success: boolean
  data?: unknown
  error?: string
  durationMs: number
  retries: number
}

export type ToolHandler = (
  input: Record<string, unknown>,
  context: ToolExecutionContext,
) => Promise<ToolHandlerResult>

export interface ToolExecutionContext {
  messageId?: string
  contactId?: string
  contactType?: string
  correlationId: string
  db: Pool
  redis: Redis
}

export interface ToolHandlerResult {
  success: boolean
  data?: unknown
  error?: string
}

// ═══════════════════════════════════════════
// Registro — lo que un módulo pasa al registrar
// ═══════════════════════════════════════════

export interface ToolRegistration {
  definition: ToolDefinition
  handler: ToolHandler
}

// ═══════════════════════════════════════════
// Access rules — deny-list por contact_type
// ═══════════════════════════════════════════

export interface ToolAccessRule {
  toolName: string
  contactType: string
  allowed: boolean
}

// ═══════════════════════════════════════════
// Formatos nativos de tool calling por provider
// ═══════════════════════════════════════════

export interface AnthropicToolDef {
  name: string
  description: string
  input_schema: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
}

export interface OpenAIToolDef {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: {
      type: 'object'
      properties: Record<string, unknown>
      required?: string[]
    }
  }
}

export interface GeminiToolDef {
  name: string
  description: string
  parameters: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
}

// ═══════════════════════════════════════════
// Config del módulo (parsed from configSchema)
// ═══════════════════════════════════════════

export interface ToolsConfig {
  TOOLS_RETRY_BACKOFF_MS: number
  TOOLS_EXECUTION_TIMEOUT_MS: number
  PIPELINE_MAX_TOOL_CALLS_PER_TURN: number
}

// ═══════════════════════════════════════════
// Execution log row (from DB)
// ═══════════════════════════════════════════

export interface ToolExecutionLog {
  id: string
  toolName: string
  messageId: string | null
  contactId: string | null
  input: Record<string, unknown> | null
  output: unknown
  status: 'running' | 'success' | 'failed' | 'timeout'
  error: string | null
  durationMs: number | null
  retries: number
  createdAt: Date
}
