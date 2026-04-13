# Plan 6: Audit Fixes — SDK Upgrade Cleanup

**Precondición**: Planes 1-5 completados y mergeados.
**Archivos a modificar**: 6 archivos
**Riesgo**: Bajo (fixes puntuales, sin rediseño)
**Fuente**: `docs/plans/audit-fixes/sdk-upgrade-audit.md`

---

## Items en scope

| ID | Tipo | Severidad | Descripción |
|---|---|---|---|
| P1 | Violación | Alta | Console importa GoogleGenAI directo — debe usar tts:service |
| B1+P2 | Bug+Violación | Media | API key expuesta en URL de batch embeddings |
| B2 | Bug | Baja | EmbeddingService crea cliente con key 'placeholder' |
| B3 | Bug | Baja | Console TTS preview sin error handling específico |
| R3 | Redundancia | Baja | detectFamily() duplicado en mismo módulo |
| C1 | Complejidad | Baja | AnyPart duck-typed cuando ya hay imports reales disponibles |
| C2 | Complejidad | Baja | TTS callTTSModel() recibe requestBody monolítico con as any |

### Items excluidos

| ID | Razón |
|---|---|
| R1+R2 | `buildGoogleParts`/`buildAnthropicContent` duplicados entre providers.ts y llm-client.ts — es correcto por diseño: engine no puede importar de módulos. Funcional y aceptable. |
| G2 | `docs/architecture/pipeline.md` y `task-routing.md` no tenían refs a SDKs — no había nada que cambiar. |
| G3 | `parameters` vs `parametersJsonSchema` en Gemini Live WebSocket — necesita investigación contra la API v1beta. No es un fix puntual, es una pregunta abierta. Dejar como deuda técnica documentada. |

---

## Tareas

### 6.1 P1 — Console TTS preview: usar tts:service via registry

**Archivo**: `src/modules/console/server-api.ts`
**Líneas**: ~803-860

**Problema**: El módulo console importa `GoogleGenAI` y crea su propio cliente SDK para el TTS preview. Viola la regla "NO importar código entre módulos — usar services del registry".

**Fix**: Reemplazar todo el bloque de TTS preview con delegación a `tts:service`.

El handler ya tiene acceso al registry via `getRegistryRef()` (línea 805). El `tts:service` registrado por el módulo TTS expone `synthesize(text: string)` que retorna `{ audioBuffer: Buffer, durationSeconds: number } | null`.

**PERO**: el preview necesita una voz específica (`body.voiceName`) que puede ser diferente a la configurada en `tts:service`. Hay dos opciones:

**Opción A (pragmática)**: El TTS preview usa el tts:service con la voz configurada. Si el usuario quiere probar otra voz, cambia la config primero. Esto simplifica enormemente el handler.

**Opción B (completa)**: Agregar un método `synthesizeWithVoice(text, voiceName)` al tts:service para que el preview pueda especificar la voz sin cambiar la config global.

**Recomendación**: Opción B es mejor porque el preview existe precisamente para probar voces antes de configurarlas. Sin ese método, el preview pierde su razón de ser.

**Implementación Opción B**:

En `src/modules/tts/tts-service.ts`, agregar método público:
```typescript
/**
 * Synthesize with a specific voice (used by console preview).
 * Does NOT change the service config — one-shot override.
 */
async synthesizeWithVoice(text: string, voiceName: string): Promise<SynthesizeResult | null> {
  if (!this.client) return null
  if (!text || text.trim().length === 0) return null

  // Build TTS contents and config inline (no requestBody intermediary)
  const contents = [{ role: 'user' as const, parts: [{ text: text.substring(0, 500) }] }]
  const config = {
    responseModalities: ['AUDIO' as const],
    speechConfig: {
      voiceConfig: {
        prebuiltVoiceConfig: { voiceName },
      },
    },
  }

  return this.callTTSModelDirect(this.config.TTS_MODEL || 'gemini-2.5-flash-preview-tts', contents, config)
}
```

Donde `callTTSModelDirect` es el refactor de `callTTSModel` que recibe `contents` y `config` directamente (ver tarea 6.7 — C2).

En `src/modules/console/server-api.ts`:
1. **Eliminar** `import { GoogleGenAI } from '@google/genai'` (línea 5 o similar)
2. **Reemplazar** el bloque TTS preview (líneas ~803-860) con:
```typescript
const { getRegistryRef } = await import('./manifest-ref.js')
const registry = getRegistryRef()!
const ttsService = registry.getOptional<{
  synthesizeWithVoice(text: string, voiceName: string): Promise<{ audioBuffer: Buffer; durationSeconds: number } | null>
}>('tts:service')
if (!ttsService) {
  jsonResponse(res, 503, { error: 'TTS service not available' })
  return
}
try {
  const result = await ttsService.synthesizeWithVoice(body.text, body.voiceName)
  if (!result) {
    jsonResponse(res, 502, { error: 'TTS synthesis returned no audio' })
    return
  }
  // Convert to WAV for browser playback (same PCM→WAV as before)
  const pcmBuffer = result.audioBuffer
  // ... WAV header code stays the same ...
} catch (err) {
  logger.error({ err }, 'TTS preview failed')
  jsonResponse(res, 502, { error: 'TTS preview failed' })
}
```

