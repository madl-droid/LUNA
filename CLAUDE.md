# LUNA — Agente IA de Leads

## Qué es
Agente de IA que atiende leads por WhatsApp, email, Google Chat y llamadas de voz. Califica, agenda, hace seguimiento, escala a humanos. Single-instance per server. Un repo, múltiples deploys.

## Stack
TypeScript / Node.js ≥22 (ESM), PostgreSQL + pgvector, Redis + BullMQ, Baileys (WhatsApp), Twilio (voz), Google OAuth2 (Gmail, Calendar, Sheets, Chat), LLMs: Anthropic + Google.

## Arquitectura
Sistema modular con kernel que descubre y carga módulos dinámicamente. Cada módulo exporta un `manifest.ts` con lifecycle (init/stop), hooks tipados, config schema y definición de UI.

- Kernel (src/kernel/): registry, loader, hooks, config, server HTTP — ver `src/kernel/CLAUDE.md`
- Módulos (src/modules/): descubiertos automáticamente por loader — ver CLAUDE.md de cada módulo
- Engine (src/engine/): pipeline de procesamiento de mensajes — ver `src/engine/CLAUDE.md`
- Pipeline de 5 pasos (solo 2 usan LLM): ver `docs/architecture/pipeline.md`
- Tabla de modelos y fallback chain: ver `docs/architecture/pipeline.md`
- Lead status (máquina de estados): ver `docs/architecture/lead-status.md`
- Fallback chain: Anthropic → Google. Circuit breaker: 5 fallas en 10 min → provider DOWN 5 min.

## Estructura de directorios
```
src/
  extractors/        — extractores globales de contenido (ver src/extractors/CLAUDE.md)
  kernel/            — core del sistema modular (ver src/kernel/CLAUDE.md)
  modules/
    whatsapp/        — canal WhatsApp Baileys (ver CLAUDE.md)
    memory/          — memoria Redis+PG (ver CLAUDE.md)
    console/         — panel de control web (ver CLAUDE.md)
    llm/             — gateway LLM unificado (ver CLAUDE.md)
    model-scanner/   — escáner de modelos LLM (ver CLAUDE.md)
    users/           — listas de usuarios y permisos (ver CLAUDE.md)
    tools/           — herramientas del agente (ver CLAUDE.md)
    lead-scoring/    — calificación de leads BANT (ver CLAUDE.md)
    google-apps/     — provider Google: OAuth2, Drive, Sheets, Docs, Slides, Calendar (ver CLAUDE.md)
    gmail/           — canal de email via Gmail API (ver CLAUDE.md)
    google-chat/     — canal Google Chat (ver CLAUDE.md)
    twilio-voice/    — canal de voz: Twilio + Gemini Live (ver CLAUDE.md)
    engine/          — wrapper del pipeline para el kernel (ver CLAUDE.md)
    knowledge/       — base de conocimiento: docs, FAQs, sync, búsqueda (ver CLAUDE.md)
    scheduled-tasks/ — tareas programadas del agente (ver CLAUDE.md)
    tts/             — síntesis de voz: Google Cloud TTS (ver CLAUDE.md)
    freight/         — wrapper modular de tool de flete (ver CLAUDE.md)
    medilink/        — integración Medilink/HealthAtom: pacientes, citas, follow-up (ver CLAUDE.md)
    freshdesk/       — integración Freshdesk Knowledge Base: búsqueda y sync de artículos (ver CLAUDE.md)
    cortex/          — sistema nervioso: monitoreo, alertas, Reflex (ver CLAUDE.md)
    subagents/       — subagentes especializados: CRUD, system subagents, web-researcher, verificación iterativa (3 retries), spawn, métricas (ver CLAUDE.md)
    hitl/            — Human-in-the-Loop: consulta humana y escalamiento unificado (ver CLAUDE.md)
  tools/
    freight/         — tool de estimación de flete (ver src/tools/freight/CLAUDE.md)
    freshdesk/       — tools de Freshdesk KB: búsqueda, artículos, sync (ver src/tools/freshdesk/CLAUDE.md)
  engine/            — pipeline de procesamiento (ver src/engine/CLAUDE.md)
    attachments/     — subsistema de adjuntos del engine (types, processor, url-extractor, injection-validator, audio-transcriber, tools)
  migrations/        — SQL migrations numeradas (auto-ejecutadas por kernel/migrator.ts)
  index.ts           — entry point: crea kernel, carga módulos, inicia server
deploy/              — docker-compose + deploy (ver deploy/CLAUDE.md)
instance/            — config operacional (config.json) + knowledge/media/
docs/                — arquitectura (docs/architecture/) y reportes de sesión
```

