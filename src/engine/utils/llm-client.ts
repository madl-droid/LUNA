// LUNA Engine — LLM Client
// Puente entre el engine y el módulo LLM.
// Si el módulo LLM está activo, delega al gateway.
// Si no, usa llamadas directas a SDKs (fallback para compatibilidad).

import Anthropic from '@anthropic-ai/sdk'
import { GoogleGenerativeAI } from '@google/generative-ai'
import OpenAI from 'openai'
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
    messages: Array<{ role: string; content: string }>
    maxTokens?: number
    temperature?: number
    tools?: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>
    jsonMode?: boolean
    traceId?: string
  }): Promise<{
    text: string
    provider: string
    model: string
    inputTokens: number
    outputTokens: number
    toolCalls?: Array<{ name: string; input: Record<string, unknown> }>
    durationMs: number
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
let googleClient: GoogleGenerativeAI | null = null
let openaiClient: OpenAI | null = null

/**
 * Initialize LLM clients with API keys from config.
 */
export function initLLMClients(config: EngineConfig): void {
  if (config.anthropicApiKey) {
    anthropicClient = new Anthropic({ apiKey: config.anthropicApiKey })
  }
  if (config.googleApiKey) {
    googleClient = new GoogleGenerativeAI(config.googleApiKey)
  }
  if (config.openaiApiKey) {
    openaiClient = new OpenAI({ apiKey: config.openaiApiKey })
  }
}

/**
 * Call an LLM provider.
 * Routes through gateway if available, otherwise uses direct SDK calls.
 */
export async function callLLM(options: LLMCallOptions): Promise<LLMCallResult> {
  // If gateway available, delegate
  if (_gateway) {
    return callViaGateway(options)
  }

  // Fallback: direct SDK calls
  const provider = options.provider ?? 'anthropic'
  const model = options.model ?? ''

  try {
    return await callProvider(provider, model, options)
  } catch (err) {
    logger.warn({ provider, model, task: options.task, err }, 'Primary LLM call failed')
    throw err
  }
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
  } catch (primaryErr) {
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
  })

  return {
    text: response.text,
    provider: response.provider as LLMProvider,
    model: response.model,
    inputTokens: response.inputTokens,
    outputTokens: response.outputTokens,
    toolCalls: response.toolCalls,
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
    case 'openai':
      return callOpenAI(model, options)
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
      content: m.content,
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
  const toolCalls: Array<{ name: string; input: Record<string, unknown> }> = []

  for (const block of response.content) {
    if (block.type === 'text') {
      text += block.text
    } else if (block.type === 'tool_use') {
      toolCalls.push({ name: block.name, input: block.input as Record<string, unknown> })
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

  const genModel = googleClient.getGenerativeModel({
    model,
    generationConfig: {
      maxOutputTokens: options.maxTokens ?? 2048,
      temperature: options.temperature ?? 0.7,
    },
    systemInstruction: options.system || undefined,
  })

  // Convert message format: combine into Gemini history + last user message
  const history = options.messages.slice(0, -1).map(m => ({
    role: m.role === 'assistant' ? 'model' as const : 'user' as const,
    parts: [{ text: m.content }],
  }))

  const lastMessage = options.messages[options.messages.length - 1]!

  const chat = genModel.startChat({ history })
  const result = await chat.sendMessage(lastMessage.content)
  const response = result.response

  return {
    text: response.text(),
    provider: 'google',
    model,
    inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
    outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
  }
}

// ─── OpenAI ───────────────────────────────

async function callOpenAI(model: string, options: LLMCallOptions): Promise<LLMCallResult> {
  if (!openaiClient) throw new Error('OpenAI client not initialized')

  const messages: OpenAI.ChatCompletionMessageParam[] = []

  if (options.system) {
    messages.push({ role: 'system', content: options.system })
  }

  for (const m of options.messages) {
    messages.push({ role: m.role, content: m.content })
  }

  const response = await openaiClient.chat.completions.create({
    model,
    messages,
    max_tokens: options.maxTokens ?? 2048,
    temperature: options.temperature ?? 0.7,
  })

  const choice = response.choices[0]

  return {
    text: choice?.message?.content ?? '',
    provider: 'openai',
    model: response.model,
    inputTokens: response.usage?.prompt_tokens ?? 0,
    outputTokens: response.usage?.completion_tokens ?? 0,
  }
}
