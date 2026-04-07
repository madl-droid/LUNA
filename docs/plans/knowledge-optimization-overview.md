# Knowledge Optimization — Overview de Ejecución

> **Sesión de planificación**: `claude/project-planning-session-nrsYJ`
> **Fecha**: 2026-04-07

## Resumen ejecutivo

Optimización integral del módulo Knowledge para:
1. Unificar la extracción de contenido con los extractores globales
2. Enriquecer embeddings con metadata contextual (descripciones admin, LLM, índices)
3. Habilitar profundización inteligente en documentos (`expand_knowledge`)
4. Obligar al agente a siempre buscar en knowledge antes de responder
5. Mejorar la UI/UX del panel de knowledge en console

## Planes

| # | Plan | Branch | Tareas | Depende de |
|---|------|--------|--------|-----------|
| 1 | [Extractores Globales](knowledge-optimization-plan1-extractors.md) | `feat/knowledge-extractors-integration` | 5 | — |
| 2 | [Deep Knowledge](knowledge-optimization-plan2-embeddings.md) | `feat/knowledge-deep-search` | 7 | Plan 1 |
| 3 | [UI/UX](knowledge-optimization-plan3-ui-ux.md) | `feat/knowledge-ui-ux` | 6 | Plan 1 |
| 4 | [Audit Fixes](knowledge-optimization-plan4-audit-fixes.md) | `feat/knowledge-audit-fixes` | 7 | Plans 1-3 |

## Orden de ejecución

```
                    ┌─── Plan 2: Deep Knowledge (7 tareas) ──┐
Plan 1 (5 tareas) ─┤                                         ├─ Plan 4: Audit Fixes (7 tareas) → PR
                    └─── Plan 3: UI/UX (6 tareas) ──────────┘
```

**Fase 1**: Plan 1 (secuencial, fundacional) ✅
**Fase 2**: Plan 2 + Plan 3 (en paralelo, branches independientes) ✅
**Fase 3**: Auditoría → Plan 4 (audit fixes, branch independiente) ← SIGUIENTE
**Fase 4**: Merge a planning branch → revisión → PR

## Branches

Todos derivan de `claude/project-planning-session-nrsYJ`:

```
claude/project-planning-session-nrsYJ  (planning branch - este)
├── feat/knowledge-extractors-integration  (Plan 1 - PRIMERO) ✅
├── feat/knowledge-deep-search             (Plan 2 - después de merge Plan 1) ✅
├── feat/knowledge-ui-ux                   (Plan 3 - después de merge Plan 1) ✅
└── feat/knowledge-audit-fixes             (Plan 4 - después de merge Plans 1-3) ← SIGUIENTE
```

## Qué resuelve cada plan

### Plan 1: Extractores Globales (Fundacional)
- **Bugs resueltos**: Google Docs body vacío, headings planos
- **Mejora**: PDF/Slides/DOCX con imágenes pasan por LLM vision
- **Unificación**: Todos los loaders usan extractores globales
- **Cleanup**: Código duplicado eliminado

### Plan 2: Deep Knowledge (Cerebro)
- **Nueva tool**: `expand_knowledge(documentId)` — profundizar en documentos
- **Search mejorado**: `search_knowledge` retorna documentId, chunkIndex, chunkTotal, sourceType
- **Core boost**: +0.15 en búsqueda para documentos core
- **Embeddings enriquecidos**: Descripciones admin/tab/column prepended al chunk content
- **Chunks índice**: Overview de contenido multi-documento
- **Shareable funcional**: Agente ve URLs compartibles en contexto
- **Mandato de búsqueda**: Instrucción hardcoded no-removible por admin
- **Cleanup**: `fullVideoEmbed` eliminado

### Plan 3: UI/UX (Console)
- **Bug fix**: wizard `wizState.itemId`
- **Mejora**: Detección de sourceType por servidor (no URL)
- **Nuevo**: Badges de pipeline (Visual, Texto, Video, CSV, Web)
- **Nuevo**: Toast informativo post-creación
- **Nuevo**: Conteo de fragmentos en items entrenados
- **Cleanup**: Dead code en UI

