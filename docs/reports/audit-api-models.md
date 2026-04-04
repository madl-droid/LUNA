# Auditoría: Modelos LLM, fuentes de configuración y circuit breaker

> Fecha: 2026-04-04 | Branch: `claude/audit-api-models-PpkMt`

## 1. Arquitectura del gateway LLM

Todas las llamadas del pipeline principal pasan por:

```
LLMGateway.chat() → TaskRouter.resolve() → circuit breaker dual → ProviderAdapter → API
```

El modelo se selecciona según la **tarea** (`task`), con cadena de fallback de 3 niveles:
1. **Primary** — modelo configurado (2 retries con backoff)
2. **Downgrade** — mismo provider, modelo menor (2 retries)
3. **Cross-API fallback** — otro provider (2 retries)

---

## 2. Rutas por tarea (task-router.ts)

Los defaults están **hardcodeados** en `src/modules/llm/task-router.ts:21-147` pero son **sobreescribibles desde consola** via `LLM_{TASK}_PROVIDER/MODEL`.

| Tarea | Primario | Downgrade | Fallback | Circuit breaker |
|-------|----------|-----------|----------|:---------------:|
| `classify` | `anthropic:claude-sonnet-4-5-20250929` | — | `google:gemini-2.5-flash` | Dual |
| `respond` | `google:gemini-2.5-flash` | `google:gemini-2.5-flash-lite` | `anthropic:claude-sonnet-4-5-20250929` | Dual |
| `complex` | `anthropic:claude-opus-4-5-20251101` | `anthropic:claude-sonnet-4-5-20250929` | `google:gemini-2.5-pro` | Dual |
| `tools` | `anthropic:claude-sonnet-4-5-20250929` | — | `google:gemini-2.5-flash` | Dual |
| `proactive` | `anthropic:claude-sonnet-4-5-20250929` | — | `google:gemini-2.5-flash` | Dual |
| `vision` | `google:gemini-2.5-flash` | `google:gemini-2.5-flash-lite` | `anthropic:claude-sonnet-4-5-20250929` | Dual |
| `web_search` | `google:gemini-2.5-flash` | `google:gemini-2.5-pro` | `anthropic:claude-sonnet-4-5-20250929` | Dual |
| `compress` | `anthropic:claude-haiku-4-5-20251001` | — | `google:gemini-2.5-flash` | Dual |
| `ack` | `anthropic:claude-haiku-4-5-20251001` | — | `google:gemini-2.5-flash` | Dual |
| `criticize` | `google:gemini-2.5-pro` | `google:gemini-2.5-flash` | `anthropic:claude-sonnet-4-5-20250929` | Dual |
| `document_read` | `anthropic:claude-sonnet-4-5-20250929` | — | `google:gemini-2.5-flash` | Dual |
| `batch` | `anthropic:claude-sonnet-4-5-20250929` | — | `google:gemini-2.5-flash` | Dual |

### Task aliases

Mapeo de nombres internos a rutas canónicas (`task-router.ts:172-198`):

| Alias | Ruta canónica | Alias | Ruta canónica |
|-------|--------------|-------|--------------|
| `evaluate` | classify | `cortex-analyze` | complex |
| `proactive-evaluate` | classify | `cortex-pulse` | complex |
| `compose` | respond | `cortex-trace` | complex |
| `detect_commitment` | classify | `trace-evaluate` | complex |
| `process_attachment` | vision | `trace-compose` | complex |
| `subagent` | tools | `trace-analyze` | complex |
| `scheduled-task` | tools | `trace-synthesize` | complex |
| `extract_qualification` | classify | `nightly-scoring` | batch |
| `parse_signature` | classify | `nightly-compress` | batch |
| `extract_knowledge` | vision | `nightly-reactivation` | batch |
| `transcribe` | vision | `read_document` | document_read |
| | | `summarize_document` | document_read |

---

## 3. Effort routing (agentic loop)

Modelo seleccionado **antes** de llamar al gateway, según nivel de esfuerzo:

