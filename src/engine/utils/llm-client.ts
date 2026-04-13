// LUNA Engine — LLM Client
// Puente entre el engine y el módulo LLM.
// Si el módulo LLM está activo, delega al gateway.
// Si no, usa llamadas directas a SDKs (fallback para compatibilidad).

import Anthropic from '@anthropic-ai/sdk'
import { GoogleGenAI } from '@google/genai'
import pino from 'pino'
import type { LLMCallOptions, LLMCallResult, LLMProvider, EngineConfig } from '../types.js'

const logger = pino({ name: 'engine:llm' })

// ═══════════════════════════════════════════
// Gateway reference (set by engine init when LLM module is active)
// ═══════════════════════════════════════════

interface LLMGatewayLike {
  chat(request: {
    task: string
    provider?: string
    model?: string
    system?: string
    messages: Array<{ role: string; content: string | import('../../kernel/types.js').LLMContentPart[] | import('../../modules/llm/types.js').MessageContentBlock[] }>
    maxTokens?: number
    temperature?: number
    tools?: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>
    jsonMode?: boolean
    jsonSchema?: Record<string, unknown>
    thinking?: { type: 'enabled' | 'adaptive'; budgetTokens?: number; effort?: 'low' | 'medium' | 'high' }
    googleSearchGrounding?: boolean
    citations?: boolean
    codeExecution?: boolean
    traceId?: string
  }): Promise<{
    text: string
    provider: string
    model: string
    inputTokens: number
    outputTokens: number
    toolCalls?: Array<{ id: string; name: string; input: Record<string, unknown> }>
    durationMs: number
    cacheReadTokens?: number
    cacheCreationTokens?: number
    fallbackLevel?: 'primary' | 'downgrade' | 'cross-api'
    groundingMetadata?: {
      searchQueries?: string[]
      sources?: Array<{ uri: string; title: string }>
    }
    codeResults?: Array<{ code: string; output: string; error?: string }>
  }>
}

let _gateway: LLMGatewayLike | null = null

/**
 * Set the LLM gateway reference. Called by engine init when LLM module is active.
 */
export function setLLMGateway(gateway: LLMGatewayLike | null): void {
  _gateway = gateway
  if (gateway) {
    logger.info('LLM calls will be routed through the LLM module gateway')
  }
}

/**
 * Check if the gateway is available.
 */
export function hasGateway(): boolean {
  return _gateway !== null
}

// ═══════════════════════════════════════════
// Direct SDK clients (fallback when LLM module not active)
// ═══════════════════════════════════════════

let anthropicClient: Anthropic | null = null
let googleClient: GoogleGenAI | null = null

/**
 * Initialize LLM clients with API keys from config.
 */
export function initLLMClients(config: EngineConfig): void {
  if (config.anthropicApiKey) {
    anthropicClient = new Anthropic({ apiKey: config.anthropicApiKey })
  }
  if (config.googleApiKey) {
    googleClient = new GoogleGenAI({ apiKey: config.googleApiKey })
  }
}

// ═══════════════════════════════════════════
// Direct SDK defaults (used only when LLM module is NOT active)
// Minimal mapping so the engine can function standalone.
// ════��══════════════════════════════════════

