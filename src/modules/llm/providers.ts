// LUNA — LLM Provider Adapters
// Adapters normalizados para Anthropic, Google (Gemini) y OpenAI.
// Cada adapter implementa ProviderAdapter y normaliza la respuesta a LLMResponse.

import Anthropic from '@anthropic-ai/sdk'
import { GoogleGenerativeAI } from '@google/generative-ai'
import OpenAI from 'openai'
import pino from 'pino'
import type {
  ProviderAdapter,
  LLMProviderName,
  LLMRequest,
  LLMResponse,
  LLMToolCall,
  ModelInfo,
  ContentPart,
  LLMMessage,
} from './types.js'

const logger = pino({ name: 'llm:providers' })

// ═══════════════════════════════════════════
// Helper: extract text content from message
// ═══════════════════════════════════════════

function textContent(content: string | ContentPart[]): string {
  if (typeof content === 'string') return content
  return content
    .filter(p => p.type === 'text' && p.text)
    .map(p => p.text!)
    .join('')
}

// ═══════════════════════════════════════════
// Anthropic Adapter
// ═══════════════════════════════════════════

export class AnthropicAdapter implements ProviderAdapter {
  readonly name: LLMProviderName = 'anthropic'
  private clients = new Map<string, Anthropic>()

  init(apiKey: string): void {
    if (!this.clients.has(apiKey)) {
      this.clients.set(apiKey, new Anthropic({ apiKey }))
    }
  }

  isInitialized(): boolean {
    return this.clients.size > 0
  }

  async chat(request: LLMRequest, apiKey: string, timeoutMs: number): Promise<LLMResponse> {
    let client = this.clients.get(apiKey)
    if (!client) {
      client = new Anthropic({ apiKey })
      this.clients.set(apiKey, client)
    }

    const start = Date.now()

    // Build messages — Anthropic doesn't support 'system' role in messages array
    const messages: Anthropic.MessageParam[] = []
    for (const m of request.messages) {
      if (m.role === 'system') continue // handled via system param
      messages.push({
        role: m.role as 'user' | 'assistant',
        content: this.buildAnthropicContent(m),
      })
    }

    const params: Anthropic.MessageCreateParams = {
      model: request.model ?? 'claude-sonnet-4-5-20250929',
      max_tokens: request.maxTokens ?? 2048,
      temperature: request.temperature ?? 0.7,
      messages,
    }

    // System prompt
    const systemParts: string[] = []
    if (request.system) systemParts.push(request.system)
    // Also collect system messages from the array
    for (const m of request.messages) {
      if (m.role === 'system') {
        systemParts.push(textContent(m.content))
      }
    }
    if (systemParts.length > 0) {
      params.system = systemParts.join('\n\n')
    }

    // Tools
    if (request.tools?.length) {
      params.tools = request.tools.map(t => ({
        name: t.name,
        description: t.description,
        input_schema: t.inputSchema as Anthropic.Tool['input_schema'],
      }))
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const response = await client.messages.create(params, {
        signal: controller.signal,
      })

      let text = ''
      const toolCalls: LLMToolCall[] = []

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
        durationMs: Date.now() - start,
        fromFallback: false,
        attempt: 0,
      }
    } finally {
      clearTimeout(timer)
    }
  }

  async listModels(apiKey: string): Promise<ModelInfo[]> {
    try {
      const res = await fetch('https://api.anthropic.com/v1/models', {
        headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      })
      if (!res.ok) return []
      const data = await res.json() as { data: Array<{ id: string; display_name: string }> }
      return data.data.map(m => ({
        id: m.id,
        provider: 'anthropic' as const,
        displayName: m.display_name,
        family: detectFamily(m.id),
        capabilities: detectCapabilities('anthropic', m.id),
        inputCostPer1M: 0,
        outputCostPer1M: 0,
      }))
    } catch (err) {
      logger.error({ err }, 'Failed to list Anthropic models')
      return []
    }
  }

  private buildAnthropicContent(msg: LLMMessage): string | Anthropic.ContentBlockParam[] {
    if (typeof msg.content === 'string') return msg.content

    const blocks: Anthropic.ContentBlockParam[] = []
    for (const part of msg.content) {
      if (part.type === 'text' && part.text) {
        blocks.push({ type: 'text', text: part.text })
      } else if (part.type === 'image_url' && part.data) {
        blocks.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: (part.mimeType ?? 'image/jpeg') as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
            data: part.data,
          },
        })
      }
    }
    return blocks.length === 1 && blocks[0].type === 'text'
      ? (blocks[0] as Anthropic.TextBlockParam).text
      : blocks
  }
}

