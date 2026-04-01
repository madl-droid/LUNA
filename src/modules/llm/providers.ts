// LUNA — LLM Provider Adapters
// Adapters normalizados para Anthropic y Google (Gemini).
// Cada adapter implementa ProviderAdapter y normaliza la respuesta a LLMResponse.

import Anthropic from '@anthropic-ai/sdk'
import { GoogleGenerativeAI } from '@google/generative-ai'
import pino from 'pino'
import { logExternalApi } from '../../kernel/extreme-logger.js'
import type {
  ProviderAdapter,
  LLMProviderName,
  LLMRequest,
  LLMResponse,
  LLMToolCall,
  LLMBatchRequest,
  LLMBatchResult,
  LLMBatchInfo,
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
    if ((part.type === 'image_url' || part.type === 'audio' || part.type === 'video') && part.data) {
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

    const params: Record<string, unknown> = {
      model: request.model ?? 'claude-sonnet-4-5-20250929',
      max_tokens: request.maxTokens ?? 2048,
      temperature: request.temperature ?? 0.7,
      messages,
    }

    // System prompt — with prompt caching (cache_control on the last text block)
    const systemParts: string[] = []
    if (request.system) systemParts.push(request.system)
    for (const m of request.messages) {
      if (m.role === 'system') {
        systemParts.push(textContent(m.content))
      }
    }
    if (systemParts.length > 0) {
      const systemText = systemParts.join('\n\n')
      // Use array format with cache_control for prompt caching (ephemeral = 5 min TTL, auto-renews)
      params.system = [
        { type: 'text', text: systemText, cache_control: { type: 'ephemeral' } },
      ]
    }

    // Extended thinking (incompatible with temperature — remove it)
    if (request.thinking) {
      params.thinking = {
        type: request.thinking.type === 'adaptive' ? 'adaptive' : 'enabled',
        budget_tokens: request.thinking.budgetTokens ?? 4096,
      }
      delete params.temperature // Anthropic: thinking and temperature are incompatible
    }

    // Tools
    const tools: unknown[] = []
    if (request.tools?.length) {
      for (const t of request.tools) {
        tools.push({
          name: t.name,
          description: t.description,
          input_schema: t.inputSchema,
        })
      }
    }
    // Code execution tool (built-in Anthropic sandbox)
    if (request.codeExecution) {
      tools.push({ type: 'code_execution' })
    }
    if (tools.length > 0) {
      params.tools = tools
    }

    // JSON mode — prefill trick: add assistant message starting with '{'
    if (request.jsonMode && !request.tools?.length) {
      messages.push({ role: 'assistant', content: '{' })
    }

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const response = await client.messages.create(
        params as unknown as Anthropic.MessageCreateParams,
        { signal: controller.signal },
      )

      const msg = response as Anthropic.Message
      let text = ''
      const toolCalls: LLMToolCall[] = []
      const codeResults: Array<{ code: string; output: string; error?: string }> = []

      for (const block of msg.content) {
        if (block.type === 'text') {
          text += block.text
        } else if (block.type === 'tool_use') {
          toolCalls.push({ name: block.name, input: block.input as Record<string, unknown> })
        }
        // Code execution results (type: 'code_execution_result' — Anthropic built-in)
        if ((block as unknown as Record<string, unknown>).type === 'code_execution_result') {
          const ceBlock = block as unknown as Record<string, unknown>
          codeResults.push({
            code: String((ceBlock as Record<string, unknown>).code ?? ''),
            output: String((ceBlock as Record<string, unknown>).output ?? ''),
            error: (ceBlock as Record<string, unknown>).error ? String((ceBlock as Record<string, unknown>).error) : undefined,
          })
        }
      }

      // JSON mode — prepend '{' since we used prefill
      if (request.jsonMode && !request.tools?.length) {
        text = '{' + text
      }

      // Extract cache metrics from usage
      const usage = msg.usage as unknown as Record<string, unknown>
      const cacheReadTokens = typeof usage.cache_read_input_tokens === 'number' ? usage.cache_read_input_tokens : undefined
      const cacheCreationTokens = typeof usage.cache_creation_input_tokens === 'number' ? usage.cache_creation_input_tokens : undefined

      const durationMs = Date.now() - start
      logExternalApi({
        provider: 'anthropic', endpoint: '/messages', method: 'POST',
        durationMs, status: 200, model: msg.model,
        tokensIn: msg.usage.input_tokens, tokensOut: msg.usage.output_tokens,
      }).catch(() => {})

      return {
        text,
        provider: 'anthropic',
        model: msg.model,
        inputTokens: msg.usage.input_tokens,
        outputTokens: msg.usage.output_tokens,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        durationMs,
        fromFallback: false,
        attempt: 0,
        cacheReadTokens: cacheReadTokens as number | undefined,
        cacheCreationTokens: cacheCreationTokens as number | undefined,
        codeResults: codeResults.length > 0 ? codeResults : undefined,
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

  async submitBatch(requests: LLMBatchRequest[], apiKey: string): Promise<string> {
    const batchRequests = requests.map(r => ({
      custom_id: r.customId,
      params: {
        model: r.request.model ?? 'claude-sonnet-4-5-20250929',
        max_tokens: r.request.maxTokens ?? 2048,
        messages: r.request.messages.map(m => ({
          role: m.role,
          content: typeof m.content === 'string' ? m.content : this.buildAnthropicContent(m as LLMMessage),
        })),
        ...(r.request.system ? { system: r.request.system } : {}),
      },
    }))

    const res = await fetch('https://api.anthropic.com/v1/messages/batches', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({ requests: batchRequests }),
    })

    if (!res.ok) {
      const errText = await res.text()
      throw new Error(`Anthropic batch submit failed: ${errText}`)
    }
    const data = await res.json() as { id: string }
    return data.id
  }

  async getBatchStatus(batchId: string, apiKey: string): Promise<LLMBatchInfo> {
    const res = await fetch(`https://api.anthropic.com/v1/messages/batches/${batchId}`, {
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    })
    if (!res.ok) throw new Error(`Anthropic batch status failed: ${res.status}`)
    const data = await res.json() as Record<string, unknown>
    const counts = data.request_counts as Record<string, number> | undefined
    return {
      batchId,
      provider: 'anthropic',
      status: (data.processing_status as string) === 'ended' ? 'ended' : 'processing',
      totalRequests: (counts?.processing ?? 0) + (counts?.succeeded ?? 0) + (counts?.errored ?? 0),
      completedRequests: counts?.succeeded ?? 0,
      failedRequests: counts?.errored ?? 0,
      createdAt: String(data.created_at ?? ''),
      endedAt: data.ended_at ? String(data.ended_at) : undefined,
    }
  }

  async getBatchResults(batchId: string, apiKey: string): Promise<LLMBatchResult[]> {
    const res = await fetch(`https://api.anthropic.com/v1/messages/batches/${batchId}/results`, {
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    })
    if (!res.ok) throw new Error(`Anthropic batch results failed: ${res.status}`)
    const text = await res.text()
    // Results are JSONL (one JSON per line)
    return text.trim().split('\n').filter(Boolean).map((line: string) => {
      const item = JSON.parse(line) as Record<string, unknown>
      const result = item.result as Record<string, unknown> | undefined
      if (result?.type === 'succeeded') {
        const msg = result.message as Record<string, unknown>
        const usage = msg.usage as Record<string, number> | undefined
        let respText = ''
        for (const block of (msg.content as Array<Record<string, unknown>>) ?? []) {
          if (block.type === 'text') respText += block.text
        }
        return {
          customId: String(item.custom_id ?? ''),
          response: {
            text: respText,
            provider: 'anthropic' as const,
            model: String(msg.model ?? ''),
            inputTokens: usage?.input_tokens ?? 0,
            outputTokens: usage?.output_tokens ?? 0,
            durationMs: 0,
            fromFallback: false,
            attempt: 0,
          },
        }
      }
      return {
        customId: String(item.custom_id ?? ''),
        error: result?.type === 'errored'
          ? JSON.stringify((result as Record<string, unknown>).error ?? 'batch item failed')
          : 'unknown error',
      }
    })
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
      } else if (part.type === 'video' && part.data) {
        // Anthropic doesn't support native video — log and convert to text placeholder
        logger.debug({ mimeType: part.mimeType }, 'Video part not supported by Anthropic, converting to text placeholder')
        blocks.push({ type: 'text', text: `[Video: ${part.mimeType ?? 'video/unknown'}]` })
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

    // Build generation config
    const generationConfig: Record<string, unknown> = {
      maxOutputTokens: request.maxTokens ?? 2048,
      temperature: request.temperature ?? 0.7,
    }

    // JSON mode (Gemini: responseMimeType + optional responseSchema)
    if (request.jsonMode) {
      generationConfig.responseMimeType = 'application/json'
      if (request.jsonSchema) {
        generationConfig.responseSchema = request.jsonSchema
      }
    }

    // Extended thinking (Gemini 3+: thinkingConfig)
    if (request.thinking) {
      generationConfig.thinkingConfig = {
        thinkingBudget: request.thinking.budgetTokens ?? 4096,
      }
    }

    // Build tools array for Gemini
    const geminiTools: unknown[] = []
    if (request.tools?.length) {
      geminiTools.push({
        functionDeclarations: request.tools.map(t => ({
          name: t.name,
          description: t.description,
          parameters: t.inputSchema,
        })),
      })
    }
    // Google Search grounding (built-in Gemini tool)
    if (request.googleSearchGrounding) {
      geminiTools.push({ googleSearch: {} })
    }
    // Code execution (built-in Gemini tool)
    if (request.codeExecution) {
      geminiTools.push({ codeExecution: {} })
    }

    const modelConfig: Record<string, unknown> = {
      model,
      generationConfig,
      systemInstruction: request.system || undefined,
    }
    if (geminiTools.length > 0) {
      modelConfig.tools = geminiTools
    }

    const genModel = client.getGenerativeModel(modelConfig as unknown as Parameters<typeof client.getGenerativeModel>[0])

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

      // Extract tool calls and code execution results
      const toolCalls: LLMToolCall[] = []
      const codeResults: Array<{ code: string; output: string; error?: string }> = []
      const candidate = response.candidates?.[0]
      if (candidate?.content?.parts) {
        for (const part of candidate.content.parts) {
          if ('functionCall' in part && part.functionCall) {
            toolCalls.push({
              name: part.functionCall.name,
              input: (part.functionCall.args ?? {}) as Record<string, unknown>,
            })
          }
          // Code execution results
          const p = part as unknown as Record<string, unknown>
          if ('executableCode' in p && p.executableCode) {
            const ec = p.executableCode as Record<string, unknown>
            codeResults.push({
              code: String(ec.code ?? ''),
              output: '',
            })
          }
          if ('codeExecutionResult' in p && p.codeExecutionResult) {
            const cer = p.codeExecutionResult as Record<string, unknown>
            const last = codeResults[codeResults.length - 1]
            if (last) {
              last.output = String(cer.output ?? '')
              if (cer.outcome === 'ERROR') last.error = String(cer.output ?? 'execution error')
            }
          }
        }
      }

      // Extract grounding metadata if available
      let groundingMetadata: LLMResponse['groundingMetadata']
      const gm = (candidate as Record<string, unknown> | undefined)?.groundingMetadata as Record<string, unknown> | undefined
      if (gm) {
        groundingMetadata = {
          searchQueries: Array.isArray(gm.searchEntryPoint) ? undefined : undefined,
          sources: Array.isArray(gm.groundingChunks)
            ? (gm.groundingChunks as Array<Record<string, unknown>>)
                .filter(c => c.web)
                .map(c => {
                  const web = c.web as Record<string, unknown>
                  return { uri: String(web.uri ?? ''), title: String(web.title ?? '') }
                })
            : undefined,
        }
      }

      // Extract cache metrics if available
      const usageMeta = response.usageMetadata as Record<string, unknown> | undefined
      const cacheReadTokens = typeof usageMeta?.cachedContentTokenCount === 'number'
        ? usageMeta.cachedContentTokenCount
        : undefined

      const durationMs = Date.now() - start
      const inTokens = response.usageMetadata?.promptTokenCount ?? 0
      const outTokens = response.usageMetadata?.candidatesTokenCount ?? 0
      logExternalApi({
        provider: 'google', endpoint: '/generateContent', method: 'POST',
        durationMs, status: 200, model, tokensIn: inTokens, tokensOut: outTokens,
      }).catch(() => {})

      return {
        text: response.text(),
        provider: 'google',
        model,
        inputTokens: inTokens,
        outputTokens: outTokens,
        toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
        durationMs,
        fromFallback: false,
        attempt: 0,
        cacheReadTokens,
        groundingMetadata,
        codeResults: codeResults.length > 0 ? codeResults : undefined,
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
