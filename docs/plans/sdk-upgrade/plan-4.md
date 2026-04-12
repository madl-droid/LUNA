# Plan 4: Native Tool Calling Format

**Precondición**: Planes 1, 2, y 3 completados (SDKs migrados, adapters corregidos).
**Archivos a modificar**: `src/modules/llm/types.ts`, `src/engine/types.ts`, `src/modules/llm/providers.ts` (ambos adapters), `src/engine/agentic/agentic-loop.ts`, `src/engine/utils/llm-client.ts`
**Riesgo**: Alto (cambio en core loop — testing exhaustivo requerido)

---

## Contexto

### El problema actual

El agentic loop en `src/engine/agentic/agentic-loop.ts` maneja tool calling de forma sub-óptima. Cuando el LLM produce tool calls y LUNA las ejecuta, los resultados se envían de vuelta al modelo como **texto plano**:

```
// Assistant message (línea 484-494):
"[Tool call: search_knowledge({\"query\":\"precios lista A\"})]"

// User message con resultados (línea 499-517):
"Tool results:\n\n[search_knowledge]: {\"results\": [{\"title\": \"...\", ...}]}"
```

Ambas APIs (Anthropic y Google) tienen formatos nativos para tool calling multi-turn:

**Anthropic** espera:
```json
// Assistant turn:
{ "role": "assistant", "content": [
  { "type": "text", "text": "Let me search..." },
  { "type": "tool_use", "id": "toolu_xxx", "name": "search_knowledge", "input": {...} }
]}
// User turn con resultado:
{ "role": "user", "content": [
  { "type": "tool_result", "tool_use_id": "toolu_xxx", "content": "result data" }
]}
```

**Google** espera:
```json
// Model turn:
{ "role": "model", "parts": [
  { "text": "Let me search..." },
  { "functionCall": { "name": "search_knowledge", "args": {...} } }
]}
// User turn con resultado:
{ "role": "user", "parts": [
  { "functionResponse": { "name": "search_knowledge", "response": { "result": data } } }
]}
```

### Beneficios de migrar

1. **Ahorro de tokens**: Menos overhead textual (sin `[Tool call: ...]`, sin `Tool results:`)
2. **Fiabilidad**: El modelo sabe exactamente qué es un resultado de tool vs texto del usuario
3. **IDs de llamada**: Anthropic vincula request↔response por ID (tracking preciso)
4. **Llamadas encadenadas**: Mejor continuidad en multi-turn con 3-8 tool calls

---

## Tareas

### 4.1 Extender tipos LLMMessage para soportar content blocks

**Archivo**: `src/modules/llm/types.ts`

El tipo `LLMMessage` actual solo soporta texto:
```typescript
export interface LLMMessage {
  role: 'user' | 'assistant' | 'system'
  content: string | ContentPart[]  // ContentPart = text | image | audio | video
}
```

Agregar soporte para content blocks de tool calling:

```typescript
// Nuevo: Content block types para tool calling nativo
export interface ToolUseBlock {
  type: 'tool_use'
  id: string         // ID generado por el LLM (ej: 'toolu_xxx')
  name: string
  input: Record<string, unknown>
}

export interface ToolResultBlock {
  type: 'tool_result'
  toolUseId: string  // Vincula al ToolUseBlock.id
  name: string       // Nombre del tool (para Google que usa name en vez de ID)
  content: string    // Resultado serializado
  isError?: boolean  // Si el tool falló
}

export interface TextBlock {
  type: 'text'
  text: string
}

// Union type para content blocks en mensajes
export type MessageContentBlock = TextBlock | ToolUseBlock | ToolResultBlock | ContentPart

// Actualizar LLMMessage
export interface LLMMessage {
  role: 'user' | 'assistant' | 'system'
  content: string | ContentPart[] | MessageContentBlock[]
}
```

### 4.2 Actualizar LLMResponse para incluir tool_use IDs

**Archivo**: `src/modules/llm/types.ts`

El tipo `LLMToolCall` actual no tiene ID:
```typescript
export interface LLMToolCall {
  name: string
  input: Record<string, unknown>
}
```

Agregar ID:
```typescript
export interface LLMToolCall {
  id: string   // ← AGREGAR: ID del tool_use (Anthropic) o generado para Google
  name: string
  input: Record<string, unknown>
}
```

### 4.3 Actualizar tipos del engine

**Archivo**: `src/engine/types.ts`

Buscar la definición de `LLMCallOptions` y su tipo de messages. Agregar soporte para content blocks. La interfaz `LLMCallOptions` (verificar nombre exacto) define el formato de mensajes que el engine envía al gateway.

```typescript
// Verificar y actualizar la interfaz de messages en LLMCallOptions
// para que soporte contenido estructurado además de strings
messages: Array<{
  role: 'user' | 'assistant' | 'system'
  content: string | import('../modules/llm/types.js').MessageContentBlock[]
}>
```

### 4.4 Actualizar AnthropicAdapter para manejar tool content blocks

