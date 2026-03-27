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
  'channel:composing':      [ChannelComposingPayload, void]
  'channel:send_complete':  [ChannelSendCompletePayload, void]
  'message:sent':           [SentPayload, void]

  // LLM (pipeline ↔ providers)
  'llm:chat':               [LLMChatPayload, LLMChatResult]
  'llm:models_available':   [{ provider: string }, LLMModelsResult]
  'llm:provider_down':      [{ provider: string; reason: string }, void]
  'llm:provider_up':        [{ provider: string }, void]

  // Console
  'console:config_saved':   [{ keys: string[] }, void]
  'console:config_applied': [Record<string, never>, void]

  // Contactos
  'contact:new':            [{ contactId: string; channel: string }, void]
  'contact:status_changed': [{ contactId: string; agentId?: string; from: string; to: string }, void]

  // Usuarios (users module)
  'user:resolved':          [{ senderId: string; channel: string; userType: string; listName: string }, void]

  // Jobs
  'job:register':           [JobRegistration, void]
  'job:run':                [{ jobName: string }, void]

  // Tools
  'tools:register':         [ToolRegisterPayload, void]
  'tools:before_execute':   [ToolBeforeExecutePayload, void]
  'tools:executed':         [ToolExecutedPayload, void]

  // Voice calls (twilio-voice module)
  'call:incoming':          [CallHookPayload, void]
  'call:outgoing':          [CallHookPayload, void]
  'call:connected':         [CallConnectedPayload, void]
  'call:ended':             [CallEndedPayload, void]
  'call:transcript':        [CallTranscriptPayload, void]
}

// Hook payload types
export interface IncomingHookPayload {
  id: string
  channelName: string
  channelMessageId: string
  from: string
  /** Phone number resolved from LID mapping (WhatsApp only) */
  resolvedPhone?: string
  /** Display name from the channel (e.g. WhatsApp pushName) */
  senderName?: string
  timestamp: Date
  content: { type: string; text?: string; mediaUrl?: string; caption?: string }
  attachments?: Array<{
    id: string
    filename: string
    mimeType: string
    size: number
    getData: () => Promise<Buffer>
  }>
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
  content: {
    type: string
    text?: string
    mediaUrl?: string
    caption?: string
    audioBuffer?: Buffer
    audioDurationSeconds?: number
    ptt?: boolean
  }
  quotedRaw?: unknown
  correlationId?: string
}

export interface ChannelComposingPayload {
  channel: string
  to: string
  correlationId?: string
}

export interface ChannelSendCompletePayload {
  channel: string
  to: string
  messageCount: number
  correlationId?: string
}

export interface SentPayload {
  channel: string
  to: string
  channelMessageId?: string
  success: boolean
}

/** Multimodal content part for LLM messages (image, audio, text) */
export interface LLMContentPart {
  type: 'text' | 'image_url' | 'audio'
  text?: string
  /** Base64 data or URL */
  data?: string
  mimeType?: string
}

export interface LLMChatPayload {
  task: string
  provider?: string
  model?: string
  system?: string
  messages: Array<{ role: 'user' | 'assistant'; content: string | LLMContentPart[] }>
  maxTokens?: number
  temperature?: number
  /** Tools for native function calling */
  tools?: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>
  /** Force JSON output */
  jsonMode?: boolean
  /** Override API key env var */
  apiKeyEnv?: string
  /** Trace/correlation ID */
  traceId?: string
}