| Esfuerzo | Modelo default | Provider | Config key | Hardcoded |
|----------|---------------|----------|------------|:---------:|
| `low` | `claude-haiku-4-5-20251001` | anthropic | `LLM_LOW_EFFORT_MODEL` | Default en manifest, configurable consola |
| `medium` | `claude-sonnet-4-6` | anthropic | `LLM_MEDIUM_EFFORT_MODEL` | Default en manifest, configurable consola |
| `high` | `claude-sonnet-4-6` | anthropic | `LLM_HIGH_EFFORT_MODEL` | Default en manifest, configurable consola |

Fuente: `src/modules/engine/manifest.ts:127-132`, cargados en `src/engine/config.ts:189-194`.

Estos modelos se pasan como `options.model` al gateway, que los usa como override del primary de la ruta.

---

## 4. Circuit breaker: arquitectura dual

### Capa 1 — Legacy por provider (`CircuitBreakerManager`)
- **Granularidad**: 1 breaker por provider (`anthropic`, `google`)
- **Config default**: 5 fallas en 10 min → OPEN por 5 min
- **Configurable**: Sí (`LLM_CB_FAILURE_THRESHOLD`, `LLM_CB_WINDOW_MS`, `LLM_CB_RECOVERY_MS`)
- **Archivo**: `src/modules/llm/circuit-breaker.ts:406`

### Capa 2 — Escalating por target (`EscalatingCBManager`)
- **Granularidad**: 1 breaker por `provider:model` (ej: `anthropic:claude-sonnet-4-6`)
- **Config**: 2 fallas en 30 min → 1h → 3h → 6h (loop)
- **Reset**: Primer éxito → closed + reset escalation
- **Archivo**: `src/modules/llm/circuit-breaker.ts:365`

### Flujo en gateway (`llm-gateway.ts:225-239`):

```
Para cada target (primary → downgrade → fallback):
  1. Check rate limit → skip si excedido
  2. Check budget → throw si excedido
  3. Check provider CB (capa 1) → skip si OPEN
  4. Check target CB (capa 2) → skip si OPEN
  5. Intentar con retries (max 2, backoff exponencial)
  6. Éxito → reset ambos breakers
  7. Falla retryable + retries agotados → record en ambos
  8. Falla no retryable → record inmediato en ambos
```

### Capa 3 — Tool loop detector (agentic loop)
- Previene loops infinitos de tool calls
- Escalamiento graduado: warn (3 repeticiones) → block (5) → circuit_break (8)
- **Archivo**: `src/engine/agentic/tool-loop-detector.ts`

---

## 5. Llamadas que BYPASEAN el gateway

### A. Embeddings — `gemini-embedding-2-preview`

| Aspecto | Detalle |
|---------|---------|
| **Archivo** | `src/modules/knowledge/embedding-service.ts:10` |
| **Modelo** | `gemini-embedding-2-preview` — **HARDCODEADO** (constante `MODEL`) |
| **Provider** | Google Gemini REST API directo (no SDK) |
| **API key** | `GOOGLE_AI_API_KEY` del config_store |
| **Circuit breaker** | **Propio, independiente** — 3 fallas en 5 min → open 5 min |
| **Rate limit** | Propio — token bucket 5000 RPM |
| **Configurable consola** | **No** |
| **Llamado desde** | `vectorize-worker.ts` (BullMQ job) |

### B. TTS — `gemini-2.5-flash-preview-tts`

| Aspecto | Detalle |
|---------|---------|
| **Archivo** | `src/modules/tts/tts-service.ts:34` |
| **Modelo** | `gemini-2.5-flash-preview-tts` — **HARDCODEADO** (en URL) |
| **Provider** | Google Gemini REST API directo |
| **API key** | `GOOGLE_AI_API_KEY` del config_store |
| **Circuit breaker** | **NINGUNO** |
| **Configurable consola** | **No** |
| **Llamado desde** | Phase 4 post-processor via `tts:service` |

### C. TTS Preview (consola)

