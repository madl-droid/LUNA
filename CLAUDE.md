# LUNA — Agente IA de Leads

## Qué es
Agente de IA que atiende leads por WhatsApp y email. Califica, agenda, hace seguimiento, escala a humanos. Single-instance per server. Un repo, múltiples deploys.

## Stack
TypeScript / Node.js ≥22 (ESM), PostgreSQL, Redis + BullMQ, Baileys (WhatsApp), Google OAuth2 (Gmail, Calendar, Sheets), LLMs: Anthropic + OpenAI + Google.

## Arquitectura
Sistema modular con kernel que descubre y carga módulos dinámicamente. Cada módulo exporta un `manifest.ts` con lifecycle (init/stop), hooks tipados, config schema y definición de UI.

- Kernel (src/kernel/): registry, loader, hooks, config, server HTTP — ver `src/kernel/CLAUDE.md`
- Módulos (src/modules/): descubiertos automáticamente por loader — ver CLAUDE.md de cada módulo
- Engine (src/engine/): pipeline de procesamiento de mensajes — ver `src/engine/CLAUDE.md`
- Pipeline de 5 pasos (solo 2 usan LLM): ver `docs/architecture/pipeline.md`
- Tabla de modelos y fallback chain: ver `docs/architecture/pipeline.md`
- Lead status (máquina de estados): ver `docs/architecture/lead-status.md`
- Fallback chain: Anthropic → OpenAI → Google. Circuit breaker: 5 fallas en 10 min → provider DOWN 5 min.

## Estructura de directorios
```
src/
  kernel/            — core del sistema modular (ver src/kernel/CLAUDE.md)
  modules/
    whatsapp/        — canal WhatsApp Baileys (ver CLAUDE.md)
    memory/          — memoria Redis+PG (ver CLAUDE.md)
    oficina/         — panel de control web (ver CLAUDE.md)
    llm/             — gateway LLM unificado (ver CLAUDE.md)
    model-scanner/   — escáner de modelos LLM (ver CLAUDE.md)
    users/           — listas de usuarios y permisos (ver CLAUDE.md)
    tools/           — herramientas del agente (ver CLAUDE.md)
    lead-scoring/    — calificación de leads BANT (ver CLAUDE.md)
    google-apps/     — provider Google: OAuth2, Drive, Sheets, Docs, Slides, Calendar (ver CLAUDE.md)
    gmail/           — canal de email via Gmail API (ver CLAUDE.md)
    engine/          — wrapper del pipeline para el kernel (ver CLAUDE.md)
  engine/            — pipeline de procesamiento (ver src/engine/CLAUDE.md)
  index.ts           — entry point: crea kernel, carga módulos, inicia server
deploy/              — docker-compose + deploy (ver deploy/CLAUDE.md)
instance/            — config operacional (config.json) + knowledge/media/
docs/                — arquitectura (docs/architecture/) y reportes de sesión
```

## Cómo crear un nuevo módulo
1. Crear `src/modules/{nombre}/manifest.ts` exportando `ModuleManifest` (de `../../kernel/types.js`)
2. Definir: name, version, description, type (`core-module`|`channel`|`feature`|`provider`), init(), stop()
3. Config: agregar `configSchema` (Zod) + `.env.example`. UI: definir `oficina.fields`/`apiRoutes`.
4. Dependencias: declarar `depends: ['otro-modulo']`.
5. **OBLIGATORIO: Crear `CLAUDE.md`** en el directorio del módulo (ver template en sección "Mantenimiento" abajo). Agregar entrada a la lista de "Módulos documentados".
6. **OBLIGATORIO: Usar helpers del kernel** — ver sección "REGLA: No duplicar helpers HTTP ni config schemas" abajo.

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
- NO implementar voz ni llamadas (TTS, Gemini Live) — es V2
- NO agregar vector database (pgvector, Pinecone) — fuse.js fuzzy search basta para V1
- NO guardar archivos en la base de datos — media queda en disco en instance/knowledge/media/
- NO construir dashboard — es V2
- NO hacer sync bidireccional con Google Sheets — Postgres es fuente de verdad, writes a Sheets son async
- NO usar import sin extensión .js en paths relativos — ESM lo requiere
- NO acceder arrays por índice sin `!` o `?.` — `noUncheckedIndexedAccess` está activo en tsconfig. `arr[0]` es `T | undefined`. Usar `arr[0]!` cuando hay guard previo (`if (arr.length > 0)`) o `arr[0]?.prop` cuando no hay guard.

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
- `src/kernel/CLAUDE.md` — core del sistema modular
- `src/modules/whatsapp/CLAUDE.md` — canal WhatsApp (Baileys)
- `src/modules/memory/CLAUDE.md` — memoria Redis+PG
- `src/modules/oficina/CLAUDE.md` — panel de control web
- `src/modules/model-scanner/CLAUDE.md` — escáner de modelos LLM
- `src/modules/users/CLAUDE.md` — listas de usuarios y permisos
- `src/modules/llm/CLAUDE.md` — gateway LLM unificado (circuit breaker, routing, tracking, seguridad)
- `src/modules/tools/CLAUDE.md` — herramientas del agente (registro, ejecución, tool calling nativo)
- `src/modules/lead-scoring/CLAUDE.md` — calificación de leads (BANT + custom, scoring, UI oficina)
- `src/modules/google-apps/CLAUDE.md` — provider Google (OAuth2, Drive, Sheets, Docs, Slides, Calendar)
- `src/modules/gmail/CLAUDE.md` — canal de email via Gmail API (send, reply, forward, attachments)
- `src/modules/prompts/CLAUDE.md` — gestión centralizada de prompts del agente (slots, campaigns, oficina)
- `src/modules/engine/CLAUDE.md` — wrapper del pipeline para el kernel
- `src/engine/CLAUDE.md` — pipeline de procesamiento
- `deploy/CLAUDE.md` — infraestructura y despliegue

### Docs de referencia (consultar cuando sea relevante)
- `docs/architecture/pipeline.md` — pipeline de 5 pasos y tabla de modelos LLM
- `docs/architecture/lead-status.md` — máquina de estados de calificación de leads