**Archivo**: `src/modules/llm/providers.ts` — dentro de `AnthropicAdapter.chat()`

**4.4a**: Al construir mensajes, detectar y convertir content blocks:
```typescript
// Dentro del loop que construye messages (línea ~78)
for (const m of request.messages) {
  if (m.role === 'system') continue

  if (typeof m.content === 'string') {
    messages.push({ role: m.role as 'user' | 'assistant', content: m.content })
  } else if (Array.isArray(m.content)) {
    // Detectar si hay content blocks de tool calling
    const hasToolBlocks = m.content.some(
      (b: any) => b.type === 'tool_use' || b.type === 'tool_result'
    )

    if (hasToolBlocks) {
      const blocks: Anthropic.ContentBlockParam[] = []
      for (const block of m.content as MessageContentBlock[]) {
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
        // Otros ContentPart se manejan por buildAnthropicContent existente
      }
      messages.push({ role: m.role as 'user' | 'assistant', content: blocks })
    } else {
      // Contenido multimedia sin tool blocks — usar path existente
      messages.push({
        role: m.role as 'user' | 'assistant',
        content: this.buildAnthropicContent(m),
      })
    }
  }
}
```

**4.4b**: Al parsear la respuesta, capturar tool_use IDs:
```typescript
// Donde se parsean tool calls (línea ~159-161)
} else if (block.type === 'tool_use') {
  toolCalls.push({
    id: block.id,   // ← CAPTURAR el ID
    name: block.name,
    input: block.input as Record<string, unknown>,
  })
}
```

### 4.5 Actualizar GoogleAdapter para manejar tool content blocks

**Archivo**: `src/modules/llm/providers.ts` — dentro de `GoogleAdapter.chat()`

**4.5a**: Al construir contents, detectar y convertir content blocks:
```typescript
// Al construir history y lastMessage
// Google usa functionCall en model parts y functionResponse en user parts

for (const m of nonSystemMessages) {
  const role = m.role === 'assistant' ? 'model' : 'user'

  if (typeof m.content === 'string') {
    contents.push({ role, parts: [{ text: m.content }] })
  } else if (Array.isArray(m.content)) {
    const hasToolBlocks = m.content.some(
      (b: any) => b.type === 'tool_use' || b.type === 'tool_result'
    )

    if (hasToolBlocks) {
      const parts: any[] = []
      for (const block of m.content as MessageContentBlock[]) {
        if (block.type === 'tool_use') {
          // Google: functionCall en model turn
          parts.push({
            functionCall: {
              name: (block as ToolUseBlock).name,
              args: (block as ToolUseBlock).input,
            },
          })
        } else if (block.type === 'tool_result') {
          // Google: functionResponse en user turn
          const resultBlock = block as ToolResultBlock
          let parsedResult: Record<string, unknown>
          try {
            parsedResult = JSON.parse(resultBlock.content)
          } catch {
            parsedResult = { result: resultBlock.content }
          }
          parts.push({
            functionResponse: {
              name: resultBlock.name,
              response: parsedResult,
            },
          })
        } else if (block.type === 'text') {
          parts.push({ text: (block as TextBlock).text })
        }
      }
      contents.push({ role, parts })
    } else {
      contents.push({ role, parts: buildGoogleParts(m.content) })
    }
  }
}
```

**4.5b**: Al parsear tool calls, generar IDs para Google (Google no genera IDs nativamente como Anthropic):
```typescript
// Generar ID compatible
if ('functionCall' in part && part.functionCall) {
  toolCalls.push({
    id: `gc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    name: part.functionCall.name,
    input: (part.functionCall.args ?? {}) as Record<string, unknown>,
  })
}
```

### 4.6 Actualizar agentic-loop.ts — el cambio principal

**Archivo**: `src/engine/agentic/agentic-loop.ts`

**4.6a**: Cambiar tipo de messages array:

```typescript
// ANTES (línea ~129):
const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [...]

// DESPUÉS:
import type { MessageContentBlock, ToolUseBlock, ToolResultBlock, TextBlock } from '../../modules/llm/types.js'

const messages: Array<{
  role: 'user' | 'assistant'
  content: string | MessageContentBlock[]
}> = [
  { role: 'user', content: userMessage ?? ctx.normalizedText },
]
```

**4.6b**: Cuando el LLM retorna tool calls, construir assistant message con content blocks:

```typescript
// ANTES (líneas 229-237):
messages.push({
  role: 'assistant',
  content: formatAssistantToolMessage(llmResult.text, llmResult.toolCalls),
})
messages.push({
  role: 'user',
  content: formatToolResultsMessage(toolResults),
})

// DESPUÉS:
// Assistant message: texto parcial + tool_use blocks
const assistantBlocks: MessageContentBlock[] = []
if (llmResult.text) {
  assistantBlocks.push({ type: 'text', text: llmResult.text })
}
for (const tc of llmResult.toolCalls) {
  assistantBlocks.push({
    type: 'tool_use',
    id: tc.id,
    name: tc.name,
    input: tc.input,
  })
}
messages.push({ role: 'assistant', content: assistantBlocks })

