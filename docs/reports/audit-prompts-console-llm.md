# AUDITORIA COMPLETA: Prompts, Contexto, Consola y LLM

**Fecha:** 2026-03-28
**Branch:** `claude/audit-prompt-system-vwKgg`
**Alcance:** Sistema de prompts, inyeccion de contexto, consola, llamadas LLM

---

## RESUMEN EJECUTIVO

Se auditaron 4 subsistemas interconectados: prompts, engine/contexto, consola y LLM gateway. Se encontraron **7 problemas criticos**, **6 problemas medios** y **5 problemas menores**. El hallazgo mas grave es que el **engine usa un mock de tools hardcodeado** en lugar del registry real, lo que significa que el evaluador LLM solo ve 10 herramientas falsas en vez de las 30+ reales registradas por los modulos.

---

## HALLAZGOS CRITICOS (7)

### C1. Engine Phase 2 usa MOCK tool catalog — no ve tools reales

**Archivos:** `src/engine/phases/phase2-evaluate.ts:10,59` + `src/engine/mocks/tool-registry.ts`

```typescript
import { getCatalog } from '../mocks/tool-registry.js'  // MOCK!
const toolCatalog = getCatalog()  // Siempre 10 tools hardcodeadas
```

**Impacto:** El evaluador LLM (Phase 2) ve solo 10 tools ficticias (schedule, lookup_product, lookup_contact, etc.) en lugar de las 30+ reales registradas por modulos (medilink: 12, google-apps: 8, knowledge: 2, freshdesk: 2, lead-scoring: 1, etc.).

**Consecuencia:** El LLM no puede planificar el uso de tools reales como `search_knowledge`, `freshdesk_get_article`, `estimate-freight`, herramientas de Medilink, etc. Solo puede planificar tools que coincidan con los 10 nombres hardcodeados.

**El propio CLAUDE.md del engine lo confirma:** `tool-registry.ts sigue siendo mock — pendiente conectar tools:registry`

**Correccion:** Phase 2 debe llamar `registry.getOptional('tools:registry')?.getCatalog(contactType)` con filtrado por permisos de usuario.

---

### C2. Subagent siempre ejecuta tools MOCK

**Archivo:** `src/engine/subagent/subagent.ts:17,121`

```typescript
import { executeTool } from '../mocks/tool-registry.js'  // MOCK!
const toolResult = await executeTool(toolCall.name, toolCall.input)  // Siempre fake
```

**Impacto:** Todas las ejecuciones de tools del subagent devuelven datos falsos hardcodeados. Nunca se conecta al registry real.

**Consecuencia:** El subagent mini-loop (tool calling nativo con multiples iteraciones) es completamente inoperante en produccion — todas sus "ejecuciones" devuelven datos ficticios como `{ product: 'Producto Demo', price: 100 }`.

**Correccion:** Debe usar `registry.getOptional('tools:registry')?.executeTool()` con fallback a error explicito.

---

### C3. Deshabilitacion de tools en consola NO afecta al evaluador

**Flujo roto:**
1. Admin deshabilita tool X en consola via `PUT /console/api/tools/settings`
2. Se marca `enabled=false` en tabla `tools` de PostgreSQL
3. Phase 3 (Execute) SI respeta esto — rechaza ejecucion
4. Phase 2 (Evaluate) **NO lo ve** — usa mock catalog hardcodeado
5. El LLM sigue recomendando tool X en su plan de ejecucion

**Consecuencia:** Tools deshabilitadas se planifican pero fallan en ejecucion, desperdiciando tokens y generando errores silenciosos.

---

### C4. Configuracion LLM de consola NO llega al engine config

**Archivos:**
- `src/engine/config.ts` — Lee `LLM_CLASSIFY_MODEL`, `LLM_CLASSIFY_PROVIDER` de `process.env` UNICAMENTE
- `src/modules/llm/task-router.ts` — Lee `LLM_ROUTE_CLASSIFY` (JSON) de registry config (DB + env)
- `src/modules/console/templates-sections.ts` — Guarda `LLM_ROUTE_*` en config_store

**El problema:**
| Componente | Lee de | Clave |
|---|---|---|
| Console UI | Guarda en config_store (DB) | `LLM_ROUTE_CLASSIFY` (JSON) |
| LLM Module TaskRouter | registry.getConfig('llm') | `LLM_ROUTE_CLASSIFY` (JSON) |
| Engine config.ts | `process.env` SOLAMENTE | `LLM_CLASSIFY_MODEL` (string) |

**Consecuencia:** Cambiar modelo/provider en la consola actualiza el LLM module, pero el engine sigue leyendo los valores originales del `.env`. Solo un restart del servidor aplica los cambios del engine.

