# LLM — Gateway unificado de proveedores LLM

Gateway centralizado para Anthropic y Google (Gemini). Circuit breaker (por provider + escalating por target), routing por tarea con 3 niveles de fallback, tracking de uso/costos, seguridad contra prompt injection, prompt caching, batch async.

## Archivos
- `manifest.ts` — lifecycle, configSchema, console fields/routes
- `types.ts` — todos los tipos del módulo (providers, routes, requests, responses, usage, batch, TTS, scanner, API key groups)
- `llm-gateway.ts` — orquestador principal: routing → rate limit → budget → circuit breaker → retry → call → tracking → sanitize → batch
- `circuit-breaker.ts` — CB legacy por provider + **EscalatingCBManager** por target (provider:model)
- `providers.ts` — adapters normalizados: Anthropic (prompt cache, JSON prefill, thinking, code exec, citations, batch) y Google (JSON mode, thinking, grounding, code exec, implicit cache)
- `task-router.ts` — enruta tareas a providers con 3 niveles: primary → downgrade → cross-api fallback. Una key por provider.
- `usage-tracker.ts` — tracking Redis (hot counters) + PG (persistencia). Rate limits, budget.
- `pg-store.ts` — tablas llm_usage, llm_daily_stats. Queries de resumen y limpieza.
- `security.ts` — detección de prompt injection, sanitización de prompts/respuestas, redacción de API keys.
- `model-scanner.ts` — escaneo periódico de modelos disponibles en ambos providers.

## 10 Tareas Canónicas (Task Routing v2)

El Task Router es la ÚNICA fuente de verdad para selección de modelo/provider/key. No ejecuta llamadas.
Documentación completa: `docs/architecture/task-routing.md`

| Tarea | Modelo default | Fallback | Uso |
|-------|---------------|----------|-----|
| `main` | Sonnet 4.6 | Gemini Flash | Conversación, respuestas, tool calling |
| `complex` | Opus 4.6 | Gemini Pro | Razonamiento profundo, objeciones, HITL |
| `low` | Haiku 4.5 | Gemini Flash Lite | Saludos, ACKs, confirmaciones simples |
| `criticize` | Gemini Pro | Sonnet 4.6 | Verificación de calidad, subagent verify |
| `media` | Gemini Flash | Sonnet 4.6 | Vision, audio, video, documentos, OCR, STT |
| `web_search` | Gemini Flash + grounding | Sonnet 4.6 | Búsqueda web con Google Search |
| `compress` | Sonnet 4.6 | Gemini Flash | Compresión de sesiones, buffer |
| `batch` | Sonnet 4.6 | Gemini Flash | Batch nocturno, scoring, tareas programadas |
| `tts` | Gemini Pro TTS | Gemini Flash TTS | Síntesis de voz |
| `knowledge` | text-embedding-004 | — | Embeddings, vectorización |

### TaskCategory
Cada feature que hace una llamada LLM DEBE declarar una categoría:
```typescript
import { TaskCategory } from '../../modules/llm/types.js'
await callLLM({ task: TaskCategory.MEDIA, ... })
```

### TASK_ALIASES
Nombres custom se registran en `TASK_ALIASES` en `task-router.ts`. Si un nombre no está registrado, ruta a `main` con warning.
Nombres legacy (classify, respond, tools, vision, stt, document_read, ack) son aliases a las nuevas tareas canónicas.

## API Keys — una por provider

Una sola key por provider: `ANTHROPIC_API_KEY` y `GOOGLE_AI_API_KEY`. Sin grupos ni sub-keys.

## Fallback chain de 3 niveles
```
Primary (2 retries con backoff)
  ↓ falla
Downgrade — mismo provider, modelo menor (2 retries)
  ↓ falla
Fallback — otro provider, capacidades equivalentes (2 retries)
```