// User message: tool_result blocks
const resultBlocks: MessageContentBlock[] = []
for (let i = 0; i < toolResults.length; i++) {
  const r = toolResults[i]!
  const tc = llmResult.toolCalls[i]!
  const dataStr = r.success
    ? (typeof r.data === 'string' ? r.data : JSON.stringify(r.data)) ?? '(no data)'
    : `ERROR: ${r.error ?? 'Unknown error'}`
  // Truncar resultados grandes
  const MAX_TOOL_RESULT_CHARS = 8_000
  const content = dataStr.length > MAX_TOOL_RESULT_CHARS
    ? dataStr.slice(0, MAX_TOOL_RESULT_CHARS) + `\n[truncated: ${MAX_TOOL_RESULT_CHARS}/${dataStr.length} chars]`
    : dataStr
  resultBlocks.push({
    type: 'tool_result',
    toolUseId: tc.id,
    name: tc.name,
    content,
    isError: !r.success,
  })
}
messages.push({ role: 'user', content: resultBlocks })
```

**4.6c**: Eliminar las funciones `formatAssistantToolMessage()` y `formatToolResultsMessage()` (líneas 484-517). Ya no se necesitan.

**4.6d**: Actualizar la llamada de turn limit / circuit break (línea ~258):
```typescript
// La llamada final sin tools no necesita cambio — ya envía messages como texto
// Pero ahora messages puede contener content blocks. La llamada final
// puede seguir enviando un mensaje de texto como está.
messages.push({
  role: 'user',
  content: 'You have reached the tool call limit. Please provide your final response now...',
})
```

### 4.7 Actualizar llm-client.ts — gateway delegation

**Archivo**: `src/engine/utils/llm-client.ts`

La interfaz `LLMGatewayLike` (línea ~18) define los tipos de messages. Actualizar:

```typescript
interface LLMGatewayLike {
  chat(request: {
    // ...
    messages: Array<{
      role: string
      content: string | import('../../modules/llm/types.js').MessageContentBlock[]
    }>
    // ...
  }): Promise<{
    // ...
    toolCalls?: Array<{ id: string; name: string; input: Record<string, unknown> }>
    // ...
  }>
}
```

También actualizar el tipo de retorno `LLMCallResult` para incluir `id` en toolCalls.

Verificar `callViaGateway()` (línea ~192) — debe pasar messages tal cual al gateway.

Para las funciones de fallback directo (`callAnthropic`, `callGoogle`), el handling de tool content blocks es opcional dado que es un path de fallback. Pero al menos los toolCalls retornados deben tener `id`:

```typescript
toolCalls.push({
  id: block.id,  // Anthropic ya retorna ID
  name: block.name,
  input: block.input as Record<string, unknown>,
})
```

### 4.8 Compilar y verificar

```bash
npx tsc --noEmit
```

**IMPORTANTE**: Debido a la complejidad de este cambio, verificar:
1. Que `noUncheckedIndexedAccess` no cause problemas con los arrays de tool calls
2. Que los tipos de `MessageContentBlock` y `ContentPart` no tengan conflictos
3. Que el path de "sin tools" (LLM responde solo texto) siga funcionando sin cambios

---

## Criterios de éxito

- [ ] Tool calls y resultados se envían como content blocks nativos (no texto)
- [ ] Anthropic recibe `tool_use` + `tool_result` blocks con IDs vinculados
- [ ] Google recibe `functionCall` + `functionResponse` parts
- [ ] Mensajes de texto normales (sin tools) siguen funcionando sin cambio
- [ ] La llamada final de "turn limit" sigue funcionando
- [ ] El path de error/fallback sigue produciendo texto plano
- [ ] `LLMToolCall.id` se captura y propaga correctamente
- [ ] `npx tsc --noEmit` pasa sin errores

---

## Trampas

- **LLMToolCall.id es NUEVO** — todos los sitios que construyen `LLMToolCall` necesitan generar un ID. Anthropic los genera automáticamente. Google no — generar un ID sintético.
- **Content block arrays vs string**: Muchos sitios asumen que `message.content` es `string`. El agentic loop solo debe usar content blocks para mensajes con tool calls. Los mensajes normales deben seguir usando `string`.
- **Orden de resultados**: Los tool results deben estar en el mismo orden que los tool calls del assistant message. Anthropic vincula por `tool_use_id`, Google vincula por nombre de función.
- **La truncación de resultados** (MAX_TOOL_RESULT_CHARS = 8000) debe mantenerse — está en el content string de cada ToolResultBlock.
- **El subagent tool** (`run_subagent`) y el skill read tool deben retornar IDs compatibles.
- **No cambiar el formato de los mensajes que se persisten en la base de datos** — memory/session storage sigue usando texto plano. Los content blocks son solo para la conversación LLM en-flight.
