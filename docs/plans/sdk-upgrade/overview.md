# OVERVIEW — SDK Upgrade: Anthropic + Google GenAI

**Contexto**: Los SDKs de LLM están desactualizados. `@google/generative-ai` (0.24.1) está **deprecado y archivado** desde diciembre 2025 — reemplazo obligatorio por `@google/genai`. `@anthropic-ai/sdk` (0.78.0) tiene bugs activos en code execution y adaptive thinking. Tool calling usa formato texto en vez de bloques nativos.

**Scope**: Actualizar ambos SDKs, migrar todos los puntos de contacto con las APIs, optimizar tool calling nativo, verificar compilación.

---

## Estado actual vs objetivo

| Componente | Actual | Objetivo |
|---|---|---|
| `@anthropic-ai/sdk` | 0.78.0 | ^0.88.0 |
| `@google/generative-ai` | 0.24.1 (DEPRECADO) | ELIMINAR |
| `@google/genai` | No instalado | ^1.49.0 |
| Code execution Anthropic | Formato incorrecto | `code_execution_20260120` |
| Adaptive thinking | budget_tokens (deprecated) | effort param |
| JSON mode Anthropic | Prefill trick (`{`) | `output_config.format` |
| Batch API Anthropic | fetch() raw | SDK `batches.*` |
| Google adapter | GoogleGenerativeAI class | GoogleGenAI class |
| Embeddings | fetch() raw a REST API | @google/genai SDK |
| TTS Gemini | fetch() raw a REST API | @google/genai SDK |
| Model scanner Google | fetch() raw | @google/genai SDK |
| Tool calling (agentic loop) | Text format | Native content blocks |
| Gemini Live | WebSocket raw | Evaluar ai.live |

---

## Archivos afectados

| Archivo | Plan(es) | Tipo de cambio |
|---|---|---|
| `package.json` | 1 | Deps update |
| `src/modules/llm/providers.ts` | 1, 2 | Reescritura Google + fix Anthropic |
| `src/modules/llm/types.ts` | 1, 4 | Nuevos tipos content blocks |
| `src/modules/llm/llm-gateway.ts` | 3 | Eliminar TTS legacy |
| `src/modules/llm/model-scanner.ts` | 3 | Migrar a SDK |
| `src/engine/utils/llm-client.ts` | 1 | Reescribir callGoogle |
| `src/engine/agentic/agentic-loop.ts` | 4 | Tool results nativos |
| `src/engine/types.ts` | 4 | LLMMessage content blocks |
| `src/modules/knowledge/embedding-service.ts` | 3 | Migrar a SDK |
| `src/modules/tts/tts-service.ts` | 3 | Migrar a SDK |
| `src/modules/console/server-api.ts` | 3 | Migrar TTS preview |
| `src/modules/twilio-voice/gemini-live.ts` | 5 | Evaluar migración |
| `src/modules/llm/CLAUDE.md` | 5 | Actualizar docs |
| `src/engine/CLAUDE.md` | 5 | Actualizar docs |
| `CLAUDE.md` | 5 | Actualizar docs |

---

## Estructura de planes

### Plan 1: SDK Dependencies + Google Core Adapter Migration
**Archivos**: package.json, providers.ts (GoogleAdapter), llm-client.ts (callGoogle), types.ts
**Esfuerzo**: ~3h
**Riesgo**: Medio-Alto (reescritura completa GoogleAdapter)
**Precondición**: Ninguna

### Plan 2: Anthropic Adapter Optimization
**Archivos**: providers.ts (AnthropicAdapter solamente)
**Esfuerzo**: ~2h
**Riesgo**: Bajo-Medio
**Precondición**: Plan 1 completado

### Plan 3: Google Peripheral Services Migration
**Archivos**: embedding-service.ts, tts-service.ts, model-scanner.ts, server-api.ts, llm-gateway.ts
**Esfuerzo**: ~2.5h
**Riesgo**: Bajo-Medio
**Precondición**: Plan 1 completado

