// LUNA — LLM Provider Adapters
// Adapters normalizados para Anthropic y Google (Gemini).
// Cada adapter implementa ProviderAdapter y normaliza la respuesta a LLMResponse.

import Anthropic from '@anthropic-ai/sdk'
import { GoogleGenerativeAI } from '@google/generative-ai'
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

/** Build Google Gemini content parts from string or ContentPart[] */
function buildGoogleParts(content: string | ContentPart[]): Array<{ text: string } | { inlineData: { data: string; mimeType: string } }> {
  if (typeof content === 'string') return [{ text: content }]
  return content.map(part => {
    if (part.type === 'text' && part.text) return { text: part.text }
    if ((part.type === 'image_url' || part.type === 'audio') && part.data) {
      return { inlineData: { data: part.data, mimeType: part.mimeType ?? 'application/octet-stream' } }
    }
    return { text: part.text ?? '' }
  })
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
      } else if (part.type === 'audio' && part.data) {
        // Anthropic doesn't support native audio — log and convert to text placeholder
        logger.debug({ mimeType: part.mimeType }, 'Audio part not supported by Anthropic, converting to text placeholder')
        blocks.push({ type: 'text', text: `[Audio: ${part.mimeType ?? 'audio/unknown'}]` })
      }
    }
    return blocks.length === 1 && blocks[0]!.type === 'text'
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
      parts: buildGoogleParts(m.content),
    }))

    const lastMessage = nonSystemMessages[nonSystemMessages.length - 1]!
    const lastParts = buildGoogleParts(lastMessage.content)

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const chat = genModel.startChat({ history })
      const result = await chat.sendMessage(lastParts)
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
// Helpers
// ═══════════════════════════════════════════

function detectFamily(modelId: string): string {
  const lower = modelId.toLowerCase()
  const families = ['haiku', 'sonnet', 'opus', 'flash', 'pro']
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
  return adapters
}