### Plan 4: Audit Fixes (Calidad)
- **[ALTO] Fix missing await**: `expand_knowledge` handler — try/catch era dead code
- **[ALTO] Fix index chunks duplicados**: hash determinístico + delete-before-insert en re-sync
- **[MEDIO] Cache invalidation**: `invalidateExpandCache()` conectado al re-training
- **[MEDIO] Refactor**: Extraer helpers para 4 patrones copy-paste (pageTexts + enrichWithLLM)
- **[MEDIO] Cleanup llmDescription**: Evaluar si eliminar o conectar parámetro muerto
- **[BAJO] Cleanup**: console.log, verify-url, skipScannerFallback, traducciones, dead code
- **[BAJO] Estabilizar**: Constantes compartidas para visual section matching

## Archivos impactados (consolidado)

### Plan 1
- `src/modules/google-apps/docs-service.ts`
- `src/modules/knowledge/item-manager.ts`
- `src/extractors/index.ts`
- `src/extractors/pdf.ts`
- `src/modules/knowledge/extractors/smart-chunker.ts`

### Plan 2
- `src/modules/knowledge/item-manager.ts`
- `src/modules/knowledge/pg-store.ts`
- `src/modules/knowledge/search-engine.ts`
- `src/modules/knowledge/types.ts`
- `src/modules/knowledge/manifest.ts`
- `src/modules/knowledge/knowledge-manager.ts`
- `src/engine/prompts/context-builder.ts`
- `src/engine/prompts/agentic.ts`
- `instance/prompts/system/knowledge-mandate.md` (NUEVO)

### Plan 3
- `src/modules/knowledge/console-section.ts`
- `src/modules/knowledge/manifest.ts`
- `src/modules/console/ui/styles/components.css`

### Archivo compartido (Plan 1 + Plan 2)
- `src/modules/knowledge/item-manager.ts` — Plan 1 refactoriza loaders, Plan 2 agrega prepend + index chunks

## Ruta de archivos

```
docs/plans/
├── knowledge-optimization-overview.md          ← ESTE ARCHIVO
├── knowledge-optimization-plan1-extractors.md  ← Plan 1 ✅
├── knowledge-optimization-plan2-embeddings.md  ← Plan 2 ✅
├── knowledge-optimization-plan3-ui-ux.md       ← Plan 3 ✅
└── knowledge-optimization-plan4-audit-fixes.md ← Plan 4 (audit fixes)
```

## Instrucciones para el ejecutor (Sonnet 4.6)

1. **Leer el plan completo** antes de empezar
2. **Leer los CLAUDE.md** de cada módulo que vayas a tocar
3. **Leer el código actual** de cada archivo antes de modificarlo
4. **Ejecutar tarea por tarea** en orden
5. **Compilar** después de cada tarea: `docker run --rm -v /docker/luna-repo:/app -w /app node:22-alpine npx tsc --noEmit`
6. **Commit** por tarea completada (no acumular)
7. **Push** al branch indicado cuando todas las tareas estén completas

## Notas de diseño

### ¿Por qué `expand_knowledge` en vez de solo CONSULTA_VIVA?
CONSULTA_VIVA solo funciona para recursos Google vivos (Sheets, Docs, Slides, Drive con OAuth). Para PDFs subidos por URL, webs, YouTube → no hay API viva. `expand_knowledge` es general: funciona para TODO tipo de contenido usando los chunks ya indexados.

### ¿Por qué instrucción hardcoded?
Los slots editables por admin (`identity`, `job`, `guardrails`) pueden ser modificados desde la consola. La instrucción de búsqueda obligatoria NO debe poder desactivarse. Se implementa como archivo `.md` en `instance/prompts/system/` (no editable desde console) inyectado directamente en `agentic.ts`.

### ¿Por qué eliminar `fullVideoEmbed`?
Es dead code — el flag existe en DB y types pero ningún código lo usa. Limpiarlo reduce confusión. La columna en DB se deja (no vale la pena una migración destructiva).

### ¿Por qué `liveQueryEnabled` no va en UI?
Es un flag del sistema que se auto-activa para recursos Google. El admin no debería desactivarlo manualmente — sería contraproducente. Si necesita control, se puede agregar después.