| Aspecto | Detalle |
|---------|---------|
| **Archivo** | `src/modules/console/server.ts:~2508` |
| **Modelo** | `gemini-2.5-flash-preview-tts` — **HARDCODEADO** |
| **Circuit breaker** | **NINGUNO** |

### D. Cloud TTS legacy (gateway)

| Aspecto | Detalle |
|---------|---------|
| **Archivo** | `src/modules/llm/llm-gateway.ts:424-466` |
| **API** | Google Cloud Text-to-Speech (no Gemini) |
| **Circuit breaker** | **NINGUNO** |

### E. Engine fallback (sin módulo LLM)

| Aspecto | Detalle |
|---------|---------|
| **Archivo** | `src/engine/utils/llm-client.ts:95-145` |
| **Modelos** | Los del `EngineConfig` (legacy) |
| **Circuit breaker** | **NINGUNO** |
| **Cuándo se activa** | Solo si módulo LLM no está activo |

---

## 6. Discrepancia: engine/config.ts vs task-router.ts

Los defaults legacy del engine **no coinciden** con el task-router:

| Campo | engine/config.ts | task-router.ts |
|-------|-----------------|----------------|
| `classifyModel` | `claude-sonnet-4-6` | `claude-sonnet-4-5-20250929` |
| `respondModel` | `claude-sonnet-4-6` | `gemini-2.5-flash` (Google!) |
| `complexModel` | `claude-opus-4-6` | `claude-opus-4-5-20251101` |
| `toolsModel` | `claude-haiku-4-5-20251001` | `claude-sonnet-4-5-20250929` |

**Impacto**: En producción el task-router gobierna. Los defaults del engine/config.ts solo aplican si el módulo LLM se desactiva (fallback SDK directo).

---

## 7. Resumen de todos los modelos

| Modelo | Tipo | Hardcodeado | Consola | Circuit breaker | Dónde |
|--------|------|:-----------:|:-------:|:---------------:|-------|
| `claude-sonnet-4-5-20250929` | Chat | Default | **Sí** | **Dual** | classify, tools, proactive, batch, document_read |
| `claude-opus-4-5-20251101` | Chat | Default | **Sí** | **Dual** | complex |
| `claude-haiku-4-5-20251001` | Chat | Default | **Sí** | **Dual** | compress, ack, low effort |
| `claude-sonnet-4-6` | Chat | Default | **Sí** | **Dual** | medium/high effort |
| `gemini-2.5-flash` | Chat | Default | **Sí** | **Dual** | respond, vision, web_search, fallbacks |
| `gemini-2.5-flash-lite` | Chat | Default | **Sí** | **Dual** | downgrade respond/vision |
| `gemini-2.5-pro` | Chat | Default | **Sí** | **Dual** | criticize, downgrade complex/web |
| `gemini-embedding-2-preview` | Embedding | **Fijo** | **No** | **Propio** | knowledge embeddings |
| `gemini-2.5-flash-preview-tts` | TTS | **Fijo** | **No** | **No** | text-to-speech |

---

## 8. Riesgos y recomendaciones

1. **TTS sin circuit breaker** — Si Google TTS falla repetidamente, no hay protección. Cada request intentará y fallará. *Recomendación: agregar CB similar al de embeddings.*

2. **Embeddings con CB aislado** — El CB del embedding service no se reporta en consola ni se puede resetear desde UI. *Recomendación: exponer status en health/consola.*

3. **Modelos preview hardcodeados** — `gemini-embedding-2-preview` y `gemini-2.5-flash-preview-tts` son preview y podrían ser deprecados. *Recomendación: hacerlos configurables desde consola o al menos desde env vars.*

4. **Defaults desalineados** — engine/config.ts tiene defaults diferentes al task-router. *Recomendación: unificar o eliminar los defaults legacy del engine config.*

5. **`bypassCircuitBreaker` flag** — Existe en `LLMRequest.bypassCircuitBreaker` pero no se usa actualmente en ningún caller. No es un riesgo activo pero podría serlo si alguien lo activa sin entender las consecuencias.
