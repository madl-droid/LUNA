# Plan 2: Anthropic Adapter Optimization

**Precondición**: Plan 1 completado (SDKs actualizados, GoogleAdapter migrado).
**Archivos a modificar**: `src/modules/llm/providers.ts` (solo clase AnthropicAdapter)
**Puede ejecutarse EN PARALELO con Plan 3** (no comparten archivos).
**Riesgo**: Bajo-Medio

---

## Contexto

El AnthropicAdapter funciona pero tiene 3 bugs y 2 oportunidades de mejora. El SDK ya se actualizó a ^0.88.0 en Plan 1. Este plan aplica las correcciones y optimizaciones dentro de la clase `AnthropicAdapter` en `providers.ts`.

---

## Tareas

### 2.1 Fix: Code Execution Tool Format

**Archivo**: `src/modules/llm/providers.ts`, línea ~131 (dentro de `AnthropicAdapter.chat()`)

**Bug actual**:
```typescript
// Línea 131-132
if (request.codeExecution) {
  tools.push({ type: 'code_execution' })
}
```

El formato `{ type: 'code_execution' }` NO es válido en la API de Anthropic. El formato correcto requiere un type versionado y un name.

**Fix**:
```typescript
if (request.codeExecution) {
  tools.push({ type: 'code_execution_20260120', name: 'code_execution' })
}
```

**Nota**: `code_execution_20260120` es la versión más reciente (soporta REPL state persistence). Si se necesita compatibilidad con modelos más viejos que no soporten esta versión, usar `code_execution_20250825` como fallback. Pero dado que LUNA usa modelos 4.5+ y 4.6, la versión nueva es correcta.

### 2.2 Fix: Adaptive Thinking (effort vs budget_tokens)

**Archivo**: `src/modules/llm/providers.ts`, líneas ~110-116 (dentro de `AnthropicAdapter.chat()`)

**Bug actual**:
```typescript
// Líneas 110-116
if (request.thinking) {
  params.thinking = {
    type: request.thinking.type === 'adaptive' ? 'adaptive' : 'enabled',
    budget_tokens: request.thinking.budgetTokens ?? 4096,
  }
  delete params.temperature
}
```

Cuando `type: 'adaptive'`, el parámetro `budget_tokens` NO debe enviarse. En su lugar, se usa `effort`. Para modelos Claude 4.6, `budget_tokens` está deprecated.

**Fix**:
```typescript
if (request.thinking) {
  if (request.thinking.type === 'adaptive') {
    // Adaptive thinking: usa effort level, NO budget_tokens (deprecated en 4.6)
    params.thinking = {
      type: 'adaptive',
      effort: request.thinking.effort ?? 'medium',
    }
  } else {
    // Manual thinking: usa budget_tokens (para modelos pre-4.6 o control manual)
    params.thinking = {
      type: 'enabled',
      budget_tokens: request.thinking.budgetTokens ?? 4096,
    }
  }
  delete params.temperature // Anthropic: thinking y temperature son incompatibles
}
```

**Cambio requerido en types.ts** — agregar campo `effort` a la interfaz thinking de `LLMRequest`:
```typescript
// En src/modules/llm/types.ts, dentro de LLMRequest.thinking
thinking?: {
  type: 'enabled' | 'adaptive'
  budgetTokens?: number
  effort?: 'low' | 'medium' | 'high'  // ← AGREGAR
}
```

**Verificar también** que el effort router en `src/engine/agentic/effort-router.ts` y el config en `src/engine/agentic/types.ts` usen este campo correctamente. Hoy LUNA clasifica effort como 'normal' o 'complex'. Mapeo sugerido:
- `normal` → `effort: 'medium'`
- `complex` → `effort: 'high'`

Pero este mapeo se hace en el caller (engine), NO en el adapter. El adapter solo pasa lo que recibe.

### 2.3 Mejora: JSON Mode con output_config.format

**Archivo**: `src/modules/llm/providers.ts`, líneas ~138-139 y ~174-176

**Código actual** (prefill trick):
```typescript
// Líneas 138-139: antes de la llamada
if (request.jsonMode && !request.tools?.length) {
  messages.push({ role: 'assistant', content: '{' })
}

// Líneas 174-176: después de la llamada
if (request.jsonMode && !request.tools?.length) {
  text = '{' + text
}
```

**Mejora**: Usar `output_config.format` cuando hay un JSON schema disponible. Mantener el prefill trick como fallback para cuando no hay schema.

```typescript
// ANTES de la llamada: determinar si usar output_config o prefill
if (request.jsonMode) {
  if (request.jsonSchema) {
    // Schema disponible → usar output_config.format (nativo, garantizado)
    params.output_config = {
      format: {
        type: 'json_schema',
        schema: request.jsonSchema,
      },
    }
  } else if (!request.tools?.length) {
    // Sin schema, sin tools → prefill trick como fallback
    messages.push({ role: 'assistant', content: '{' })
  }
}

// DESPUÉS de la llamada: solo prepend '{' si usamos prefill trick
if (request.jsonMode && !request.jsonSchema && !request.tools?.length) {
  text = '{' + text
}
```

**Nota**: `output_config` es un campo nuevo en la API. El tipo del SDK lo soporta. No requiere beta headers.

### 2.4 Mejora: Batch API via SDK methods

**Archivo**: `src/modules/llm/providers.ts`, métodos `submitBatch()`, `getBatchStatus()`, `getBatchResults()` (líneas ~231-320)

**Código actual**: 3 métodos usando `fetch()` raw con URLs hardcodeadas, headers manuales, parsing manual.

**Migrar a SDK**:

```typescript
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
  // El SDK retorna un async iterable
  for await (const item of client.messages.batches.results(batchId)) {
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
```

**Nota**: La API del SDK retorna tipos tipados — aprovecharllos en vez de castear a `Record<string, unknown>`.

### 2.5 Fix menor: listModels() — eliminar anthropic-version hardcoded

**Archivo**: `src/modules/llm/providers.ts`, línea ~212

**Código actual**:
```typescript
const res = await fetch('https://api.anthropic.com/v1/models', {
  headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
})
```

**Mejora**: Usar el SDK en vez de fetch raw:
```typescript
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
```

### 2.6 Compilar y verificar

```bash
npx tsc --noEmit
```

---

## Criterios de éxito

- [ ] Code execution usa formato `code_execution_20260120`
- [ ] Adaptive thinking envía `effort` en vez de `budget_tokens`
- [ ] JSON mode usa `output_config.format` cuando hay schema, prefill como fallback
- [ ] Batch methods usan SDK en vez de fetch raw
- [ ] listModels usa SDK en vez de fetch raw
- [ ] types.ts tiene campo `effort` en thinking
- [ ] `npx tsc --noEmit` pasa sin errores

---

## Trampas

- `output_config` y `output_format` son diferentes. `output_format` es el viejo parámetro beta. Usar `output_config.format`.
- `client.messages.batches.results()` retorna un async iterable, NO un array. Usar `for await`.
- El campo `effort` en thinking es `'low' | 'medium' | 'high'`, NO `'normal' | 'complex'`.
- Al cambiar el tipo de thinking en types.ts, verificar que todos los callers compilan. Los callers actuales probablemente no pasan `effort` — verificar que el default `'medium'` es sensato.
- El `AnthropicAdapter.chat()` ya tenía `params as unknown as Anthropic.MessageCreateParams` cast (línea 148). Al agregar `output_config`, ese cast sigue siendo necesario hasta que los tipos del SDK se actualicen.
