# Plan: Console Structural Cleanup — Segunda Pasada

## Contexto
La primera pasada (PR #96) limpió controles muertos y naming legacy del engine. Esta segunda pasada ataca la **forma del módulo**: ownership de settings, migración de naming, metadata residual, partición de archivos grandes y separación de concerns del router.

Branch de trabajo: `codex/auditoria-simplicidad`
Base: `pruebas`

---

# 1. Quitar `PIPELINE_MAX_TOOL_CALLS_PER_TURN` de Agente > Avanzado

**Por qué**: El dueño real es el módulo `tools` — `ToolExecutor.executeParallel()` hace `calls.slice(0, this.maxCallsPerTurn)`. La copia en Avanzado es redundante y crea confusión de ownership.

**Archivo**: `src/modules/console/templates-sections.ts`

**Cambio**: En `renderAdvancedAgentSection()` (~línea 897), eliminar el `numField('PIPELINE_MAX_TOOL_CALLS_PER_TURN', ...)` del panel "Motor Agentico". También eliminar la variable `maxToolCalls` (~línea 875) que ya no se usa.

**Mantener**: El control en `Herramientas > Tools` (línea ~1431 del manifest de tools) — ese es el owner canónico.

---

# 2. Cerrar migración `users → contacts`

**Por qué**: El sidebar dice "Contactos", las URLs GET son `/console/contacts/*`, pero los 8 POST handlers y ~7 form actions siguen usando `/console/users/*`. Inconsistencia pura.

## 2a. Renombrar POST handlers en server.ts

Renombrar el path de cada handler (el código interno no cambia, solo el string de la ruta):

| Ruta actual | Ruta nueva |
|-------------|------------|
| `/users/add` (línea 883) | `/contacts/add` |
| `/users/update` (línea 938) | `/contacts/update` |
| `/users/deactivate` (línea 1007) | `/contacts/deactivate` |
| `/users/reactivate` (línea 1033) | `/contacts/reactivate` |
| `/users/create-list` (línea 1057) | `/contacts/create-list` |
| `/users/toggle-list` (línea 1091) | `/contacts/toggle-list` |
| `/users/delete-list` (línea 1122) | `/contacts/delete-list` |
| `/users/config` (línea 1143) | `/contacts/config` |

En cada handler, actualizar también las URLs de redirect. Por ejemplo:
- `Location: /console/users?flash=...` → `Location: /console/contacts/admin?flash=...`
- `Location: /console/contacts?page=config` → mantener (ya es correcto)

## 2b. Actualizar form actions en templates-sections.ts

Buscar y reemplazar TODOS los `action="/console/users/` por `action="/console/contacts/`:

- línea ~2992: `action="/console/users/reactivate"` → `action="/console/contacts/reactivate"`
- línea ~3133: `action="/console/users/update"` → `action="/console/contacts/update"`
- línea ~3465 (JS dinámico): `form.action='/console/users/add'` → `form.action='/console/contacts/add'`
- línea ~3546 (JS dinámico): `f.action='/console/users/deactivate'` → `f.action='/console/contacts/deactivate'`
- línea ~3930: `action="/console/users/delete-list"` → `action="/console/contacts/delete-list"`
- línea ~4201 (JS dinámico): `form.action='/console/users/toggle-list'` → `form.action='/console/contacts/toggle-list'`

## 2c. Eliminar el redirect legacy `/console/users` → `/console/contacts/admin`

En server.ts (~línea 1299-1302), eliminar el bloque:
```
if (section === 'users') {
  res.writeHead(302, { Location: `/console/contacts/admin?lang=${lang}` })
```

Ya no hay nada que apunte a `/console/users` — los forms ahora van a `/console/contacts/*`.

---

# 3. Limpiar metadata residual de `pipeline`

**Archivos y cambios**:

### templates.ts
- Línea 37: eliminar `pipeline: svgIcon(...)` de `ICONS`
- Línea 63: eliminar `'pipeline'` de `FIXED_IDS`

### templates-i18n.ts
Eliminar estas 4 claves (ES + EN):
- `sec_pipeline_unified`
- `sec_pipeline_unified_info`

Y también estas claves huérfanas detectadas en la review anterior:
- `i_PIPELINE_TURNS` (info text del campo eliminado `PIPELINE_MAX_CONVERSATION_TURNS`)
- `sec_engine_metrics` / `sec_engine_metrics_info` (reemplazadas por `sec_agente_engine_metrics*`)

### templates-sections.ts
- Línea ~2804: eliminar comentario `// Unified Pipeline page (replaces pipeline, followup, naturalidad)`

### server.ts
- Líneas ~1307-1312: eliminar el redirect `section === 'pipeline'` → `/console/agente/advanced`
- Líneas ~1313-1318: eliminar el redirect `section === 'engine-metrics'` → `/console/agente/engine-metrics`

Estos redirects eran compatibilidad con bookmarks viejos. Ya no existen páginas standalone de pipeline ni engine-metrics — ahora viven como sub-tabs de Agente. Cualquier URL vieja dará 404, lo cual es correcto para un panel admin privado.

### CLAUDE.md del módulo console
- Eliminar referencia a `/console/pipeline`
- Actualizar cualquier mención de "pipeline" como sección de la consola

---

# 4. Eliminar `SECTION_REDIRECTS`

**Archivo**: `src/modules/console/templates-sections.ts`
- Línea 1363: eliminar `export const SECTION_REDIRECTS: Record<string, string> = {}`

**Archivo**: `src/modules/console/server.ts`
- Ya fue eliminado del import en la pasada anterior (reemplazado por `renderEngineMetricsSection`). Verificar que no quede ninguna referencia.

---

# 5. Partir `templates-sections.ts` por botón principal de sidebar

**Archivo actual**: `templates-sections.ts` — 4435 líneas, 14 funciones exportadas.

**Estrategia**: Un archivo por cada botón principal del sidebar. Las utilidades compartidas (field builders, helpers) quedan en un archivo de utils.

## Nuevo layout de archivos:

### `templates-sections-utils.ts` (~200 líneas)
Funciones helper usadas por todos los renderers:
- `cv()`, `esc()`, `t()`
- `numField()`, `boolField()`, `secretField()`, `selectField()`
- `panel()`, `row2()`, `durF()`, `hourSel()`
- `mtRow()`, `modelDropdown()` (model table helpers)
- Type `SectionData` (interface export)

### `templates-sections-agente.ts` (~800 líneas)
Todo lo que vive bajo el botón "Agente" del sidebar:
- `renderDashboardSection()` — dashboard principal del agente
- `renderAdvancedAgentSection()` — API keys, modelos, funciones avanzadas, límites, motor agentico, proactive
- `renderEngineMetricsSection()` — métricas del engine
- `renderMemorySection()` — configuración de memoria
- `renderIdentitySection()` — persona, voz, prompts del agente
- `renderVoiceTTSSection()` — configuración de voz/TTS
- `renderLlmUnifiedSection()` — modelos, API keys, limits, circuit breaker (vive en Agente > Avanzado)
- `renderModelsTable()` y `renderModelsContent()` (helpers internos de LLM)

### `templates-sections-channels.ts` (~300 líneas)
Todo lo que vive bajo "Canales":
- `renderChannelsSection()` — grid de cards de canales
- `renderWhatsappSection()` — config WhatsApp específica
- `renderEmailSection()` — config Gmail
- `renderGoogleAppsSection()` — Google OAuth, Drive, Sheets, Calendar
- Constantes: `CH_SVG`, `CH_PLACEHOLDER`, `COMING_SOON_CHANNELS`

### `templates-sections-contacts.ts` (~600 líneas)
Todo lo que vive bajo "Contactos":
- `renderUsersSection()` — listas de usuarios, filtros, tabla, modal de crear/editar
- Helpers de permisos: checkboxes de tools, skills, subagents por tipo de usuario

### `templates-sections-herramientas.ts` (~400 líneas)
Todo lo que vive bajo "Herramientas":
- `renderToolsCardsSection()` — cards de herramientas
- `renderLeadScoringSection()` — wrapper del módulo lead-scoring
- `renderScheduledTasksSection()` — wrapper del módulo scheduled-tasks
- `renderKnowledgeItemsSection()` — wrapper del módulo knowledge

### `templates-sections.ts` (~200 líneas) — dispatcher + misceláneos
Se queda como punto de entrada:
- `renderSection()` — switch dispatcher que importa de los 4 archivos anteriores
- `renderInfraUnifiedSection()` — config DB/Redis (solo visible para super admins)
- `renderModulesSection()` — lista de módulos
- `renderDatabaseViewer()` — visor de DB (debug)
- Re-exports de types y funciones que otros archivos importan

### Regla de imports
Cada archivo de sección importa helpers de `templates-sections-utils.ts`. El dispatcher `renderSection()` importa las funciones render de cada archivo de sección. Los imports van en una sola dirección:

```
templates-sections-utils.ts  ←  templates-sections-agente.ts
                             ←  templates-sections-channels.ts
                             ←  templates-sections-contacts.ts
                             ←  templates-sections-herramientas.ts
                             ←  templates-sections.ts (dispatcher)
```

---

# 6. Extraer subrouters de `server.ts`

**Archivo actual**: `server.ts` — 2515 líneas.

**Estrategia**: Separar por grupo funcional. El handler principal queda como orchestrador delgado.

## Nuevo layout:

### `server-posts.ts` (~600 líneas)
Todos los POST handlers de formularios:
- `/console/save` y `/console/apply` (config save + hot reload)
- `/console/contacts/*` (los 8 handlers renombrados)
- `/console/modules/toggle`
- `/console/reset-db`, `/console/reset-contacts`
- Export: `handlePost(localUrl, body, lang, registry): Promise<{handled: boolean, redirect?: string}>`

### `server-api.ts` (~800 líneas)
Toda la función `createApiRoutes()` tal cual — ya está bien encapsulada como array de `ApiRoute[]`.
- Export: `createApiRoutes()`

### `server-data.ts` (~200 líneas)
Funciones de carga de datos:
- `fetchSectionData()` — aggregate de datos SSR por sección
- Export: `fetchSectionData()`

### `server-helpers.ts` (~300 líneas)
Helpers compartidos:
- `checkSuperAdmin()`
- `guardDebugEndpoint()`
- `purgeAllData()`, `purgeMemoryData()`, `purgeAgentData()`, `reseedSystemSubagents()`
- `flushRedisExceptSessions()`
- `parseFormBody()`, `findEnvFile()`, `parseEnvFile()`, `writeEnvFile()`
- `render404Page()`

### `server.ts` (~600 líneas) — orchestrador
Se queda con:
- `createConsoleHandler()` — pero ahora es un router delgado:
  1. Static files
  2. OAuth callback
  3. `if (POST) return handlePost(...)` (delegado)
  4. URL normalization + subpage detection
  5. Data loading via `fetchSectionData()`
  6. SSR render via `pageLayout()`
- Export: `createConsoleHandler()`

---

# 7. Limpiar comentarios legacy

Buscar y eliminar en todo el módulo `console`:

| Patrón | Acción |
|--------|--------|
| `Phase 1`, `Phase 2`, `Phase 4`, `Phase 5` | Eliminar o reemplazar por terminología actual |
| `legacy response` | Eliminar comentario |
| `pipeline de 5 fases` | Eliminar |
| `phase1`, `phase5` (en comentarios) | Reemplazar por `intake` / `delivery` si aplica |

---

# 8. Eliminar redirects legacy restantes

En server.ts, además de los ya mencionados en §3, eliminar TODOS los redirects de compatibilidad:

| Redirect actual | Acción |
|-----------------|--------|
| `knowledge` → `/console/agente/knowledge` | Eliminar |
| `memory` → `/console/agente/memory` | Eliminar |
| `prompts` → `/console/agente/identity` | Eliminar |
| `tools` → `/console/herramientas/tools` | Eliminar |
| `lead-scoring` → `/console/herramientas/lead-scoring` | Eliminar |
| `scheduled-tasks` → `/console/herramientas/scheduled-tasks` | Eliminar |
| `google-apps` → `/console/herramientas/google-apps` | Eliminar |
| `pipeline` → `/console/agente/advanced` | Eliminar (ya en §3) |
| `engine-metrics` → `/console/agente/engine-metrics` | Eliminar (ya en §3) |
| `users` → `/console/contacts/admin` | Eliminar (ya en §2c) |

Son bookmarks de URLs que ya no existen como páginas standalone. En un panel admin privado, un 404 es mejor que un redirect silencioso que oculta URLs obsoletas.

---

# Orden de ejecución sugerido

1. **§1** — Quitar PIPELINE_MAX_TOOL_CALLS_PER_TURN de Avanzado (1 archivo, 3 líneas)
2. **§2** — Cerrar migración users → contacts (2 archivos, ~20 cambios de string)
3. **§3 + §4** — Limpiar metadata pipeline + SECTION_REDIRECTS (4 archivos)
4. **§7 + §8** — Limpiar comentarios legacy + eliminar redirects (2 archivos)
5. **§5** — Partir templates-sections.ts (crear 5 archivos nuevos, refactor 1 existente)
6. **§6** — Extraer subrouters de server.ts (crear 4 archivos nuevos, refactor 1 existente)

Cada paso debe compilar limpio (`npx tsc --noEmit`) antes de avanzar al siguiente.

---

# Verificación final

1. `npx tsc --noEmit` — sin errores
2. Grep confirma:
   - Cero `action="/console/users/` en templates
   - Cero `SECTION_REDIRECTS` en imports
   - Cero `sec_pipeline` en i18n
   - Cero `Phase 4` o `Phase 5` en comentarios del módulo console
   - Cero redirects legacy en server.ts
3. `PIPELINE_MAX_TOOL_CALLS_PER_TURN` aparece solo en Herramientas > Tools
4. Cada archivo nuevo de templates-sections-*.ts exporta correctamente y es importado por el dispatcher
5. server.ts queda bajo ~600 líneas como orchestrador
