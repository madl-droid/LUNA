# LUNA — Agente IA de Leads

## Qué es
Agente de IA que atiende leads por WhatsApp y email. Califica, agenda, hace seguimiento, escala a humanos. Single-instance per server. Un repo, múltiples deploys.

## Stack
TypeScript / Node.js ≥22 (ESM), PostgreSQL, Redis + BullMQ, Baileys (WhatsApp), Google OAuth2 (Gmail, Calendar, Sheets), LLMs: Anthropic + OpenAI + Google.

## Pipeline (5 pasos, solo 2 usan LLM)
1. **Preprocess** (código): normalizar, identificar contacto, cargar contexto
2. **Classify** (LLM barato): intención, tools necesarias, sentiment
2.5. **Complexity Route** (código): decide si escalar modelo
3. **Execute Tools** (código): ejecutar tools, armar contexto resuelto
4. **Respond** (LLM potente): generar respuesta conversacional
5. **Postprocess** (código): validar, formatear, enviar, guardar, loguear

## Tabla de modelos

### TIEMPO REAL — EL CONTACTO ESTÁ ESPERANDO
| Tarea | Modelo principal | Provider | Fallback |
|-------|-----------------|----------|----------|
| Clasificar intención | Claude Haiku 4.5 | Anthropic | Gemini 3 Flash |
| Ejecutar tools / resolver | Claude Haiku 4.5 | Anthropic | Gemini 3 Flash |
| Generar respuesta conversacional | Claude Sonnet 4.6 | Anthropic | Gemini 3 Flash |
| Tareas complejas | Claude Opus 4.6 | Anthropic | Gemini 3 Pro |
| Mensajes proactivos / follow-ups | Claude Sonnet 4.6 | Anthropic | Gemini 3 Flash |
| Comprimir sesión (en vivo) | Claude Haiku 4.5 | Anthropic | Gemini 3 Flash |

### BATCH NOCTURNO — NADIE ESPERA, 50% DESCUENTO
| Tarea | Modelo principal | Provider | Fallback |
|-------|-----------------|----------|----------|
| Scoring de leads fríos | Claude Haiku 4.5 batch | Anthropic | — |
| Clasificar objeciones acumuladas | Claude Sonnet 4.6 batch | Anthropic | — |
| Comprimir memoria masiva | Gemini 3 Flash batch | Google | Claude Haiku 4.5 |
| Reporte diario al Sheet | Gemini 3 Flash batch | Google | — |

### VOZ, BÚSQUEDA Y MEDIA
| Tarea | Modelo principal | Provider | Fallback |
|-------|-----------------|----------|----------|
| Búsqueda web | Gemini 3 Flash + Grounding | Google | Anthropic web_search |
| Script para audio / llamadas | Claude Sonnet 4.6 | Anthropic | Gemini 3 Flash |
| TTS / síntesis de voz | Gemini TTS | Google | — |
| Llamadas en vivo (V2) | Gemini Live | Google | — |

### Fallback chain: Anthropic → OpenAI → Google
Si un provider falla 5x en 10 min → marcarlo DOWN por 5 min (circuit breaker).

## Estrategia de types (imports entre módulos)

Cada módulo define y exporta SUS propios types. NO hay un `src/shared/types.ts`. Los consumidores importan del módulo que define el type:

```
src/llm/types.ts         → LLMProvider, ChatParams, ChatResponse, TaskType, ModelConfig
src/gateway/channels/types.ts → NormalizedMessage, ChannelAdapter, IncomingRawMessage, SendResult, MediaPayload, OutgoingMessage
src/tools/types.ts       → ToolResult, ToolHealth
src/engine/types.ts      → PreprocessResult, Classification, ModelTier, ResolvedContext, AgentResponse, PipelineResult, PipelineLog
```

Ejemplo de import correcto:
```typescript
import type { NormalizedMessage } from '../gateway/channels/types.js'
import type { ToolResult } from '../tools/types.js'
```

## Convenciones de naming
- Archivos y carpetas: `kebab-case` (ej: `lead-status.ts`, `whatsapp-adapter.ts`)
- Variables y funciones: `camelCase`
- Clases y types/interfaces: `PascalCase`
- Constantes globales: `UPPER_SNAKE_CASE`

## REGLA MAXIMA: Configuracion centralizada

**TODO parametro configurable del sistema DEBE vivir en `src/config.ts` y leerse desde `.env`.**

