# AUDITORÍA — Módulo Templates (rama `claude/plan-templates-module-9WApf`)

**Fecha**: 2026-04-08
**Auditor**: Claude (sesión de auditoría independiente)
**Scope**: Planes 1, 2, 3 + implementación completa del módulo `templates`
**Commits auditados**: `7d8dcb5` → `28819bf` → `c8733d3` → `61011eb`

---

## Resumen ejecutivo

El módulo templates es **funcional y bien estructurado**. Sigue los patrones del proyecto, usa los helpers del kernel, integra correctamente con Drive/Docs/Slides/Sheets, y la console UI es completa. Sin embargo, hay **2 bugs reales**, **3 huecos funcionales**, y **varias deudas técnicas** que deben resolverse antes de considerar esto production-ready.

**Veredicto**: 7/10 — Buen trabajo de fundación, pero necesita un pase de hardening.

---

## 1. BUGS (rompen funcionalidad)

### BUG-1: Colisión de migración 048 (CRÍTICO)
**Archivo**: `src/migrations/048_templates-v1.sql` vs `src/migrations/048_commitment-context-summary.sql`
**Problema**: Existen DOS archivos con el número 048. El migrador ejecuta archivos en orden léxico. `048_commitment-context-summary.sql` corre primero (la "c" va antes de "t"), luego `048_templates-v1.sql`. Si el migrador rastrea por nombre exacto, la tabla `schema_migrations` registra ambas. Pero si rastrea por número, una de las dos puede ser ignorada silenciosamente o causar un conflicto.
**Impacto**: Dependiendo de la implementación del migrador, podría no correr la migración de templates o la de commitment-context-summary en deploys existentes.
**Fix**: Renumerar `048_templates-v1.sql` → `050_templates-v1.sql` y `049_comparativo-subagent.sql` → `051_comparativo-subagent.sql`. (Nota: también hay colisiones pre-existentes en 014, 015, 025 — esto es deuda heredada, no de esta rama.)

### BUG-2: `FolderManager` usa `indexOf` para segmentos repetidos (MEDIO)
**Archivo**: `src/modules/templates/folder-manager.ts:39`
```typescript
const segmentPath = `${this.rootFolderId}:${segments.slice(0, segments.indexOf(segment) + 1).join('/')}`
```
**Problema**: Si el folder pattern resuelve a segmentos repetidos (ej: `"Nike/Shoes/Nike"`), `indexOf(segment)` siempre retorna el PRIMER índice de "Nike", no el actual en la iteración. El tercer segmento "Nike" generaría la ruta `"Nike"` en vez de `"Nike/Shoes/Nike"`, apuntando al folder equivocado.
**Impacto**: Bajo en la práctica (folder patterns con segmentos repetidos son raros), pero es un bug lógico real.
**Fix**: Usar un `for (let i = 0; i < segments.length; i++)` con el índice `i` explícito en vez de `for...of` + `indexOf`:
```typescript
for (let i = 0; i < segments.length; i++) {
  const segment = segments[i]!
  const segmentPath = `${this.rootFolderId}:${segments.slice(0, i + 1).join('/')}`
  // ...
}
```

---

## 2. HUECOS FUNCIONALES (no rompen pero faltan piezas)

### HUECO-1: `FolderManager` se re-instancia en cada `createDocument` — pierde cache
**Archivo**: `src/modules/templates/service.ts:199`
```typescript
const folderManager = new FolderManager(drive, this.config.TEMPLATES_ROOT_FOLDER_ID)
```
**Problema**: Se crea un `FolderManager` nuevo POR CADA llamada a `createDocument()`. El cache en memoria del FolderManager se pierde inmediatamente. Para 10 documentos del mismo tipo, hace 10 veces las mismas búsquedas de carpeta en Drive API.
**Fix**: Hacer `FolderManager` una propiedad de la clase `TemplatesService`, inicializarlo en el constructor (o lazy-init), e invalidar cache cuando cambie la config.