## Criticizer (quality gate — 2 pasos)
Paso separado en Phase 4 que revisa la respuesta antes de enviarla.
**Modo** (`LLM_CRITICIZER_MODE`): `disabled` | `complex_only` (default) | `always`.
- `complex_only`: solo corre para planes con 3+ pasos LLM (misma definición que Phase 3).
- Prompt del criticizer viene del módulo prompts (criticizer-base + custom checklist en Identity > Criticizer).
1. **Pro revisa**: Gemini Pro (task `'criticize'`, con fallback chain) evalúa la respuesta y retorna JSON estructurado: `{approved: true}` o refinements (`tone`, `length`, `remove`, `add`, `rephrase`).
2. **Flash regenera**: Si hay refinements, se inyectan como instrucciones naturales en el system prompt del compositor. Flash regenera con el contexto completo (identity, guardrails, historial) — nunca ve "CORRECCIONES DEL REVISOR".
- Si Pro aprueba → respuesta original se envía sin cambios
- Si Pro encuentra problemas → Flash regenera con refinements inyectados
- Si falla cualquier paso → fail-open, respuesta original se envía
- Implementado en `runCriticizer()` en `phase4-compose.ts`
- No se ejecuta sobre respuestas fallback (templates de archivo)

## Escalating Circuit Breaker (por model-target)
- Clave: `provider:model` (ej: "anthropic:claude-sonnet-4-6")
- Trigger: 2 fallas en 30 min
- Escalamiento: 1h → 3h → 6h → loop cada 6h
- Reset: primer éxito → closed + reset escalation level
- Independiente del CB legacy por provider (ambos se verifican)

## Features nativos de las APIs
- **Prompt Caching**: Anthropic `cache_control: { type: 'ephemeral' }` (90% ahorro). Google implícito en 2.5+.
- **JSON Mode**: Anthropic prefill trick (`{`). Google `responseMimeType: 'application/json'`.
- **Extended Thinking**: Anthropic `thinking: { type: 'adaptive' }`. Google `thinkingConfig`.
- **Google Search Grounding**: `{ googleSearch: {} }` tool nativa en web_search.
- **Code Execution**: Anthropic `{ type: 'code_execution' }`. Google `{ codeExecution: {} }`.
- **Citations**: Anthropic document blocks (configurable, `LLM_CITATIONS_ENABLED`).
- **Batch**: Anthropic Message Batches API (50% off). Gateway expone `submitBatch/getBatchStatus/getBatchResults`.

## Service-level Circuit Breaker
- TTS, embeddings, voice tienen CB independiente del provider CB
- Usa EscalatingCBManager con keys `service:{name}` (ej: `service:tts`)
- `isServiceAvailable(service)` permite al sistema saber si un servicio está up
- Status expuesto en GET `/console/api/llm/circuit-breakers` → campo `services`

## Task Routing — sin hardcoded
- Todos los modelos por tarea vienen de configSchema con `.default()` — NO hay `DEFAULT_ROUTES` hardcoded
- Cada tarea tiene: `LLM_{TASK}_PROVIDER/MODEL` (primario), `_DOWNGRADE_` (mismo provider), `_FALLBACK_` (cross-API)
- Temperaturas por tarea definidas en `TASK_TEMPERATURES` (internal, no configurable por UI)
- 10 tareas canónicas: main, complex, low, criticize, media, web_search, compress, batch, tts, knowledge
- `resolveTaskName()` en task-router.ts resuelve aliases a tareas canónicas

## Trampas
- **API keys**: NUNCA se logean ni se incluyen en prompts.
- **Thinking + temperature**: incompatibles en Anthropic — adapter elimina temperature automáticamente.
- **JSON mode + tools**: incompatibles en Google 2.5 cuando hay tool calls en historial.
- **Budget = 0**: sin límite. Se chequea antes de cada llamada.
- **Escalating CB es por target**: un modelo puede estar down sin afectar a otros del mismo provider.
- **Phase 2 decide thinking/coding**: `ExecutionStep.useThinking` y `useCoding` son hints del evaluador.
- **Task aliases**: `TASK_ALIASES` mapea nombres custom a tareas canónicas (ej: `'trace-evaluate'` → `'complex'`).
- **Effort router**: 2 niveles (normal→main, complex→complex). NO hay nivel low en effort routing — `low` se usa directamente por ACK service.
- **Subagentes**: heredan del router via task name (`model_tier: 'normal'` → main, `'complex'` → complex, verify → criticize).
