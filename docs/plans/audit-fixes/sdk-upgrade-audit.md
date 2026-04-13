# AUDITORÍA — SDK Upgrade (rama claude/project-planning-session-1GJm6)

**Fecha**: 2026-04-13
**Scope**: Commits `61edbce..f230729` (9 commits, 24 archivos, +2507/-504 líneas)
**Planes auditados**: `docs/plans/sdk-upgrade/overview.md` + plans 1-5

---

## Veredicto general

**La migración de SDK se ejecutó correctamente en su núcleo.** Los dos SDKs se actualizaron, el adapter de Google se reescribió, el tool calling nativo se implementó, y la documentación se actualizó. El codebase compila limpio (los errores de TS son preexistentes en `src/tools/freight` y `src/tools/freshdesk` por context de Docker).

**Pero hay deuda real, redundancias, y una violación de política que vale la pena corregir.** Nada es un showstopper, pero varias cosas degradan la calidad que esta rama pretende mejorar.

---

## BUGS (B)

### B1 — API key expuesta en URL de batch embeddings
**Archivo**: `src/modules/knowledge/embedding-service.ts:177`
**Severidad**: Media
**Detalle**: `generateBatchEmbeddings()` sigue usando `fetch()` directo con `?key=${this.apiKey}` en la URL. Si esta request falla y el error se logea (línea 200: `this.log.error({ err }, ...)`), el stack trace puede incluir la URL con la key. Los individual embeddings se migraron al SDK correctamente, pero el batch quedó en raw fetch.
**Plan decía**: "Si el SDK no tiene batchEmbedContents, mantener fetch." — OK, pero no se mencionó el riesgo de exposición de la key.
**Fix sugerido**: Construir la URL sin la key en el query string y pasarla como header `x-goog-api-key`, o envolver el fetch en un try-catch que sanitize la URL del error.

### B2 — EmbeddingService crea cliente con API key `'placeholder'`
**Archivo**: `src/modules/knowledge/embedding-service.ts:44`
**Severidad**: Baja
**Detalle**: `new GoogleGenAI({ apiKey: apiKey || 'placeholder' })` — crea un cliente con una key falsa cuando no hay key configurada. El `isAvailable()` previene llamadas, pero el cliente fake existe innecesariamente y podría causar confusión en debugging.
**Fix sugerido**: `this.client = apiKey ? new GoogleGenAI({ apiKey }) : null` y verificar `this.client` en cada método (como ya hace `isAvailable()`).

### B3 — Console TTS preview sin error handling del SDK
**Archivo**: `src/modules/console/server-api.ts:813-825`
**Severidad**: Baja
**Detalle**: La migración de `fetch()` a `genAI.models.generateContent()` eliminó el manejo explícito de errores HTTP (`if (!ttsResponse.ok)`). Ahora si el SDK lanza una excepción, el handler la atrapa en un try-catch genérico más arriba, pero el mensaje de error al usuario será menos descriptivo. El código anterior daba `502 "Gemini TTS API error"` con el status code; ahora devuelve un error genérico.
**Fix sugerido**: Agregar try-catch específico alrededor de la llamada al SDK para capturar errores de la API y devolver un mensaje de error útil al usuario.

---

## REDUNDANCIAS Y DUPLICACIONES (R)

### R1 — `buildGoogleParts()` duplicado en 2 archivos
**Archivos**: 
- `src/modules/llm/providers.ts:43-91` (como `buildGoogleParts`)
- `src/engine/utils/llm-client.ts:418-439` (como `buildGeminiParts`)
**Detalle**: Ambas funciones convierten content a formato Google con handling de tool blocks. La lógica es casi idéntica. Cuando alguien cambie el formato (ej: nuevo tipo de content block), tendrá que acordarse de actualizar ambas.
**Por qué existe**: `llm-client.ts` es el fallback cuando el módulo LLM no está activo, así que no puede importar de `providers.ts` (regla de no-import entre módulos). El diseño es correcto conceptualmente.
**Fix sugerido**: Extraer una función utilitaria compartida en `src/engine/utils/` o `src/kernel/` que ambos puedan importar sin violar la regla de módulos.

### R2 — `buildAnthropicContent()` duplicado en 2 archivos
**Archivos**:
- `src/modules/llm/providers.ts:383-444`
- `src/engine/utils/llm-client.ts:379-413`
**Detalle**: Mismo patrón que R1. La versión de `llm-client.ts` usa un `AnyPart` duck-typed en vez de importar los tipos reales.
**Fix sugerido**: Mismo que R1.