### HUECO-2: `deleteTemplate` no tiene ON CASCADE — falla si hay docs generados
**Archivo**: `src/migrations/048_templates-v1.sql:18` + `src/modules/templates/repository.ts:144`
**Problema**: `doc_generated.template_id` tiene `REFERENCES doc_templates(id)` SIN `ON DELETE CASCADE`. Si el admin elimina una plantilla que tiene documentos generados, el `DELETE FROM doc_templates WHERE id = $1` falla con FK violation.
**Impacto**: El admin no puede eliminar plantillas que ya generaron documentos. La UI mostrará un error genérico.
**Fix**: Dos opciones:
1. Agregar `ON DELETE SET NULL` y hacer `template_id` nullable (los docs generados sobreviven como huérfanos)
2. Agregar soft-delete en la UI: deshabilitar en vez de borrar si hay docs generados (más pragmático)
3. En el `deleteTemplate` del repository, primero verificar si hay docs generados y retornar error descriptivo

### HUECO-3: Re-edición con conflicto no funciona para Google Workspace files
**Archivo**: `src/modules/templates/service.ts:277-293`
**Problema**: El fallback de conflicto hace: `exportFile(template) → updateFileContent(doc, buffer)`. Pero `updateFileContent` sube un archivo Office (.docx/.pptx/.xlsx) como nueva "media" sobre un Google Workspace file ID. Google Drive NO convierte automáticamente Office → Google Workspace en un `files.update` con media — crea una revisión binaria que rompe el formato nativo. El documento dejaría de ser editable como Google Doc.
**Impacto**: El caso de conflicto (dos keys con mismo valor anterior) corrompería el documento.
**Fix**: La re-edición con conflicto debería:
1. Copiar la plantilla original a un nuevo archivo temporal
2. Llenar keys en el temporal
3. Eliminar el archivo original y mover el temporal al mismo folder (pierde historial de revisiones pero mantiene formato)
4. O simplemente: copiar template fresh, llenar todo, archivar el viejo y notificar que el link cambió

**Nota honesta**: Este escenario es extremadamente raro (requiere que dos keys distintos tengan el mismo valor literal en el documento). Pragmáticamente, un `logger.warn` + error descriptivo al usuario ("No se puede re-editar este documento por conflicto de valores, se creará uno nuevo") sería suficiente en v1.

---

## 3. DEUDA TÉCNICA

### DT-1: `exportFile` cambio de return type es breaking para otros callers
**Archivo**: `src/modules/google-apps/drive-service.ts:238`
**Cambio**: `exportFile` pasó de `Promise<string>` a `Promise<string | Buffer>`.
**Problema**: Cualquier caller existente de `exportFile` que esperaba `string` ahora recibirá `string | Buffer` sin error de TS pero con posible runtime mismatch. El templates module maneja ambos tipos correctamente, pero hay que verificar que ningún otro módulo llame a `exportFile`.
**Acción**: Verificar todos los callers de `drive.exportFile()` en el codebase.

### DT-2: No hay tests
**Problema**: Cero tests para el módulo. Ni unitarios ni de integración.
**Acción mínima**: Tests para:
- `_extractKeys` (regex parsing)
- `FolderManager.resolveFolder` (cache, dedup, segments)
- `repository` (mappers, SQL queries con DB mock)

### DT-3: No hay validación de `TEMPLATES_NO_TEMPLATE_ACTION`
**Archivo**: `src/modules/templates/manifest.ts:42`
```typescript
TEMPLATES_NO_TEMPLATE_ACTION: z.string().default('hitl'),
```
**Problema**: Acepta cualquier string. Si alguien pone `"bloquear"` en vez de `"block"`, el sistema no hace nada (cae al else de `warn` silenciosamente en el tool handler).
**Fix**: Usar `z.enum(['warn', 'block', 'hitl']).default('hitl')`.

### DT-4: Tags auto-generados solo cubren keywords en inglés/español
**Archivo**: `src/modules/templates/tools.ts:110-118`
```typescript
const tagKeywords = ['brand', 'competitor', 'product', 'company', 'marca', 'competidor']
```
**Problema**: Si el admin nombra los keys `NOMBRE_EMPRESA` o `PRODUCTO_COMPETENCIA`, no se auto-generan tags. La dedup de comparativos depende de tags.
**Impacto**: Bajo — el agente puede pasar tags explícitamente. Pero la auto-generación silenciosamente no funciona para muchos nombres de keys.
**Sugerencia**: Documentar en la CLAUDE.md que los tags son opcionales pero recomendados para comparativos, y que el admin debería nombrar keys con alguno de los keywords listados.

