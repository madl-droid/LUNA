# Task Routing — Modelo de enrutamiento LLM

## Regla Maxima

**El Task Router es la UNICA fuente de verdad para la seleccion de modelo/provider/key.**
No ejecuta llamadas — cada servicio consulta al router y ejecuta independientemente.

## 10 Tareas Canonicas

| Tarea | Modelo default | Fallback | Uso |
|-------|---------------|----------|-----|
| `main` | Sonnet 4.6 | Gemini Flash | Conversacion, respuestas, tool calling |
| `complex` | Opus 4.6 | Gemini Pro | Razonamiento profundo, objeciones, HITL |
| `low` | Haiku 4.5 | Gemini Flash Lite | Saludos, ACKs, confirmaciones simples |
| `criticize` | Gemini Pro | Sonnet 4.6 | Verificacion de calidad, subagent verify |
| `media` | Gemini Flash | Sonnet 4.6 | Vision, audio, video, documentos, OCR, STT |
| `web_search` | Gemini Flash + grounding | Sonnet 4.6 | Busqueda web con Google Search |
| `compress` | Sonnet 4.6 | Gemini Flash | Compresion de sesiones, buffer |
| `batch` | Sonnet 4.6 | Gemini Flash | Batch nocturno, scoring, tareas programadas |
| `tts` | Gemini Pro TTS | Gemini Flash TTS | Sintesis de voz |
| `knowledge` | text-embedding-004 | — | Embeddings, vectorizacion |

Servicios adicionales (no pasan por el gateway):
- **voice**: Gemini Flash Live (WebSocket directo, lee modelo del router)

## Effort Router (2 niveles)

El effort router clasifica mensajes entrantes en 2 niveles de complejidad:

| Nivel | Tarea canonica | Modelo | Triggers |
|-------|---------------|--------|----------|
| `normal` | `main` | Sonnet | Default para todos los mensajes |
| `complex` | `complex` | Opus | >500 chars, 3+ preguntas, 2+ adjuntos, HITL, objeciones, nuevo contacto largo |

**No hay nivel "low" en el effort router.** La tarea `low` se usa directamente para ACKs y se selecciona por el servicio de ACK, no por el effort router.

## Sistema de Categorias (TaskCategory)

Cada feature que hace una llamada LLM DEBE declarar una categoria. La categoria mapea directamente a una tarea canonica:

```typescript
import { TaskCategory } from '../../modules/llm/types.js'

// Uso directo
const result = await callLLM({ task: TaskCategory.MEDIA, ... })

// Equivale a:
const result = await callLLM({ task: 'media', ... })
```

### Categorias disponibles

| Categoria | Tarea | Descripcion |
|-----------|-------|-------------|
| `TaskCategory.CONVERSATION` | `main` | Chat, respuestas, tool calling |
| `TaskCategory.ANALYSIS` | `complex` | Razonamiento profundo, cortex |
| `TaskCategory.ACKNOWLEDGMENT` | `low` | Saludos, ACKs, confirmaciones |
| `TaskCategory.QUALITY_GATE` | `criticize` | Verificacion, review |
| `TaskCategory.MEDIA` | `media` | Vision, audio, video, docs, STT |
| `TaskCategory.SEARCH` | `web_search` | Busqueda web |
| `TaskCategory.MEMORY` | `compress` | Compresion de sesiones |
| `TaskCategory.BACKGROUND` | `batch` | Batch nocturno, scoring |
| `TaskCategory.SPEECH` | `tts` | Text-to-speech |
| `TaskCategory.INDEXING` | `knowledge` | Embeddings |

## Como agregar una nueva llamada LLM

1. **Elige una categoria** de la tabla anterior
2. **Usa el task name** de la categoria o un nombre descriptivo:
   ```typescript
   // Opcion A: usa la categoria directamente
   await callLLM({ task: TaskCategory.MEDIA, ... })
   
   // Opcion B: usa un nombre descriptivo + registralo como alias
   await callLLM({ task: 'mi-feature-vision', ... })
   // Y en task-router.ts TASK_ALIASES:
   // 'mi-feature-vision': 'media',
   ```
3. **NO crees una nueva tarea canonica** — las 10 existentes cubren todos los casos
4. **NO pases model/provider explicitamente** — deja que el router decida

## TASK_ALIASES

Todos los nombres de tarea custom estan registrados en `TASK_ALIASES` en `src/modules/llm/task-router.ts`. Si un nombre no esta registrado, el router lo enruta a `main` con un warning en logs.

### Reglas
- Si usas un nombre descriptivo como task, **DEBES agregarlo a TASK_ALIASES**
- Cada alias apunta a exactamente 1 tarea canonica
- Los nombres canonicos (main, complex, etc.) no necesitan alias
- Si un task name desconocido llega al router, se enruta a `main` con warning

## Fallback Chain (3 niveles)

Cada tarea tiene una cadena de fallback de 3 niveles:

```
Primary (2 retries con backoff)
  ↓ falla / circuit breaker
Downgrade — mismo provider, modelo menor (2 retries)
  ↓ falla
Fallback — otro provider (2 retries)
```

Configurable desde la consola en **Agente > Advanced > Uso de modelos**.

## Subagentes

Los subagentes heredan del router:
- `model_tier: 'normal'` → tarea `main`
- `model_tier: 'complex'` → tarea `complex`
- Verificacion iterativa → tarea `criticize` (via alias `subagent-verify`)
- Google Search grounding → tarea `web_search`

## Configuracion

Los modelos se configuran en el modulo LLM (`src/modules/llm/manifest.ts` configSchema):
- `LLM_{TASK}_PROVIDER` / `LLM_{TASK}_MODEL` — modelo primario
- `LLM_{TASK}_DOWNGRADE_PROVIDER` / `LLM_{TASK}_DOWNGRADE_MODEL` — downgrade
- `LLM_{TASK}_FALLBACK_PROVIDER` / `LLM_{TASK}_FALLBACK_MODEL` — cross-API fallback

La UI de consola (**Agente > Advanced > Uso de modelos**) permite cambiar todos los modelos sin reiniciar.

## Archivos clave

- `src/modules/llm/types.ts` — `LLMTask`, `TaskCategory`
- `src/modules/llm/task-router.ts` — `TaskRouter`, `TASK_ALIASES`, `resolveTaskName()`
- `src/modules/llm/manifest.ts` — configSchema con defaults
- `src/engine/agentic/effort-router.ts` — clasificacion `normal`/`complex`
- `src/engine/agentic/types.ts` — `EffortLevel`