**Nota:** Las llamadas que van por hook `llm:chat` SI usan el TaskRouter correcto. Pero las llamadas directas del engine (commitment-detector, proactive) usan `config.classifyProvider/classifyModel` del env.

---

### C5. Prompts de relacion (lead/admin/coworker/unknown) sin UI de edicion

**Estado:** Los 4 prompts de relacion existen en DB (`prompt_slots` con `slot='relationship'`, `variant='lead'|'admin'|'coworker'|'unknown'`) y se usan activamente en el compositor (Phase 4).

**El problema:** No hay NINGUN campo en la consola para editarlos. El manifest de prompts (`src/modules/prompts/manifest.ts`) solo declara campos para `PROMPT_IDENTITY`, `PROMPT_JOB`, `PROMPT_GUARDRAILS` y `PROMPT_CRITICIZER`. No hay `PROMPT_RELATIONSHIP_*`.

**Unica forma de editar:** API directa `PUT /console/api/prompts/slot` con `{ slot: 'relationship', variant: 'lead', content: '...' }` — sin interfaz visual.

**Consecuencia:** Los prompts de relacion quedan congelados con el seed inicial (`instance/prompts/defaults/relationship-*.md`) a menos que alguien haga una llamada API manual. La consola dice "define personalidad, trabajo, reglas y **relaciones**" pero no permite editar relaciones.

---

### C6. Doble config de PIPELINE_MAX_TOOL_CALLS_PER_TURN

**Archivos:**
- `src/engine/config.ts:75` — `maxToolCallsPerTurn: envInt('PIPELINE_MAX_TOOL_CALLS_PER_TURN', 5)`
- `src/modules/tools/manifest.ts:163` — `PIPELINE_MAX_TOOL_CALLS_PER_TURN: numEnv(5)`

**El problema:** Ambos leen la misma env var, pero el engine carga su valor una sola vez al inicio (inmutable), mientras que el tools module lo recarga via `registry.reloadAllModuleConfigs()` en hot-reload.

**Consecuencia:** Cambiar el limite en consola afecta al tools:registry.executeTools() pero NO al engine. El engine puede permitir 5 calls mientras tools:registry solo permite 3, o viceversa.

---

### C7. Engine config no participa del hot-reload de consola

**Archivo:** `src/engine/config.ts` usa `getEnv()` del kernel que solo lee `process.env`. No es un modulo con configSchema — es una funcion pura que lee env vars.

**Consecuencia:** NINGUNA configuracion del engine (modelos, temperaturas, timeouts, retries, limites) se actualiza al hacer "Aplicar" en la consola. Solo un restart del servidor los aplica.

**Campos afectados:**
- `LLM_CLASSIFY_MODEL/PROVIDER` — modelo evaluador
- `LLM_RESPOND_MODEL/PROVIDER` — modelo compositor
- `temperatureClassify`, `temperatureRespond` — temperaturas
- `maxOutputTokens` — tokens de salida
- `composeRetriesPerProvider` — reintentos
- `maxToolCallsPerTurn` — limite de tools

---

## HALLAZGOS MEDIOS (6)

### M1. Gmail sin form builder de formato de respuesta

**Estado:** WhatsApp tiene 13+ campos de formato (tono, emoji, typos, signos, ejemplos) que se construyen dinamicamente en el compositor via `buildFormatFromForm()`.

**Gmail** solo tiene `FORMAT_INSTRUCTIONS_EMAIL` como un textarea crudo. No tiene:
- Seleccion de tono
- Nivel de emoji
- Max oraciones/parrafos
- Ejemplos de formato

**Consecuencia:** El formato de email es todo-o-nada: o escribes el prompt completo a mano, o usas el template por defecto.

---

### M2. Google Chat sin configuracion de formato de respuesta

**Estado:** No existe `FORMAT_INSTRUCTIONS_GOOGLE_CHAT` ni campos de formato para Google Chat. El compositor usa el fallback hardcodeado de WhatsApp.

**Consecuencia:** Google Chat hereda las reglas de WhatsApp (300 chars, conversacional) que pueden no ser apropiadas para un entorno empresarial.

---

### M3. Rutas LLM duplicadas: DEFAULT_ROUTES vs env vars

**Archivo:** `src/modules/llm/task-router.ts:20-118`

**El problema:** TaskRouter tiene `DEFAULT_ROUTES` hardcodeadas:
- classify: Sonnet -> Haiku -> Flash
- respond: Flash -> Flash-Lite -> Haiku

Pero el engine config tiene defaults diferentes:
- classify: Haiku (default en env)
- respond: Sonnet (default en env)

**Consecuencia:** Si no hay config explicita, el LLM module rutea a Sonnet para classify, pero el engine config dice Haiku. Dependiendo de que path se use (hook vs directo), se usa diferente modelo.

---