### DT-5: `shareFileAnyone` no usa `googleApiCall` wrapper
**Archivo**: `src/modules/google-apps/drive-service.ts:297-311`
**Problema**: `copyFile` usa `googleApiCall` (con timeout + retry), pero `shareFileAnyone` llama `this.drive.permissions.create` directamente sin wrapper. Si la API de permisos falla por rate limit o timeout, no hay retry.
**Fix**: Envolver en `googleApiCall`.

### DT-6: `updateFileContent` no usa `googleApiCall` wrapper
**Archivo**: `src/modules/google-apps/drive-service.ts:313-327`
**Problema**: Misma situación que DT-5.

---

## 4. COMPLEJIDAD INNECESARIA

### CI-1: El fallback de re-edición con conflicto es over-engineering para v1
**Archivo**: `src/modules/templates/service.ts:270-295`
**Problema**: El caso de conflicto (dos keys distintos con mismo valor anterior) es extremadamente improbable en uso real. Se escribieron ~25 líneas de lógica de fallback (export → upload → re-fill) que además **no funciona correctamente** (ver HUECO-3).
**Sugerencia**: Reemplazar con un `throw new Error('Conflicto de valores en re-edición: dos campos comparten el mismo valor actual. Crea un documento nuevo.')`. Simple, honesto, y evita la corrupción.

---

## 5. REDUNDANCIAS / DUPLICACIONES

### RD-1: `listGenerated` y `searchGenerated` son casi idénticos
**Archivo**: `src/modules/templates/repository.ts`
**Problema**: `listGenerated` (línea 155) y `searchGenerated` (línea 232) hacen exactamente lo mismo — construyen un query dinámico con los mismos filtros. La única diferencia es que `listGenerated` tiene LIMIT fijo de 100 y `searchGenerated` acepta un `limit` parámetro.
**Sugerencia**: Unificar en una sola función con `limit` configurable. Eliminar `listGenerated` y usar `searchGenerated` en todos lados.

### RD-2: `service.listGeneratedDocs` y `service.searchGeneratedDocs` delegan a funciones casi idénticas
**Archivo**: `src/modules/templates/service.ts`
**Problema**: Son wrappers 1:1 que llaman a `repo.listGenerated` y `repo.searchGenerated` respectivamente. Misma observación que RD-1.

---

## 6. VIOLACIONES DE POLÍTICAS

### VP-1: Ninguna violación de `process.env` — ✅ LIMPIO
El módulo usa `configSchema` y `registry.getConfig()` correctamente.

### VP-2: Usa `jsonResponse`, `parseBody`, `parseQuery` del kernel — ✅ LIMPIO
No redefine ningún helper HTTP.

### VP-3: Usa `boolEnv` del kernel — ✅ LIMPIO
Config schema usa helpers correctos.

### VP-4: No hay imports directos entre módulos para comunicación — ✅ LIMPIO
Usa `registry.getOptional()` para servicios de otros módulos.

### VP-5: CLAUDE.md del módulo creado y referenciado — ✅ LIMPIO

### VP-6: `.env.example` creado — ✅ LIMPIO

### VP-7: `noUncheckedIndexedAccess` — ⚠️ REVISAR
**Archivo**: `src/modules/templates/tools.ts:97`
```typescript
templateId = templates[0]!.id
```
Usa `!` con guard previo (`templates.length === 0` early return). Correcto.

**Archivo**: `src/modules/templates/render-section.ts` — JavaScript client-side (no aplica tsconfig).

### VP-8: ESM imports con extensión `.js` — ✅ LIMPIO
Todos los imports usan `.js`.

---

## 7. COSAS BIEN HECHAS (mérito donde corresponde)

