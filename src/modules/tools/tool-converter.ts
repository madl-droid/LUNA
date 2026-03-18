// LUNA — Module: tools — Tool Converter
// Funciones puras que convierten ToolDefinition al formato nativo de cada provider.

import type {
  ToolDefinition,
  AnthropicToolDef,
  OpenAIToolDef,
  GeminiToolDef,
} from './types.js'

export function toAnthropicTools(tools: ToolDefinition[]): AnthropicToolDef[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: {
      type: 'object' as const,
      properties: tool.parameters.properties,
      required: tool.parameters.required,
    },
  }))
}

export function toOpenAITools(tools: ToolDefinition[]): OpenAIToolDef[] {
  return tools.map((tool) => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: {
        type: 'object' as const,
        properties: tool.parameters.properties,
        required: tool.parameters.required,
      },
    },
  }))
}

export function toGeminiTools(tools: ToolDefinition[]): GeminiToolDef[] {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    parameters: {
      type: 'object' as const,
      properties: tool.parameters.properties,
      required: tool.parameters.required,
    },
  }))
}

export function toNativeTools(
  tools: ToolDefinition[],
  provider: 'anthropic' | 'openai' | 'google',
): unknown[] {
  switch (provider) {
    case 'anthropic':
      return toAnthropicTools(tools)
    case 'openai':
      return toOpenAITools(tools)
    case 'google':
      return toGeminiTools(tools)
  }
}
