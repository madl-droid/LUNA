# Plan 1: SDK Dependencies + Google Core Adapter Migration

**Precondición**: Ninguna — este plan es la base.
**Archivos a modificar**: `package.json`, `src/modules/llm/providers.ts`, `src/engine/utils/llm-client.ts`, `src/modules/llm/types.ts`
**Riesgo**: Medio-Alto
**Objetivo**: Reemplazar `@google/generative-ai` (deprecado) con `@google/genai`, bump `@anthropic-ai/sdk`, y reescribir todo el código Google que usa los SDKs directamente para chat.

---

## Contexto

`@google/generative-ai` 0.24.1 fue archivado en diciembre 2025. El repo se renombró a `deprecated-generative-ai-js`. No habrá más actualizaciones ni bug fixes. El reemplazo oficial es `@google/genai` (v1.49.0+), que tiene una API surface completamente diferente.

`@anthropic-ai/sdk` 0.78.0 es funcional pero hay 10 releases nuevos sin breaking changes. El bump es seguro.

---

## Tareas

### 1.1 Actualizar dependencias en package.json

```diff
- "@anthropic-ai/sdk": "^0.78.0",
- "@google/generative-ai": "^0.24.1",
+ "@anthropic-ai/sdk": "^0.88.0",
+ "@google/genai": "^1.49.0",
```

Ejecutar `npm install` para actualizar lockfile.

**IMPORTANTE**: NO instalar `@google/generative-ai` — debe ser eliminado completamente.

### 1.2 Reescribir GoogleAdapter en `src/modules/llm/providers.ts`

El archivo actual importa `GoogleGenerativeAI` de `@google/generative-ai`. Hay que:

1. Cambiar el import:
```typescript
// ANTES
import { GoogleGenerativeAI } from '@google/generative-ai'

// DESPUÉS
import { GoogleGenAI } from '@google/genai'
```

2. Reescribir la clase `GoogleAdapter` (líneas 358-565). La nueva API usa un patrón client-centric:

**Inicialización** (actual: `new GoogleGenerativeAI(apiKey)` → nuevo: `new GoogleGenAI({ apiKey })`):
```typescript
export class GoogleAdapter implements ProviderAdapter {
  readonly name: LLMProviderName = 'google'
  private clients = new Map<string, GoogleGenAI>()

  init(apiKey: string): void {
    if (!this.clients.has(apiKey)) {
      this.clients.set(apiKey, new GoogleGenAI({ apiKey }))
    }
  }
  // ...
}
```

**Método chat()** — el cambio más grande. Patrón actual vs nuevo:

ACTUAL (líneas 372-539):
```typescript
const genModel = client.getGenerativeModel(modelConfig)
const chat = genModel.startChat({ history })
const result = await Promise.race([chat.sendMessage(lastParts), timeoutPromise])
const response = result.response
const text = response.text()  // método
```

NUEVO — usar `ai.models.generateContent()` directamente:
```typescript
const response = await ai.models.generateContent({
  model: request.model ?? 'gemini-2.5-flash',
  contents: allContents, // historia + último mensaje juntos
  config: {
    maxOutputTokens: request.maxTokens ?? 2048,
    temperature: request.temperature ?? 0.7,
    systemInstruction: request.system || undefined,
    // tools, JSON mode, thinking — ver abajo
  }
})
const text = response.text  // propiedad, NO método
```

**Construcción de contents** — cambio en formato:
```typescript
// El nuevo SDK espera contents como array de Content objects
// Roles: 'user' y 'model' (NO 'assistant')
const contents = nonSystemMessages.map(m => ({
  role: m.role === 'assistant' ? 'model' : 'user',
  parts: buildGoogleParts(m.content),
}))
```

**Tools** — cambio en schema key:
```typescript
// ANTES: parameters (OpenAPI-like)
functionDeclarations: request.tools.map(t => ({
  name: t.name,
  description: t.description,
  parameters: t.inputSchema,  // ← VIEJO
}))

// DESPUÉS: parametersJsonSchema (JSON Schema estándar)
functionDeclarations: request.tools.map(t => ({
  name: t.name,
  description: t.description,
  parametersJsonSchema: t.inputSchema,  // ← NUEVO
}))
```

**Google Search grounding** — sin cambio conceptual:
```typescript
// Sigue siendo un tool object
config: { tools: [{ googleSearch: {} }] }
```

**Code execution** — sin cambio conceptual:
```typescript
config: { tools: [{ codeExecution: {} }] }
```

**JSON mode** — sin cambio conceptual:
```typescript
config: {
  responseMimeType: 'application/json',
  responseSchema: request.jsonSchema, // opcional
}
```

**Extended thinking** — sin cambio conceptual:
```typescript
config: {
  thinkingConfig: {
    thinkingBudget: request.thinking.budgetTokens ?? 4096,
  }
}
```

**Timeout** — el nuevo SDK puede que no soporte AbortSignal directamente. Mantener el patrón `Promise.race` con timeout:
```typescript
const controller = new AbortController()
const timer = setTimeout(() => controller.abort(), timeoutMs)
const timeoutPromise = new Promise<never>((_, reject) => {
  timer = setTimeout(() => {
    controller.abort()
    reject(new Error(`Google LLM timeout after ${timeoutMs}ms`))
  }, timeoutMs)
})

try {
  const response = await Promise.race([
    ai.models.generateContent({ model, contents, config }),
    timeoutPromise,
  ])
  // ... procesar response
} finally {
  clearTimeout(timer)
}
```

