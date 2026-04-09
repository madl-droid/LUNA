# INFORME DE CIERRE — Sesión: Plan Templates Module
## Branch: claude/plan-templates-module-9WApf

### Objetivos definidos
Planificar e implementar el módulo `templates` — plantillas de documentos para Luna. Incluye: gestión de plantillas Drive, creación de documentos desde plantillas con `{KEY}` placeholders, re-edición in-place, organización en carpetas, sharing, strict mode, HITL, y subagente comparativo-researcher.

### Completado
- Diseño de arquitectura completa (3 planes secuenciales)
- Plan 1: Fundación — módulo skeleton, DB (migración 050), Drive extensions (copyFile, shareFileAnyone, updateFileContent), repository, service, console UI, template CRUD, auto-detección de keys
- Plan 2: Pipeline — 3 tools del agente (create-from-template, search-generated-documents, reedit-document), folder manager con dedup, re-edición in-place (mismo link), sharing "anyone with link", strict mode + HITL, catalog injection en prompt
- Plan 3: Subagente comparativo-researcher — migración 051 seed, system prompt, lifecycle (enable/disable con módulo), can_spawn_children para web-researcher, auto-tags, skill templates-usage.md
- Auditoría independiente ejecutada y mergeada
- Hardening post-auditoría: 10 fixes aplicados (2 bugs, 3 huecos funcionales, 3 DTs, 2 redundancias)

### No completado
- DT-2: Tests unitarios/integración (deuda consciente, no blocker)

### Archivos creados
- `src/modules/templates/manifest.ts` — lifecycle, config, console, API routes
- `src/modules/templates/types.ts` — DocTemplate, DocGenerated, configs, inputs
- `src/modules/templates/repository.ts` — CRUD raw SQL para doc_templates + doc_generated
- `src/modules/templates/service.ts` — createDocument, reeditDocument, scanKeysFromDrive, getCatalogForPrompt
- `src/modules/templates/tools.ts` — 3 tools registrados en tools:registry
- `src/modules/templates/folder-manager.ts` — resolveFolder con dedup + cache
- `src/modules/templates/render-section.ts` — console UI bilingüe server-side
- `src/modules/templates/comparativo-subagent.ts` — slug + system prompt
- `src/modules/templates/CLAUDE.md` — documentación del módulo
- `src/modules/templates/.env.example` — vars de entorno
- `src/migrations/050_templates-v1.sql` — tablas doc_templates + doc_generated + índices GIN
- `src/migrations/051_comparativo-subagent.sql` — seed comparativo-researcher
- `instance/prompts/system/skills/templates-usage.md` — skill del agente
- `docs/reports/AUDIT-plan-templates-module.md` — reporte de auditoría

### Archivos modificados
- `src/modules/google-apps/drive-service.ts` — +copyFile, +shareFileAnyone, +updateFileContent (con googleApiCall wrapper)
- `src/engine/prompts/context-builder.ts` — templates catalog injection
- `src/modules/knowledge/sync-manager.ts` — fix exportFile return type handling
- `CLAUDE.md` (raíz) — módulo templates agregado a listas

### Interfaces expuestas (exports que otros consumen)
- `templates:service` — TemplatesService (CRUD, createDocument, reeditDocument, scanKeys)
- `templates:catalog` — `{ getCatalogText(): Promise<string> }` (inyectado en prompt del agente)
- `templates:renderSection` — `(lang: string) => string` (HTML para consola)
- Tools: `create-from-template`, `search-generated-documents`, `reedit-document`
- Drive: `copyFile()`, `shareFileAnyone()`, `updateFileContent()` en DriveService

### Dependencias instaladas
- Ninguna nueva

### Tests
- Sin tests (deuda consciente DT-2)

### Decisiones técnicas
1. **Módulo propio vs sub-módulo de google-apps**: módulo `feature` independiente que depende de google-apps. Mismo patrón que freight.
2. **Re-edición in-place**: replaceText sobre el mismo doc (mismo link, Drive versiona automáticamente). No regenerar.
3. **Conflict fallback**: si dos keys comparten mismo valor → throw error descriptivo. El approach de export/re-upload corrompe Google Workspace files.
4. **Sharing**: todos los docs "anyone with link can view" a nivel Drive. Restricción de quién recibe el link es comportamental (tool guidance).
5. **Keys por plantilla**: cada plantilla define sus propios keys con descripciones. Auto-detección por regex `{KEY_NAME}`.
6. **Subagente comparativos**: system subagent, can_spawn_children (delega a web-researcher), sin tools propios, model_tier complex.
7. **Folder dedup**: búsqueda exacta antes de crear (Drive `contains` filtra parcial, match exacto client-side).
8. **FolderManager cacheado**: instancia persistente en service, no re-creada por llamada.

### Riesgos o deuda técnica
- **DT-2**: Sin tests. Riesgo bajo para v1 pero necesario para hardening.
- **Re-edición frágil si editan en Drive**: si alguien edita manualmente el doc en Drive entre creación y re-edición, los valores a reemplazar no matchean. replaceText silenciosamente no aplica. Documentado, no mitigado.
- **Skill redundante**: templates-usage.md duplica parcialmente el detailedGuidance de los tools. No daña, pero podría simplificarse.

### Notas para integración
- Mergear a `pruebas`. Migraciones 050 y 051 corren automáticamente al arrancar.
- El módulo arranca con `activateByDefault: false` — admin debe activarlo desde la consola.
- Requiere `google-apps` y `tools` activos. Si google-apps no está conectado (OAuth), los tools no se registran.
- El subagente comparativo-researcher se activa automáticamente al activar el módulo y se desactiva al desactivarlo.
