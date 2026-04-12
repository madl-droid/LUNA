# Plan 3: Google Peripheral Services Migration

**Precondición**: Plan 1 completado (`@google/genai` instalado).
**Puede ejecutarse EN PARALELO con Plan 2** (no comparten archivos).
**Archivos a modificar**: `src/modules/knowledge/embedding-service.ts`, `src/modules/tts/tts-service.ts`, `src/modules/llm/model-scanner.ts`, `src/modules/console/server-api.ts`, `src/modules/llm/llm-gateway.ts`
**Riesgo**: Bajo-Medio

---

## Contexto

Varios servicios hacen llamadas directas a la REST API de Google vía `fetch()` en vez de usar el SDK. Ahora que `@google/genai` está instalado (Plan 1), estos servicios se pueden migrar para usar el SDK, obteniendo: tipos TypeScript, manejo de errores consistente, y menos código boilerplate.

La TTS en `llm-gateway.ts` usa la API vieja de Google Cloud TTS (`texttospeech.googleapis.com`) — es código muerto dado que el módulo TTS (`tts-service.ts`) usa Gemini TTS directamente.

---

## Tareas

### 3.1 Migrar `embedding-service.ts` a `@google/genai`

**Archivo**: `src/modules/knowledge/embedding-service.ts`

**Estado actual**: Usa `fetch()` directo a `generativelanguage.googleapis.com/v1beta/models/{model}:embedContent` y `:batchEmbedContents`. Tiene su propio circuit breaker y rate limiter (que deben mantenerse).

**Migración**:

1. Agregar import y campo de cliente:
```typescript
import { GoogleGenAI } from '@google/genai'

export class EmbeddingService {
  private readonly client: GoogleGenAI
  // ... mantener apiKey, model, dimensions, log, circuit breaker, rate limiter

  constructor(apiKey: string, logger: pino.Logger, model?: string, dimensions?: number) {
    // ... código existente
    this.client = new GoogleGenAI({ apiKey })
  }
}
```

2. Reescribir `generateEmbedding()` (líneas 66-107):
```typescript
async generateEmbedding(text: string): Promise<number[] | null> {
  if (!this.isAvailable()) return null
  if (!text.trim()) return null
  if (!this.consumeToken()) {
    this.log.warn('Rate limit reached, skipping embedding')
    return null
  }

  try {
    const result = await this.client.models.embedContent({
      model: this.model,
      contents: { parts: [{ text }] },
      config: { outputDimensionality: this.dimensions },
    })

    const values = result.embeddings?.[0]?.values
    if (!values || values.length === 0) {
      this.log.warn('Embedding response missing values')
      return null
    }

    this.resetFailures()
    return values
  } catch (err) {
    this.recordFailure()
    this.log.error({ err }, 'Embedding generation failed')
    return null
  }
}
```

**IMPORTANTE**: Verificar la estructura exacta de la respuesta de `ai.models.embedContent()` en el SDK. Los campos pueden ser `result.embeddings[0].values` o `result.embedding.values`. Consultar los tipos del SDK.

**NOTA sobre timeout**: El código actual usa `AbortSignal.timeout(15000)`. El nuevo SDK puede que acepte `signal` en el config o puede que no. Si no lo acepta, mantener `Promise.race` con timeout manual como hace el GoogleAdapter en providers.ts.

3. Reescribir `generateFileEmbedding()` (líneas 113-169) — patrón similar con `inlineData`:
```typescript
async generateFileEmbedding(data: Buffer, mimeType: string): Promise<number[] | null> {
  // ... validaciones existentes (mantener SUPPORTED check, consumeToken, etc.)

  try {
    const base64 = data.toString('base64')
    const result = await this.client.models.embedContent({
      model: this.model,
      contents: {
        parts: [{ inlineData: { mimeType, data: base64 } }],
      },
      config: { outputDimensionality: this.dimensions },
    })

    const values = result.embeddings?.[0]?.values
    if (!values) return null

    this.resetFailures()
    return values
  } catch (err) {
    this.recordFailure()
    this.log.error({ err, mimeType }, 'Multimodal file embedding failed')
    return null
  }
}
```

4. Reescribir `generateBatchEmbeddings()` (líneas 175-225):

Verificar si el nuevo SDK tiene un método `batchEmbedContents`. Si lo tiene, usarlo. Si no, hacer N llamadas individuales con concurrencia controlada (el batch endpoint es un sugar de REST API que puede no estar en el SDK).

**Opción A** — SDK tiene batch method:
```typescript
const result = await this.client.models.batchEmbedContents({
  model: this.model,
  requests: capped.map(text => ({
    content: { parts: [{ text }] },
    outputDimensionality: this.dimensions,
  })),
})
```