### R3 — `detectFamily()` duplicado
**Archivos**:
- `src/modules/llm/providers.ts:656-663`
- `src/modules/llm/model-scanner.ts:23-29`
**Detalle**: Dentro del MISMO módulo, así que esto sí es pura duplicación innecesaria. Podría vivir en un `utils.ts` del módulo LLM o exportarse de uno de los dos archivos.
**Fix sugerido**: Mover a un archivo compartido dentro de `src/modules/llm/` (ej: `helpers.ts`) y importar en ambos.

---

## COMPLEJIDAD INNECESARIA (C)

### C1 — `AnyPart` duck-typed en `llm-client.ts`
**Archivo**: `src/engine/utils/llm-client.ts:362-375`
**Detalle**: Se creó un tipo `AnyPart` con campos opcionales de todas las interfaces (`id`, `name`, `input`, `toolUseId`, `content`, `isError`) en vez de importar los tipos reales. Esto funciona pero es frágil — si se agrega un nuevo campo a `ToolUseBlock` o `ToolResultBlock`, este duck type no se actualiza automáticamente y TypeScript no te va a avisar.
**Razón de existir**: Evitar import circular engine→modules. Pero `llm-client.ts` ya importa de `../../modules/llm/types.js` en la interfaz `LLMGatewayLike` (línea 23), así que la razón es inconsistente.
**Fix sugerido**: Ya importas de `modules/llm/types.js` — importa también `MessageContentBlock`, `ToolUseBlock`, `ToolResultBlock` y elimina `AnyPart`.

### C2 — TTS `requestBody` monolítico decomponido con `as any`
**Archivo**: `src/modules/tts/tts-service.ts:196-198`
**Detalle**: `synthesize()` construye un `requestBody` monolítico con `contents` y `generationConfig`, luego `callTTSModel()` los extrae con `as any`. Esto es el resultado de migrar el `fetch()` al SDK sin refactorizar el caller.
**Fix sugerido**: Cambiar `callTTSModel()` para recibir `contents` y `config` como parámetros separados, y que `synthesize()` los pase directamente. Elimina los `as any` y el intermediario `requestBody`.

---

## VIOLACIONES DE POLÍTICA (P)

### P1 — Console importa SDK de Google directamente
**Archivo**: `src/modules/console/server-api.ts:5`
**Regla violada**: "NO importar código entre módulos directamente — usar hooks o services del registry"
**Detalle**: `import { GoogleGenAI } from '@google/genai'` en el módulo console para el TTS preview. Crea su propio cliente SDK en cada request. El Plan 3 (sección 3.4) **explícitamente sugirió** usar `tts:service` via registry, y confirmó que `getRegistryRef()` está disponible (línea 805). Esta sugerencia fue ignorada.
**Impacto**: El console ahora tiene un import directo al SDK de Google. Si la API cambia, hay que actualizar en dos lugares (console + tts-service). Además, el console crea un cliente SDK nuevo por cada preview request en vez de reusar el singleton.
**Fix sugerido**: 
```typescript
const { getRegistryRef } = await import('./manifest-ref.js')
const registry = getRegistryRef()
const tts = registry?.getOptional<{ synthesize(text: string): Promise<{ audioBuffer: Buffer } | null> }>('tts:service')
if (tts) {
  const result = await tts.synthesize(body.text.substring(0, 500))
  // ...
}
```

### P2 — `BATCH_API_BASE` hardcoded con API key en URL
**Archivo**: `src/modules/knowledge/embedding-service.ts:11,177`
**Regla violada**: Las API keys no deben aparecer en URLs logeables.
**Detalle**: Ya cubierto en B1, pero también es una violación de la política de seguridad de keys.

---

## GAPS: Plan vs Implementación (G)

### G1 — Plan 3.4 ignorado (console debería usar tts:service)
**Plan decía**: "Si esta alternativa es viable (el handler tiene acceso al registry via `getRegistryRef()`), es preferible a duplicar el código del SDK. Evaluar si el handler de server-api.ts tiene acceso al registry."
**Realidad**: El handler SÍ tiene acceso al registry (confirmado). Se ignoró la recomendación y se usó el SDK directamente.

### G2 — Plan 5.8/5.9 no ejecutados
**Plan decía**: "Actualizar `docs/architecture/pipeline.md`" y "Actualizar `docs/architecture/task-routing.md`"
**Realidad**: No hay cambios en ninguno de estos archivos. Menor — son docs de referencia, no es un bug.

