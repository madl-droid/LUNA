// LUNA — LLM Provider Adapters
// Adapters normalizados para Anthropic y Google (Gemini).
// Cada adapter implementa ProviderAdapter y normaliza la respuesta a LLMResponse.

import Anthropic from '@anthropic-ai/sdk'
import { GoogleGenAI } from '@google/genai'
import type { Content, GenerateContentConfig, Tool as GoogleTool } from '@google/genai'
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
  MessageContentBlock,
  ToolUseBlock,
  ToolResultBlock,
  TextBlock,
} from './types.js'
import { detectFamily } from './helpers.js'

const logger = pino({ name: 'llm:providers' })

// ═══════════════════════════════════════════
// Helper: extract text content from message
// ═══════════════════════════════════════════

function textContent(content: string | ContentPart[] | MessageContentBlock[]): string {
  if (typeof content === 'string') return content
  return (content as Array<{ type: string; text?: string }>)
    .filter(p => p.type === 'text' && p.text)
    .map(p => p.text!)
    .join('')
}

/** Build Google Gemini content parts from string, ContentPart[], or MessageContentBlock[] */
function buildGoogleParts(content: string | ContentPart[] | MessageContentBlock[]): Array<Record<string, unknown>> {
  if (typeof content === 'string') return [{ text: content }]

  // Detect native tool calling blocks
  const hasToolBlocks = (content as Array<{ type: string }>).some(
    b => b.type === 'tool_use' || b.type === 'tool_result',
  )

  if (hasToolBlocks) {
    // Build Google-native functionCall / functionResponse parts
    const parts: Array<Record<string, unknown>> = []
    for (const block of content as MessageContentBlock[]) {
      if (block.type === 'tool_use') {
        parts.push({
          functionCall: {
            name: (block as ToolUseBlock).name,
            args: (block as ToolUseBlock).input,
          },
        })
      } else if (block.type === 'tool_result') {
        const rb = block as ToolResultBlock
        let parsedResult: Record<string, unknown>
        try {
          parsedResult = JSON.parse(rb.content) as Record<string, unknown>
        } catch {
          parsedResult = { result: rb.content }
        }
        parts.push({
          functionResponse: {
            name: rb.name,
            response: parsedResult,
          },
        })
      } else if (block.type === 'text') {
        parts.push({ text: (block as TextBlock).text })
      }
    }
    return parts
  }

  // Standard multimedia content — existing path
  return (content as ContentPart[]).map(part => {
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
      if (request.thinking.type === 'adaptive') {
        // Adaptive thinking: uses effort level, NOT budget_tokens (deprecated in 4.6)
        params.thinking = {
          type: 'adaptive',
          effort: request.thinking.effort ?? 'medium',
        }
      } else {
        // Manual thinking: uses budget_tokens (for pre-4.6 models or manual control)
        params.thinking = {
          type: 'enabled',
          budget_tokens: request.thinking.budgetTokens ?? 4096,
        }
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
      tools.push({ type: 'code_execution_20260120', name: 'code_execution' })
    }
    if (tools.length > 0) {
      params.tools = tools
    }

    // JSON mode — use output_config.format when schema available, prefill trick as fallback
    if (request.jsonMode) {
      if (request.jsonSchema) {
        // Schema available → use output_config.format (native, guaranteed valid JSON)
        params.output_config = {
          format: {
            type: 'json_schema',
            schema: request.jsonSchema,
          },
        }
      } else if (!request.tools?.length) {
        // No schema, no tools → prefill trick as fallback
        messages.push({ role: 'assistant', content: '{' })
      }
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
          toolCalls.push({ id: block.id, name: block.name, input: block.input as Record<string, unknown> })
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

      // JSON mode — prepend '{' only if we used the prefill trick (no schema, no tools)
      if (request.jsonMode && !request.jsonSchema && !request.tools?.length) {
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
      let client = this.clients.get(apiKey)
      if (!client) {
        client = new Anthropic({ apiKey })
        this.clients.set(apiKey, client)
      }
      const page = await client.models.list()
      return page.data.map(m => ({
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
    let client = this.clients.get(apiKey)
    if (!client) {
      client = new Anthropic({ apiKey })
      this.clients.set(apiKey, client)
    }

    const batchRequests = requests.map(r => ({
      custom_id: r.customId,
      params: {
        model: r.request.model ?? 'claude-sonnet-4-6-20260214',
        max_tokens: r.request.maxTokens ?? 2048,
        messages: r.request.messages.map(m => ({
          role: m.role as 'user' | 'assistant',
          content: typeof m.content === 'string' ? m.content : this.buildAnthropicContent(m as LLMMessage),
        })),
        ...(r.request.system ? { system: r.request.system } : {}),
      },
    }))

    const batch = await client.messages.batches.create({ requests: batchRequests })
    return batch.id
  }

  async getBatchStatus(batchId: string, apiKey: string): Promise<LLMBatchInfo> {
    let client = this.clients.get(apiKey)
    if (!client) {
      client = new Anthropic({ apiKey })
      this.clients.set(apiKey, client)
    }

    const batch = await client.messages.batches.retrieve(batchId)
    const counts = batch.request_counts
    return {
      batchId,
      provider: 'anthropic',
      status: batch.processing_status === 'ended' ? 'ended' : 'processing',
      totalRequests: (counts?.processing ?? 0) + (counts?.succeeded ?? 0) + (counts?.errored ?? 0),
      completedRequests: counts?.succeeded ?? 0,
      failedRequests: counts?.errored ?? 0,
      createdAt: String(batch.created_at ?? ''),
      endedAt: batch.ended_at ? String(batch.ended_at) : undefined,
    }
  }

  async getBatchResults(batchId: string, apiKey: string): Promise<LLMBatchResult[]> {
    let client = this.clients.get(apiKey)
    if (!client) {
      client = new Anthropic({ apiKey })
      this.clients.set(apiKey, client)
    }

    const results: LLMBatchResult[] = []
    // results() returns Promise<JSONLDecoder> — await first, then iterate
    const decoder = await client.messages.batches.results(batchId)
    for await (const item of decoder) {
      if (item.result?.type === 'succeeded') {
        const msg = item.result.message
        let respText = ''
        for (const block of msg.content) {
          if (block.type === 'text') respText += block.text
        }
        results.push({
          customId: item.custom_id,
          response: {
            text: respText,
            provider: 'anthropic',
            model: msg.model,
            inputTokens: msg.usage.input_tokens,
            outputTokens: msg.usage.output_tokens,
            durationMs: 0,
            fromFallback: false,
            attempt: 0,
          },
        })
      } else {
        results.push({
          customId: item.custom_id,
          error: item.result?.type === 'errored'
            ? JSON.stringify(item.result.error ?? 'batch item failed')
            : 'unknown error',
        })
      }
    }
    return results
  }

  private buildAnthropicContent(msg: LLMMessage): string | Anthropic.ContentBlockParam[] {
    if (typeof msg.content === 'string') return msg.content

    // Detect native tool calling blocks
    const hasToolBlocks = (msg.content as Array<{ type: string }>).some(
      b => b.type === 'tool_use' || b.type === 'tool_result',
    )

    if (hasToolBlocks) {
      // Build Anthropic-native tool blocks (tool_use / tool_result)
      const blocks: Anthropic.ContentBlockParam[] = []
      for (const block of msg.content as MessageContentBlock[]) {
        if (block.type === 'tool_use') {
          blocks.push({
            type: 'tool_use',
            id: (block as ToolUseBlock).id,
            name: (block as ToolUseBlock).name,
            input: (block as ToolUseBlock).input,
          })
        } else if (block.type === 'tool_result') {
          blocks.push({
            type: 'tool_result',
            tool_use_id: (block as ToolResultBlock).toolUseId,
            content: (block as ToolResultBlock).content,
            is_error: (block as ToolResultBlock).isError,
          })
        } else if (block.type === 'text') {
          blocks.push({ type: 'text', text: (block as TextBlock).text })
        }
        // ContentPart types (image_url, audio, video) are not expected alongside tool blocks
      }
      return blocks
    }

    // Standard multimedia content — existing path
    const blocks: Anthropic.ContentBlockParam[] = []
    for (const part of msg.content as ContentPart[]) {
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
  private clients = new Map<string, GoogleGenAI>()

  init(apiKey: string): void {
    if (!this.clients.has(apiKey)) {
      this.clients.set(apiKey, new GoogleGenAI({ apiKey }))
    }
  }

  isInitialized(): boolean {
    return this.clients.size > 0
  }

  async chat(request: LLMRequest, apiKey: string, timeoutMs: number): Promise<LLMResponse> {
    let client = this.clients.get(apiKey)
    if (!client) {
      client = new GoogleGenAI({ apiKey })
      this.clients.set(apiKey, client)
    }

    const start = Date.now()
    const model = request.model ?? 'gemini-2.5-flash'

    // Build generation config
    const genConfig: GenerateContentConfig = {
      maxOutputTokens: request.maxTokens ?? 2048,
      temperature: request.temperature ?? 0.7,
    }

    // System instruction (goes in config, not in contents)
    if (request.system) {
      genConfig.systemInstruction = request.system
    }

    // JSON mode (Gemini: responseMimeType + optional responseSchema)
    if (request.jsonMode) {
      genConfig.responseMimeType = 'application/json'
      if (request.jsonSchema) {
        genConfig.responseSchema = request.jsonSchema as GenerateContentConfig['responseSchema']
      }
    }

    // Extended thinking (Gemini 2.5+: thinkingConfig)
    if (request.thinking) {
      genConfig.thinkingConfig = {
        thinkingBudget: request.thinking.budgetTokens ?? 4096,
      }
    }

    // Build tools array for Gemini
    const geminiTools: GoogleTool[] = []
    if (request.tools?.length) {
      geminiTools.push({
        functionDeclarations: request.tools.map(t => ({
          name: t.name,
          description: t.description,
          parametersJsonSchema: t.inputSchema, // NEW: parametersJsonSchema (not parameters)
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
    if (geminiTools.length > 0) {
      genConfig.tools = geminiTools
    }

    // Build contents: filter system messages, map to Gemini format (role: 'user'|'model')
    const nonSystemMessages = request.messages.filter(m => m.role !== 'system')
    const contents: Content[] = nonSystemMessages.map(m => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: buildGoogleParts(m.content) as Content['parts'],
    }))

    let timer: ReturnType<typeof setTimeout> | null = null
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`Google LLM timeout after ${timeoutMs}ms`))
      }, timeoutMs)
    })

    try {
      const response = await Promise.race([
        client.models.generateContent({ model, contents, config: genConfig }),
        timeoutPromise,
      ])

      // Extract tool calls and code execution results from candidates
      const toolCalls: LLMToolCall[] = []
      const codeResults: Array<{ code: string; output: string; error?: string }> = []
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
          if (part.executableCode) {
            codeResults.push({
              code: part.executableCode.code ?? '',
              output: '',
            })
          }
          if (part.codeExecutionResult) {
            const last = codeResults[codeResults.length - 1]
            if (last) {
              last.output = part.codeExecutionResult.output ?? ''
              if (part.codeExecutionResult.outcome === 'OUTCOME_FAILED') {
                last.error = part.codeExecutionResult.output ?? 'execution error'
              }
            }
          }
        }
      }

      // Extract grounding metadata if available
      let groundingMetadata: LLMResponse['groundingMetadata']
      const gm = candidate?.groundingMetadata
      if (gm) {
        groundingMetadata = {
          searchQueries: gm.webSearchQueries ?? undefined,
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
      const usageMeta = response.usageMetadata
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
        text: response.text ?? '',  // property (NOT method) in @google/genai
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
      if (timer !== null) clearTimeout(timer)
    }
  }

  async listModels(apiKey: string): Promise<ModelInfo[]> {
    try {
      const client = this.clients.get(apiKey) ?? new GoogleGenAI({ apiKey })
      const pager = await client.models.list()
      const result: ModelInfo[] = []
      for await (const m of pager) {
        const name = m.name ?? ''
        if (!name.startsWith('models/gemini')) continue
        const id = name.replace('models/', '')
        result.push({
          id,
          provider: 'google',
          displayName: m.displayName ?? id,
          family: detectFamily(id),
          capabilities: detectCapabilities('google', id),
          inputCostPer1M: 0,
          outputCostPer1M: 0,
        })
      }
      return result
    } catch (err) {
      logger.error({ err }, 'Failed to list Google models')
      return []
    }
  }
}

// ═══════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════

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