### M4. search_knowledge tool oculta en consola

**Archivo:** `src/modules/console/templates-sections.ts:1031`

```typescript
const TOOLS_PAGE_EXCLUDE = new Set(['tools', 'prompts', 'engine', 'memory', 'knowledge', 'tts'])
```

**Consecuencia:** La tool `search_knowledge` (registrada por el modulo knowledge) esta excluida de la pagina de herramientas de la consola. No se puede habilitar/deshabilitar visualmente ni configurar retries/access rules desde la UI.

---

### M5. Permisos de usuario filtran tools del mock, no del registry real

**Archivo:** `src/engine/prompts/evaluator.ts:230-239`

```typescript
function filterToolsByPermissions(catalog, ctx) {
  if (ctx.userPermissions.tools.includes('*')) return catalog
  return catalog.filter(t => ctx.userPermissions.tools.includes(t.name))
}
```

**El problema:** El filtrado de permisos SI se aplica, pero sobre el catalogo mock de 10 tools. Los nombres de tools reales configurados en permisos de usuario (`users:permissions`) no coinciden con los nombres del mock.

**Ejemplo:** Si configuras `tools: ['search_knowledge', 'freshdesk_search']` en permisos, el filtro devuelve 0 tools porque esos nombres no existen en el mock.

---

### M6. Sync bidireccional prompts <-> config_store con inconsistencia temporal

**Flujo:**
1. `syncConsoleFields()` copia prompt_slots -> config_store (init)
2. Console muestra valores de config_store
3. API `PUT /console/api/prompts/slot` escribe a prompt_slots directamente
4. Console sigue mostrando valor viejo de config_store hasta refresh

**Consecuencia:** Editar prompts via API no actualiza la vista de consola inmediatamente. Hay dos fuentes de verdad (DB y config_store) que pueden divergir.

---

## HALLAZGOS MENORES (5)

### m1. Template `channel-format-google-chat.md` no existe

Solo existen `channel-format-whatsapp.md` y `channel-format-email.md` en `instance/prompts/system/`. Google Chat no tiene template propio.

### m2. Evaluator generado (slot='evaluator') no se usa en Phase 2

El prompt module tiene `generateEvaluator()` que genera un evaluador via LLM y lo guarda en `prompt_slots` con `slot='evaluator'`. Pero el evaluador de Phase 2 (`src/engine/prompts/evaluator.ts`) lee de `getSystemPrompt('evaluator-system')` (archivo), NO del slot 'evaluator' de DB.

### m3. Mock tool registry tiene fecha hardcodeada

`src/engine/mocks/tool-registry.ts:59` devuelve availability con fecha `2026-03-18` — datos de demo que llegarian a produccion si el mock se ejecuta.

### m4. No hay campo de consola para embedding model selection

El modelo de embeddings esta hardcodeado como `gemini-embedding-exp-03-07` en el knowledge module. No es configurable desde consola.

### m5. Circuit breaker de embeddings no visible en consola

El knowledge module tiene circuit breaker para embeddings (3 fallas en 5min -> abierto 5min) pero no hay indicador en la UI de consola sobre su estado.

---

## MAPA DE CONECTIVIDAD

### Que SI esta conectado correctamente

| Origen (Consola) | Destino (Engine/LLM) | Estado |
|---|---|---|
| PROMPT_IDENTITY/JOB/GUARDRAILS/CRITICIZER | compositor Phase 4 via promptsService | OK (via sync) |
| WHATSAPP_FORMAT_TONE/EMOJI/TYPOS/etc | compositor via buildFormatFromForm() | OK |
| FORMAT_INSTRUCTIONS_WHATSAPP (advanced) | compositor via config_store | OK |
| AGENT_NAME/LAST_NAME/LANGUAGE | promptsService.getAgentName() | OK |
| AGENT_ACCENT | accent prompt injection en identity | OK |
| Knowledge documents/categories/FAQs | Phase 1 knowledgeInjection | OK |
| User permissions knowledgeCategories | Phase 1 category filtering | OK |
| Tool enable/disable | Phase 3 execution gate | OK |
| Tool access rules per contact_type | Phase 3 isToolAllowed() | OK |
| Lead scoring campaigns | Phase 1 campaign detection | OK |
| criticizer-base.md template | compositor quality checklist | OK |
| LLM API keys | LLM module providers | OK |
| Circuit breaker config | LLM module CB | OK |
| Rate limits RPM/TPM | LLM module usage tracker | OK |

### Que NO esta conectado

