# Plan 5: Verificación Final + Documentación

**Precondición**: Planes 1-4 completados.
**Archivos a modificar**: `src/modules/twilio-voice/gemini-live.ts` (evaluar), CLAUDE.md (varios), `docs/architecture/`
**Riesgo**: Bajo

---

## Contexto

Este plan cierra la sesión de SDK upgrade. Verifica que todo compila, evalúa la migración de Gemini Live, y actualiza la documentación del proyecto para reflejar todos los cambios.

---

## Tareas

### 5.1 Evaluar migración de Gemini Live

**Archivo**: `src/modules/twilio-voice/gemini-live.ts`

**Estado actual**: WebSocket raw a `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.BidiGenerateContent`. Funciona correctamente para voz bidireccional en tiempo real.

**El nuevo SDK ofrece**: `ai.live.connect()` que abstrae la conexión WebSocket.

**Evaluación**: Leer la documentación del SDK para `ai.live` y comparar con la implementación actual. Decidir basándose en:

| Criterio | Mantener WebSocket raw | Migrar a ai.live |
|---|---|---|
| **Funcionalidad faltante** | Nada — funciona | Posible mejor manejo de reconexión |
| **Riesgo** | Cero (no cambiar) | Medio (audio real-time) |
| **Mantenibilidad** | OK — WebSocket es simple | Mejor — abstracción SDK |
| **Esfuerzo** | Cero | ~2h |

**Decisión recomendada**: NO migrar en esta sesión. El WebSocket funciona, el audio real-time es sensible, y el beneficio es marginal. Documentar como deuda técnica aceptada.

**Sin embargo**, hacer estos ajustes menores si aplican:
1. Verificar que la URL del WebSocket siga siendo correcta para la versión actual de la API
2. Si hay que construir tool declarations, verificar que usen `parametersJsonSchema` (no `parameters`) si el Live API del nuevo SDK cambió el formato
3. **Verificar la config de `thinkingConfig`**: El código actual (líneas 56-68) tiene lógica para 3.1 vs 2.5. Asegurar que sigue siendo correcta.

### 5.2 Verificación TypeScript completa

Ejecutar compilación completa:

```bash
npx tsc --noEmit
```

Si hay errores:
1. Clasificar: error de tipo vs error de import vs error de compatibilidad
2. Corregir cada uno
3. Re-compilar hasta que pase limpio

**Verificaciones adicionales**:
```bash
# Buscar imports del SDK viejo que pudieron quedar
grep -r "@google/generative-ai" src/ --include="*.ts"
# Debe retornar CERO resultados

# Buscar usos de .text() como método que debería ser .text propiedad
grep -r "response\.text()" src/ --include="*.ts"
# Solo debe aparecer en código que NO sea del SDK nuevo

# Buscar 'parameters:' en function declarations (debería ser parametersJsonSchema)
grep -r "parameters:" src/modules/llm/providers.ts
grep -r "parameters:" src/engine/utils/llm-client.ts
# Verificar que estos son parametersJsonSchema donde corresponde
```

### 5.3 Actualizar `src/modules/llm/CLAUDE.md`

Actualizar el CLAUDE.md del módulo LLM para reflejar:

**Sección "Features nativos de las APIs"** — actualizar:
```markdown
## Features nativos de las APIs
- **Prompt Caching**: Anthropic `cache_control: { type: 'ephemeral' }` (90% ahorro). Google implícito en 2.5+, explícito via `ai.caches` (nuevo SDK).
- **JSON Mode**: Anthropic `output_config.format` con JSON schema (nativo, garantizado). Google `responseMimeType: 'application/json'`.
- **Extended Thinking**: Anthropic `thinking: { type: 'adaptive', effort: 'medium' }` (4.6+) o `thinking: { type: 'enabled', budget_tokens: N }` (pre-4.6). Google `thinkingConfig`.
- **Google Search Grounding**: `{ googleSearch: {} }` tool nativa en web_search.
- **Code Execution**: Anthropic `{ type: 'code_execution_20260120', name: 'code_execution' }`. Google `{ codeExecution: {} }`.
- **Citations**: Anthropic document blocks (configurable, `LLM_CITATIONS_ENABLED`).
- **Batch**: Anthropic `client.messages.batches.*` (SDK nativo, 50% off). Gateway expone `submitBatch/getBatchStatus/getBatchResults`.
- **Tool Calling**: Formato nativo — Anthropic `tool_use/tool_result` content blocks con IDs, Google `functionCall/functionResponse` parts.
```

**Sección "Timeouts y sanitización"** — actualizar:
```markdown
## SDKs y versiones
- **Anthropic**: `@anthropic-ai/sdk` ^0.88.0 — SDK tipado completo
- **Google**: `@google/genai` ^1.49.0 — SDK unificado (reemplaza @google/generative-ai deprecado)
- **Patrón Google**: `new GoogleGenAI({ apiKey })` → `ai.models.generateContent({ model, contents, config })`
- **Tool params Google**: `parametersJsonSchema` (JSON Schema estándar, NO `parameters`)
```