### Plan 4: Native Tool Calling Format
**Archivos**: agentic-loop.ts, providers.ts (ambos adapters), types.ts, engine/types.ts
**Esfuerzo**: ~3h
**Riesgo**: Alto (cambio en core loop)
**Precondición**: Planes 2 y 3 completados

### Plan 5: Verificación Final + Documentación
**Archivos**: gemini-live.ts (evaluar), CLAUDE.md (varios), docs/architecture/
**Esfuerzo**: ~1.5h
**Riesgo**: Bajo
**Precondición**: Plan 4 completado

---

## Estrategia de ejecución

```
Plan 1 ─────────────── (secuencial, base obligatoria)
   │
   ├── Plan 2 ─────── (paralelo, Anthropic adapter)
   │                │
   └── Plan 3 ─────── (paralelo, Google peripherals)
                    │
            Plan 4 ── (secuencial, native tool calling)
                    │
            Plan 5 ── (secuencial, verificación + docs)
```

**Planes 2 y 3 son 100% paralelos** — no comparten ningún archivo. Ambos requieren Plan 1 como base.
**Plan 4 es secuencial** — toca providers.ts que fue modificado por Plans 1, 2 y 3.
**Plan 5 es secuencial** — verificación final y documentación de todo.

---

## Datos de referencia para ejecutores

### @google/genai — API surface key
```typescript
import { GoogleGenAI } from '@google/genai'
const ai = new GoogleGenAI({ apiKey })

// Chat
const response = await ai.models.generateContent({
  model: 'gemini-2.5-flash',
  contents: [{ role: 'user', parts: [{ text: '...' }] }],
  config: { temperature: 0.7, maxOutputTokens: 2048 }
})
console.log(response.text) // propiedad, NO método

// Tools
config: {
  tools: [{
    functionDeclarations: [{
      name: 'tool_name',
      description: '...',
      parametersJsonSchema: { type: 'object', properties: {...} }
    }]
  }]
}

// Tool results (en contents)
{ role: 'user', parts: [{ functionResponse: { name: 'tool_name', response: { result: data } } }] }

// System instruction
config: { systemInstruction: 'text' }

// JSON mode
config: { responseMimeType: 'application/json', responseSchema: {...} }

// Thinking
config: { thinkingConfig: { thinkingBudget: 4096 } } // Gemini 2.5
config: { thinkingConfig: { includeThoughts: true, thinkingLevel: 'MEDIUM' } } // Gemini 3+

// Grounding
config: { tools: [{ googleSearch: {} }] }

// Code execution
config: { tools: [{ codeExecution: {} }] }

// Embeddings
const result = await ai.models.embedContent({
  model: 'gemini-embedding-2-preview',
  contents: { parts: [{ text: '...' }] },
  config: { outputDimensionality: 1536 }
})

// Model listing
const models = await ai.models.list()

// Response usage
response.usageMetadata.promptTokenCount
response.usageMetadata.candidatesTokenCount
response.usageMetadata.cachedContentTokenCount
```

### @anthropic-ai/sdk 0.88.0 — cambios key
```typescript
// Code execution (CORRECTO)
tools.push({ type: 'code_execution_20260120', name: 'code_execution' })

// Adaptive thinking (CORRECTO para modelos 4.6)
params.thinking = { type: 'adaptive', effort: 'medium' }

// Manual thinking (para modelos pre-4.6)
params.thinking = { type: 'enabled', budget_tokens: 4096 }

// JSON mode nativo
params.output_config = {
  format: {
    type: 'json_schema',
    schema: { type: 'object', properties: {...}, required: [...] }
  }
}

// Batch via SDK
const batch = await client.messages.batches.create({ requests: [...] })
const status = await client.messages.batches.retrieve(batchId)
const results = client.messages.batches.results(batchId) // async iterator

// Tool result blocks (Anthropic native format)
// Assistant message:
{ role: 'assistant', content: [
  { type: 'text', text: 'partial reasoning' },
  { type: 'tool_use', id: 'toolu_xxx', name: 'search', input: {...} }
]}
// User message with result:
{ role: 'user', content: [
  { type: 'tool_result', tool_use_id: 'toolu_xxx', content: 'result data' }
]}
```