## Cómo crear un nuevo módulo
**OBLIGATORIO: Consultar `docs/architecture/module-system.md` para la guía completa.** Reglas condensadas en `src/modules/CLAUDE.md` (se carga automáticamente al trabajar en módulos).

Resumen rápido:
1. Crear `src/modules/{nombre}/manifest.ts` exportando `ModuleManifest` (de `../../kernel/types.js`)
2. Definir: name, version, description, type (`core-module`|`channel`|`feature`|`provider`), init(), stop()
3. Config: agregar `configSchema` (Zod) + `.env.example`. UI: definir `console.fields`/`apiRoutes`.
4. Dependencias: declarar `depends: ['otro-modulo']`.
5. **OBLIGATORIO: Crear `CLAUDE.md`** en el directorio del módulo (ver template en sección "Mantenimiento" abajo). Agregar entrada a la lista de "Módulos documentados".
6. **OBLIGATORIO: Usar helpers del kernel** — ver sección "REGLA: No duplicar helpers HTTP ni config schemas" abajo.

## REGLA: Nombre del agente en canales instant

**Todos los canales `channelType: 'instant'`** obtienen el nombre del agente de `prompts:service.getAgentName()`. NO hardcodear nombres. El valor se configura en el módulo `prompts` (campo `AGENT_NAME`). Se usa para detección de @menciones en grupos/rooms. Ver `docs/architecture/channel-guide.md` para el patrón completo.

## REGLA MAXIMA: Config distribuido

**Ningún módulo lee `process.env` directamente.**

### Cómo funciona:
1. **Kernel** (`src/kernel/config.ts`): ÚNICO archivo que lee process.env. Solo infraestructura: DB, Redis, PORT, LOG_LEVEL.
2. **Módulos**: declaran `configSchema` (Zod) en su manifest para sus propias env vars. El loader parsea y guarda en registry.
3. **Lectura**: módulos usan `registry.getConfig<MiConfig>('mi-modulo')` — tipado y validado.
4. **Nuevos params**: agregar al configSchema del módulo + `.env.example`.
5. **Valores por defecto**: en el schema Zod con `.default()`.

### Ejemplo: en manifest.ts declarar `configSchema: z.object({ MI_PARAM: z.string().default('valor') })`, en init() leer con `registry.getConfig<T>('mi-modulo')`.

## REGLA: No duplicar helpers HTTP ni config schemas

**Helpers HTTP y Zod ya existen en el kernel. NUNCA redefinir `readBody`, `parseBody`, `jsonResponse`, `parseQuery` en un módulo.**

### HTTP helpers (`src/kernel/http-helpers.ts`)
```typescript
import { jsonResponse, parseBody, parseQuery, readBody, getPathname } from '../../kernel/http-helpers.js'

// En handlers de apiRoutes:
jsonResponse(res, 200, { ok: true })          // respuesta JSON
const body = await parseBody<MyType>(req)      // leer + parsear JSON body
const query = parseQuery(req)                  // URLSearchParams
const name = query.get('name')                 // query param (string | null)
```