**NOTA**: `result.audioBuffer` del tts:service es OGG/Opus (post-ffmpeg), no PCM raw. El preview actual espera PCM para convertir a WAV. Dos opciones:
- Si el browser puede reproducir OGG → enviar como OGG directamente (más simple)
- Si necesita WAV → que `synthesizeWithVoice()` retorne PCM raw (antes de ffmpeg conversion)

Verificar qué formato espera el browser del preview. Si el JS del console reproduce audio via `new Audio()`, OGG funciona en todos los browsers modernos excepto Safari. Si Safari es necesario, retornar WAV. Evaluar y decidir.

### 6.2 B1+P2 — Sanitizar API key en batch embeddings URL

**Archivo**: `src/modules/knowledge/embedding-service.ts`, línea ~177

**Problema**: `fetch(...?key=${this.apiKey}...)` — si la request falla, el error message puede incluir la URL completa con la API key, que termina en logs.

**Fix**: Mover la API key de query string a header `x-goog-api-key`:

```typescript
const url = `${BATCH_API_BASE}/${this.model}:batchEmbedContents`
const res = await fetch(url, {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-goog-api-key': this.apiKey,  // header instead of query param
  },
  body: JSON.stringify(body),
  signal: AbortSignal.timeout(30000),
})
```

Verificar que la API de Google acepta `x-goog-api-key` header para batch embeddings (lo acepta — es el estándar para APIs de Google AI). Si por alguna razón no funciona, alternativa: envolver el error para strip la URL.

También eliminar la constante `BATCH_API_BASE` y usar la URL directamente ya que solo se usa en un lugar.

### 6.3 B2 — Eliminar cliente con key 'placeholder'

**Archivo**: `src/modules/knowledge/embedding-service.ts`, línea 44

**Código actual**:
```typescript
this.client = new GoogleGenAI({ apiKey: apiKey || 'placeholder' })
```

**Fix**:
```typescript
this.client = apiKey ? new GoogleGenAI({ apiKey }) : null
```

Luego agregar null checks en `generateEmbedding()` y `generateFileEmbedding()`:
```typescript
if (!this.isAvailable() || !this.client) return null
```

`isAvailable()` ya chequea `!this.apiKey`, así que el `!this.client` es redundante pero explícito y no cuesta nada.

### 6.4 B3 — Error handling en console TTS preview

**Se resuelve como parte de 6.1** — la delegación a tts:service tiene su propio try-catch con error descriptivo. Si se implementa la opción B, el tts:service maneja errores internamente y retorna null, y el handler responde 502.

### 6.5 R3 — Deduplicar detectFamily()

**Archivos**:
- `src/modules/llm/providers.ts:656-663` (función `detectFamily`)
- `src/modules/llm/model-scanner.ts:23-29` (función `detectFamily`)

**Fix**: Crear `src/modules/llm/helpers.ts` y mover la función ahí:

```typescript
// src/modules/llm/helpers.ts
const FAMILIES = ['haiku', 'sonnet', 'opus', 'flash', 'pro'] as const

export function detectFamily(modelId: string): string {
  const lower = modelId.toLowerCase()
  for (const f of FAMILIES) {
    if (lower.includes(f)) return f
  }
  return 'unknown'
}
```

En `providers.ts` y `model-scanner.ts`: eliminar las funciones locales e importar:
```typescript
import { detectFamily } from './helpers.js'
```

`model-scanner.ts` también tiene constantes `ANTHROPIC_FAMILIES` y `GOOGLE_FAMILIES` que ya no se necesitan si usa la función unificada.

### 6.6 C1 — Eliminar AnyPart duck type, usar imports reales

**Archivo**: `src/engine/utils/llm-client.ts`, líneas ~361-375

**Problema**: `AnyPart` es un duck type con campos opcionales de todas las interfaces de bloques. El archivo ya importa de `../../modules/llm/types.js` (línea 23 de LLMGatewayLike), así que no hay razón para no importar los tipos reales.

**Fix**: Eliminar `type AnyPart` y agregar imports:

```typescript
import type {
  MessageContentBlock,
  ToolUseBlock,
  ToolResultBlock,
  TextBlock,
  ContentPart,
} from '../../modules/llm/types.js'
```