Esto incluye: API keys, timeouts, limites de tokens, temperaturas, intervalos, cron schedules, puertos, modelos LLM, feature flags de modulos, rutas de archivos, y cualquier valor que el usuario pueda querer cambiar sin tocar codigo.

### Reglas:
1. **Ningun modulo lee `process.env` directamente.** Solo `src/config.ts` lo hace.
2. **Todo modulo importa de `src/config.ts`:** `import { config } from '../config.js'`
3. **Nuevos parametros configurables** se agregan en 3 lugares:
   - `.env.example` (documentacion con valor por defecto)
   - Schema zod en `src/config.ts` (validacion y tipo)
   - Mapeo `loadFromEnv()` en `src/config.ts` (lectura del env var)
4. **Antes de hardcodear un valor** que podria ser configurable (timeout, limite, intervalo, modelo, flag), pregunta al usuario si debe ir en `src/config.ts`.
5. **Valores por defecto** se definen en el schema zod con `.default()`, para que el sistema arranque sin `.env` en desarrollo.

### Ejemplo de uso correcto:
```typescript
import { config } from '../config.js'

const pool = new Pool({
  host: config.db.host,
  port: config.db.port,
  max: config.db.maxConnections,
})
```

### Ejemplo de uso INCORRECTO:
```typescript
// PROHIBIDO: leer process.env directamente
const host = process.env.DB_HOST ?? 'localhost'
```

## Principios
- Si se puede sin LLM → código
- Cada tool extiende BaseTool (retry + fallback + circuit breaker)
- Config por archivos en /instance (Markdown + JSON)
- Fallback messages son predefinidos, nunca generados por LLM
- Channel adapter es interfaz inmutable
- Logs JSON estructurados en cada paso
- Contact unification cross-channel

## Lead Status (máquina de estados)

qualification_status — valores y transiciones:

  unknown → new → qualifying → qualified → scheduled → attended → converted
                      │
                      ├→ out_of_zone
                      ├→ not_interested
                      └→ cold (3 follow-ups sin respuesta)
  scheduled → cold (no asiste, no responde)
  ANY → blocked (lead pide no ser contactado)

Triggers (código en postprocessor, NO en LLM):
  unknown → new:              primer mensaje recibido
  new → qualifying:           agente inicia preguntas de calificación
  qualifying → qualified:     cumple TODOS los criterios de qualifying.json
  qualifying → out_of_zone:   ubicación fuera de cobertura
  qualifying → not_interested: lead dice que no le interesa
  qualifying → cold:          3 follow-ups sin respuesta
  qualified → scheduled:      cita/demo agendada exitosamente
  scheduled → attended:       confirmación de asistencia (manual o callback)
  scheduled → cold:           no asiste y no responde
  attended → converted:       cierre de venta (manual)
  ANY → blocked:              /stop, "no me escriban", "dejen de molestar"
```
`contact_type` es un campo APARTE (no confundir):
contact_type: unknown | lead | client_active | client_former | team_internal | provider | blocked

## Lo que NO hacer

- NO usar ORM (Drizzle, Prisma, TypeORM) — raw SQL con queries parametrizadas ($1, $2)
- NO agregar Express ni Fastify — health check usa http nativo de Node.js
- NO implementar Meta Cloud API adapter — solo archivo placeholder vacío
- NO implementar voz ni llamadas (TTS, Gemini Live) — es V2
- NO agregar vector database (pgvector, Pinecone) — fuse.js fuzzy search basta para V1
- NO guardar archivos en la base de datos — media queda en disco en instance/knowledge/media/
- NO construir dashboard — es V2
- NO hacer sync bidireccional con Google Sheets — Postgres es fuente de verdad, writes a Sheets son async y unidireccionales
- NO usar import sin extensión .js en paths relativos (ESM lo requiere)

## Desarrollo paralelo
Cada sesión trabaja en su propio branch. Contexto específico en `docs/sessions/S{XX}.md`.

## REGLA OBLIGATORIA: Informe de cierre
Al terminar CADA sesión, genera informe en `docs/reports/S{XX}-report.md`:

```markdown
# INFORME DE CIERRE — Sesión S{XX}: {nombre}
## Branch: feat/s{xx}-{nombre-corto}

### Objetivos definidos
### Completado ✅
### No completado ❌
### Archivos creados/modificados
### Interfaces expuestas (exports que otros consumen)
### Dependencias instaladas
### Tests (qué tests, si pasan)
### Decisiones técnicas
### Riesgos o deuda técnica
### Notas para integración
```