### Config schema helpers (`src/kernel/config-helpers.ts`)
```typescript
import { numEnv, numEnvMin, floatEnv, floatEnvMin, boolEnv } from '../../kernel/config-helpers.js'

configSchema: z.object({
  MI_TIMEOUT_MS: numEnv(30000),          // int, default 30000
  MI_MAX_RETRIES: numEnvMin(0, 3),       // int >= 0, default 3
  MI_BUDGET_USD: floatEnvMin(0, 10.5),   // float >= 0, default 10.5
  MI_ENABLED: boolEnv(true),             // boolean, default true
  MI_NAME: z.string().default('valor'),  // string (sin helper, directo)
})
```

### Lo que NO hacer
- NO definir `function readBody()`, `function jsonResponse()`, `function parseBody()`, `function parseQuery()` dentro de un módulo
- NO escribir `z.string().transform(Number).pipe(z.number().int())` — usar `numEnv()` o `numEnvMin()`
- NO escribir `z.string().transform(v => v === 'true')` — usar `boolEnv()`
- NO usar `res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(...))` — usar `jsonResponse()`
- NO usar `JSON.parse(await readBody(req))` — usar `parseBody<T>(req)`

## Types: cada módulo define los suyos
Contratos centrales en `src/kernel/types.ts` (HookMap, ModuleManifest, payloads). Types de dominio en cada módulo. NO hay `src/shared/types.ts`.
```typescript
import type { ModuleManifest, HookMap } from '../../kernel/types.js'
import type { StoredMessage } from '../memory/types.js'
```

## Convenciones de naming
- Archivos y carpetas: `kebab-case` (ej: `model-scanner`, `baileys-adapter.ts`)
- Variables y funciones: `camelCase`
- Clases y types/interfaces: `PascalCase`
- Constantes globales: `UPPER_SNAKE_CASE`

## Principios
- Si se puede sin LLM → código
- Módulos se comunican via hooks y services del registry, nunca imports directos
- Config por archivos en /instance (Markdown + JSON)
- Fallback messages son predefinidos, nunca generados por LLM
- Logs JSON estructurados en cada paso (pino)
- Contact unification cross-channel

## Lo que NO hacer
- NO usar ORM (Drizzle, Prisma, TypeORM) — raw SQL con queries parametrizadas ($1, $2)
- NO agregar Express ni Fastify — servidor HTTP nativo de Node.js
- NO importar código entre módulos directamente — usar hooks o services del registry
- NO leer process.env fuera de kernel/config.ts — módulos usan registry.getConfig()
- NO implementar Meta Cloud API adapter — solo archivo placeholder vacío
- NO implementar voz ni llamadas fuera del módulo twilio-voice — toda la lógica de voz vive ahí
- pgvector ya está integrado (memory + knowledge v2). NO agregar bases vectoriales externas (Pinecone, Weaviate, etc.)
- NO guardar archivos en la base de datos — media queda en disco en instance/knowledge/media/
- NO construir SPA para console — usar SSR con templates server-side
- NO hacer sync bidireccional con Google Sheets — Postgres es fuente de verdad, writes a Sheets son async
- NO usar import sin extensión .js en paths relativos — ESM lo requiere
- NO acceder arrays por índice sin `!` o `?.` — `noUncheckedIndexedAccess` está activo en tsconfig. `arr[0]` es `T | undefined`. Usar `arr[0]!` cuando hay guard previo (`if (arr.length > 0)`) o `arr[0]?.prop` cuando no hay guard.

## REGLA OBLIGATORIA: Compilar antes de push

**SIEMPRE compilar TypeScript antes de hacer push.** Los errores de TS rompen el build de GitHub Actions y bloquean el deploy.

```bash
docker run --rm -v /docker/luna-repo:/app -w /app node:22-alpine npx tsc --noEmit
```

Si hay errores, corregirlos ANTES de pushear. No hay excepción a esta regla.

## Sistema de migraciones SQL

Las tablas fundacionales del dominio (contacts, sessions, messages, agents, etc.) se crean automáticamente al arrancar mediante un auto-migrador.