Luego en `buildAnthropicContent()` y `buildGeminiParts()`:
```typescript
// En vez de: for (const part of content as AnyPart[])
// Usar:
for (const part of content as MessageContentBlock[]) {
  if (part.type === 'tool_use') {
    const tu = part as ToolUseBlock
    blocks.push({ type: 'tool_use', id: tu.id, name: tu.name, input: tu.input })
  } else if (part.type === 'tool_result') {
    const tr = part as ToolResultBlock
    blocks.push({ type: 'tool_result', tool_use_id: tr.toolUseId, content: tr.content, is_error: tr.isError })
  } else if (part.type === 'text') {
    blocks.push({ type: 'text', text: (part as TextBlock).text })
  } else if (part.type === 'image_url') {
    const p = part as ContentPart
    // ... existing image handling
  }
  // etc.
}
```

### 6.7 C2 — Refactorizar callTTSModel() para recibir params separados

**Archivo**: `src/modules/tts/tts-service.ts`

**Problema**: `synthesize()` construye un `requestBody: Record<string, unknown>` monolítico y `callTTSModel()` lo descompone con `as any` casts.

**Fix**: Cambiar la firma de `callTTSModel()`:

```typescript
// ANTES
private async callTTSModel(model: string, requestBody: Record<string, unknown>): Promise<SynthesizeResult | null>

// DESPUÉS
private async callTTSModelDirect(
  model: string,
  contents: Array<{ role: string; parts: Array<{ text: string }> }>,
  config: Record<string, unknown>,
): Promise<SynthesizeResult | null>
```

Dentro del método, usar directamente:
```typescript
const response = await Promise.race([
  this.client.models.generateContent({ model, contents, config }),
  // timeout...
])
```

Y actualizar `synthesize()` para construir contents y config por separado:
```typescript
const contents = [{ role: 'user', parts: [{ text: styledText }] }]
const config = {
  responseModalities: ['AUDIO'],
  temperature,
  speechConfig: {
    voiceConfig: {
      prebuiltVoiceConfig: { voiceName: this.config.TTS_VOICE_NAME || 'Kore' },
    },
  },
}

const primaryModel = this.config.TTS_MODEL || 'gemini-2.5-flash-preview-tts'
let result = await this.callTTSModelDirect(primaryModel, contents, config)
```

Esto también habilita `synthesizeWithVoice()` de la tarea 6.1, que puede llamar a `callTTSModelDirect()` con una config diferente.

### 6.8 Compilar y verificar

```bash
npx tsc --noEmit
```

---

## Criterios de éxito

- [ ] Console NO importa `GoogleGenAI` ni `@google/genai`
- [ ] Console TTS preview usa `tts:service` via registry
- [ ] Batch embeddings URL no contiene API key (usa header)
- [ ] EmbeddingService no crea cliente con key 'placeholder'
- [ ] Console TTS preview tiene error handling descriptivo
- [ ] `detectFamily()` existe en un solo lugar (helpers.ts) e importado por providers y scanner
- [ ] `AnyPart` duck type eliminado de llm-client.ts
- [ ] `callTTSModel()` no usa `as any` casts
- [ ] `npx tsc --noEmit` pasa sin errores

---

## Orden de ejecución sugerido

6.7 (C2) y 6.1 (P1) están entrelazados — `synthesizeWithVoice()` necesita `callTTSModelDirect()`. Hacer en orden:

1. **6.7** — Refactorizar callTTSModel en tts-service.ts
2. **6.1** — Console TTS preview via tts:service (depende de 6.7)
3. **6.2** — Sanitizar API key batch embeddings
4. **6.3** — Eliminar placeholder client
5. **6.5** — Deduplicar detectFamily
6. **6.6** — Eliminar AnyPart
7. **6.8** — Compilar

6.4 (B3) se resuelve automáticamente con 6.1.

---

## Trampas

- **El TTS preview retorna OGG/Opus** (post-ffmpeg), no PCM raw. El handler actual convierte PCM→WAV para el browser. Si se delega a tts:service, el formato de retorno cambia. Verificar qué formato necesita el browser.
- **`x-goog-api-key` header**: Funciona para Gemini API. No usar `Authorization: Bearer` (eso es para OAuth, no para API keys).
- **Los tipos en llm-client.ts**: Al importar de `../../modules/llm/types.js`, se crea una dependencia engine→module. Pero esto ya existe (línea 23), así que no es nuevo.
- **`synthesizeWithVoice()` necesita exponerse en la interfaz del servicio**: Verificar que el tipo registrado en el registry (`tts:service`) incluya este método, o que el handler del console use un tipo inline.