| Origen (Consola) | Destino esperado | Problema |
|---|---|---|
| Tool enable/disable | Phase 2 evaluator catalog | Usa mock, no registry |
| Tool access rules | Phase 2 evaluator filtering | Filtra sobre mock |
| LLM_ROUTE_* (console) | Engine config.ts | Engine lee env, no config_store |
| PIPELINE_MAX_TOOL_CALLS_PER_TURN (console) | Engine maxToolCallsPerTurn | Engine no hot-reload |
| Relationship prompts | Console UI | Sin campos de edicion |
| Gmail format (tono/emoji) | Console UI | Sin form builder |
| Google Chat format | Console + compositor | Sin template ni config |
| Generated evaluator (DB) | Phase 2 evaluator system | Phase 2 lee archivo, no DB |
| Temperature/retry config (console) | Engine config | Engine no hot-reload |

---

## RESUMEN DE DUPLICACIONES

| Concepto | Ubicacion 1 | Ubicacion 2 | Conflicto |
|---|---|---|---|
| Tool catalog | `src/engine/mocks/tool-registry.ts` (10 tools fake) | `src/modules/tools/tool-registry.ts` (30+ real) | Mock vs Real |
| Model routing | `src/engine/config.ts` (env vars) | `src/modules/llm/task-router.ts` (JSON routes) | Diferentes defaults |
| Tool call limit | `src/engine/config.ts:75` | `src/modules/tools/manifest.ts:163` | Sin sync |
| Prompt storage | `prompt_slots` table | `config_store` table | Doble fuente de verdad |
| Channel format defaults | `src/engine/prompts/compositor.ts:12-26` | `instance/prompts/system/channel-format-*.md` | Prioridad confusa |
| Evaluator prompt | `instance/prompts/system/evaluator-system.md` | `EVALUATOR_SYSTEM_FALLBACK` en evaluator.ts | Fallback innecesario si template existe |

---

## PLAN DE ACCION RECOMENDADO

### Prioridad 1 — Critico (impide funcionamiento correcto)

1. **Conectar tools:registry al evaluador (Phase 2)**
   - Reemplazar `import { getCatalog } from '../mocks/tool-registry.js'`
   - Usar `registry.getOptional('tools:registry')?.getCatalog(contactType)`
   - Mantener mock solo como fallback si tools module no esta activo
   - Archivos: `src/engine/phases/phase2-evaluate.ts`, `src/engine/prompts/evaluator.ts`

2. **Conectar tools:registry al subagent**
   - Reemplazar `import { executeTool } from '../mocks/tool-registry.js'`
   - Usar registry real con fallback a error explicito en prod
   - Archivo: `src/engine/subagent/subagent.ts`

3. **Unificar config de modelos engine <-> LLM module**
   - Mover config de modelos del engine al engine module manifest (configSchema)
   - O hacer que engine lea del LLM module's TaskRouter via registry
   - Archivos: `src/engine/config.ts`, `src/modules/engine/manifest.ts`

### Prioridad 2 — Medio (funcionalidad incompleta)

4. **Agregar campos de edicion de relationship prompts en consola**
   - Agregar 4 textareas para relationship variants (lead, admin, coworker, unknown)
   - Archivo: `src/modules/prompts/manifest.ts` (console.fields)

5. **Crear form builder de formato para Gmail y Google Chat**
   - Replicar patron de WhatsApp (tono, emoji, max sentences, etc.)
   - Archivos: manifests de gmail y google-chat

6. **Crear template channel-format-google-chat.md**
   - Archivo: `instance/prompts/system/channel-format-google-chat.md`

### Prioridad 3 — Mejoras

7. **Eliminar mock tool-registry.ts**
   - Despues de conectar registry real, eliminar `src/engine/mocks/tool-registry.ts`

8. **Unificar PIPELINE_MAX_TOOL_CALLS_PER_TURN en una sola fuente**

9. **Conectar evaluator generado (DB) al Phase 2**

10. **Agregar indicador de estado de circuit breaker de embeddings en consola**

---

## ARCHIVOS CLAVE REFERENCIADOS

```
src/engine/mocks/tool-registry.ts          — MOCK a eliminar
src/engine/phases/phase2-evaluate.ts       — Usa mock catalog
src/engine/subagent/subagent.ts            — Usa mock executeTool
src/engine/config.ts                       — Lee env, no config_store
src/engine/prompts/evaluator.ts            — Prompt builder Phase 2
src/engine/prompts/compositor.ts           — Prompt builder Phase 4
src/modules/prompts/manifest.ts            — Sin campos relationship
src/modules/llm/task-router.ts             — Routing con JSON routes
src/modules/llm/manifest.ts                — Config LLM_ROUTE_*
src/modules/tools/tool-registry.ts         — Registry real (no usado por engine)
src/modules/engine/manifest.ts             — Sin config de modelos LLM
src/modules/console/templates-sections.ts  — UI de consola
instance/prompts/system/                   — Templates de sistema
instance/prompts/defaults/                 — Seeds iniciales
```
