// LUNA — Kernel types
// Interfaces que todos los módulos implementan. Este archivo es el contrato.

import type { ZodObject } from 'zod'
import type { Registry } from './registry.js'

// ═══════════════════════════════════════════
// Hook system — typed hooks
// ═══════════════════════════════════════════

/**
 * HookMap define todos los hooks del sistema con sus tipos de payload.
 * Esto da type-safety end-to-end: el que registra un hook y el que lo
 * ejecuta comparten el mismo tipo.
 *
 * Para agregar un hook nuevo: agregar una entrada aquí.
 * [payload, returnType] — returnType es void para actions, T para filters.
 */
export interface HookMap {
  // Ciclo de vida de módulos
  'module:activated':       [{ name: string }, void]
  'module:deactivated':     [{ name: string }, void]

  // Mensajes (pipeline ↔ channels)
  'message:incoming':       [IncomingHookPayload, void]
  'message:classified':     [ClassifiedHookPayload, void]
  'message:before_respond': [BeforeRespondPayload, void]
  'message:response_ready': [ResponseReadyPayload, void]
  'message:send':           [SendPayload, void]
  'message:sent':           [SentPayload, void]

  // LLM (pipeline ↔ providers)
  'llm:chat':               [LLMChatPayload, LLMChatResult]
  'llm:models_available':   [{ provider: string }, LLMModelsResult]
  'llm:provider_down':      [{ provider: string; reason: string }, void]
  'llm:provider_up':        [{ provider: string }, void]

  // Oficina
  'oficina:config_saved':   [{ keys: string[] }, void]
  'oficina:config_applied': [Record<string, never>, void]

  // Contactos
  'contact:new':            [{ contactId: string; channel: string }, void]
  'contact:status_changed': [{ contactId: string; from: string; to: string }, void]

  // Jobs
  'job:register':           [JobRegistration, void]
  'job:run':                [{ jobName: string }, void]
}

// Hook payload types
export interface IncomingHookPayload {
  id: string
  channelName: string
  channelMessageId: string
  from: string
  timestamp: Date
  content: { type: string; text?: string; mediaUrl?: string; caption?: string }
  raw?: unknown
}

export interface ClassifiedHookPayload {
  messageId: string
  intent: string
  sentiment?: string
  tools?: string[]
}

export interface BeforeRespondPayload {
  messageId: string
  classification: ClassifiedHookPayload
  resolvedContext?: unknown
}

export interface ResponseReadyPayload {
  messageId: string
  response: string
  channel: string
  to: string
}

export interface SendPayload {
  channel: string
  to: string
  content: { type: string; text?: string; mediaUrl?: string; caption?: string }
  correlationId?: string
}

export interface SentPayload {
  channel: string
  to: string
  channelMessageId?: string
  success: boolean
}

export interface LLMChatPayload {
  task: string
  provider?: string
  model?: string
  system?: string
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
  maxTokens?: number
  temperature?: number
}

export interface LLMChatResult {
  text: string
  provider: string
  model: string
  inputTokens?: number
  outputTokens?: number
}

export interface LLMModelsResult {
  models: Array<{ id: string; displayName: string; family: string }>
}

export interface JobRegistration {
  jobName: string
  cron?: string
  intervalMs?: number
  handler: () => Promise<void>
}

// ═══════════════════════════════════════════
// Module manifest — el contrato de cada módulo
// ═══════════════════════════════════════════

export type ModuleType = 'core-module' | 'provider' | 'channel' | 'feature'

export interface ModuleManifest {
  /** Identificador único. Ej: 'whatsapp', 'llm-anthropic' */
  name: string

  /** Version semver. Ej: '1.0.0' */
  version: string

  /** Descripción corta, en ambos idiomas */
  description: { es: string; en: string }

  /** Tipo de módulo — afecta cómo la oficina lo muestra */
  type: ModuleType

  /** Si es false, no se puede desactivar desde la oficina */
  removable: boolean

  /** Si es true, se activa automáticamente la primera vez que se descubre.
   *  Ideal para core-modules y módulos que deben estar activos por defecto. */
  activateByDefault?: boolean

  /** Nombres de otros módulos que deben estar activos */
  depends?: string[]

  /** Schema Zod con las variables de entorno que este módulo necesita.
   *  Se fusionan automáticamente con los demás al arrancar. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  configSchema?: ZodObject<any>

  /** Definición de cómo se ve este módulo en la oficina */
  oficina?: ModuleOficinaDef

  /** Se llama al activar el módulo */
  init: (registry: Registry) => Promise<void>

  /** Se llama al desactivar. Limpiar intervalos, cerrar conexiones. */
  stop?: () => Promise<void>
}

// ═══════════════════════════════════════════
// Oficina definition per module
// ═══════════════════════════════════════════

export interface OficinaField {
  key: string
  type: 'text' | 'secret' | 'number' | 'boolean' | 'select'
  label: { es: string; en: string }
  info?: { es: string; en: string }
  options?: Array<{ value: string; label: string }>
}

export interface ApiRoute {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  path: string
  handler: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => Promise<void>
}

export interface ModuleOficinaDef {
  /** Título del panel en la oficina */
  title: { es: string; en: string }

  /** Descripción debajo del título */
  info?: { es: string; en: string }

  /** Orden de aparición (menor = más arriba) */
  order: number

  /** Campos del formulario. Se renderizan automáticamente. */
  fields?: OficinaField[]

  /** Endpoints API custom bajo /oficina/api/{moduleName}/ */
  apiRoutes?: ApiRoute[]
}

// ═══════════════════════════════════════════
// Internal types used by the kernel
// ═══════════════════════════════════════════

export interface LoadedModule {
  manifest: ModuleManifest
  active: boolean
}

export type HookCallback<K extends keyof HookMap = keyof HookMap> =
  (payload: HookMap[K][0], correlationId: string) => Promise<HookMap[K][1]> | HookMap[K][1]

export interface HookEntry<K extends keyof HookMap = keyof HookMap> {
  moduleName: string
  callback: HookCallback<K>
  priority: number
}