1. **Drive extensions limpias**: `copyFile`, `shareFileAnyone`, `updateFileContent` siguen el patrón existente del drive-service. `supportsAllDrives: true` en todas las llamadas.
2. **Tool guidance excelente**: `detailedGuidance` en los 3 tools es claro, específico, y guía correctamente al agente.
3. **Catalog injection en context-builder**: Sigue el patrón existente (como HITL rules), no inventa nada nuevo.
4. **Console UI completa y funcional**: CRUD, scan-keys, edit pre-populate, generated docs table. Todo con i18n.
5. **Key regex con `lastIndex` reset**: Correctamente reseteado a 0 antes de cada búsqueda (trampa conocida de regex global).
6. **Subagent lifecycle correcto**: Enable en `init()`, disable en `stop()`, reload catalog. Patrón idéntico a gcal-scheduler.
7. **Doc dedup via GIN index en tags**: Eficiente y correcto para el caso de comparativos.
8. **`createGenerated` con subquery**: Elegante — `doc_type` se hereda del template via `SELECT ... FROM doc_templates WHERE id = $1`, evitando inconsistencia.
9. **HITL integration**: Cuando strict + no template + action=hitl, crea ticket correctamente usando la interfaz `CreateTicketInput`.

---

## 8. PLAN DE ACCIÓN (priorizado)

| # | Severidad | Item | Esfuerzo |
|---|-----------|------|----------|
| 1 | CRÍTICO | Renumerar migraciones 048→050, 049→051 | 5 min |
| 2 | MEDIO | Fix FolderManager `indexOf` bug → usar `for(let i)` | 5 min |
| 3 | MEDIO | Hacer FolderManager instancia de clase (no re-crear) | 10 min |
| 4 | MEDIO | Fix deleteTemplate FK constraint (verificar o soft-delete) | 15 min |
| 5 | BAJO | Reemplazar conflict fallback con error descriptivo | 10 min |
| 6 | BAJO | Validar `TEMPLATES_NO_TEMPLATE_ACTION` con `z.enum` | 2 min |
| 7 | BAJO | Wrappear `shareFileAnyone` y `updateFileContent` en `googleApiCall` | 10 min |
| 8 | BAJO | Unificar `listGenerated`/`searchGenerated` | 10 min |
| 9 | DEUDA | Verificar callers de `exportFile` (return type cambió) | 10 min |
| 10 | DEUDA | Tests mínimos para regex, folder manager, repository | 2-4 hrs |

**Items 1-2 son blockers para merge.**
Items 3-6 son recomendados para v1.
Items 7-10 pueden ir en un pase posterior de hardening.

---

## 9. OPINIONES HONESTAS

### Sobre la arquitectura general
El approach es correcto. Un módulo `feature` que consume servicios de `google-apps` via registry es el patrón estándar de LUNA. No hay nada que reinventar aquí.

### Sobre la complejidad del comparativo-researcher
Buena decisión hacer que sea el AGENTE principal quien decide el flujo, no el tool handler. El tool solo provee mecánica (crear, buscar, re-editar), y el `detailedGuidance` + la skill de templates guían al agente. Esto es más resiliente que hardcodear lógica de decisión en el handler.

Sin embargo, el subagente `comparativo-researcher` es esencialmente un **prompt disfrazado de subagente**. No tiene tools propios (`allowed_tools: {}`), no tiene lógica especial — solo un system prompt que dice "investiga y retorna JSON". El mismo resultado se podría lograr con una instrucción en el `detailedGuidance` del tool diciendo "para comparativos, primero investiga con web-researcher antes de llenar keys". Pero entiendo la decisión de mantener modularidad y métricas del subagente.

### Sobre re-edición in-place
La idea de re-editar el mismo archivo de Drive (mantener el link) es buena UX. Pero el approach de `replaceText(oldValue, newValue)` es frágil: si el usuario editó manualmente el documento en Drive entre la creación y la re-edición, los valores a reemplazar ya no matchean. No hay fallback para este caso — el reemplazo silenciosamente no aplica y el DB queda desincronizado del documento real.

**Sugerencia pragmática**: Agregar un check post-reemplazo (re-leer el documento y verificar que los nuevos valores aparecen), o documentar la limitación.

### Sobre el skill file
`instance/prompts/system/skills/templates-usage.md` es redundante con el `detailedGuidance` de los tools. El agente ya recibe el guidance cuando usa los tools. El skill solo agrega valor si el agente necesita decidir ANTES de usar un tool si debería usar templates. En la práctica, el catalog injection en el prompt ya cubre esto.

No es un problema — es una capa extra de guía que no hace daño. Pero si buscas eficiencia, podrías eliminarlo y confiar en el catalog + tool guidance.