const DIRECT_TASK_DEFAULTS: Record<string, { provider: LLMProvider; model: string }> = {
  main:       { provider: 'anthropic', model: 'claude-sonnet-4-6-20260214' },
  complex:    { provider: 'anthropic', model: 'claude-opus-4-6-20260210' },
  low:        { provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
  criticize:  { provider: 'google',    model: 'gemini-2.5-pro' },
  media:      { provider: 'google',    model: 'gemini-2.5-flash' },
  web_search: { provider: 'google',    model: 'gemini-2.5-flash' },
  compress:   { provider: 'anthropic', model: 'claude-sonnet-4-6-20260214' },
  batch:      { provider: 'anthropic', model: 'claude-sonnet-4-6-20260214' },
}

function resolveDirectProvider(task?: string): LLMProvider {
  if (!task) return 'anthropic'
  return DIRECT_TASK_DEFAULTS[task]?.provider ?? 'anthropic'
}

function resolveDirectModel(task?: string): string {
  if (!task) return 'claude-sonnet-4-6-20260214'
  return DIRECT_TASK_DEFAULTS[task]?.model ?? 'claude-sonnet-4-6-20260214'
}

const DIRECT_TIMEOUT_MS = 30_000
const DIRECT_RETRY_MAX = 2
const DIRECT_RETRY_BACKOFF_MS = 1_000

/**
 * Call an LLM provider.
 * Routes through gateway if available, otherwise uses direct SDK calls.
 * Direct path includes timeout (30s) and retry (2 attempts) for safety.
 */
export async function callLLM(options: LLMCallOptions): Promise<LLMCallResult> {
  // If gateway available, delegate
  if (_gateway) {
    return callViaGateway(options)
  }

  // Fallback: direct SDK calls — resolve defaults from task name
  const provider = options.provider ?? resolveDirectProvider(options.task)
  const model = options.model ?? resolveDirectModel(options.task)

  let lastErr: unknown
  for (let attempt = 0; attempt <= DIRECT_RETRY_MAX; attempt++) {
    try {
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Direct LLM timeout after ${DIRECT_TIMEOUT_MS}ms`)), DIRECT_TIMEOUT_MS),
      )
      return await Promise.race([callProvider(provider, model, options), timeoutPromise])
    } catch (err) {
      lastErr = err
      logger.warn({ provider, model, task: options.task, attempt, err }, 'Direct LLM call failed')
      if (attempt < DIRECT_RETRY_MAX) {
        await new Promise(r => setTimeout(r, DIRECT_RETRY_BACKOFF_MS))
      }
    }
  }
  throw lastErr
}

/**
 * Call with fallback: try primary, then fallback provider.
 * Routes through gateway if available (gateway handles fallback internally).
 */
export async function callLLMWithFallback(
  options: LLMCallOptions,
  fallbackProvider: LLMProvider,
  fallbackModel: string,
): Promise<LLMCallResult> {
  // Gateway handles fallback internally via task routing
  if (_gateway) {
    return callViaGateway(options)
  }

  // Fallback: direct SDK calls with manual fallback
  try {
    return await callLLM(options)
  } catch {
    logger.warn(
      { primary: options.provider, fallback: fallbackProvider, task: options.task },
      'Falling back to secondary provider',
    )
    try {
      return await callProvider(fallbackProvider, fallbackModel, options)
    } catch (fallbackErr) {
      logger.error(
        { primary: options.provider, fallback: fallbackProvider, task: options.task, fallbackErr },
        'Fallback also failed',
      )
      throw fallbackErr
    }
  }
}

// ═══════════════════════════════════════════
// Gateway delegation
// ═══════════════════════════════════════════

async function callViaGateway(options: LLMCallOptions): Promise<LLMCallResult> {
  const response = await _gateway!.chat({
    task: options.task,
    provider: options.provider,
    model: options.model,
    system: options.system,
    messages: options.messages,
    maxTokens: options.maxTokens,
    temperature: options.temperature,
    tools: options.tools,
    jsonMode: options.jsonMode,
    jsonSchema: options.jsonSchema,
    thinking: options.thinking,
    googleSearchGrounding: options.googleSearchGrounding,
    citations: options.citations,
    codeExecution: options.codeExecution,
  })

  return {
    text: response.text,
    provider: response.provider as LLMProvider,
    model: response.model,
    inputTokens: response.inputTokens,
    outputTokens: response.outputTokens,
    toolCalls: response.toolCalls,
    cacheReadTokens: response.cacheReadTokens,
    fallbackLevel: response.fallbackLevel,
    groundingMetadata: response.groundingMetadata,
    codeResults: response.codeResults,
  }
}

// ═══════════════════════════════════════════
// Direct SDK calls (fallback)
// ═══════════════════════════════════════════

async function callProvider(
  provider: LLMProvider,
  model: string,
  options: LLMCallOptions,
): Promise<LLMCallResult> {
  switch (provider) {
    case 'anthropic':
      return callAnthropic(model, options)
    case 'google':
      return callGoogle(model, options)
    default:
      throw new Error(`Unknown LLM provider: ${provider}`)
  }
}

// ─── Anthropic ────────────────────────────

async function callAnthropic(model: string, options: LLMCallOptions): Promise<LLMCallResult> {
  if (!anthropicClient) throw new Error('Anthropic client not initialized')

  const params: Anthropic.MessageCreateParams = {
    model,
    max_tokens: options.maxTokens ?? 2048,
    temperature: options.temperature ?? 0.7,
    messages: options.messages.map(m => ({
      role: m.role,
      content: buildAnthropicContent(m.content),
    })),
  }

  if (options.system) {
    params.system = options.system
  }

  // Add tools if provided (for subagent)
  if (options.tools?.length) {
    params.tools = options.tools.map(t => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema as Anthropic.Tool['input_schema'],
    }))
  }

  const response = await anthropicClient.messages.create(params)

  // Extract text and tool calls
  let text = ''
  const toolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }> = []

  for (const block of response.content) {
    if (block.type === 'text') {
      text += block.text
    } else if (block.type === 'tool_use') {
      toolCalls.push({ id: block.id, name: block.name, input: block.input as Record<string, unknown> })
    }
  }

  return {
    text,
    provider: 'anthropic',
    model: response.model,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
  }
}

// ─── Google (Gemini) ──────────────────────

async function callGoogle(model: string, options: LLMCallOptions): Promise<LLMCallResult> {
  if (!googleClient) throw new Error('Google AI client not initialized')

  const genConfig: Record<string, unknown> = {
    maxOutputTokens: options.maxTokens ?? 2048,
    temperature: options.temperature ?? 0.7,
  }

  if (options.system) {
    genConfig.systemInstruction = options.system
  }

  // Convert tools to Gemini functionDeclarations format (parametersJsonSchema, not parameters)
  if (options.tools?.length) {
    genConfig.tools = [{
      functionDeclarations: options.tools.map(t => ({
        name: t.name,
        description: t.description,
        parametersJsonSchema: t.inputSchema,
      })),
    }]
  }

  // Build contents array: all messages in user/model format
  const contents = options.messages.map(m => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: buildGeminiParts(m.content),
  }))

  const response = await googleClient.models.generateContent({
    model,
    contents: contents as Parameters<typeof googleClient.models.generateContent>[0]['contents'],
    config: genConfig as Parameters<typeof googleClient.models.generateContent>[0]['config'],
  })

  // Extract tool calls from response candidates
  const toolCalls: Array<{ id: string; name: string; input: Record<string, unknown> }> = []
  const candidate = response.candidates?.[0]
  if (candidate?.content?.parts) {
    for (const part of candidate.content.parts) {
      if (part.functionCall) {
        toolCalls.push({
          id: `gc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          name: part.functionCall.name ?? '',
          input: (part.functionCall.args ?? {}) as Record<string, unknown>,
        })
      }
    }
  }

  return {
    text: response.text ?? '',  // property (NOT method) in @google/genai
    provider: 'google',
    model,
    inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
    outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
  }
}