**Parsing de respuesta** — cambios clave:
```typescript
// ANTES
const candidate = response.candidates?.[0]
if (candidate?.content?.parts) {
  for (const part of candidate.content.parts) {
    if ('functionCall' in part && part.functionCall) {
      toolCalls.push({ name: part.functionCall.name, input: part.functionCall.args ?? {} })
    }
  }
}
const text = response.text()  // método

// DESPUÉS
// El nuevo SDK expone candidates de forma similar, verificar estructura exacta
// response.candidates[0].content.parts sigue existiendo
// response.text es propiedad (NO método)
// functionCall sigue existiendo en parts
// Verificar con los tipos del SDK
```

**Usage metadata** — verificar nombres de campos:
```typescript
// ANTES
response.usageMetadata?.promptTokenCount
response.usageMetadata?.candidatesTokenCount
response.usageMetadata?.cachedContentTokenCount

// DESPUÉS — verificar si los nombres cambiaron en @google/genai
// Probablemente sean los mismos, pero consultar tipos del SDK
```

**Grounding metadata** — verificar estructura:
```typescript
// ANTES: candidate.groundingMetadata.groundingChunks
// DESPUÉS: verificar si la estructura cambió en el nuevo SDK
```

**listModels()** — migrar de fetch raw a SDK:
```typescript
// ANTES (líneas 541-564)
const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`)

// DESPUÉS
async listModels(apiKey: string): Promise<ModelInfo[]> {
  try {
    const client = this.clients.get(apiKey) ?? new GoogleGenAI({ apiKey })
    const pager = await client.models.list()
    // pager es un async iterable o tiene .page
    // Filtrar solo modelos gemini
    // Mapear a ModelInfo[]
  } catch (err) {
    logger.error({ err }, 'Failed to list Google models')
    return []
  }
}
```

### 1.3 Actualizar helper `buildGoogleParts()`

La función `buildGoogleParts()` (línea 38-47) construye parts para el SDK de Google. Verificar que el formato sigue siendo compatible:

```typescript
// El nuevo SDK acepta el mismo formato de parts:
// { text: string } | { inlineData: { data: string, mimeType: string } }
// Probablemente no necesite cambios, pero verificar tipos
```

### 1.4 Reescribir `callGoogle()` en `src/engine/utils/llm-client.ts`

Este archivo es el fallback cuando el módulo LLM no está activo. Tiene su propia implementación de `callGoogle()` (líneas 297-354).

1. Cambiar import:
```typescript
// ANTES
import { GoogleGenerativeAI } from '@google/generative-ai'
// DESPUÉS
import { GoogleGenAI } from '@google/genai'
```

2. Cambiar inicialización (línea 87):
```typescript
// ANTES
googleClient = new GoogleGenerativeAI(config.googleApiKey)
// DESPUÉS
googleClient = new GoogleGenAI({ apiKey: config.googleApiKey })
```

3. Reescribir `callGoogle()` con el mismo patrón que el GoogleAdapter:
- Usar `googleClient.models.generateContent()` en vez de `getGenerativeModel().startChat().sendMessage()`
- Cambiar `parameters` → `parametersJsonSchema` en tools
- Cambiar `response.text()` → `response.text`

4. Actualizar `buildGeminiParts()` helper (líneas 385-394) si necesario.

### 1.5 Verificar types.ts

Revisar si `src/modules/llm/types.ts` necesita cambios. Probablemente NO — los tipos internos de LUNA (LLMRequest, LLMResponse, etc.) son abstracciones propias que no dependen de tipos del SDK. Pero verificar:

- ¿Hay algún import de `@google/generative-ai` en types.ts? → NO, no hay
- ¿Los tipos de respuesta (toolCalls, groundingMetadata, etc.) siguen siendo compatibles? → Verificar

### 1.6 Verificar que no queden imports del viejo SDK

Buscar en todo el codebase:
```bash
grep -r "@google/generative-ai" src/ --include="*.ts"
```

Solo deben aparecer en `providers.ts` y `llm-client.ts` (los que ya cambiamos). Si hay otros, migrarlos.

**NOTA**: Los archivos que usan fetch() directo a `generativelanguage.googleapis.com` (embedding-service.ts, tts-service.ts, model-scanner.ts, server-api.ts) NO importan el SDK y NO se tocan en este plan. Se migran en el Plan 3.

### 1.7 Compilar y verificar

```bash
npx tsc --noEmit
```

Corregir cualquier error de tipos antes de commitear.

---

## Criterios de éxito

- [ ] `@google/generative-ai` eliminado de package.json y lockfile
- [ ] `@google/genai` ^1.49.0 instalado
- [ ] `@anthropic-ai/sdk` ^0.88.0 en package.json
- [ ] `GoogleAdapter.chat()` funciona con el nuevo SDK
- [ ] `GoogleAdapter.listModels()` funciona con el nuevo SDK
- [ ] `callGoogle()` en llm-client.ts funciona con el nuevo SDK
- [ ] Tool calling, JSON mode, thinking, grounding, code execution siguen funcionando
- [ ] `npx tsc --noEmit` pasa sin errores
- [ ] NO hay imports de `@google/generative-ai` en ningún archivo

---

## Trampas

- `response.text` es propiedad en el nuevo SDK, `response.text()` era método en el viejo. Si usas `()` obtendrás un error silencioso (llamar una string como función).
- `parameters` → `parametersJsonSchema` en function declarations. Si usas el viejo nombre, los tools no se parsean.
- El nuevo SDK requiere Node.js ≥20. LUNA usa ≥22, así que OK.
- Los roles en contents son `'user'` y `'model'` — NUNCA `'assistant'`.
- `ai.models.generateContent()` retorna la respuesta directamente, NO un objeto con `.response`. Verificar la estructura exacta con los tipos del SDK.
- El AnthropicAdapter NO se toca en este plan más allá del bump de versión. Los fixes específicos van en Plan 2.