### Cómo funciona
1. `src/kernel/migrator.ts` corre en `createPool()`, después de las kernel tables, antes del setup wizard
2. Tabla `schema_migrations` trackea qué migraciones ya se aplicaron
3. Lee archivos `.sql` numerados de `src/migrations/` en orden
4. Cada migración corre en transacción; si falla, rollback y abort

### Archivos de migración (`src/migrations/`)
```
001_engine-tables.sql        — contacts, contact_channels, sessions, messages, campaigns
002_memory-v3-phase0.sql     — pgvector, agents, companies, system_state, pipeline_logs
003_memory-v3-phase1.sql     — ALTER columns, agent_contacts, session_summaries, commitments, archives
004_memory-v3-phase3.sql     — DROP old columns (cleanup)
005_proactive-v1.sql         — extend commitments, proactive_outreach_log
006_ack-messages-v1.sql      — ack_messages + seeds
007_rename-oficina.sql       — rename oficina→console
008_replan-metrics.sql       — add replan columns to pipeline_logs
009_db-cleanup.sql           — drop unused tables, add indexes, final column cleanup
010_alter-ego-v1.sql         — trace_scenarios, trace_runs, trace_results (Cortex simulation & testing)
011_cross-channel-v1.sql     — relax proactive_outreach_log channel constraint for all channels
012_task-checkpoints.sql     — task_checkpoints table for resumable pipeline execution
013_subagents-v1.sql         — subagent_types (CRUD), subagent_usage (métricas)
018_subagents-v2.sql         — is_system, google_search_grounding, seed web-researcher
023_hitl-v1.sql              — hitl_tickets, hitl_ticket_log, hitl_rules, users.supervisor_id
019_attachment-dual-results.sql — llm_text, category_label, file_path en attachment_extractions
020_session-compression-v2.sql — session_archives, session_summaries_v2, session_memory_chunks, compression tracking
021_knowledge-optimization.sql — attachment dedup (content_hash, knowledge_match_id), value evaluation, full_video_embed
```

### Cómo agregar una nueva migración
1. Crear archivo `src/migrations/{NNN}_{nombre}.sql` con el siguiente número secuencial
2. Usar `IF NOT EXISTS` / `IF EXISTS` para idempotencia
3. El migrador lo detecta y aplica automáticamente en el siguiente arranque

### Bootstrap de instance/
`src/kernel/bootstrap.ts` crea directorios faltantes de `instance/` al arrancar (knowledge/media, fallbacks, wa-auth, tools). El Dockerfile copia `instance/` como template base.

### Notas
- Los módulos siguen creando sus tablas propias en `init()` (prompts, llm_usage, google_oauth_tokens, etc.)
- Las migraciones fundacionales (contacts, messages, agents) ahora las maneja el migrador, NO los módulos
- `docs/migrations/` se mantiene como referencia histórica; la versión canónica está en `src/migrations/`

## Deploy
Ramas: `main` (prod), `pruebas` (staging), `claude` (dev). Push auto-deploys via GitHub Actions + Docker + Traefik.
Detalle completo en `deploy/CLAUDE.md`.

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

## Mantenimiento de CLAUDE.md por módulo

Cada módulo bajo `src/` tiene (o debería tener) su propio CLAUDE.md con contexto específico. Estos archivos se cargan automáticamente solo cuando se trabaja en ese directorio.

### Cuándo crear uno nuevo
- Al crear un nuevo módulo en `src/modules/` (ej: `src/modules/llm-anthropic/`)
- Al descubrir trampas o patrones durante desarrollo, actualizar el CLAUDE.md del módulo afectado

### Template (mantener bajo 80 líneas)
Secciones: propósito (1-2 líneas), Archivos (lista), Manifest (type, depends, config), Hooks/Servicios, API routes, Patrones, Trampas.