export interface LLMChatResult {
  text: string
  provider: string
  model: string
  inputTokens?: number
  outputTokens?: number
  /** Tool calls returned by the model */
  toolCalls?: Array<{ name: string; input: Record<string, unknown> }>
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

// Tool hook payloads
export interface ToolRegisterPayload {
  toolName: string
  moduleName: string
}

export interface ToolBeforeExecutePayload {
  toolName: string
  input: Record<string, unknown>
  messageId?: string
  contactType?: string
}

export interface ToolExecutedPayload {
  toolName: string
  success: boolean
  durationMs: number
  messageId?: string
  error?: string
}

// Call hook payloads (twilio-voice module)
export interface CallHookPayload {
  callId: string
  callSid: string
  direction: 'inbound' | 'outbound'
  from: string
  to: string
  agentId?: string
  contactId?: string
}

export interface CallConnectedPayload {
  callId: string
  callSid: string
  direction: 'inbound' | 'outbound'
  from: string
  to: string
  agentId?: string
  contactId?: string
  connectedAt: Date
}

export interface CallEndedPayload {
  callId: string
  callSid: string
  direction: 'inbound' | 'outbound'
  from: string
  to: string
  agentId?: string
  contactId?: string
  durationSeconds: number
  endReason: string
}

export interface CallTranscriptPayload {
  callId: string
  speaker: 'caller' | 'agent' | 'system'
  text: string
  timestampMs: number
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

  /** Tipo de módulo — afecta cómo la console lo muestra */
  type: ModuleType

  /** Solo para type='channel': tipo de comunicación del canal.
   *  - 'instant': mensajería instantánea (WhatsApp, Google Chat)
   *  - 'async': comunicación asíncrona (email)
   *  - 'voice': llamadas de voz */
  channelType?: 'instant' | 'async' | 'voice'

  /** Si es false, no se puede desactivar desde la console */
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

  /** Definición de cómo se ve este módulo en la console */
  console?: ModuleConsoleDef

  /** Se llama al activar el módulo */
  init: (registry: Registry) => Promise<void>

  /** Se llama al desactivar. Limpiar intervalos, cerrar conexiones. */
  stop?: () => Promise<void>
}

// ═══════════════════════════════════════════
// Console definition per module
// ═══════════════════════════════════════════

export type ConsoleFieldType =
  | 'text' | 'textarea' | 'secret' | 'number' | 'boolean' | 'select'
  | 'divider' | 'tags' | 'readonly' | 'duration' | 'model-select'

export interface ConsoleField {
  key: string
  type: ConsoleFieldType
  label: { es: string; en: string }
  info?: { es: string; en: string }
  options?: Array<{ value: string; label: string }>
  /** Number constraints */
  min?: number
  max?: number
  step?: number
  /** Visual unit suffix (e.g. "ms", "min", "tokens") */
  unit?: string
  /** Placeholder text */
  placeholder?: string
  /** Separator for tags type (default ",") */
  separator?: string
  /** Rows for textarea */
  rows?: number

  // ── Layout hints for channel settings pages ──
  /** Field width: 'half' = 50% (side-by-side pairs), 'full' = 100% (default) */
  width?: 'half' | 'full'
  /** Icon HTML for boolean toggle rows (SVG string) */
  icon?: string
  /** Description below label for boolean toggle rows (bilingüe) */
  description?: { es: string; en: string }
}

export interface ApiRoute {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE'
  path: string
  handler: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => Promise<void>
}

/** Sidebar category for grouping modules */
export type ConsoleGroup = 'channels' | 'agent' | 'leads' | 'data' | 'modules' | 'system' | string

export interface ModuleConsoleDef {
  /** Título del panel en la console */
  title: { es: string; en: string }

  /** Descripción debajo del título */
  info?: { es: string; en: string }

  /** Orden de aparición (menor = más arriba) */
  order: number

  /** Sidebar category — determines which group this module appears in */
  group?: ConsoleGroup

  /** Sidebar icon (HTML entity or emoji) */
  icon?: string

  /** Campos del formulario. Se renderizan automáticamente. */
  fields?: ConsoleField[]

  /** Endpoints API custom bajo /console/api/{moduleName}/ */
  apiRoutes?: ApiRoute[]