**Agregar trampa**:
```markdown
- **Google SDK response.text**: Es PROPIEDAD, no método. `response.text` NO `response.text()`.
- **Tool calling IDs**: Anthropic genera `tool_use_id` automáticamente. Para Google se generan IDs sintéticos.
```

### 5.4 Actualizar `src/engine/CLAUDE.md`

Actualizar la sección del agentic loop para reflejar el cambio a tool calling nativo:

**Sección "Cómo funciona el loop agentico"** — paso 3:
```markdown
3. **Loop**: `runAgenticLoop(ctx, systemPrompt, tools, config, registry)`:
   - Llama `callLLM()` con task name (router decide modelo/provider)
   - Si LLM retorna solo texto → listo, retorna como respuesta final
   - Si LLM retorna tool_calls (con IDs) → ejecuta via `ToolRegistry.executeTool()`, retorna resultados
   - Tool calls y resultados se envían como **content blocks nativos** (tool_use/tool_result para Anthropic, functionCall/functionResponse para Google) — NO como texto plano
   - Protecciones: dedup cache, loop detector
   - Ejecución paralela de tools via `StepSemaphore`
   - Límite de turns → fuerza respuesta texto final
```

**Sección "Ruta de ejecución de tools"** — actualizar:
```markdown
### Ruta de ejecución de tools
LLM produce tool_calls (con IDs)
  → loop detector pre-check
  → dedup cache check
  → registry.getOptional<ToolRegistry>('tools:registry')
  → toolRegistry.executeTool(name, input, context)
  → dedup cache store
  → loop detector post-check
  → resultados retornados al LLM como content blocks nativos (tool_result/functionResponse)
  → siguiente turn del loop
```

### 5.5 Actualizar `CLAUDE.md` raíz

En la sección "Stack":
```markdown
## Stack
TypeScript / Node.js ≥22 (ESM), PostgreSQL + pgvector, Redis + BullMQ, Baileys (WhatsApp), Twilio (voz), Google OAuth2 (Gmail, Calendar, Sheets, Chat), LLMs: Anthropic SDK ^0.88.0 + Google GenAI SDK ^1.49.0.
```

En la sección "Lo que NO hacer", agregar:
```markdown
- NO instalar `@google/generative-ai` — está deprecado y archivado. Usar `@google/genai`
- NO usar `response.text()` como método para Google SDK — es propiedad `response.text`
- NO usar `parameters` en function declarations de Google — usar `parametersJsonSchema`
- NO usar `budget_tokens` con `thinking.type: 'adaptive'` en Anthropic — usar `effort`
```

### 5.6 Actualizar `src/modules/knowledge/CLAUDE.md`

Actualizar la línea del embedding service:
```markdown
- `embedding-service.ts` — Google gemini-embedding-2-preview (1536 dims) via @google/genai SDK. Circuit breaker (3 fallas → 5min down). Rate limit 5000 RPM (tier 2). Soporta multimodal (generateFileEmbedding).
```

### 5.7 Actualizar `src/modules/tts/CLAUDE.md`

Actualizar la línea relevante:
```markdown
- `tts-service.ts` — TTSService: Gemini TTS via @google/genai SDK → PCM → WAV → ffmpeg → OGG/Opus, chunking, splitting
```

### 5.8 Actualizar `docs/architecture/pipeline.md` (si existe sección de modelos/SDKs)

Verificar si hay referencias a los SDKs o a los métodos de llamada. Actualizar si es necesario.

### 5.9 Actualizar `docs/architecture/task-routing.md` (si existe sección de adapters)

Verificar si hay referencias a los adapters. La nota sobre JSON mode debería actualizarse para mencionar `output_config.format`.

---

## Criterios de éxito

- [ ] `npx tsc --noEmit` pasa limpio
- [ ] Cero imports de `@google/generative-ai` en el codebase
- [ ] Cero usos de `response.text()` como método en código del nuevo SDK
- [ ] `src/modules/llm/CLAUDE.md` refleja SDKs actuales y features
- [ ] `src/engine/CLAUDE.md` refleja tool calling nativo
- [ ] `CLAUDE.md` raíz refleja SDKs actuales y reglas
- [ ] `src/modules/knowledge/CLAUDE.md` refleja SDK nuevo
- [ ] `src/modules/tts/CLAUDE.md` refleja SDK nuevo
- [ ] Decisión sobre Gemini Live documentada

---

## Trampas

- **No inventar features** en la documentación. Solo documentar lo que fue implementado.
- **Los CLAUDE.md deben mantenerse bajo 80 líneas** por convención del proyecto. No expandir excesivamente.
- **Verificar que `gemini-live.ts` siga compilando** después de que `@google/generative-ai` fue eliminado. Si importaba tipos de ese paquete, habrá un error. Verificar imports.
- **El módulo twilio-voice usa `ws` (WebSocket)** directamente, NO el SDK de Google. Verificar que no haya dependencias transitivas rotas.