### Módulos documentados
- `src/extractors/CLAUDE.md` — **extractores globales de contenido** (CUALQUIER módulo/agente que necesite extraer info DEBE usar estos)
- `src/modules/CLAUDE.md` — **reglas de creación de módulos** (se carga automáticamente al trabajar en cualquier módulo)
- `src/kernel/CLAUDE.md` — core del sistema modular
- `src/kernel/setup/CLAUDE.md` — wizard de instalacion + auth (login/logout, sessions, factory reset)
- `src/modules/whatsapp/CLAUDE.md` — canal WhatsApp (Baileys)
- `src/modules/memory/CLAUDE.md` — memoria Redis+PG
- `src/modules/console/CLAUDE.md` — panel de control web
- `src/modules/model-scanner/CLAUDE.md` — escáner de modelos LLM
- `src/modules/users/CLAUDE.md` — listas de usuarios y permisos
- `src/modules/llm/CLAUDE.md` — gateway LLM unificado (circuit breaker, routing, tracking, seguridad)
- `src/modules/tools/CLAUDE.md` — herramientas del agente (registro, ejecución, tool calling nativo)
- `src/modules/lead-scoring/CLAUDE.md` — calificación de leads (BANT + custom, scoring, UI console)
- `src/modules/google-apps/CLAUDE.md` — provider Google (OAuth2, Drive, Sheets, Docs, Slides, Calendar)
- `src/modules/gmail/CLAUDE.md` — canal de email via Gmail API (send, reply, forward, attachments)
- `src/modules/prompts/CLAUDE.md` — gestión centralizada de prompts del agente (slots, campaigns, console)
- `src/modules/engine/CLAUDE.md` — wrapper del pipeline para el kernel
- `src/modules/google-chat/CLAUDE.md` — canal Google Chat (webhook + Chat API, Service Account)
- `src/modules/twilio-voice/CLAUDE.md` — canal de voz (Twilio + Gemini Live)
- `src/modules/knowledge/CLAUDE.md` — base de conocimiento (docs, FAQs, sync Drive/URLs, búsqueda híbrida)
- `src/modules/scheduled-tasks/CLAUDE.md` — tareas programadas (cron, BullMQ, ejecucion LLM)
- `src/engine/attachments/` — subsistema de adjuntos del engine (reemplaza módulo standalone src/modules/attachments/)
- `src/modules/tts/CLAUDE.md` — síntesis de voz (Google Cloud TTS, OGG_OPUS, PTT voice notes)
- `src/modules/freight/CLAUDE.md` — wrapper modular de la tool de flete
- `src/tools/freight/CLAUDE.md` — estimación de flete internacional (SeaRates + DHL Express)
- `src/modules/medilink/CLAUDE.md` — integración Medilink/HealthAtom (pacientes, citas, disponibilidad, follow-up, webhooks)
- `src/modules/freshdesk/CLAUDE.md` — wrapper modular de tools Freshdesk KB
- `src/modules/cortex/CLAUDE.md` — sistema nervioso: monitoreo, alertas, Reflex, Pulse, Trace (simulación y testing)
- `src/modules/subagents/CLAUDE.md` — subagentes especializados (CRUD, system subagents, web-researcher, verificación iterativa 3 retries, spawn, métricas)
- `src/modules/hitl/CLAUDE.md` — Human-in-the-Loop (consulta humana, escalamiento, supervisor chain, handoff por canal)
- `src/tools/freshdesk/CLAUDE.md` — Freshdesk Knowledge Base (búsqueda, artículos, sync semanal)
- `src/engine/CLAUDE.md` — pipeline de procesamiento
- `src/engine/checkpoints/CLAUDE.md` — checkpoints para pipelines resumibles
- `deploy/CLAUDE.md` — infraestructura y despliegue

### Docs de referencia (consultar cuando sea relevante)
- `docs/architecture/module-system.md` — **guía completa de creación de módulos** (tipos, lifecycle, manifest, registry, hooks, servicios, config, console)
- `docs/architecture/channel-guide.md` — **guía completa de creación de canales** (channel-config service, hooks, hot-reload, console fields, checklist)
- `docs/architecture/pipeline.md` — pipeline de 5 pasos y tabla de modelos LLM
- `docs/architecture/lead-status.md` — máquina de estados de calificación de leads
