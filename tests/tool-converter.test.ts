// Test 3: Tool Converter — toAnthropicTools/toGeminiTools/toNativeTools
// Verifies: correct format conversion, shortDescription fallback, parameter mapping

import { describe, it, expect } from 'vitest'
import { toAnthropicTools, toGeminiTools, toNativeTools } from '../src/modules/tools/tool-converter.js'
import type { ToolDefinition } from '../src/modules/tools/types.js'

const SAMPLE_TOOL: ToolDefinition = {
  name: 'check-availability',
  displayName: 'Verificar Disponibilidad',
  description: 'Verifica disponibilidad en el calendario para agendar citas. Retorna slots disponibles.',
  shortDescription: 'Verifica disponibilidad en el calendario',
  category: 'calendar',
  sourceModule: 'google-apps',
  parameters: {
    type: 'object',
    properties: {
      date: { type: 'string', description: 'Fecha en formato YYYY-MM-DD' },
      duration: { type: 'number', description: 'Duración en minutos' },
    },
    required: ['date'],
  },
}

const TOOL_WITHOUT_SHORT: ToolDefinition = {
  ...SAMPLE_TOOL,
  name: 'no-short',
  shortDescription: undefined,
}

describe('toAnthropicTools', () => {
  it('converts to Anthropic format with input_schema', () => {
    const result = toAnthropicTools([SAMPLE_TOOL])
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({
      name: 'check-availability',
      description: 'Verifica disponibilidad en el calendario',
      input_schema: {
        type: 'object',
        properties: SAMPLE_TOOL.parameters.properties,
        required: ['date'],
      },
    })
  })

  it('uses shortDescription when available', () => {
    const result = toAnthropicTools([SAMPLE_TOOL])
    expect(result[0]!.description).toBe('Verifica disponibilidad en el calendario')
  })

  it('falls back to description when no shortDescription', () => {
    const result = toAnthropicTools([TOOL_WITHOUT_SHORT])
    expect(result[0]!.description).toContain('Verifica disponibilidad en el calendario para agendar citas')
  })
})

describe('toGeminiTools', () => {
  it('converts to Gemini format with parameters (not input_schema)', () => {
    const result = toGeminiTools([SAMPLE_TOOL])
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual({
      name: 'check-availability',
      description: 'Verifica disponibilidad en el calendario',
      parameters: {
        type: 'object',
        properties: SAMPLE_TOOL.parameters.properties,
        required: ['date'],
      },
    })
  })
})

describe('toNativeTools', () => {
  it('dispatches to Anthropic format', () => {
    const result = toNativeTools([SAMPLE_TOOL], 'anthropic')
    expect(result).toHaveLength(1)
    expect(result[0]).toHaveProperty('input_schema')
  })

  it('dispatches to Gemini format', () => {
    const result = toNativeTools([SAMPLE_TOOL], 'google')
    expect(result).toHaveLength(1)
    expect(result[0]).toHaveProperty('parameters')
  })

  it('handles empty tool array', () => {
    expect(toNativeTools([], 'anthropic')).toEqual([])
    expect(toNativeTools([], 'google')).toEqual([])
  })

  it('handles multiple tools', () => {
    const tools = [SAMPLE_TOOL, { ...SAMPLE_TOOL, name: 'second-tool' }]
    expect(toNativeTools(tools, 'anthropic')).toHaveLength(2)
    expect(toNativeTools(tools, 'google')).toHaveLength(2)
  })
})