**Opción B** — SDK no tiene batch, mantener fetch directo:
Si el SDK no expone `batchEmbedContents`, mantener el `fetch()` actual para este método solamente. No forzar una migración parcial que empeore el código.

5. Eliminar `API_BASE` constant (línea 10) si ya no se usa.

6. **MANTENER**: Circuit breaker, rate limiter, isAvailable(), consumeToken(), todos los helpers internos. Solo cambia cómo se hace la llamada HTTP.

### 3.2 Migrar `tts-service.ts` a `@google/genai`

**Archivo**: `src/modules/tts/tts-service.ts`

**Estado actual**: Usa `fetch()` directo a `generativelanguage.googleapis.com/v1beta/models/{model}:generateContent` para TTS.

**Migración**:

1. Agregar import y cliente:
```typescript
import { GoogleGenAI } from '@google/genai'

export class TTSService {
  private client: GoogleGenAI | null = null
  // ...

  constructor(config: TTSConfig) {
    // ... código existente
    if (config.TTS_GOOGLE_API_KEY) {
      this.client = new GoogleGenAI({ apiKey: config.TTS_GOOGLE_API_KEY })
    }
  }
}
```

2. Reescribir `callTTSModel()` (líneas 179-244):

```typescript
private async callTTSModel(model: string, requestBody: Record<string, unknown>): Promise<SynthesizeResult | null> {
  if (Date.now() < this.cbOpenUntil) {
    logger.warn({ model }, 'TTS circuit breaker open')
    return null
  }
  if (!this.client) return null

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TTSService.FETCH_TIMEOUT_MS)

  try {
    const response = await Promise.race([
      this.client.models.generateContent({
        model,
        contents: (requestBody as Record<string, unknown>).contents as any,
        config: (requestBody as Record<string, unknown>).generationConfig as any,
      }),
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('TTS timeout')), TTSService.FETCH_TIMEOUT_MS)
      }),
    ])

    // Extraer audio base64 de la respuesta
    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data
    if (!base64Audio) {
      logger.error({ model }, 'Gemini TTS: no audio data in response')
      this.recordFailure(model)
      return null
    }

    // Success — reset circuit breaker
    if (this.failures > 0) {
      this.failures = 0
    }

    const pcmBuffer = Buffer.from(base64Audio, 'base64')
    const wavBuffer = pcmToWav(pcmBuffer)
    let audioBuffer: Buffer
    try {
      audioBuffer = await wavToOggOpus(wavBuffer)
    } catch {
      audioBuffer = wavBuffer
    }

    const durationSeconds = Math.max(1, Math.round(pcmBuffer.length / 48000))
    return { audioBuffer, durationSeconds }
  } catch (err) {
    this.recordFailure(model)
    return null
  } finally {
    clearTimeout(timer)
  }
}
```

**IMPORTANTE**: Verificar cómo el nuevo SDK estructura `contents` y `config` para TTS. El TTS usa `responseModalities: ['AUDIO']` en generationConfig + `speechConfig`. Verificar que el SDK acepta estos campos en `config`.

**NOTA**: Puede que necesites restructurar el requestBody para separar `contents` y `config`. Actualmente `synthesize()` construye un `requestBody` monolítico. Considerar refactorizar `synthesize()` para construir `contents` y `config` por separado y pasarlos a `callTTSModel()` ya separados.

3. Actualizar `updateConfig()` para reinicializar el cliente si la API key cambia.

4. Eliminar `GEMINI_TTS_API_BASE` constant (línea 36).

### 3.3 Migrar `model-scanner.ts` (parte Google)

**Archivo**: `src/modules/llm/model-scanner.ts`

**Estado actual**: `fetchGoogleModels()` (líneas 59-83) usa `fetch()` directo.

**Migración**:
```typescript
import { GoogleGenAI } from '@google/genai'

async function fetchGoogleModels(apiKey: string): Promise<ScannedModel[]> {
  try {
    const client = new GoogleGenAI({ apiKey })
    const pager = await client.models.list()
    // Filtrar modelos gemini y mapear a ScannedModel
    const models: ScannedModel[] = []
    for (const m of pager.models ?? []) {
      const name = m.name ?? ''
      if (!name.startsWith('models/gemini')) continue
      const id = name.replace('models/', '')
      models.push({
        id,
        displayName: m.displayName ?? id,
        provider: 'google',
        family: detectFamily(id),
        createdAt: '',
      })
    }
    return models
  } catch (err) {
    logger.error({ err }, 'Error fetching Google models')
    return []
  }
}
```