// ─── Multimodal content helpers ──────────────

type ContentInput = string | import('../types.js').LLMCallOptions['messages'][number]['content']

// Loose part type for duck-typed iteration over the LLMContentPart | MessageContentBlock union
type AnyPart = {
  type: string
  text?: string
  data?: string
  mimeType?: string
  // ToolUseBlock fields
  id?: string
  name?: string
  input?: Record<string, unknown>
  // ToolResultBlock fields
  toolUseId?: string
  content?: string
  isError?: boolean
}

/** Convert content to Anthropic format (string or ContentBlockParam[]).
 *  Handles multimedia parts and native tool calling blocks (tool_use / tool_result). */
function buildAnthropicContent(content: ContentInput): string | Anthropic.ContentBlockParam[] {
  if (typeof content === 'string') return content
  const blocks: Anthropic.ContentBlockParam[] = []
  for (const part of content as AnyPart[]) {
    if (part.type === 'tool_use' && part.id) {
      blocks.push({
        type: 'tool_use',
        id: part.id,
        name: part.name!,
        input: part.input!,
      })
    } else if (part.type === 'tool_result' && part.toolUseId) {
      blocks.push({
        type: 'tool_result',
        tool_use_id: part.toolUseId,
        content: part.content!,
        is_error: part.isError,
      })
    } else if (part.type === 'text' && part.text) {
      blocks.push({ type: 'text', text: part.text })
    } else if (part.type === 'image_url' && part.data) {
      blocks.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: (part.mimeType ?? 'image/png') as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
          data: part.data,
        },
      })
    } else if (part.type === 'audio' && part.data) {
      // Anthropic doesn't support audio natively — pass as text description
      blocks.push({ type: 'text', text: `[Audio: ${part.mimeType ?? 'audio/ogg'}]` })
    }
  }
  return blocks.length === 1 && blocks[0]?.type === 'text' ? (blocks[0] as { type: 'text'; text: string }).text : blocks
}

/** Convert content to Google Gemini parts format.
 *  Handles multimedia parts and native tool calling blocks (functionCall / functionResponse). */
function buildGeminiParts(content: ContentInput): Array<Record<string, unknown>> {
  if (typeof content === 'string') return [{ text: content }]
  return (content as AnyPart[]).map(part => {
    if (part.type === 'tool_use') {
      return { functionCall: { name: part.name ?? '', args: part.input ?? {} } }
    }
    if (part.type === 'tool_result') {
      let parsedResult: Record<string, unknown>
      try {
        parsedResult = JSON.parse(part.content ?? '{}') as Record<string, unknown>
      } catch {
        parsedResult = { result: part.content ?? '' }
      }
      return { functionResponse: { name: part.name ?? '', response: parsedResult } }
    }
    if (part.type === 'text' && part.text) return { text: part.text }
    if ((part.type === 'image_url' || part.type === 'audio') && part.data) {
      return { inlineData: { data: part.data, mimeType: part.mimeType ?? 'application/octet-stream' } }
    }
    return { text: part.text ?? '' }
  })
}