  /** Wizard de conexión para canales. **OBLIGATORIO** si type='channel'.
   *  Define los pasos que el modal de conexión muestra al usuario.
   *  Cada paso tiene instrucciones bilingües y campos opcionales.
   *  Los links externos deben incluir URL completa con target="_blank" y SVG redirect icon.
   *
   *  Las instrucciones de conexión DEBEN definirse aquí (en el módulo del canal),
   *  NO en la UI. La consola extrae este campo del manifest para renderizar el modal.
   *  El saveEndpoint DEBE persistir credenciales en config_store (AES-256-GCM). */
  connectionWizard?: ConnectionWizardDef
}

/** Definición del wizard de conexión para un canal.
 *
 *  OBLIGATORIO para módulos con type='channel'. Cada canal debe incluir
 *  las instrucciones de conexión en su manifest, NO en la UI.
 *  La consola lee `connectionWizard` del manifest para renderizar el modal.
 *
 *  Las instrucciones deben incluir:
 *  1. Links externos a las plataformas relevantes (con target="_blank" y icono de redirect)
 *  2. Pasos detallados para obtener credenciales
 *  3. Campos de input para las credenciales (en los steps correspondientes)
 *
 *  Patrón de extracción:
 *  - La UI obtiene el wizard via `manifest.console.connectionWizard`
 *  - Los pasos se renderizan secuencialmente en un modal
 *  - Los campos (fields) generan inputs cuyo valor se envía al saveEndpoint
 *  - El saveEndpoint del módulo valida y persiste en config_store (AES-256-GCM)
 */
export interface ConnectionWizardStep {
  /** Título del paso (bilingüe) */
  title: { es: string; en: string }
  /** Instrucciones HTML del paso (bilingüe). Puede incluir <a href="..." target="_blank"> para links externos.
   *  Los links externos DEBEN incluir el SVG de redirect icon para abrir en nueva pestaña. */
  instructions: { es: string; en: string }
  /** Campos de input que el usuario debe completar en este paso (opcionales) */
  fields?: Array<{
    key: string
    label: { es: string; en: string }
    type: 'text' | 'secret' | 'textarea'
    placeholder?: string
  }>
}

/** Parámetros estándar de operación para el canal. Se muestran en el modal
 *  después de los pasos del wizard como configuración inicial. */
export interface ChannelOperationParams {
  /** Si el canal debe intentar reconectarse automáticamente tras una desconexión */
  autoReconnect?: { es: string; en: string }
  /** Máximo de reintentos de conexión antes de marcar como error */
  maxRetries?: { es: string; en: string }
  /** Intervalo entre reintentos (en ms) */
  retryIntervalMs?: { es: string; en: string }
  /** Parámetros adicionales específicos del canal */
  custom?: Array<{
    key: string
    label: { es: string; en: string }
    type: 'text' | 'number' | 'boolean'
    defaultValue?: string
  }>
}

export interface ConnectionWizardDef {
  /** Título del modal (bilingüe) */
  title: { es: string; en: string }
  /** Pasos del wizard. Cada paso se muestra secuencialmente.
   *  Las instrucciones de conexión DEBEN estar aquí (en el módulo del canal),
   *  NO hardcodeadas en la UI de la consola. */
  steps: ConnectionWizardStep[]
  /** Endpoint API para guardar las credenciales: POST /console/api/{moduleName}/{savePath}
   *  Recibe JSON con los valores de todos los fields de todos los steps.
   *  DEBE persistir en config_store (DB encriptada con AES-256-GCM) para
   *  sobrevivir reinicios del contenedor. */
  saveEndpoint?: string
  /** Si true, después de guardar se llama a POST /console/apply para hot-reload */
  applyAfterSave?: boolean
  /** Endpoint API para verificar conexión después de guardar (GET). Opcional. */
  verifyEndpoint?: string
  /** Parámetros estándar de operación del canal (reconexión, reintentos, etc.) */
  operationParams?: ChannelOperationParams
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