**NOTA**: `fetchAnthropicModels()` (líneas 33-57) también usa fetch raw, pero se migra a SDK en Plan 2 via `listModels()` del adapter. Si el model-scanner también necesita Anthropic, verificar si puede reusar el adapter o si debe mantener su propia llamada. Actualmente usa fetch directo — se puede migrar aquí al SDK de Anthropic también:
```typescript
import Anthropic from '@anthropic-ai/sdk'

async function fetchAnthropicModels(apiKey: string): Promise<ScannedModel[]> {
  try {
    const client = new Anthropic({ apiKey })
    const page = await client.models.list()
    return page.data.map(m => ({
      id: m.id,
      displayName: m.display_name,
      provider: 'anthropic' as const,
      family: detectFamily(m.id),
      createdAt: m.created_at,
    }))
  } catch (err) {
    logger.error({ err }, 'Error fetching Anthropic models')
    return []
  }
}
```

### 3.4 Migrar TTS preview en `console/server-api.ts`

**Archivo**: `src/modules/console/server-api.ts`, líneas ~812-860

**Estado actual**: El endpoint de TTS preview hace un `fetch()` directo a Gemini TTS.

**Migración**: Usar el SDK:
```typescript
import { GoogleGenAI } from '@google/genai'

// Dentro del handler de TTS preview:
const client = new GoogleGenAI({ apiKey })
const response = await client.models.generateContent({
  model: ttsModel,
  contents: [{ role: 'user', parts: [{ text: body.text.substring(0, 500) }] }],
  config: {
    responseModalities: ['AUDIO'],
    speechConfig: {
      voiceConfig: {
        prebuiltVoiceConfig: { voiceName: body.voiceName },
      },
    },
  },
})

const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data
```

**ALTERNATIVA más limpia**: En vez de crear un cliente SDK inline, usar el servicio TTS existente (`tts:service`) si está disponible via registry:
```typescript
const ttsService = registry.getOptional<TTSService>('tts:service')
if (ttsService) {
  const result = await ttsService.synthesize(body.text.substring(0, 500))
  // ... enviar result.audioBuffer
}
```

Si esta alternativa es viable (el handler tiene acceso al registry), es preferible a duplicar el código del SDK. Evaluar si el handler de server-api.ts tiene acceso al registry via `manifest-ref.ts` (línea 803 ya importa `getRegistryRef()`). Si sí → usar tts:service. Si no → migrar a SDK directamente.

### 3.5 Eliminar TTS legacy de `llm-gateway.ts`

**Archivo**: `src/modules/llm/llm-gateway.ts`, método `tts()` (líneas ~446-500)

**Estado actual**: El gateway tiene un método `tts()` que llama a `texttospeech.googleapis.com/v1/text:synthesize` — la API vieja de Google Cloud TTS, no Gemini TTS.

**Acción**: Verificar si este método se usa en algún lugar:
```bash
grep -r "gateway\.tts\|gateway\.\btts\b" src/ --include="*.ts"
```

Si NO se usa (el módulo TTS usa su propio `tts-service.ts`), eliminar el método completo.

Si SÍ se usa, redirigir al servicio TTS del módulo (`tts:service`) via registry, o migrar a usar Gemini TTS via SDK.

**También eliminar**: Las interfaces `TTSRequest` y `TTSResponse` de `types.ts` si solo eran usadas por este método y no por el módulo TTS (el módulo TTS tiene sus propios tipos en `tts/types.ts`). Verificar antes de eliminar.

### 3.6 Compilar y verificar

```bash
npx tsc --noEmit
```

---

## Criterios de éxito

- [ ] `embedding-service.ts` usa `@google/genai` para embeddings
- [ ] `tts-service.ts` usa `@google/genai` para TTS
- [ ] `model-scanner.ts` usa SDKs para listar modelos (ambos providers)
- [ ] Console TTS preview usa SDK o delega a tts:service
- [ ] TTS legacy en llm-gateway.ts eliminado o migrado
- [ ] Circuit breakers y rate limiters preservados en embedding-service
- [ ] `npx tsc --noEmit` pasa sin errores

---

## Trampas

- **Embedding response structure**: Verificar si `ai.models.embedContent()` retorna `result.embeddings[0].values` o `result.embedding.values`. Los tipos del SDK lo dirán.
- **Batch embeddings**: El SDK puede no tener `batchEmbedContents`. Si no existe, mantener fetch raw para ese método.
- **TTS responseModalities**: Verificar que el SDK acepta `responseModalities: ['AUDIO']` como campo de config.
- **Console handler**: El handler de server-api.ts ya tiene acceso al registry via `getRegistryRef()` — preferir delegar a `tts:service`.
- **No eliminar TTSRequest/TTSResponse de types.ts** si el módulo TTS las importa desde ahí. Verificar imports antes de borrar.
- **No tocar providers.ts ni agentic-loop.ts** — eso va en otros planes.