// ═══════════════════════════════════════════
// Google (Gemini) Adapter
// ═══════════════════════════════════════════

export class GoogleAdapter implements ProviderAdapter {
  readonly name: LLMProviderName = 'google'
  private clients = new Map<string, GoogleGenerativeAI>()

  init(apiKey: string): void {
    if (!this.clients.has(apiKey)) {
      this.clients.set(apiKey, new GoogleGenerativeAI(apiKey))
    }
  }

  isInitialized(): boolean {
    return this.clients.size > 0
  }

  async chat(request: LLMRequest, apiKey: string, timeoutMs: number): Promise<LLMResponse> {
    let client = this.clients.get(apiKey)
    if (!client) {
      client = new GoogleGenerativeAI(apiKey)
      this.clients.set(apiKey, client)
    }

    const start = Date.now()
    const model = request.model ?? 'gemini-2.5-flash'

    const genModel = client.getGenerativeModel({
      model,
      generationConfig: {
        maxOutputTokens: request.maxTokens ?? 2048,
        temperature: request.temperature ?? 0.7,
      },
      systemInstruction: request.system || undefined,
    })

    // Build conversation: system messages go to systemInstruction, rest to history
    const nonSystemMessages = request.messages.filter(m => m.role !== 'system')

    const history = nonSystemMessages.slice(0, -1).map(m => ({
      role: m.role === 'assistant' ? 'model' as const : 'user' as const,
      parts: [{ text: textContent(m.content) }],
    }))

    const lastMessage = nonSystemMessages[nonSystemMessages.length - 1]!
    const lastText = textContent(lastMessage.content)

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const chat = genModel.startChat({ history })
      const result = await chat.sendMessage(lastText)
      const response = result.response

      // Extract tool calls if any
      const toolCalls: LLMToolCall[] = []
      const candidate = response.candidates?.[0]
      if (candidate?.content?.parts) {
        for (const part of candidate.content.parts) {
          if ('functionCall' in part && part.functionCall) {
            toolCalls.push({
              name: part.functionCall.name,
              input: (part.functionCall.args ?? {}) as Record<string, unknown>,
            })
          }
        }
      }

      return {
        text: response.text(),
        provider: 'google',
        model,
        inputTokens: response.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        durationMs: Date.now() - start,
        fromFallback: false,
        attempt: 0,
      }
    } finally {
      clearTimeout(timer)
    }
  }

  async listModels(apiKey: string): Promise<ModelInfo[]> {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`)
      if (!res.ok) return []
      const data = await res.json() as { models: Array<{ name: string; displayName: string }> }
      return (data.models || [])
        .filter(m => m.name.startsWith('models/gemini'))
        .map(m => {
          const id = m.name.replace('models/', '')
          return {
            id,
            provider: 'google' as const,
            displayName: m.displayName,
            family: detectFamily(id),
            capabilities: detectCapabilities('google', id),
            inputCostPer1M: 0,
            outputCostPer1M: 0,
          }
        })
    } catch (err) {
      logger.error({ err }, 'Failed to list Google models')
      return []
    }
  }
}

// ═══════════════════════════════════════════
// OpenAI Adapter
// ═══════════════════════════════════════════

export class OpenAIAdapter implements ProviderAdapter {
  readonly name: LLMProviderName = 'openai'
  private clients = new Map<string, OpenAI>()

  init(apiKey: string): void {
    if (!this.clients.has(apiKey)) {
      this.clients.set(apiKey, new OpenAI({ apiKey }))
    }
  }

  isInitialized(): boolean {
    return this.clients.size > 0
  }

  async chat(request: LLMRequest, apiKey: string, timeoutMs: number): Promise<LLMResponse> {
    let client = this.clients.get(apiKey)
    if (!client) {
      client = new OpenAI({ apiKey })
      this.clients.set(apiKey, client)
    }

    const start = Date.now()
    const model = request.model ?? 'gpt-4o-mini'

    const messages: OpenAI.ChatCompletionMessageParam[] = []

    // System prompt
    if (request.system) {
      messages.push({ role: 'system', content: request.system })
    }

    // Messages
    for (const m of request.messages) {
      if (m.role === 'system') {
        messages.push({ role: 'system', content: textContent(m.content) })
      } else if (typeof m.content === 'string') {
        messages.push({ role: m.role as 'user' | 'assistant', content: m.content })
      } else {
        // Multimodal
        const parts: OpenAI.ChatCompletionContentPart[] = []
        for (const p of m.content) {
          if (p.type === 'text' && p.text) {
            parts.push({ type: 'text', text: p.text })
          } else if (p.type === 'image_url' && p.data) {
            parts.push({
              type: 'image_url',
              image_url: { url: p.data.startsWith('http') ? p.data : `data:${p.mimeType ?? 'image/jpeg'};base64,${p.data}` },
            })
          }
        }
        messages.push({ role: m.role as 'user' | 'assistant', content: parts } as OpenAI.ChatCompletionMessageParam)
      }
    }

    const params: OpenAI.ChatCompletionCreateParams = {
      model,
      messages,
      max_tokens: request.maxTokens ?? 2048,
      temperature: request.temperature ?? 0.7,
    }

    // Tools
    if (request.tools?.length) {
      params.tools = request.tools.map(t => ({
        type: 'function' as const,
        function: {
          name: t.name,
          description: t.description,
          parameters: t.inputSchema,
        },
      }))
    }

    // JSON mode
    if (request.jsonMode) {
      params.response_format = { type: 'json_object' }
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const response = await client.chat.completions.create(params, {
        signal: controller.signal,
      })

      const choice = response.choices[0]
      const toolCalls: LLMToolCall[] = []

      if (choice?.message?.tool_calls) {
        for (const tc of choice.message.tool_calls) {
          if (tc.type === 'function') {
            try {
              toolCalls.push({
                name: tc.function.name,
                input: JSON.parse(tc.function.arguments) as Record<string, unknown>,
              })
            } catch {
              logger.warn({ function: tc.function.name }, 'Failed to parse OpenAI tool call arguments')
            }
          }
        }
      }

      return {
        text: choice?.message?.content ?? '',
        provider: 'openai',
        model: response.model,
        inputTokens: response.usage?.prompt_tokens ?? 0,
        outputTokens: response.usage?.completion_tokens ?? 0,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        durationMs: Date.now() - start,
        fromFallback: false,
        attempt: 0,
      }
    } finally {
      clearTimeout(timer)
    }
  }

  async listModels(apiKey: string): Promise<ModelInfo[]> {
    try {
      const client = new OpenAI({ apiKey })
      const list = await client.models.list()
      const models: ModelInfo[] = []
      for await (const m of list) {
        if (m.id.startsWith('gpt-') || m.id.startsWith('o1') || m.id.startsWith('o3') || m.id.startsWith('o4')) {
          models.push({
            id: m.id,
            provider: 'openai',
            displayName: m.id,
            family: detectFamily(m.id),
            capabilities: detectCapabilities('openai', m.id),
            inputCostPer1M: 0,
            outputCostPer1M: 0,
          })
        }
      }
      return models
    } catch (err) {
      logger.error({ err }, 'Failed to list OpenAI models')
      return []
    }
  }
}

// ═══════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════

function detectFamily(modelId: string): string {
  const lower = modelId.toLowerCase()
  const families = ['haiku', 'sonnet', 'opus', 'flash', 'pro', 'gpt-4o', 'gpt-4.1', 'o3', 'o4']
  for (const f of families) {
    if (lower.includes(f)) return f
  }
  return 'unknown'
}

function detectCapabilities(provider: LLMProviderName, modelId: string): Array<'text' | 'tools' | 'vision' | 'code'> {
  const caps: Array<'text' | 'tools' | 'vision' | 'code'> = ['text']
  const lower = modelId.toLowerCase()

  // Most modern models support tools
  if (provider === 'anthropic') {
    caps.push('tools', 'vision', 'code')
  } else if (provider === 'google') {
    caps.push('tools', 'code')
    if (lower.includes('pro') || lower.includes('flash')) caps.push('vision')
  } else if (provider === 'openai') {
    caps.push('tools', 'code')
    if (lower.includes('gpt-4o') || lower.includes('gpt-4.1')) caps.push('vision')
  }

  return caps
}

// ═══════════════════════════════════════════
// Factory
// ═══════════════════════════════════════════

export function createAdapters(): Map<LLMProviderName, ProviderAdapter> {
  const adapters = new Map<LLMProviderName, ProviderAdapter>()
  adapters.set('anthropic', new AnthropicAdapter())
  adapters.set('google', new GoogleAdapter())
  adapters.set('openai', new OpenAIAdapter())
  return adapters
}