### G3 — `twilio-voice` tool declarations usan `parameters:` no `parametersJsonSchema:`
**Archivos**: `src/modules/twilio-voice/voice-engine.ts:89,348,363` y `types.ts:159`
**Detalle**: Estos archivos definen function declarations con `parameters:` (formato viejo). El Live API usa WebSocket raw (no el SDK), así que PUEDE ser correcto si el protocolo v1beta del WebSocket acepta `parameters`. Pero Plan 5 decía "verificar que usen `parametersJsonSchema`" y esto no se verificó.
**Riesgo**: Si Google unifica el formato en futuras versiones del WebSocket API, esto rompe silenciosamente.
**Fix sugerido**: Verificar contra la documentación actual de la Gemini Live API. Si el WebSocket v1beta acepta ambos, considerar migrar a `parametersJsonSchema` preventivamente.

---

## LO QUE SE HIZO BIEN

1. **Migración limpia del SDK de Google**: `@google/generative-ai` eliminado completamente, cero imports residuales.
2. **`response.text` como propiedad**: Verificado en grep — ningún uso de `response.text()` como método del SDK.
3. **`parametersJsonSchema`**: Correctamente usado en `providers.ts` y `llm-client.ts`.
4. **Tool calling nativo**: Implementación sólida con content blocks bien tipados (`ToolUseBlock`, `ToolResultBlock`, `TextBlock`).
5. **IDs sintéticos para Google**: `gc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}` — funcional y suficiente.
6. **Thinking adaptive/manual split**: Correctamente separado `effort` vs `budget_tokens` según el tipo.
7. **JSON mode con `output_config.format`**: Implementado con fallback a prefill trick.
8. **Batch API migrado al SDK de Anthropic**: `client.messages.batches.*` usado correctamente.
9. **Circuit breakers preservados**: Tanto en embeddings como TTS, los CB existentes no se tocaron.
10. **CLAUDE.md actualizados**: LLM, engine, knowledge, TTS, y raíz reflejan los cambios.
11. **`TTSRequest`/`TTSResponse` legacy eliminados**: Limpieza correcta del código muerto en `llm-gateway.ts`.

---

## RESUMEN EJECUTIVO

| Categoría | Count | Crítico |
|-----------|-------|---------|
| Bugs | 3 | 0 (B1 es medio, B2-B3 son bajos) |
| Redundancias | 3 | R1+R2 son aceptables por diseño, R3 es gratuita |
| Complejidad | 2 | Ninguna crítica, son oportunidades de limpieza |
| Violaciones | 2 | P1 es real y debería corregirse |
| Gaps | 3 | G1 es el más importante (plan ignorado) |

### Prioridad de fixes

1. **P1 + G1**: Console debería usar `tts:service` via registry, no crear su propio SDK client → elimina import del SDK de Google de console.
2. **B1 + P2**: Sanitizar URL del batch embeddings para no exponer API key en logs.
3. **R3**: Deduplicar `detectFamily()` dentro del módulo LLM.
4. **C1**: Reemplazar `AnyPart` duck type con imports reales (ya hay precedente en el mismo archivo).
5. **C2**: Refactorizar `callTTSModel()` para recibir params separados.
6. **R1 + R2**: Evaluar extraer helpers de content building a un lugar compartido (lower priority, diseño actual es funcional).
7. **B2**: Reemplazar `'placeholder'` con `null` check.
8. **B3**: Agregar error handling específico al TTS preview del console.
9. **G3**: Verificar `parameters` vs `parametersJsonSchema` en Gemini Live API.

---

## NOTA SOBRE LA PLANIFICACIÓN

Los planes son excelentes documentos técnicos: bien estructurados, con el nivel correcto de detalle, y con secciones de "trampas" que demuestran pensamiento preventivo. El overview con la tabla de estado actual vs objetivo y la estrategia de ejecución paralela (Plans 2||3) son profesionales.

**Pero**: el Plan 3.4 tenía la respuesta correcta escrita en el plan ("usar tts:service via registry") y el ejecutor la ignoró. Eso no es un problema de planificación, es un problema de ejecución. Los planes valen poco si no se siguen.

La decisión de no migrar Gemini Live (Plan 5.1) fue pragmática y correcta. "Si funciona y el riesgo es alto, no toques" — buena ingeniería.
